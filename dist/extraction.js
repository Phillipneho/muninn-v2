// Muninn v2 Enhanced Fact Extraction Pipeline
// Phase 1: Improved extraction with temporal parsing, coreference resolution, and confidence scoring
import OpenAI from 'openai';
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});
// Enhanced extraction prompt with coreference resolution and identity detection
const EXTRACTION_PROMPT_V2 = `You are a precise fact extraction system. Extract atomic facts, entities, and events from conversations.

## CRITICAL: IDENTITY & STATE DETECTION (P1)
You MUST capture declarative statements about identity, relationships, and permanent states. These are NOT actions - they are facts about WHO someone IS.

Examples:
- "I am a transgender woman" → fact: {subject: "Caroline", predicate: "identity", object: "transgender woman", confidence: 1.0}
- "She identifies as non-binary" → fact: {subject: "She", predicate: "gender_identity", object: "non-binary"}
- "I'm single" → fact: {subject: "I", predicate: "relationship_status", object: "single"}
- "I'm from Sweden" → fact: {subject: "I", predicate: "from", object: "Sweden"}
- "My name is Caroline" → fact: {subject: "I", predicate: "name", object: "Caroline"}
- "I have a dog named Max" → fact: {subject: "I", predicate: "has_pet", object: "Max"}
- "I've been married for 5 years" → fact: {subject: "I", predicate: "marriage_duration", object: "5 years"}

DO NOT skip these. They are foundational identity facts, not events or actions.

## COREFERENCE RESOLUTION
Before extracting facts, resolve all pronouns and references to their antecedents:
- "I", "me", "my" → identify the speaker
- "he", "she", "they" → find the referenced person
- "it", "that" → find the referenced concept/object
- "we", "our" → identify the group

## TEMPORAL PARSING
Convert relative dates to ISO dates based on the session date:
- "yesterday" → session_date - 1 day
- "last week" → session_date - 7 days
- "two days ago" → session_date - 2 days
- "last month" → session_date - 1 month
- "recently" → session_date (approximate)
- "The Sunday before May 25" → Calculate: find Sunday before the given date
- "The week before 14 August 2023" → week of Aug 7-13, 2023

## FACT EXTRACTION RULES
1. Each fact must be ATOMIC - one subject, one predicate, one object
2. Extract temporal information (validFrom)
3. Assign confidence:
   - 1.0 = explicitly stated ("I work at Acme")
   - 0.9 = strongly implied ("My company Acme...")
   - 0.7 = inferred ("The team at Acme...")
   - 0.5 = uncertain ("I think I might...")
4. Include evidence - the EXACT quote that supports the fact

## ENTITY TYPES
- person: named individuals
- org: organizations, companies, groups
- project: specific initiatives, products
- concept: abstract ideas, topics
- location: physical places
- technology: tools, platforms, languages

## EVENT EXTRACTION
Extract state transitions:
- oldValue (what was true before)
- newValue (what is true now)
- cause (why it changed, if stated)

OUTPUT FORMAT (JSON):
{
  "speaker": "Name of the primary speaker",
  "facts": [
    {
      "subject": "Caroline",
      "predicate": "attends",
      "object": "LGBTQ support group",
      "objectType": "entity",
      "validFrom": "2023-05-07",
      "confidence": 1.0,
      "evidence": "I went to the LGBTQ support group yesterday"
    },
    {
      "subject": "Caroline",
      "predicate": "identity",
      "object": "transgender woman",
      "objectType": "literal",
      "confidence": 1.0,
      "evidence": "I am a transgender woman"
    },
    {
      "subject": "Caroline",
      "predicate": "relationship_status",
      "object": "single",
      "objectType": "literal",
      "confidence": 1.0,
      "evidence": "I'm single"
    }
  ],
  "entities": [
    {"name": "Caroline", "type": "person"},
    {"name": "LGBTQ support group", "type": "org"}
  ],
  "events": [
    {
      "entity": "Caroline",
      "attribute": "attendance",
      "oldValue": null,
      "newValue": "LGBTQ support group",
      "occurredAt": "2023-05-07",
      "cause": "seeking support"
    }
  ]
}

CONVERSATION:
"""
{conversation}
"""

SESSION DATE: {sessionDate}

Extract facts, entities, and events. Resolve all coreferences. Parse temporal expressions. Output valid JSON only.`;
export class FactExtractor {
    async extract(content, sessionDate) {
        const prompt = EXTRACTION_PROMPT_V2
            .replace('{conversation}', content)
            .replace('{sessionDate}', sessionDate || new Date().toISOString().split('T')[0]);
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: 'You are a precise fact extraction system. Resolve coreferences, parse temporal expressions, and extract atomic facts. Output valid JSON only.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.1,
            max_tokens: 3000,
            response_format: { type: 'json_object' }
        });
        const text = response.choices[0]?.message?.content || '{}';
        try {
            const result = JSON.parse(text);
            return this.validateAndClean(result);
        }
        catch (e) {
            console.error('Failed to parse extraction result:', e);
            return { facts: [], entities: [], events: [] };
        }
    }
    validateAndClean(result) {
        return {
            facts: result.facts.map(f => ({
                subject: this.normalizeEntityName(f.subject),
                predicate: this.normalizePredicate(f.predicate),
                object: this.normalizeEntityName(f.object),
                objectType: f.objectType === 'entity' ? 'entity' : 'literal',
                validFrom: this.normalizeDate(f.validFrom),
                confidence: Math.min(1, Math.max(0, f.confidence || 0.8)),
                evidence: f.evidence?.trim() || ''
            })),
            entities: result.entities.map(e => ({
                name: this.normalizeEntityName(e.name),
                type: this.validateEntityType(e.type)
            })),
            events: result.events.map(e => ({
                entity: this.normalizeEntityName(e.entity),
                attribute: this.normalizePredicate(e.attribute),
                oldValue: e.oldValue ? this.normalizeEntityName(e.oldValue) : undefined,
                newValue: this.normalizeEntityName(e.newValue),
                occurredAt: this.normalizeDate(e.occurredAt),
                cause: e.cause?.trim()
            }))
        };
    }
    normalizeEntityName(name) {
        if (!name)
            return '';
        return name.trim()
            .replace(/^(the|a|an)\s+/i, '') // Remove articles
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
    }
    normalizePredicate(predicate) {
        return predicate.toLowerCase()
            .trim()
            .replace(/\s+/g, '_')
            .replace(/^(is_|are_|was_|were_)/, '') // Remove be-verbs
            .replace(/_+/g, '_'); // Normalize underscores
    }
    normalizeDate(date) {
        if (!date)
            return undefined;
        // Already ISO format
        if (/^\d{4}-\d{2}-\d{2}$/.test(date))
            return date;
        // Relative dates - parse with date-fns or return as-is
        // For now, just return the date as-is (LLM should handle conversion)
        return date;
    }
    validateEntityType(type) {
        const validTypes = ['person', 'org', 'project', 'concept', 'location', 'technology'];
        const normalized = type.toLowerCase().trim();
        // Map common variations
        const mappings = {
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
            'language': 'technology'
        };
        return mappings[normalized] || 'concept';
    }
}
// Enhanced entity resolution with fuzzy matching and confidence
export function resolveEntities(extracted, existing) {
    const resolved = new Map();
    for (const entity of extracted) {
        const normalizedName = entity.name.toLowerCase().trim();
        // Exact match
        for (const [existingName, data] of existing) {
            if (existingName === normalizedName) {
                resolved.set(entity.name, { id: data.id, confidence: 1.0, isNew: false });
                break;
            }
            // Alias match
            if (data.aliases.some(alias => alias.toLowerCase() === normalizedName)) {
                resolved.set(entity.name, { id: data.id, confidence: 0.95, isNew: false });
                break;
            }
            // Fuzzy match (Levenshtein distance)
            const distance = levenshteinDistance(normalizedName, existingName);
            const maxLength = Math.max(normalizedName.length, existingName.length);
            const similarity = 1 - (distance / maxLength);
            if (similarity > 0.8) {
                resolved.set(entity.name, { id: data.id, confidence: similarity, isNew: false });
                break;
            }
            // Partial match (one name contains the other)
            if (normalizedName.includes(existingName) || existingName.includes(normalizedName)) {
                const partialConfidence = Math.min(normalizedName.length, existingName.length) /
                    Math.max(normalizedName.length, existingName.length);
                if (partialConfidence > 0.5) {
                    resolved.set(entity.name, { id: data.id, confidence: partialConfidence * 0.8, isNew: false });
                    break;
                }
            }
        }
        // No match - create new
        if (!resolved.has(entity.name)) {
            resolved.set(entity.name, { id: '', confidence: 1.0, isNew: true });
        }
    }
    return resolved;
}
// Levenshtein distance for fuzzy matching
function levenshteinDistance(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            }
            else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
            }
        }
    }
    return matrix[b.length][a.length];
}
// Enhanced contradiction detection with state change tracking
export function detectContradictions(newFact, existingFacts) {
    const contradictions = [];
    // Predicates that are transient (temporary states) - don't create events
    // These represent fleeting states, not permanent life changes
    const TRANSIENT_PATTERNS = [
        'is_at', 'is_with', 'is_feeling', 'mood', 'current_activity',
        'is_doing', 'is_thinking', 'currently', 'temporarily', 'at_',
        'at', 'location', 'is', 'was_at', 'went_to', 'visited',
        'walking', 'doing', 'feeling', 'thinking', 'current'
    ];
    // Predicates that are persistent (permanent state changes) - create events
    // These represent significant life changes that should be tracked
    const PERSISTENT_PATTERNS = [
        'lives_in', 'moved_to', 'job', 'employment', 'relationship_status',
        'married_to', 'partner', 'education', 'career', 'identity',
        'employer', 'works_at', 'residence', 'home', 'lives'
    ];
    for (const existing of existingFacts) {
        // Skip if objects are null/undefined
        const existingObj = existing.object?.toLowerCase() || '';
        const newObj = newFact.object?.toLowerCase() || '';
        // Same subject, same predicate, different object
        if (existing.subject.toLowerCase() === newFact.subject.toLowerCase() &&
            existing.predicate === newFact.predicate &&
            existingObj !== newObj) {
            // Determine if this is a transient or persistent predicate
            const predicate = newFact.predicate.toLowerCase();
            // Check exact matches first (most reliable)
            const isExactTransient = TRANSIENT_PATTERNS.some(t => predicate === t);
            const isExactPersistent = PERSISTENT_PATTERNS.some(p => predicate === p);
            // Then check substring matches (exclude short patterns like 'at', 'is')
            const isSubstringTransient = !isExactPersistent && TRANSIENT_PATTERNS.some(t => t.length > 2 && predicate.includes(t));
            const isSubstringPersistent = PERSISTENT_PATTERNS.some(p => p.length > 2 && predicate.includes(p));
            const isTransient = isExactTransient || isSubstringTransient;
            const isPersistent = isExactPersistent || isSubstringPersistent;
            // Only trigger state change for persistent predicates with high confidence
            const isHighConfidence = (newFact.confidence || 0.5) >= 0.8;
            const shouldCreateEvent = isPersistent && !isTransient && isHighConfidence;
            if (shouldCreateEvent) {
                console.log(`[Muninn] State change detected: ${newFact.subject}.${newFact.predicate} "${existingObj}" → "${newObj}"`);
            }
            contradictions.push({
                fact: existing,
                type: 'value_conflict',
                stateChange: {
                    oldValue: existingObj,
                    newValue: newObj
                },
                isTransient: !shouldCreateEvent
            });
            continue;
        }
        // Temporal overlap (conflicting time ranges)
        if (existing.subject.toLowerCase() === newFact.subject.toLowerCase() &&
            existing.predicate === newFact.predicate &&
            existing.validFrom &&
            newFact.validFrom &&
            existing.validFrom !== newFact.validFrom &&
            existingObj && newObj && existingObj !== newObj) {
            contradictions.push({
                fact: existing,
                type: 'temporal_overlap'
            });
            continue;
        }
    }
    return contradictions;
}
// Confidence scoring based on evidence quality
export function scoreConfidence(fact, speaker) {
    let confidence = fact.confidence || 0.8;
    // Boost confidence for explicit statements
    if (fact.evidence) {
        const evidence = fact.evidence.toLowerCase();
        // Explicit first-person statements
        if (/^(i |we |my |our )/i.test(evidence)) {
            confidence = Math.min(1.0, confidence + 0.1);
        }
        // Hedge words reduce confidence
        if (/\b(maybe|might|probably|possibly|think|guess|perhaps)\b/i.test(evidence)) {
            confidence = Math.max(0.3, confidence - 0.2);
        }
        // Certainty words boost confidence
        if (/\b(definitely|certainly|absolutely|always|never)\b/i.test(evidence)) {
            confidence = Math.min(1.0, confidence + 0.1);
        }
    }
    return Math.min(1, Math.max(0, confidence));
}
//# sourceMappingURL=extraction.js.map