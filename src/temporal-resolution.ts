// Muninn v2 Temporal Resolution
// Implements "Anchor & Resolve" pattern for LOCOMO benchmark

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export interface TemporalObject {
  raw_date: string;           // "last Friday"
  resolved_date?: string;     // "2023-08-11" (ISO-8601)
  start_date?: string;        // For fuzzy dates: "2023-08-01"
  end_date?: string;          // For fuzzy dates: "2023-08-10"
  confidence: number;         // 0.0 - 1.0
  temporal_type: 'POINT' | 'RANGE' | 'DURATION';
}

export interface SessionExtraction {
  session_id: string;
  session_date: string;
  entities: Array<{
    name: string;
    type: string;
  }>;
  facts: Array<{
    subject: string;
    predicate: string;
    object: string;
    object_type: 'entity' | 'literal';
    confidence: number;
    temporal?: TemporalObject;
  }>;
  events: Array<{
    entity: string;
    attribute: string;
    old_value?: string;
    new_value: string;
    temporal: TemporalObject;
  }>;
}

/**
 * Batch extract from multiple sessions
 * Reduces API calls by processing 5 sessions at once
 */
export async function batchExtractSessions(
  sessions: Array<{
    id: string;
    date: string;
    content: string;
  }>,
  batchSize: number = 5
): Promise<SessionExtraction[]> {
  const results: SessionExtraction[] = [];
  
  // Process in batches
  for (let i = 0; i < sessions.length; i += batchSize) {
    const batch = sessions.slice(i, i + batchSize);
    const extractions = await extractBatch(batch);
    results.push(...extractions);
  }
  
  return results;
}

/**
 * Extract facts, entities, events from a batch of sessions
 */
