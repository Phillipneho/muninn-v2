// Muninn v2 Temporal Query Rewriter
// Translates fuzzy temporal queries into structured metadata filters

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export interface TemporalQuery {
  searchTerm: string;
  temporalFilter?: {
    start?: string;  // ISO-8601 date
    end?: string;    // ISO-8601 date
  };
  intent: 'TEMPORAL_FACT_FINDING' | 'ENTITY_STATE_QUERY' | 'EVOLUTION_QUERY' | 'GENERAL';
  entities: string[];
}

/**
 * Rewrite fuzzy temporal query into structured search object
 */
export async function rewriteTemporalQuery(
  query: string,
  currentDate: string = new Date().toISOString().split('T')[0]
): Promise<TemporalQuery> {
  // Extract entities first (simple pattern matching)
  const capitalized = query.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
  const questionWords = ['who', 'what', 'where', 'when', 'why', 'how', 'which', 'does', 'is', 'are', 'was', 'were', 'the', 'a', 'an', 'that', 'this', 'these', 'those'];
  const entities = capitalized.filter(w => !questionWords.includes(w.toLowerCase()));
  
  // Detect temporal intent
  const lower = query.toLowerCase();
  
  // Check for temporal keywords
  const hasTemporal = /\b(when|date|time|year|month|week|day|ago|before|after|last|next|during|in)\b/i.test(query);
  
  if (!hasTemporal) {
    return {
      searchTerm: query,
      intent: 'GENERAL',
      entities
    };
  }
  
  // Use LLM to parse temporal intent
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a temporal query parser. Extract the time range from user queries.

Current date: ${currentDate}

Return JSON with:
- search_term: The core search (e.g., "Caroline Pride Parade")
- temporal_filter: { start?: "YYYY-MM-DD", end?: "YYYY-MM-DD" }
- intent: One of TEMPORAL_FACT_FINDING, ENTITY_STATE_QUERY, EVOLUTION_QUERY, GENERAL
- entities: List of named entities

Examples:
- "When did Caroline go to the parade in August?" → { search_term: "Caroline parade", temporal_filter: { start: "2023-08-01", end: "2023-08-31" }, intent: "TEMPORAL_FACT_FINDING", entities: ["Caroline"] }
- "What did Caroline do last week?" → { search_term: "Caroline", temporal_filter: { start: "2026-02-26", end: "2026-03-04" }, intent: "EVOLUTION_QUERY", entities: ["Caroline"] }
- "What is Caroline's status?" → { search_term: "Caroline status", intent: "ENTITY_STATE_QUERY", entities: ["Caroline"] }

Output ONLY valid JSON.`
      },
      {
        role: 'user',
        content: query
      }
    ],
    temperature: 0,
    max_tokens: 200,
    response_format: { type: 'json_object' }
  });
  
  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content || '{}');
    return {
      searchTerm: parsed.search_term || query,
      temporalFilter: parsed.temporal_filter,
      intent: parsed.intent || 'GENERAL',
      entities: parsed.entities || entities
    };
  } catch {
    return {
      searchTerm: query,
      intent: 'GENERAL',
      entities
    };
  }
}

/**
 * Apply temporal filter to facts
 */
export function filterByDate(
  facts: any[],
  temporalFilter?: { start?: string; end?: string }
): any[] {
  if (!temporalFilter?.start && !temporalFilter?.end) {
    return facts;
  }
  
  return facts.filter(fact => {
    const factDate = fact.validFrom || fact.createdAt;
    if (!factDate) return true; // Keep facts without dates
    
    const date = new Date(factDate);
    const start = temporalFilter.start ? new Date(temporalFilter.start) : null;
    const end = temporalFilter.end ? new Date(temporalFilter.end) : null;
    
    if (start && date < start) return false;
    if (end && date > end) return false;
    
    return true;
  });
}

/**
 * Rank facts by temporal proximity
 */
export function rankByTemporalProximity(
  facts: any[],
  targetDate?: string
): any[] {
  if (!targetDate) {
    // Default: rank by recency
    return facts.sort((a, b) => {
      const dateA = new Date(a.validFrom || a.createdAt || 0);
      const dateB = new Date(b.validFrom || b.createdAt || 0);
      return dateB.getTime() - dateA.getTime();
    });
  }
  
  const target = new Date(targetDate);
  
  return facts.sort((a, b) => {
    const dateA = new Date(a.validFrom || a.createdAt || 0);
    const dateB = new Date(b.validFrom || b.createdAt || 0);
    
    const distA = Math.abs(dateA.getTime() - target.getTime());
    const distB = Math.abs(dateB.getTime() - target.getTime());
    
    return distA - distB;
  });
}