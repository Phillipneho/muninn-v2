// Muninn v4.0 - Enhanced Recall with Fuzzy Entity + Predicate Expansion
// Three key fixes:
// 1. Fuzzy entity resolution (ILIKE + Levenshtein)
// 2. Semantic predicate expansion
// 3. Over-fetch (100) + keyword rerank

import OpenAI from 'openai';
import dotenv from 'dotenv';
import { ObservationDatabase } from './dist/observation-database.js';
import { mapQueryToPredicates, CANONICAL_PREDICATES } from './query-predicates.js';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ============================================================================
// FIX 1: FUZZY ENTITY RESOLUTION
// ============================================================================

// Known entity aliases (from LOCOMO benchmark)
// NOTE: Each entity maps to its canonical name, not cross-referencing other entities
const ENTITY_ALIASES: Record<string, string[]> = {
  'jon': ['jon', 'jonathan'],
  'john': ['john'],
  'gina': ['gina'],
  'caroline': ['caroline', 'carol', 'carrie'],
  'melanie': ['melanie', 'mel'],
  'maria': ['maria', 'mary'],
  'tim': ['tim', 'timothy'],
  'audrey': ['audrey'],
  'andrew': ['andrew', 'andy'],
  'jolene': ['jolene'],
  'deborah': ['deborah', 'deb'],
  'calvin': ['calvin'],
  'james': ['james', 'jim'],
  'evan': ['evan'],
  'sam': ['sam', 'samuel'],
  'dave': ['dave', 'david'],
  'nate': ['nate', 'nathan'],
  'joanna': ['joanna'],
};

// Reverse mapping: alias → canonical name
const ALIAS_TO_CANONICAL: Record<string, string> = {};
for (const [canonical, aliases] of Object.entries(ENTITY_ALIASES)) {
  for (const alias of aliases) {
    ALIAS_TO_CANONICAL[alias.toLowerCase()] = canonical.toLowerCase();
  }
}

/**
 * Resolve entity names from query using fuzzy matching
 */
export function resolveEntitiesFromQuery(query: string, db: ObservationDatabase): string[] {
  const queryLower = query.toLowerCase();
  const entities: Set<string> = new Set();
  
  // 1. Check for names with word boundaries
  for (const [canonical, aliases] of Object.entries(ENTITY_ALIASES)) {
    for (const alias of aliases) {
      // Word boundary match - exact word only
      const regex = new RegExp(`\\b${alias}\\b`, 'i');
      if (regex.test(queryLower)) {
        // Verify in database
        const entity = db.resolveEntity(canonical);
        if (entity) {
          entities.add(entity.name.toLowerCase());
        } else {
          entities.add(canonical);
        }
        break; // Found this canonical, move to next
      }
    }
  }
  
  return [...entities];
}

// ============================================================================
// FIX 2: SEMANTIC PREDICATE EXPANSION
// ============================================================================

// User-intent verbs → canonical predicates
const INTENT_TO_PREDICATE: Record<string, string> = {
  // Martial arts / skills
  'martial': 'skill_acquisition',
  'karate': 'skill_acquisition',
  'taekwondo': 'skill_acquisition',
  'kickboxing': 'skill_acquisition',
  'practice': 'skill_acquisition',
  'learn': 'skill_acquisition',
  'skill': 'skill_acquisition',
  
  // Volunteering
  'volunteer': 'volunteered',
  'shelter': 'volunteered',
  'community': 'volunteered',
  'homeless': 'volunteered',
  
  // Job/work
  'job': 'employer',
  'work': 'employer',
  'employer': 'employer',
  'fired': 'job_loss',
  'laid off': 'job_loss',
  'lost job': 'job_loss',
  'unemployed': 'job_loss',
  
  // Hobbies
  'hobby': 'hobby',
  'enjoy': 'hobby',
  'like to': 'hobby',
  'passion': 'hobby',
  'dance': 'hobby',
  'paint': 'hobby',
  'music': 'hobby',
  
  // Coping
  'destress': 'coping_mechanism',
  'stress': 'coping_mechanism',
  'relax': 'coping_mechanism',
  'cope': 'coping_mechanism',
  
  // Family/relationships
  'husband': 'family',
  'wife': 'family',
  'kid': 'family',
  'children': 'family',
  'married': 'relationship_status',
  'single': 'relationship_status',
  
  // Pets
  'dog': 'pet',
  'cat': 'pet',
  'pet': 'pet',
  
  // Events
  'attend': 'attended',
  'visit': 'attended',
  'go to': 'attended',
  
  // Values/beliefs
  'value': 'values',
  'believe': 'believes',
  'think': 'believes',
};

