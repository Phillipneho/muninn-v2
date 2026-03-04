// v3.2: Reasoning Agent
// Handles multi-hop queries by resolving unresolved entity references

import type { MuninnDatabase } from './database-sqlite.js';
import { extractSearchableDescriptor } from './description-extractor.js';

export interface QueryIntent {
  type: 'simple' | 'multi_hop';
  originalQuery: string;
  
  // For simple queries
  explicitEntityId?: string;
  explicitEntityName?: string;
  predicate?: string;
  temporalConstraint?: {
    month?: string;
    year?: number;
    dateRange?: { start: Date; end: Date };
  };
  
  // For multi-hop queries
  isUnresolvedReference: boolean;
  description?: string; // e.g., "the person I met at the cafe"
  entityType?: 'person' | 'org' | 'project' | 'concept' | 'location' | 'technology';
  resolutionSteps?: ResolutionStep[];
  
  // After resolution
  resolvedEntityId?: string;
  resolvedEntityName?: string;
}

export interface ResolutionStep {
  step: number;
  action: 'search' | 'filter' | 'resolve';
  description: string;
  searchQuery?: string;
  result?: {
    entityId?: string;
    entityName?: string;
    confidence: number;
  };
}

export interface AmbiguityResult {
  isAmbiguous: boolean;
  candidates: Array<{
    entityId: string;
    entityName: string;
    relevance: number;
    context: string;
  }>;
  clarifyingQuestion?: string;
}

/**
 * Classifies whether a query is single-hop (simple) or multi-hop (needs resolution)
 */
export async function classifyQueryIntent(query: string): Promise<QueryIntent> {
  const lower = query.toLowerCase();
  
  // Patterns that indicate unresolved references
  const unresolvedPatterns = [
    /the person (?:I|we|you) (?:met|saw|spoke to)/,
    /the (?:man|woman|lady|guy|girl) (?:from|at) the/,
    /my (?:boss|colleague|friend|partner)'s/,
    /someone (?:I|we) (?:met|saw|know)/,
    /the (?:one|person) who/,
    /what's(?:-| )?his(?:-| )?name/,
    /you know, (?:the|that)/,
    /the person from (?:last )?(?:week|month|year)/,
    /the (?:latest|newest|most recent)/
  ];
  
  // Check for unresolved reference
  const isUnresolvedReference = unresolvedPatterns.some(pattern => pattern.test(query));
  
  if (isUnresolvedReference) {
    // Use the description extractor for better parsing
    const descriptor = extractSearchableDescriptor(query);
    
    return {
      type: 'multi_hop',
      originalQuery: query,
      isUnresolvedReference: true,
      description: descriptor.searchableQuery,
      entityType: descriptor.entityType,
      temporalConstraint: descriptor.temporalHint ? {
        month: descriptor.temporalHint.month,
        year: descriptor.temporalHint.year
      } : undefined,
      resolutionSteps: []
    };
  }
  
  // Simple query - extract explicit entity
  const entityMatch = query.match(/(?:what|where|when|who|how)\s+(?:did|is|was|were)\s+(\w+)/i);
  
  return {
    type: 'simple',
    originalQuery: query,
    isUnresolvedReference: false,
    explicitEntityName: entityMatch?.[1],
    predicate: extractPredicate(query),
    temporalConstraint: extractTemporalConstraint(query)
  };
}

/**
 * Extracts the description from an unresolved reference query
 */
