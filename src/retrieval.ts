// Muninn v2 Retrieval Pipeline
// Priority: Structured → Graph → Events → Semantic

import type { RecallOptions, RecallResult, Fact, Event } from './types.js';
import { MuninnDatabase } from './database.js';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export class Retriever {
  private db: MuninnDatabase;
  
  constructor(db: MuninnDatabase) {
    this.db = db;
  }
  
  /**
   * Main retrieval function - implements priority order
   */
  async recall(query: string, options?: RecallOptions): Promise<RecallResult> {
    // 1. Extract entities from query
    const entities = await this.extractEntities(query);
    
    // 2. Parse temporal intent
    const temporalIntent = this.parseTemporalIntent(query);
    
    // 3. Try structured state query
    if (entities.length > 0) {
      const facts = await this.db.getCurrentFacts(entities[0], temporalIntent.predicate);
      if (facts.length > 0) {
        return {
          source: 'structured',
          facts: facts.map(this.mapFact)
        };
      }
    }
    
    // 4. Try graph traversal (multi-hop)
    if (entities.length >= 2) {
      const path = await this.db.traverseGraph(entities[0], 3);
      if (path.length > 0) {
        return {
          source: 'graph',
          path: path.map(p => ({
            entity: p.entity,
            relationship: p.relationship,
            relatedEntity: p.related_entity,
            depth: p.depth
          }))
        };
      }
    }
    
    // 5. Try temporal reasoning
    if (temporalIntent.type === 'change' && entities.length > 0) {
      const events = await this.db.getEntityEvolution(
        entities[0],
        temporalIntent.timeRange?.from,
        temporalIntent.timeRange?.to
      );
      if (events.length > 0) {
        return {
          source: 'events',
          events: events.map(this.mapEvent)
        };
      }
    }
    
    // 6. Fall back to semantic search
    const semantic = await this.semanticSearch(query, options?.limit || 10);
    return {
      source: 'semantic',
      memories: semantic
    };
  }
  
  /**
   * Extract entities from query using simple patterns + LLM
   */
  private async extractEntities(query: string): Promise<string[]> {
    // First, try simple pattern matching
    const capitalizedWords = query.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
    
    // If we found capitalized words, they're likely entities
    if (capitalizedWords.length > 0) {
      return [...new Set(capitalizedWords)];
    }
    
    // Otherwise, use LLM for entity extraction
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Extract named entities from the query. Return a JSON array of entity names.'
          },
          {
            role: 'user',
            content: query
          }
        ],
        temperature: 0,
        max_tokens: 100,
        response_format: { type: 'json_object' }
      });
      
      const text = response.choices[0]?.message?.content || '{"entities":[]}';
      const result = JSON.parse(text);
      return result.entities || [];
    } catch (e) {
      return [];
    }
  }
  
  /**
   * Parse temporal intent from query
   */
  private parseTemporalIntent(query: string): {
    type: 'current' | 'change' | 'when' | 'history';
    predicate?: string;
    timeRange?: { from?: Date; to?: Date };
  } {
    const lower = query.toLowerCase();
    
    // "How did X change?" or "What changed?"
    if (lower.includes('change') || lower.includes('evolution') || lower.includes('history')) {
      return { type: 'change' };
    }
    
    // "When did X happen?"
    if (lower.includes('when ')) {
      return { type: 'when' };
    }
    
    // "What is X's Y?" - extract predicate
    const possessiveMatch = lower.match(/what is (\w+)'s (\w+)/);
    if (possessiveMatch) {
      return { type: 'current', predicate: possessiveMatch[2] };
    }
    
    // "What does X Y?" - extract predicate
    const verbMatch = lower.match(/what does (\w+) (\w+)/);
    if (verbMatch) {
      return { type: 'current', predicate: verbMatch[2] };
    }
    
    return { type: 'current' };
  }
  
  /**
   * Semantic search fallback
   */
  private async semanticSearch(query: string, limit: number): Promise<any[]> {
    // Generate embedding for query
    const embedding = await this.generateEmbedding(query);
    
    // Query episodes by similarity
    const result = await this.db.pool.query(`
      SELECT 
        id, content, source, actor, occurred_at, ingested_at,
        1 - (embedding <=> $1::vector) as similarity
      FROM episodes
      ORDER BY embedding <=> $1::vector
      LIMIT $2
    `, [`[${embedding.join(',')}]`, limit]);
    
    return result.rows;
  }
  
  /**
   * Generate embedding using OpenAI
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text
    });
    
    return response.data[0].embedding;
  }
  
  /**
   * Map database fact to TypeScript type
   */
  private mapFact(row: any): Fact {
    return {
      id: row.id,
      subjectEntityId: row.subject_entity_id,
      predicate: row.predicate,
      objectEntityId: row.object_entity_id,
      objectValue: row.object_value,
      valueType: row.value_type,
      confidence: row.confidence,
      sourceEpisodeId: row.source_episode_id,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      createdAt: row.created_at,
      invalidatedAt: row.invalidated_at,
      evidence: row.evidence
    };
  }
  
  /**
   * Map database event to TypeScript type
   */
  private mapEvent(row: any): Event {
    return {
      id: row.id,
      factId: row.fact_id,
      entityId: row.entity_id,
      attribute: row.attribute,
      oldValue: row.old_value,
      newValue: row.new_value,
      cause: row.cause,
      occurredAt: row.occurred_at,
      observedAt: row.observed_at,
      sourceEpisodeId: row.source_episode_id
    };
  }
}