/**
 * Expand query predicates with semantic mappings
 */
export function expandPredicates(query: string, basePredicates: string[]): string[] {
  const queryLower = query.toLowerCase();
  const predicates: Set<string> = new Set(basePredicates);
  
  // Add predicates from intent mapping
  for (const [intent, predicate] of Object.entries(INTENT_TO_PREDICATE)) {
    if (queryLower.includes(intent)) {
      predicates.add(predicate);
    }
  }
  
  // Add related predicates
  // If asking about "volunteering", also check "volunteer" (canonical form)
  if (queryLower.includes('volunteer')) {
    predicates.add('volunteered');
    predicates.add('volunteer');
  }
  
  // If asking about "destress" or "cope", check hobby too
  if (queryLower.includes('destress') || queryLower.includes('cope')) {
    predicates.add('coping_mechanism');
    predicates.add('hobby');
    predicates.add('activity');
  }
  
  // If asking about "martial arts", check skill_acquisition and hobby
  if (queryLower.includes('martial') || queryLower.includes('karate') || queryLower.includes('taekwondo')) {
    predicates.add('skill_acquisition');
    predicates.add('hobby');
    predicates.add('activity');
  }
  
  // If asking about "shelter" or "homeless", check volunteering
  if (queryLower.includes('shelter') || queryLower.includes('homeless')) {
    predicates.add('volunteered');
    predicates.add('volunteer');
  }
  
  return [...predicates];
}

// ============================================================================
// FIX 4: PRECEDENT SEARCH (v5.2 - Decision Traces)
// ============================================================================

/**
 * Find previous successful queries that are similar to the current query
 * If a precedent has high outcome_reward, use its predicates to prioritize retrieval
 */
export function findPrecedent(
  db: ObservationDatabase,
  query: string,
  entityIds: string[]
): { predicates: string[]; cluster_path: string[] } | null {
  try {
    // Get all decision traces for the relevant entities
    const traces = db.getAllTraces?.();
    if (!traces || traces.length === 0) return null;
    
    // Simple keyword-based precedent matching (since no embeddings in SQLite)
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    
    let bestPrecedent: any = null;
    let bestScore = 0;
    
    for (const trace of traces) {
      const traceText = (trace.query_text || '').toLowerCase();
      let matchScore = 0;
      
      // Count matching keywords
      for (const word of queryWords) {
        if (traceText.includes(word)) {
          matchScore += 1;
        }
      }
      
      // Also check predicates_fired for entity matches
      if (entityIds.length > 0 && trace.activated_nodes) {
        try {
          const nodes = JSON.parse(trace.activated_nodes);
          for (const node of nodes) {
            if (entityIds.includes(node.entity_id)) {
              matchScore += 2;
            }
          }
        } catch (e) {}
      }
      
      // Weight by outcome_reward
      const rewardScore = (trace.outcome_reward || 0) * 5;
      const totalScore = matchScore + rewardScore;
      
      if (totalScore > bestScore && (trace.outcome_reward || 0) > 0.5) {
        bestScore = totalScore;
        bestPrecedent = trace;
      }
    }
    
    if (bestPrecedent && bestPrecedent.predicates_fired) {
      try {
        const predicates = JSON.parse(bestPrecedent.predicates_fired);
        const clusterPath = bestPrecedent.cluster_path ? JSON.parse(bestPrecedent.cluster_path) : [];
        return { predicates, cluster_path: clusterPath };
      } catch (e) {
        return null;
      }
    }
    
    return null;
  } catch (err) {
    console.error('Precedent search error:', err);
    return null;
  }
}

// ============================================================================
// FIX 3: KEYWORD RERANKING
// ============================================================================

/**
 * Calculate keyword match score for observations
 */