function extractDescription(query: string): string {
  const lower = query.toLowerCase();
  
  // Pattern: "the person I met at the cafe"
  if (lower.includes('met at')) {
    const match = query.match(/met at (?:the )?([^.?]+)/i);
    if (match) return `met at ${match[1]}`;
  }
  
  // Pattern: "the lady from the gym"
  if (lower.includes('from the')) {
    const match = query.match(/from the ([^.?]+)/i);
    if (match) return `from ${match[1]}`;
  }
  
  // Pattern: "my partner's daughter"
  if (lower.includes("'s")) {
    const match = query.match(/(\w+)'s (\w+)/i);
    if (match) return `${match[1]}'s ${match[2]}`;
  }
  
  return query;
}

/**
 * Detects the type of entity being referenced
 */
function detectEntityType(query: string): 'person' | 'org' | 'project' | 'concept' | 'location' | 'technology' {
  const lower = query.toLowerCase();
  
  if (/\b(?:person|man|woman|lady|guy|girl|someone|who)\b/.test(lower)) return 'person';
  if (/\b(?:place|location|where|venue)\b/.test(lower)) return 'location';
  if (/\b(?:company|organization|org|business)\b/.test(lower)) return 'org';
  if (/\b(?:event|meeting|workshop|conference)\b/.test(lower)) return 'concept';
  
  return 'person'; // default
}

/**
 * Extracts the predicate from a query
 */
function extractPredicate(query: string): string | undefined {
  const lower = query.toLowerCase();
  
  const predicatePatterns: [RegExp, string][] = [
    [/where did .+ (?:go|visit|travel)/, 'went_to'],
    [/when did .+ (?:start|begin)/, 'started'],
    [/what did .+ (?:say|mention|tell)/, 'said'],
    [/how did .+ (?:feel|think)/, 'felt'],
    [/who did .+ (?:meet|see|speak)/, 'met'],
    [/what is .+ (?:job|role|position)/, 'job'],
    [/where does .+ (?:live|work|stay)/, 'location']
  ];
  
  for (const [pattern, predicate] of predicatePatterns) {
    if (pattern.test(lower)) return predicate;
  }
  
  return undefined;
}

/**
 * Extracts temporal constraints from a query
 */
function extractTemporalConstraint(query: string): QueryIntent['temporalConstraint'] {
  const lower = query.toLowerCase();
  const constraint: QueryIntent['temporalConstraint'] = {};
  
  // Month detection
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 
                  'july', 'august', 'september', 'october', 'november', 'december'];
  for (const month of months) {
    if (lower.includes(month)) {
      constraint.month = month.charAt(0).toUpperCase() + month.slice(1);
      break;
    }
  }
  
  // Year detection
  const yearMatch = lower.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    constraint.year = parseInt(yearMatch[1]);
  }
  
  // Relative time
  if (lower.includes('last week')) {
    const now = new Date();
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    constraint.dateRange = { start, end: now };
  }
  
  if (lower.includes('last month')) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    constraint.dateRange = { start, end: now };
  }
  
  return constraint;
}

/**
 * Resolves an entity by its description using semantic search
 * 
 * Strategy: Search facts/evidence for the description, then extract the subject
 * 
 * Example:
 * - Description: "met at the cafe"
 * - Search: facts WHERE evidence LIKE '%met%cafe%'
 * - Result: "Phillip met Dave at The Coffee House" → returns Dave's UUID
 */
export async function resolveEntityByDescription(
  db: MuninnDatabase,
  description: string,
  entityType: 'person' | 'org' | 'project' | 'concept' | 'location' | 'technology',
  temporalHint?: { month?: string; year?: number }
): Promise<{ id: string; name: string; confidence: number } | null> {
  
  // Step 1: Search facts for matching evidence
  // The key insight: instead of searching for entity names,
  // we search for the ACTION/LOCATION that defines the entity
  
  const searchTerms = description.toLowerCase().split(/\s+/);
  const predicateMatch = description.match(/(?:met|saw|from|at|in)/i);
  const predicate = predicateMatch ? predicateMatch[0].toLowerCase() : null;
  
  // Build search query - search evidence column for matching terms
  const facts = db['db'].prepare(`
    SELECT 
      f.subject_entity_id,
      f.object_entity_id,
      f.predicate,
      f.object_value,
      f.evidence,
      e.name as subject_name,
      e.type as subject_type
    FROM facts f
    JOIN entities e ON f.subject_entity_id = e.id
    WHERE f.evidence IS NOT NULL
    ORDER BY f.valid_from DESC
    LIMIT 50
  `).all() as any[];
  
  // Step 2: Score facts by matching terms in evidence
  const scored: Array<{ 
    entityId: string; 
    entityName: string; 
    confidence: number; 
    context: string;
    predicate?: string;
  }> = [];
  
  for (const fact of facts) {
    const evidence = (fact.evidence || '').toLowerCase();
    const objectValue = (fact.object_value || '').toLowerCase();
    
    // Calculate match score
    let score = 0;
    
    // Match search terms in evidence
    for (const term of searchTerms) {
      if (term.length < 3) continue; // Skip short terms
      if (evidence.includes(term)) score += 2;
      if (objectValue.includes(term)) score += 1;
    }
    
    // Boost for matching predicate
    if (predicate && fact.predicate && fact.predicate.toLowerCase().includes(predicate)) {
      score += 5;
    }
    
    // Boost for temporal match
    if (temporalHint?.month && evidence.includes(temporalHint.month.toLowerCase())) {
      score += 3;
    }
    if (temporalHint?.year && evidence.includes(temporalHint.year.toString())) {
      score += 3;
    }
    
    // Boost for entity type match
    if (fact.subject_type === entityType) {
      score += 2;
    }
    
    if (score > 0) {
      // For "met" predicates, the object is often the person we're looking for
      if (predicate === 'met' && fact.object_entity_id) {
        const objectEntity = db['db'].prepare(`
          SELECT id, name, type FROM entities WHERE id = ?
        `).get(fact.object_entity_id) as any;
        
        if (objectEntity && objectEntity.type === entityType) {
          scored.push({
            entityId: objectEntity.id,
            entityName: objectEntity.name,
            confidence: Math.min(score / 10, 1),
            context: fact.evidence || '',
            predicate: fact.predicate
          });
        }
      }
      
      // Also consider the subject
      scored.push({
        entityId: fact.subject_entity_id,
        entityName: fact.subject_name,
        confidence: Math.min(score / 15, 0.8), // Lower confidence for subject match
        context: fact.evidence || '',
        predicate: fact.predicate
      });
    }
  }
  
  // Step 3: Sort by confidence and return best match
  scored.sort((a, b) => b.confidence - a.confidence);
  
  // Remove duplicates
  const seen = new Set<string>();
  const unique = scored.filter(s => {
    if (seen.has(s.entityId)) return false;
    seen.add(s.entityId);
    return true;
  });
  
  if (unique.length === 0) {
    return null;
  }
  
  return {
    id: unique[0].entityId,
    name: unique[0].entityName,
    confidence: unique[0].confidence
  };
}

