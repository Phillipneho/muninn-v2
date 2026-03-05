// Muninn v2 Unified Observation Extractor
// Replaces binary Event/Fact extraction with tagged observations

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export interface Observation {
  entity_name: string;
  tags: string[];           // ['IDENTITY', 'TRAIT', 'ACTIVITY', 'STATE']
  predicate: string;        // 'is', 'painted', 'attended', 'identifies_as'
  content: string;          // The value or description
  valid_from?: string;       // ISO timestamp when this became true
  valid_until?: string;      // ISO timestamp when this stopped being true (rare)
  confidence: number;
  evidence?: string;         // Exact quote from text
  metadata?: Record<string, any>;
}

export interface ExtractionResult {
  entities: Array<{ name: string; type: string }>;
  observations: Observation[];
}

/**
 * The Universal Observer Prompt (v5.0)
 * 
 * Core principle: Be an Aggressive Collector of signal.
 * If a fact is stated, capture it. Do not require a "change" to have occurred.
 * 
 * CRITICAL IMPROVEMENTS v5.0:
 * - Better temporal resolution for "last week", "ten years ago", "the week before X"
 * - Extract specific key events (speeches, birthdays, etc.)
 * - Handle age-related events
 */
const OBSERVATION_PROMPT = `You are the Muninn Knowledge Extracter. Your job is to extract EVERY assertion from the text as tagged observations.

## Critical: Extract for ALL Speakers
Do not focus only on one person. Extract observations about EVERY entity mentioned.

## Tag Definitions (use multiple tags when appropriate)

| Tag | Definition | Examples | Persistence |
|-----|------------|----------|-------------|
| IDENTITY | Core definitions of who someone is | "is transgender", "is from Sweden", "is a mother" | Permanent |
| TRAIT | Persistent habits, skills, preferences | "paints sunrises", "plays violin", "enjoys hiking" | Long-term |
| ACTIVITY | One-off events with timestamps | "attended support group May 7", "ran charity race" | Temporal |
| STATE | Current values that can change | "works at TechCorp", "lives in Brisbane", "is single" | Updateable |

## Tagging Rules

1. **Multi-tag**: An observation can have multiple tags
   - "Melanie paints sunrises" → ["TRAIT", "ACTIVITY"] (shows she's an artist AND happened)
   - "Caroline is transgender" → ["IDENTITY", "STATE"]

2. **No oldValue required**: If something is stated, capture it
   - Do NOT ignore "painted a sunrise" just because it's not a state change

3. **Natural predicates**: Use the verb from the text
   - "painted", "attended", "is", "researched", "moved from"
   - IMPORTANT: Use specific verbs for key events:
     - "gave a talk/speech/presentation" → predicate: "gave_speech"
     - "talked about my journey/story" → predicate: "talked_about"
     - "went to support group" → predicate: "attended"
     - "met up with" → predicate: "met_up_with"

4. **Temporal resolution** (CRITICAL): Convert relative dates to ISO EX
   SessionACT dates Date: {sessionDate}
   
   Calculate EXACT dates:
   - "yesterday" → session_date - 1 day
   - "last week" → session_date - 7 days (calculate exact date)
   - "last Saturday" → Find the Saturday before session_date
   - "ten years ago" → Calculate: session_year - 10
   - "the week before [date]" → Calculate exact date (7 days before)
   - "last month" → Same day previous month
   
   ALWAYS output as "YYYY-MM-DD" format for valid_from

5. **Age and duration events**:
   - "my 18th birthday ten years ago" → Extract TWO observations:
     1. predicate: "had_18th_birthday", content: "age 18", valid_from: "2013-XX-XX" (session year - 10)
     2. predicate: "received_gift", content: "hand-painted bowl", valid_from: "2013-XX-XX"
   - "has known friends for 4 years" → predicate: "has_known_friends", content: "for 4 years", valid_from: null (it's a duration, not a date)

6. **Key events to extract precisely**:
   - "school event" + "talked about journey" → predicate: "gave_speech" or "presented"
   - "support group" → predicate: "attended" (support group)
   - "workshop" → predicate: "attended" (workshop)
   - "charity race" → predicate: "ran" (charity race)

7. **Implicit identity extraction** (CRITICAL):
   - If someone mentions "transgender journey", "LGBTQ+ community", "trans community" → Extract:
     - predicate: "identifies_as", content: "transgender", tags: ["IDENTITY"]
   - If someone says "my grandma in my home country, Sweden" → Extract:
     - predicate: "is_from", content: "Sweden", tags: ["IDENTITY"]
   - Context clues are valid sources for identity!

## Extraction Examples

Input: "Melanie: Yeah, I painted that lake sunrise last year! It's special to me."
Output:
{
  "observations": [
    {
      "entity_name": "Melanie",
      "tags": ["TRAIT", "ACTIVITY"],
      "predicate": "painted",
      "content": "lake sunrise",
      "valid_from": "2022-01-01",
      "confidence": 0.95,
      "evidence": "I painted that lake sunrise last year!"
    }
  ]
}

Input: "Caroline: I went to a LGBTQ support group yesterday."
Session Date: "2023-05-08"
Output:
{
  "observations": [
    {
      "entity_name": "Caroline",
      "tags": ["ACTIVITY"],
      "predicate": "attended",
      "content": "LGBTQ support group",
      "valid_from": "2023-05-07",
      "confidence": 0.95,
      "evidence": "I went to a LGBTQ support group yesterday"
    }
  ]
}

Input: "Caroline: My friend made it for my 18th birthday ten years ago."
Session Date: "2023-05-08"
Output:
{
  "observations": [
    {
      "entity_name": "Caroline",
      "tags": ["ACTIVITY"],
      "predicate": "had_18th_birthday",
      "content": "age 18",
      "valid_from": "2013-05-08",
      "confidence": 0.9,
      "evidence": "my 18th birthday ten years ago"
    },
    {
      "entity_name": "Caroline",
      "tags": ["TRAIT"],
      "predicate": "received_gift",
      "content": "hand-painted bowl from friend",
      "valid_from": "2013-05-08",
      "confidence": 0.9,
      "evidence": "A friend made it for my 18th birthday ten years ago"
    }
  ]
}

Input: "Caroline: I wanted to tell you about my school event last week. I talked about my transgender journey."
Session Date: "2023-06-09"
Output:
{
  "observations": [
    {
      "entity_name": "Caroline",
      "tags": ["ACTIVITY"],
      "predicate": "gave_speech",
      "content": "at school about transgender journey",
      "valid_from": "2023-06-02",
      "confidence": 0.95,
      "evidence": "I wanted to tell you about my school event last week"
    },
    {
      "entity_name": "Caroline",
      "tags": ["ACTIVITY"],
      "predicate": "talked_about",
      "content": "transgender journey at school event",
      "valid_from": "2023-06-02",
      "confidence": 0.9,
      "evidence": "I talked about my transgender journey"
    }
  ]
}

Input: "Caroline: I met up with my friends, family, and mentors last week."
Session Date: "2023-06-09"
Output:
{
  "observations": [
    {
      "entity_name": "Caroline",
      "tags": ["ACTIVITY"],
      "predicate": "met_up_with",
      "content": "friends, family, and mentors",
      "valid_from": "2023-06-02",
      "confidence": 0.95,
      "evidence": "I met up with my friends, family, and mentors last week"
    }
  ]
}

Input: "Caroline: I've known my current group of friends for 4 years."
Output:
{
  "observations": [
    {
      "entity_name": "Caroline",
      "tags": ["STATE"],
      "predicate": "has_known_friends",
      "content": "current group of friends for 4 years",
      "valid_from": null,
      "confidence": 0.9,
      "evidence": "I've known my current group of friends for 4 years"
    }
  ]
}

## Session Date
Use this to resolve relative dates: {sessionDate}

## Output Format

{
  "entities": [
    {"name": "Caroline", "type": "person"},
    {"name": "Melanie", "type": "person"}
  ],
  "observations": [
    {
      "entity_name": "Caroline",
      "tags": ["IDENTITY"],
      "predicate": "identifies_as",
      "content": "transgender woman",
      "valid_from": null,
      "confidence": 1.0,
      "evidence": "I am a transgender woman"
    }
  ]
}

## Conversation to Process:

{conversation}

Extract ALL observations. Be aggressive. Capture EVERY fact. Output valid JSON only.`;

