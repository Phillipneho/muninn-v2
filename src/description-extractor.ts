// v3.2: Description Extractor
// Extracts searchable entity descriptors from unresolved references

export interface ExtractedDescriptor {
  rawDescription: string;
  searchableQuery: string;
  predicate?: string;
  entityType: 'person' | 'org' | 'project' | 'concept' | 'location' | 'technology';
  temporalHint?: {
    month?: string;
    year?: number;
    relative?: 'last_week' | 'last_month' | 'yesterday' | 'recent';
  };
}

/**
 * Extracts the searchable descriptor from an unresolved reference
 * 
 * Example transformations:
 * - "the person I met at the cafe" → "met at the cafe" (predicate: met)
 * - "the guy from the BHP meeting" → "from BHP meeting" (predicate: met)
 * - "my partner's daughter" → "partner" (then traverse relationship)
 * - "the lady from the gym" → "from the gym" (predicate: met)
 */
export function extractSearchableDescriptor(query: string): ExtractedDescriptor {
  const lower = query.toLowerCase();
  
  // Pattern: "the person I met at [place]"
  const metAtPattern = /(?:the )?(?:person|man|woman|lady|guy|girl|someone)\s+(?:I |we |you )?(?:met|saw|spoke to)\s+(?:at |in )?(?:the )?([^.?]+)/i;
  const metAtMatch = query.match(metAtPattern);
  if (metAtMatch) {
    return {
      rawDescription: metAtMatch[1].trim(),
      searchableQuery: `met at ${metAtMatch[1].trim()}`,
      predicate: 'met',
      entityType: 'person',
      temporalHint: extractTemporalHint(lower)
    };
  }
  
  // Pattern: "the [person] from the [place/event]"
  const fromPattern = /(?:the )?(?:person|man|woman|lady|guy|girl|someone)\s+from\s+(?:the )?([^.?]+)/i;
  const fromMatch = query.match(fromPattern);
  if (fromMatch) {
    return {
      rawDescription: fromMatch[1].trim(),
      searchableQuery: `from ${fromMatch[1].trim()}`,
      predicate: 'met',
      entityType: 'person',
      temporalHint: extractTemporalHint(lower)
    };
  }
  
  // Pattern: "my [relationship]'s [relationship]" (double-hop)
  const doubleHopPattern = /my\s+(\w+)'s\s+(\w+)/i;
  const doubleHopMatch = query.match(doubleHopPattern);
  if (doubleHopMatch) {
    return {
      rawDescription: `${doubleHopMatch[1]}'s ${doubleHopMatch[2]}`,
      searchableQuery: doubleHopMatch[1], // First resolve "partner", then traverse to "daughter"
      predicate: undefined,
      entityType: 'person',
      temporalHint: extractTemporalHint(lower)
    };
  }
  
  // Pattern: "my [relationship]" (single-hop)
  const relationshipPattern = /my\s+(\w+)/i;
  const relationshipMatch = query.match(relationshipPattern);
  if (relationshipMatch) {
    const relationship = relationshipMatch[1].toLowerCase();
    // Common relationships
    const relationshipTypes: Record<string, string> = {
      'partner': 'partner',
      'wife': 'partner',
      'husband': 'partner',
      'son': 'child',
      'daughter': 'child',
      'boss': 'boss',
      'colleague': 'colleague',
      'friend': 'friend'
    };
    return {
      rawDescription: relationship,
      searchableQuery: relationshipTypes[relationship] || relationship,
      predicate: relationshipTypes[relationship],
      entityType: 'person',
      temporalHint: extractTemporalHint(lower)
    };
  }
  
  // Pattern: "the [person] who [action]"
  const whoPattern = /(?:the )?(?:person|man|woman|lady|guy|girl|one)\s+who\s+([^.?]+)/i;
  const whoMatch = query.match(whoPattern);
  if (whoMatch) {
    return {
      rawDescription: whoMatch[1].trim(),
      searchableQuery: whoMatch[1].trim(),
      predicate: extractPredicateFromAction(whoMatch[1]),
      entityType: 'person',
      temporalHint: extractTemporalHint(lower)
    };
  }
  
  // Fallback: Extract key nouns
  const nouns = query.match(/\b[A-Z][a-z]+|\b[a-z]+/g) || [];
  return {
    rawDescription: query,
    searchableQuery: nouns.slice(0, 3).join(' '),
    predicate: undefined,
    entityType: detectEntityType(lower),
    temporalHint: extractTemporalHint(lower)
  };
}

/**
 * Extracts temporal hints from the query
 */
function extractTemporalHint(lower: string): ExtractedDescriptor['temporalHint'] {
  const hint: ExtractedDescriptor['temporalHint'] = {};
  
  // Relative time
  if (lower.includes('last week')) {
    hint.relative = 'last_week';
  } else if (lower.includes('last month')) {
    hint.relative = 'last_month';
  } else if (lower.includes('yesterday')) {
    hint.relative = 'yesterday';
  } else if (lower.includes('recently') || lower.includes('recent')) {
    hint.relative = 'recent';
  }
  
  // Specific months
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 
                  'july', 'august', 'september', 'october', 'november', 'december'];
  for (const month of months) {
    if (lower.includes(month)) {
      hint.month = month.charAt(0).toUpperCase() + month.slice(1);
      break;
    }
  }
  
  // Year
  const yearMatch = lower.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    hint.year = parseInt(yearMatch[1]);
  }
  
  return hint;
}

/**
 * Extracts predicate from an action phrase
 */
function extractPredicateFromAction(action: string): string | undefined {
  const lower = action.toLowerCase();
  
  if (lower.includes('met')) return 'met';
  if (lower.includes('said')) return 'said';
  if (lower.includes('mentioned')) return 'mentioned';
  if (lower.includes('told')) return 'told';
  if (lower.includes('went')) return 'went_to';
  if (lower.includes('works')) return 'works_at';
  if (lower.includes('lives')) return 'lives_at';
  
  return undefined;
}

/**
 * Detects the type of entity being referenced
 */
function detectEntityType(lower: string): 'person' | 'org' | 'project' | 'concept' | 'location' | 'technology' {
  if (/\b(?:person|man|woman|lady|guy|girl|someone|who)\b/.test(lower)) return 'person';
  if (/\b(?:place|location|where|venue|cafe|restaurant|gym)\b/.test(lower)) return 'location';
  if (/\b(?:company|organization|org|business|startup)\b/.test(lower)) return 'org';
  if (/\b(?:project|app|product)\b/.test(lower)) return 'project';
  if (/\b(?:meeting|workshop|conference|event)\b/.test(lower)) return 'concept';
  
  return 'person'; // default
}

/**
 * Examples for LLM prompt (use in query-intent.ts)
 */
export const EXTRACTION_EXAMPLES = [
  {
    input: "What did the guy from the BHP meeting say?",
    output: {
      rawDescription: "guy from BHP meeting",
      searchableQuery: "from BHP meeting",
      predicate: "met",
      entityType: "person"
    }
  },
  {
    input: "When is my partner's birthday?",
    output: {
      rawDescription: "partner",
      searchableQuery: "partner",
      predicate: "partner",
      entityType: "person"
    }
  },
  {
    input: "Where did I go with the person I met at the cafe?",
    output: {
      rawDescription: "person I met at the cafe",
      searchableQuery: "met at the cafe",
      predicate: "met",
      entityType: "person"
    }
  },
  {
    input: "What did the lady from the gym mention about running?",
    output: {
      rawDescription: "lady from the gym",
      searchableQuery: "from the gym",
      predicate: "met",
      entityType: "person"
    }
  }
];