/**
 * Handles ambiguous entity resolution
 */
export async function handleAmbiguity(
  candidates: Array<{ entityId: string; entityName: string; context: string }>
): Promise<AmbiguityResult> {
  if (candidates.length === 0) {
    return { isAmbiguous: false, candidates: [] };
  }
  
  if (candidates.length === 1) {
    return {
      isAmbiguous: false,
      candidates: [{
        ...candidates[0],
        relevance: 1
      }]
    };
  }
  
  // Multiple candidates - generate clarifying question
  const names = candidates.slice(0, 3).map(c => c.entityName);
  const clarifyingQuestion = `Are you referring to ${names.join(', or ')}?`;
  
  return {
    isAmbiguous: true,
    candidates: candidates.map(c => ({ ...c, relevance: 0.5 })),
    clarifyingQuestion
  };
}

/**
 * Main recursive memory search function
 * Handles both single-hop and multi-hop queries
 */
export async function recursiveMemorySearch(
  db: MuninnDatabase,
  userQuery: string,
  sessionContext?: {
    recentEntities?: string[];
    currentDate?: Date;
  }
): Promise<{
  intent: QueryIntent;
  results: any[];
  resolutionPath?: string[];
  clarifyingQuestion?: string;
}> {
  // Step 1: Classify the query
  const intent = await classifyQueryIntent(userQuery);
  
  // Step 2: Handle multi-hop queries
  if (intent.isUnresolvedReference && intent.description) {
    console.log(`🔍 Resolving reference: "${intent.description}"`);
    
    // First Hop: Find the entity by description
    const resolved = await resolveEntityByDescription(
      db,
      intent.description,
      intent.entityType || 'person',
      intent.temporalConstraint
    );
    
    if (!resolved) {
      return {
        intent,
        results: [],
        resolutionPath: [`Failed to resolve: "${intent.description}"`],
        clarifyingQuestion: `I couldn't identify the ${intent.entityType || 'person'} you're referring to.`
      };
    }
    
    intent.resolvedEntityId = resolved.id;
    intent.resolvedEntityName = resolved.name;
    
    console.log(`✅ Identified as: ${resolved.name} (${resolved.id})`);
    
    // Step 3: Perform final search with resolved entity
    const results = db.getCurrentFacts(resolved.name);
    
    return {
      intent,
      results: results.map((f: any) => ({
        subject_name: resolved.name,
        predicate: f.predicate,
        object_value: f.object_value || f.object,
        confidence: f.confidence
      })),
      resolutionPath: [
        `Resolved: "${intent.description}" → ${resolved.name}`,
        `Searched: ${intent.predicate || 'all facts'} for ${resolved.name}`
      ]
    };
  }
  
  // Step 4: Handle simple queries
  if (intent.explicitEntityName) {
    const entity = db.resolveEntity(intent.explicitEntityName);
    if (entity) {
      const results = db.getCurrentFacts(intent.explicitEntityName);
      
      return {
        intent,
        results: results.map((f: any) => ({
          subject_name: intent.explicitEntityName,
          predicate: f.predicate,
          object_value: f.object_value || f.object,
          confidence: f.confidence
        })),
        resolutionPath: [`Direct search for ${intent.explicitEntityName}`]
      };
    }
  }
  
  // Step 5: Fallback to general search
  const allFacts = db['db'].prepare('SELECT * FROM facts LIMIT 10').all() as any[];
  
  return {
    intent,
    results: allFacts.map((f: any) => ({
      subject_name: 'Unknown',
      predicate: f.predicate,
      object_value: f.object_value,
      confidence: f.confidence
    })),
    resolutionPath: ['General search (fallback)']
  };
}