async function extractBatch(
  sessions: Array<{ id: string; date: string; content: string }>
): Promise<SessionExtraction[]> {
  // Calculate day of week for each session
  const sessionsWithContext = sessions.map(s => ({
    ...s,
    day_of_week: getDayOfWeek(s.date)
  }));
  
  // Build batch prompt
  const prompt = `You are a precise memory extraction system. Extract structured data from conversations.

IMPORTANT: Each session has a specific date. Use this to resolve relative dates like "last Friday" or "yesterday".

For example:
- If session date is "2023-08-14 (Monday)" and someone says "last Friday", resolve to "2023-08-11"
- If session date is "2023-05-08 (Monday)" and someone says "yesterday", resolve to "2023-05-07"

Sessions to process:
${sessionsWithContext.map((s, i) => `
--- SESSION ${i + 1} ---
Date: ${s.date} (${s.day_of_week})
Content:
${s.content}
`).join('\n')}

For each session, output a JSON object with:
- entities: [{ name, type }] - type = person, org, location, concept, event
- facts: [{ subject, predicate, object, object_type, confidence, temporal }]
- events: [{ entity, attribute, old_value?, new_value, temporal }]

For temporal:
- raw_date: original text (e.g., "last Friday")
- resolved_date: ISO-8601 date (e.g., "2023-08-11")
- start_date/end_date: for fuzzy dates (e.g., "early August" -> start: "2023-08-01", end: "2023-08-10")
- confidence: 0.0-1.0
- temporal_type: "POINT" (specific date), "RANGE" (fuzzy), "DURATION" (span)

Output ONLY a JSON array of session extractions, one per session, in order.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a precise memory extraction system. Output only valid JSON.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0,
    max_tokens: 4000,
    response_format: { type: 'json_object' }
  });
  
  const text = response.choices[0]?.message?.content || '{"sessions":[]}';
  
  try {
    const parsed = JSON.parse(text);
    const sessions = Array.isArray(parsed) ? parsed : (parsed.sessions || []);
    
    // Map back to session IDs
    return sessions.map((s: any, i: number) => ({
      session_id: sessionsWithContext[i].id,
      session_date: sessionsWithContext[i].date,
      entities: s.entities || [],
      facts: s.facts || [],
      events: s.events || []
    }));
  } catch (e) {
    console.error('Failed to parse batch extraction:', e);
    return sessionsWithContext.map(s => ({
      session_id: s.id,
      session_date: s.date,
      entities: [],
      facts: [],
      events: []
    }));
  }
}

/**
 * Get day of week from ISO date string
 */
function getDayOfWeek(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[date.getDay()];
  } catch {
    return 'Unknown';
  }
}

/**
 * Resolve a relative date to ISO-8601
 */
export function resolveRelativeDate(
  relativeText: string,
  anchorDate: string
): { resolved: string; confidence: number } | null {
  const anchor = new Date(anchorDate);
  
  // Extended patterns for LOCOMO-style relative dates
  const patterns: Array<{ regex: RegExp; resolver: (m: RegExpMatchArray) => Date }> = [
    // "yesterday"
    {
      regex: /yesterday/i,
      resolver: () => new Date(anchor.getTime() - 86400000)
    },
    // "last Monday/Tuesday/etc"
    {
      regex: /last\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
      resolver: (m) => {
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const target = days.indexOf(m[1].toLowerCase());
        const current = anchor.getDay();
        let diff = current - target;
        if (diff <= 0) diff += 7;
        return new Date(anchor.getTime() - diff * 86400000);
      }
    },
    // "X days/weeks/months/years ago"
    {
      regex: /(\d+)\s+(day|week|month|year)s?\s+ago/i,
      resolver: (m) => {
        const num = parseInt(m[1]);
        const unit = m[2].toLowerCase();
        const d = new Date(anchor);
        if (unit === 'day') d.setDate(d.getDate() - num);
        else if (unit === 'week') d.setDate(d.getDate() - num * 7);
        else if (unit === 'month') d.setMonth(d.getMonth() - num);
        else if (unit === 'year') d.setFullYear(d.getFullYear() - num);
        return d;
      }
    },
    // "The Sunday before May 25, 2023" - LOCOMO pattern
    {
      regex: /(?:the\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+before\s+(\d{1,2})\s+(\w+)\s+(\d{4})/i,
      resolver: (m) => {
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const targetDay = days.indexOf(m[1].toLowerCase());
        const dayNum = parseInt(m[2]);
        const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        const month = months.indexOf(m[3].toLowerCase());
        const year = parseInt(m[4]);
        
        const refDate = new Date(year, month, dayNum);
        let currentDay = refDate.getDay();
        let diff = currentDay - targetDay;
        if (diff <= 0) diff += 7;
        return new Date(refDate.getTime() - diff * 86400000);
      }
    },
    // "The week before 14 August 2023" -> start of that week
    {
      regex: /(?:the\s+)?week\s+before\s+(\d{1,2})\s+(\w+)\s+(\d{4})/i,
      resolver: (m) => {
        const dayNum = parseInt(m[1]);
        const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        const month = months.indexOf(m[2].toLowerCase());
        const year = parseInt(m[3]);
        
        const refDate = new Date(year, month, dayNum);
        // Return Sunday of the week before
        const dayOfWeek = refDate.getDay();
        return new Date(refDate.getTime() - (dayOfWeek + 7) * 86400000);
      }
    },
    // "The weekend before X"
    {
      regex: /(?:the\s+)?weekend\s+before\s+(\d{1,2})\s+(\w+)\s+(\d{4})/i,
      resolver: (m) => {
        const dayNum = parseInt(m[1]);
        const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        const month = months.indexOf(m[2].toLowerCase());
        const year = parseInt(m[3]);
        
        const refDate = new Date(year, month, dayNum);
        // Saturday of the weekend before
        const dayOfWeek = refDate.getDay();
        const daysToSaturday = (dayOfWeek + 7 - 6) % 7;
        return new Date(refDate.getTime() - (daysToSaturday + 7) * 86400000);
      }
    },
    // "The Friday before X"
    {
      regex: /(?:the\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+before\s+(\d{1,2})\s+(\w+)\s*(\d{4})?/i,
      resolver: (m) => {
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const targetDay = days.indexOf(m[1].toLowerCase());
        const dayNum = parseInt(m[2]);
        const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        const month = months.indexOf(m[3].toLowerCase());
        const year = m[4] ? parseInt(m[4]) : anchor.getFullYear();
        
        const refDate = new Date(year, month, dayNum);
        let currentDay = refDate.getDay();
        let diff = currentDay - targetDay;
        if (diff <= 0) diff += 7;
        return new Date(refDate.getTime() - diff * 86400000);
      }
    },
    // Month names with optional year: "May 2023" or "May"
    {
      regex: /^(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?$/i,
      resolver: (m) => {
        const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        const month = months.indexOf(m[1].toLowerCase());
        const year = m[2] ? parseInt(m[2]) : anchor.getFullYear();
        return new Date(year, month, 1);
      }
    }
  ];
  
  for (const { regex, resolver } of patterns) {
    const match = relativeText.match(regex);
    if (match) {
      try {
        const resolved = resolver(match);
        return {
          resolved: resolved.toISOString().split('T')[0],
          confidence: 0.9
        };
      } catch {
        continue;
      }
    }
  }
  
  return null;
}