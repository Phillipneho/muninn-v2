// Muninn v2 Retrieval Pipeline (SQLite Version)
// Priority: Structured → Graph → Events → Semantic

import type { RecallOptions, RecallResult, Fact, Event } from './types.js';
import { MuninnDatabase } from './database-sqlite.js';

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
    const entities = this.extractEntitiesSimple(query);
    
    // 2. Parse temporal intent (for filtering)
    const temporalIntent = this.parseTemporalIntent(query);
    
    // 3. Extract temporal bounds from query
    const temporalBounds = this.extractTemporalBounds(query);
    
    // 4. Try structured state query (by entity, with temporal filter)
    if (entities.length > 0) {
      // Resolve entity by name or alias
      const entityName = entities[0];
      const resolved = this.db.resolveEntity(entityName);
      const canonicalName = resolved?.name || entityName;
      
      const facts = this.db.getCurrentFacts(canonicalName);
      if (facts.length > 0) {
        // Apply temporal filter if query has time bounds
        const filteredFacts = temporalBounds 
          ? this.filterByTemporalBounds(facts, temporalBounds)
          : facts;
        
        return {
          source: 'structured',
          facts: filteredFacts.map(f => this.mapFact(f))
        };
      }
    }
    
    // 4. Try graph traversal (multi-hop)
    if (entities.length >= 2) {
      const path = this.db.traverseGraph(entities[0], 3);
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
      const events = this.db.getEntityEvolution(
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
    
    // 6. No results found
    return {
      source: 'semantic',
      memories: []
    };
  }
  
  /**
   * Extract entities from query using simple patterns
   */
  private extractEntitiesSimple(query: string): string[] {
    // Question words and articles to exclude
    const questionWords = ['who', 'what', 'where', 'when', 'why', 'how', 'which', 'does', 'is', 'are', 'was', 'were', 'the', 'a', 'an', 'that', 'this', 'these', 'those'];
    
    // Find capitalized words (likely named entities)
    const capitalized = query.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
    
    // Find quoted strings
    const quoted = query.match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, '')) || [];
    
    // Combine, filter, and dedupe
    const all = [...capitalized, ...quoted];
    const filtered = all.filter(word => !questionWords.includes(word.toLowerCase()));
    
    return [...new Set(filtered)];
  }
  
  /**
   * Extract temporal bounds from query (e.g., "in August", "last week")
   */
  private extractTemporalBounds(query: string): { 
    start?: Date; 
    end?: Date; 
    monthOnly?: number; // 0-11 for month-only queries
  } | null {
    const lower = query.toLowerCase();
    
    // Named months
    const months = ['january', 'february', 'march', 'april', 'may', 'june',
                    'july', 'august', 'september', 'october', 'november', 'december'];
    
    for (let i = 0; i < months.length; i++) {
      if (lower.includes(months[i])) {
        // Check if year is specified
        const yearMatch = lower.match(/\b(20\d{2})\b/);
        if (yearMatch) {
          const year = parseInt(yearMatch[1]);
          const start = new Date(year, i, 1);
          const end = new Date(year, i + 1, 0, 23, 59, 59);
          return { start, end };
        }
        
        // Month only - match any year
        return { monthOnly: i };
      }
    }
    
    // "last week", "last month"
    if (lower.includes('last week')) {
      const now = new Date();
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { start, end: now };
    }
    
    if (lower.includes('last month')) {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      return { start, end };
    }
    
    // Year references
    const yearMatch = lower.match(/\b(20\d{2})\b/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1]);
      const start = new Date(year, 0, 1);
      const end = new Date(year, 11, 31, 23, 59, 59);
      return { start, end };
    }
    
    return null;
  }
  
  /**
   * Filter facts by temporal bounds
   */
  private filterByTemporalBounds(
    facts: any[],
    bounds: { start?: Date; end?: Date; monthOnly?: number }
  ): any[] {
    return facts.filter(fact => {
      const factDate = fact.valid_from ? new Date(fact.valid_from) : null;
      if (!factDate) return true; // Keep facts without dates
      
      // Month-only filter (match any year)
      if (bounds.monthOnly !== undefined) {
        return factDate.getMonth() === bounds.monthOnly;
      }
      
      // Date range filter
      if (bounds.start && factDate < bounds.start) return false;
      if (bounds.end && factDate > bounds.end) return false;
      
      return true;
    });
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
      validFrom: row.valid_from ? new Date(row.valid_from) : undefined,
      validUntil: row.valid_until ? new Date(row.valid_until) : undefined,
      createdAt: row.created_at ? new Date(row.created_at) : new Date(),
      invalidatedAt: row.invalidated_at ? new Date(row.invalidated_at) : undefined,
      evidence: row.evidence ? JSON.parse(row.evidence) : undefined
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
      occurredAt: row.occurred_at ? new Date(row.occurred_at) : new Date(),
      observedAt: row.observed_at ? new Date(row.observed_at) : new Date(),
      sourceEpisodeId: row.source_episode_id
    };
  }
}