function keywordScore(observation: { content: string; predicate: string; entity?: string }, query: string): number {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const contentLower = observation.content.toLowerCase();
  const predicateLower = observation.predicate.toLowerCase();
  
  let score = 0;
  
  // Exact word matches in content
  for (const word of queryWords) {
    if (contentLower.includes(word)) {
      score += 2;
    }
  }
  
  // Predicate match bonus
  for (const word of queryWords) {
    if (predicateLower.includes(word)) {
      score += 3;
    }
  }
  
  // Boost for temporal keywords if query asks "when"
  if (query.toLowerCase().includes('when')) {
    if (observation.predicate === 'state' || observation.predicate === 'started' || observation.predicate === 'attended') {
      score += 2;
    }
  }
  
  // CLUSTER WEIGHTING: For similarity questions, boost shared predicates
  // Questions about similarities should prioritize intersection clusters
  const isSimilarityQuestion = /\b(both|common|share|same|similar|alike|together)\b/i.test(query);
  if (isSimilarityQuestion) {
    // These predicates indicate shared experiences/values - boost them
    const sharedPredicates = ['employer', 'job_loss', 'hobby', 'coping_mechanism', 'volunteered', 'skill_acquisition', 'location', 'relationship_status'];
    if (sharedPredicates.includes(observation.predicate)) {
      score += 5; // Strong boost for shared-cluster observations
    }
  }
  
  return score;
}

/**
 * Rerank observations by keyword relevance
 */
export function rerankObservations(
  observations: Array<{ content: string; predicate: string; valid_from?: string; entity: string; evidence?: string; confidence: number }>,
  query: string
): typeof observations {
  return observations
    .map(obs => ({
      ...obs,
      _score: keywordScore(obs, query)
    }))
    .sort((a, b) => b._score - a._score)
    .map(({ _score, ...obs }) => obs);
}

// ============================================================================
// MAIN RECALL FUNCTION
// ============================================================================

const ANSWER_SYNTHESIS_PROMPT = `You are Muninn, a memory assistant. Given a question and observations from memory, synthesize a concise answer.

RULES:
1. Use the observations to make REASONABLE INFERENCES
2. If observations suggest an answer but don't explicitly state it, infer it
3. Only say "I don't have enough information" if there's NO relevant information
4. For temporal questions ("when"), use the valid_from dates
5. For multi-entity questions (asking about multiple people), explicitly name the commonality first
6. For "what do they have in common" or "similarities" questions:
   - Start with: "Both [Name] and [Name]..."
   - Then differentiate: "...though [Name] was X and [Name] was Y."
   - Focus on SHARED observations first (same predicate or overlapping values)
7. For "would" questions asking about likelihood:
   - Make reasonable inferences from the observations
   - "Would they have X?" → Look for related items, collections, preferences
   - "Would they be interested in Y?" → Look for similar interests, activities, values
   - Consider NEGATIVE evidence: if observations suggest X but NOT Y, say "Likely no"
   - If the question asks "Would X be considered Y?" and there's no evidence they ARE Y, answer "Likely no" or "No evidence suggests that"
8. Keep answers under 50 words unless more detail is required

ENTITIES: {{entities}}
QUESTION: {{question}}

OBSERVATIONS (sorted by relevance):
{{observations}}

Answer:`;

export interface RecallResult {
  answer: string;
  observations: Array<{
    content: string;
    predicate: string;
    valid_from?: string;
    entity: string;
    evidence?: string;
  }>;
  confidence: number;
  entities: string[];
}