export class ObservationExtractor {
  
  async extract(content: string, sessionDate?: string, retries: number = 3): Promise<ExtractionResult> {
    const prompt = OBSERVATION_PROMPT
      .replace('{sessionDate}', sessionDate || new Date().toISOString().split('T')[0])
      .replace('{conversation}', content);
    
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are a precise knowledge extraction system. Output valid JSON only. Extract EVERY assertion as a tagged observation.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.1,
          max_tokens: 4000,
          response_format: { type: 'json_object' }
        });
        
        const text = response.choices[0]?.message?.content || '{"entities":[],"observations":[]}';
        
        const result = JSON.parse(text) as ExtractionResult;
        return this.validateAndClean(result);
      } catch (e: any) {
        lastError = e;
        // Retry on transient errors (rate limits, server errors)
        if (e.status === 429 || e.status === 500 || e.status === 502 || e.status === 503) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
          console.log(`   ⚠️ API error ${e.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw e;
      }
    }
    
    console.error('Failed to extract after', retries, 'retries:', lastError?.message);
    return { entities: [], observations: [] };
  }
  
  private validateAndClean(result: ExtractionResult): ExtractionResult {
    return {
      entities: result.entities.map(e => ({
        name: this.normalizeName(e.name),
        type: this.validateEntityType(e.type)
      })),
      observations: result.observations.map(o => ({
        entity_name: this.normalizeName(o.entity_name),
        tags: this.validateTags(o.tags),
        predicate: this.normalizePredicate(o.predicate),
        content: (o.content || '').toString().trim(),
        valid_from: this.normalizeDate(o.valid_from),
        valid_until: this.normalizeDate(o.valid_until),
        confidence: Math.min(1, Math.max(0, o.confidence || 0.8)),
        evidence: o.evidence?.trim(),
        metadata: o.metadata
      }))
    };
  }
  
  private normalizeName(name: string): string {
    if (!name) return '';
    return name.trim()
      .replace(/^(the|a|an)\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  private validateTags(tags: string[]): string[] {
    const validTags = ['IDENTITY', 'TRAIT', 'ACTIVITY', 'STATE'];
    const normalized = tags.map(t => t.toUpperCase());
    // Ensure at least one valid tag
    const valid = normalized.filter(t => validTags.includes(t));
    if (valid.length === 0) {
      return ['ACTIVITY']; // Default to ACTIVITY if no valid tags
    }
    return valid;
  }
  
  private validateEntityType(type: string): string {
    const validTypes = ['person', 'org', 'project', 'concept', 'location', 'technology', 'event'];
    const normalized = type.toLowerCase().trim();
    
    const mappings: Record<string, string> = {
      'person': 'person',
      'people': 'person',
      'human': 'person',
      'user': 'person',
      'organization': 'org',
      'org': 'org',
      'company': 'org',
      'team': 'org',
      'group': 'org',
      'project': 'project',
      'task': 'project',
      'initiative': 'project',
      'product': 'project',
      'concept': 'concept',
      'idea': 'concept',
      'topic': 'concept',
      'location': 'location',
      'place': 'location',
      'city': 'location',
      'country': 'location',
      'technology': 'technology',
      'tech': 'technology',
      'tool': 'technology',
      'platform': 'technology',
      'language': 'technology',
      'event': 'event'
    };
    
    return mappings[normalized] || 'concept';
  }
  
  private normalizePredicate(predicate: string): string {
    return predicate.toLowerCase()
      .trim()
      .replace(/\s+/g, '_')
      .replace(/^(is_|are_|was_|were_)/, '')
      .replace(/_+/g, '_');
  }
  
  private normalizeDate(date?: string): string | undefined {
    if (!date) return undefined;
    
    // Already ISO format
    if (/^\d{4}-\d{2}-\d{2}/.test(date)) return date.split('T')[0];
    
    // Try to parse
    try {
      const parsed = new Date(date);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().split('T')[0];
      }
    } catch {}
    
    return undefined;
  }
}

// Weight calculation for retrieval
export function calculateObservationWeight(observation: { tags: string[] }, similarity: number = 1.0): number {
  const WEIGHTS: Record<string, number> = {
    'IDENTITY': 10.0,
    'STATE': 5.0,
    'TRAIT': 3.0,
    'ACTIVITY': 1.0
  };
  
  // Use the highest weight tag
  const maxWeight = Math.max(...observation.tags.map(t => WEIGHTS[t] || 1.0));
  return similarity * maxWeight;
}