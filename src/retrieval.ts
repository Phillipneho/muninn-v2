// Muninn v2 Enhanced Retrieval Pipeline
// Phase 4: Structured queries, graph traversal, semantic fallback

import { MuninnDatabase } from './database-sqlite.js';
import type { RecallOptions, RecallResult, Fact, Event } from './types.js';
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
   * 1. Structured state (facts)
   * 2. Graph traversal (relationships)
   * 3. Temporal reasoning (events)
   * 4. Semantic fallback (embeddings)
   */
  async recall(query: string, options?: RecallOptions): Promise<RecallResult> {
    // 1. Extract entities from query
    const entities = await this.extractEntities(query);
    
    // 2. Parse temporal intent
    const temporalIntent = this.parseTemporalIntent(query);
    
    // 3. Try structured state query
    if (entities.length > 0) {
      const facts = this.db.getCurrentFacts(entities[0], temporalIntent.predicate);
      if (facts.length > 0) {
        return {
          source: 'structured',
          facts: facts.map(f => this.mapFact(f))
        };
      }
    }
    
    // 4. Try graph traversal (multi-hop)
    if (entities.length >= 2) {
      const path = this.db.traverseGraph(entities[0], options?.limit || 3);
      if (path.length > 0) {
        // Filter to paths that reach the target entity
        const relevantPaths = path.filter(p => 
          p.related_entity.toLowerCase().includes(entities[1].toLowerCase()) ||
          entities[1].toLowerCase().includes(p.related_entity.toLowerCase())
        );
        
        if (relevantPaths.length > 0) {
          return {
            source: 'graph',
            path: relevantPaths.map(p => ({
              entity: p.entity,
              relationship: p.relationship,
              relatedEntity: p.related_entity,
              depth: p.depth
            }))
          };
        }
        
        // Return all paths if no specific target
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
      const events = this.db.getEntityEvolution(
        entities[0],
        temporalIntent.timeRange?.from,
        temporalIntent.timeRange?.to
      );
      if (events.length > 0) {
        return {
          source: 'events',
          events: events.map(e => this.mapEvent(e))
        };
      }
    }
    
    // 6. Try "when did X happen?" queries
    if (temporalIntent.type === 'when' && entities.length > 0) {
      const events = this.db.getEntityEvolution(entities[0]);
      if (events.length > 0) {
        return {
          source: 'events',
          events: events.map(e => this.mapEvent(e))
        };
      }
    }
    
    // 7. Fall back to semantic search
    const semantic = await this.semanticSearch(query, options?.limit || 10);
    return {
      source: 'semantic',
      memories: semantic
    };
  }
  
  /**
   * Multi-hop query: Find path from entity A to entity B
   */
  async findPath(fromEntity: string, toEntity: string, maxDepth: number = 3): Promise<{
    found: boolean;
    path: Array<{ entity: string; relationship: string; relatedEntity: string }>;
  }> {
    const paths = this.db.traverseGraph(fromEntity, maxDepth);
    
    // Find paths that reach the target
    for (const path of paths) {
      if (path.related_entity.toLowerCase() === toEntity.toLowerCase()) {
        return {
          found: true,
          path: [{
            entity: path.entity,
            relationship: path.relationship,
            relatedEntity: path.related_entity
          }]
        };
      }
    }
    
    // Try reverse traversal
    const reversePaths = this.db.traverseGraph(toEntity, maxDepth);
    for (const path of reversePaths) {
      if (path.related_entity.toLowerCase() === fromEntity.toLowerCase()) {
        return {
          found: true,
          path: [{
            entity: fromEntity,
            relationship: 'related_to',
            relatedEntity: toEntity
          }]
        };
      }
    }
    
    return { found: false, path: [] };
  }
  
  /**
   * Get all facts about an entity
   */
  getEntityFacts(entityName: string): Fact[] {
    const facts = this.db.getCurrentFacts(entityName);
    return facts.map(f => this.mapFact(f));
  }
  
  /**
   * Get entity evolution (state changes over time)
   */
  getEntityEvolution(entityName: string, from?: Date, to?: Date): Event[] {
    const events = this.db.getEntityEvolution(entityName, from, to);
    return events.map(e => this.mapEvent(e));
  }
  
  /**
   * Extract entities from query using LLM
   */
  async extractEntities(query: string): Promise<string[]> {
    // First, try simple pattern matching
    // Exclude question words and common articles
    const questionWords = ['what', 'where', 'when', 'who', 'how', 'which', 'why', 'does', 'is', 'are', 'was', 'were', 'the', 'a', 'an', 'that', 'this', 'these', 'those'];
    
    const capitalized = query.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
    const filtered = capitalized.filter(word => !questionWords.includes(word.toLowerCase()));
    
    // If we found capitalized words, they're likely entities
    if (filtered.length > 0) {
      return [...new Set(filtered)];
    }
    
    // Otherwise, use LLM for entity extraction
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Extract named entities (people, places, organizations, projects) from the query. Return a JSON array of entity names only. Do NOT include question words (what, where, when, who, how). Example: {"entities": ["Caroline", "LGBTQ support group"]}'
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
    
    // "Where does X work?" -> predicate: "work"
    const whereMatch = lower.match(/where does (\w+) (\w+)/);
    if (whereMatch) {
      return { type: 'current', predicate: whereMatch[2] };
    }
    
    // "Who does X Y?" -> predicate: "Y"
    const whoMatch = lower.match(/who does (\w+) (\w+)/);
    if (whoMatch) {
      return { type: 'current', predicate: whoMatch[2] };
    }
    
    return { type: 'current' };
  }
  
  /**
   * Semantic search fallback
   */
  private async semanticSearch(query: string, limit: number): Promise<any[]> {
    // Generate embedding for query
    const embedding = await this.generateEmbedding(query);
    
    // For SQLite, we don't have vector search, so return empty
    // In production (Neon/pgvector), this would search episodes
    return [];
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
   * Map database row to Fact type
   */
  private mapFact(row: any): Fact {
    return {
      id: row.id,
      subjectEntityId: row.subject_entity_id,
      predicate: row.predicate,
      objectEntityId: row.object_entity_id,
      objectValue: row.object,
      valueType: row.value_type || 'string',
      confidence: row.confidence || 0.8,
      sourceEpisodeId: row.source_episode_id,
      validFrom: row.valid_from ? new Date(row.valid_from) : undefined,
      validUntil: row.valid_until ? new Date(row.valid_until) : undefined,
      createdAt: row.created_at ? new Date(row.created_at) : new Date(),
      invalidatedAt: row.invalidated_at ? new Date(row.invalidated_at) : undefined,
      evidence: row.evidence ? JSON.parse(row.evidence) : undefined
    };
  }
  
  /**
   * Map database Row to Event type
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
      occurredAt: row.occurred_at ? new Date(row.occurred_at) : new Date(),
      observedAt: row.observed_at ? new Date(row.observed_at) : new Date(),
      sourceEpisodeId: row.source_episode_id
    };
  }
}