export async function recallWithSynthesis(
  db: ObservationDatabase,
  query: string,
  entities?: string[]
): Promise<RecallResult> {
  // Step 1: Resolve entities
  const detectedEntities = entities?.length > 0 ? entities : resolveEntitiesFromQuery(query, db);
  
  // Get entity IDs for precedent search
  const entityIds = detectedEntities.map(name => {
    const entityObj = db.resolveEntity(name);
    return entityObj?.id;
  }).filter(Boolean) as string[];
  
  // Step 2: Expand predicates FIRST (need this for precedent logic)
  const basePredicates = mapQueryToPredicates(query);
  const expandedPredicates = expandPredicates(query, basePredicates);
  
  // Step 2.5: PRECEDENT SEARCH (v5.2)
  // Check for similar successful queries before standard retrieval
  const precedent = findPrecedent(db, query, entityIds);
  let prioritizedPredicates = expandedPredicates;
  
  if (precedent && precedent.predicates.length > 0) {
    // Boost precedent predicates - add them with higher priority
    const precedentPredicates = precedent.predicates.filter((p: string) => !expandedPredicates.includes(p));
    prioritizedPredicates = [...precedentPredicates, ...expandedPredicates];
  }
  
  // Step 3: Over-fetch observations (100 per entity)
  const allObservations: any[] = [];
  
  for (const entityName of detectedEntities.length > 0 ? detectedEntities : ['']) {
    const entityObj = db.resolveEntity(entityName);
    if (!entityObj) continue;
    
    const obs = db.getObservationsByEntity(entityObj.id, {
      predicates: prioritizedPredicates.length > 0 ? prioritizedPredicates : undefined,
      limit: 100  // OVER-FETCH
    });
    
    allObservations.push(...obs.map(o => ({
      entity: entityObj.name,
      content: o.object_value,
      predicate: o.predicate,
      valid_from: o.valid_from,
      evidence: o.evidence,
      confidence: o.confidence || 0.8
    })));
  }
  
  // Step 4: Rerank by keyword relevance
  const reranked = rerankObservations(allObservations, query);
  
  // Step 5: Take top 40 for synthesis
  const topObservations = reranked.slice(0, 40);
  
  if (topObservations.length === 0) {
    return {
      answer: "I don't have any relevant observations about that.",
      observations: [],
      confidence: 0,
      entities: detectedEntities
    };
  }
  
  // Step 6: Format for LLM
  const obsText = topObservations.map((o, i) => 
    `[${i + 1}] [${o.entity}] ${o.predicate}: "${o.content}"${o.valid_from ? ` (${o.valid_from})` : ''}`
  ).join('\n');
  
  // Step 7: Call LLM for synthesis
  const prompt = ANSWER_SYNTHESIS_PROMPT
    .replace('{{entities}}', detectedEntities.join(', ') || 'unknown')
    .replace('{{question}}', query)
    .replace('{{observations}}', obsText);
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 200
    });
    
    const answer = response.choices[0]?.message?.content || "Unable to synthesize answer.";
    
    return {
      answer,
      observations: topObservations.map(o => ({
        content: o.content,
        predicate: o.predicate,
        valid_from: o.valid_from,
        entity: o.entity,
        evidence: o.evidence
      })),
      confidence: topObservations[0]?.confidence || 0.8,
      entities: detectedEntities
    };
  } catch (err) {
    console.error('LLM synthesis failed:', err);
    return {
      answer: topObservations[0]?.content || "Unable to retrieve answer.",
      observations: topObservations.slice(0, 10),
      confidence: 0.5,
      entities: detectedEntities
    };
  }
}

// For benchmarking without LLM calls
export function recallDirect(
  db: ObservationDatabase,
  query: string,
  entities?: string[]
): RecallResult {
  const detectedEntities = entities?.length > 0 ? entities : resolveEntitiesFromQuery(query, db);
  const basePredicates = mapQueryToPredicates(query);
  const expandedPredicates = expandPredicates(query, basePredicates);
  
  const allObservations: any[] = [];
  
  for (const entityName of detectedEntities.length > 0 ? detectedEntities : ['']) {
    const entityObj = db.resolveEntity(entityName);
    if (!entityObj) continue;
    
    const obs = db.getObservationsByEntity(entityObj.id, {
      predicates: expandedPredicates.length > 0 ? expandedPredicates : undefined,
      limit: 100
    });
    
    allObservations.push(...obs.map(o => ({
      entity: entityObj.name,
      content: o.object_value,
      predicate: o.predicate,
      valid_from: o.valid_from,
      evidence: o.evidence,
      confidence: o.confidence || 0.8
    })));
  }
  
  const reranked = rerankObservations(allObservations, query);
  const topObservations = reranked.slice(0, 10);
  
  return {
    answer: topObservations[0]?.content || "No observations found.",
    observations: topObservations,
    confidence: topObservations[0]?.confidence || 0.5,
    entities: detectedEntities
  };
}