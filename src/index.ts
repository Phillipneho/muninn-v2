// Muninn v2 - Memory as Evolving Reality
// Main entry point

export { MuninnDatabase } from './database-sqlite.js';
export { FactExtractor, resolveEntities, detectContradictions } from './extraction.js';
export { Retriever } from './retrieval-sqlite.js';
export * from './types.js';

import { MuninnDatabase } from './database-sqlite.js';
import { FactExtractor, resolveEntities, detectContradictions } from './extraction.js';
import { Retriever } from './retrieval-sqlite.js';
import type { Episode, ExtractionResult, Fact, Entity } from './types.js';

/**
 * Muninn v2 Memory System
 * 
 * Core principle: Memory is a model of evolving reality, not stored text.
 * 
 * What it stores:
 * - Facts: Typed, timestamped assertions
 * - Events: State transitions (before → after)
 * - Relationships: Directed, typed links
 * - Contradictions: Conflicting assertions preserved, flagged
 * 
 * What it answers:
 * - What is true now?
 * - What changed?
 * - When did it change?
 * - Why do we believe this?
 * - Are there conflicts?
 */
export class Muninn {
  private db: MuninnDatabase;
  private extractor: FactExtractor;
  private retriever: Retriever;
  
  constructor(dbPath?: string) {
    this.db = new MuninnDatabase(dbPath);
    this.extractor = new FactExtractor();
    this.retriever = new Retriever(this.db);
  }
  
  /**
   * Ingest a conversation or document
   * Extracts facts, entities, events and stores them
   */
  async remember(
    content: string,
    options?: {
      source?: string;
      actor?: string;
      occurredAt?: Date;
      sessionDate?: string;
    }
  ): Promise<{
    episodeId: string;
    factsCreated: number;
    entitiesCreated: number;
    eventsCreated: number;
    contradictions: number;
  }> {
    // 1. Create episode (raw storage)
    const episode = this.db.createEpisode({
      content,
      source: options?.source || 'conversation',
      actor: options?.actor,
      occurredAt: options?.occurredAt || new Date()
    });
    
    // 2. Extract facts, entities, events
    const extraction = await this.extractor.extract(content, options?.sessionDate);
    
    // 3. Create entities
    const entityIdMap = new Map<string, string>();
    for (const entity of extraction.entities) {
      const created = this.db.findOrCreateEntity(entity.name, entity.type);
      entityIdMap.set(entity.name.toLowerCase(), created.id);
    }
    
    // 4. Create facts
    let factsCreated = 0;
    let contradictions = 0;
    
    for (const fact of extraction.facts) {
      const subjectId = entityIdMap.get(fact.subject.toLowerCase());
      if (!subjectId) {
        // Skip facts with unknown entities
        continue;
      }
      
      // Check for contradictions
      const existingFacts = this.db.getCurrentFacts(fact.subject);
      const conflicting = detectContradictions(fact, existingFacts.map(f => ({
        subject: f.subject,
        predicate: f.predicate,
        object: f.object,
        objectType: 'entity',
        confidence: f.confidence,
        evidence: f.evidence?.[0] || ''
      })));
      
      if (conflicting.length > 0) {
        // Create contradiction records
        for (const conflict of conflicting) {
          // Mark old fact as invalidated
          // Store new fact
          // Create contradiction record
          contradictions++;
        }
      }
      
      // Get object entity ID (or create)
      let objectEntityId: string | undefined;
      if (fact.objectType === 'entity') {
        objectEntityId = entityIdMap.get(fact.object.toLowerCase());
      }
      
      // Create fact
      this.db.createFact({
        subjectEntityId: subjectId,
        predicate: fact.predicate,
        objectEntityId,
        objectValue: fact.objectType === 'literal' ? fact.object : undefined,
        valueType: fact.objectType === 'entity' ? 'entity' : 'string',
        confidence: fact.confidence,
        sourceEpisodeId: episode.id,
        validFrom: fact.validFrom ? new Date(fact.validFrom) : undefined,
        evidence: fact.evidence ? [fact.evidence] : undefined
      });
      
      factsCreated++;
    }
    
    // 5. Create events
    let eventsCreated = 0;
    for (const event of extraction.events) {
      const entityId = entityIdMap.get(event.entity.toLowerCase());
      if (!entityId) continue;
      
      this.db.createEvent({
        entityId,
        attribute: event.attribute,
        oldValue: event.oldValue,
        newValue: event.newValue,
        cause: event.cause,
        occurredAt: event.occurredAt ? new Date(event.occurredAt) : options?.occurredAt || new Date(),
        sourceEpisodeId: episode.id
      });
      
      eventsCreated++;
    }
    
    return {
      episodeId: episode.id,
      factsCreated,
      entitiesCreated: extraction.entities.length,
      eventsCreated,
      contradictions
    };
  }
  
  /**
   * Query memory
   * Priority: Structured → Graph → Events → Semantic
   */
  async recall(query: string, options?: {
    limit?: number;
    entityFilter?: string[];
    timeRange?: { from?: Date; to?: Date };
  }) {
    return this.retriever.recall(query, options);
  }
  
  /**
   * Get entity evolution (how did it change over time?)
   */
  async getEvolution(entityName: string, from?: Date, to?: Date) {
    return this.db.getEntityEvolution(entityName, from, to);
  }
  
  /**
   * Traverse knowledge graph
   */
  async traverseGraph(startEntity: string, maxDepth?: number) {
    return this.db.traverseGraph(startEntity, maxDepth);
  }
  
  /**
   * Get unresolved contradictions
   */
  async getContradictions() {
    return this.db.getUnresolvedContradictions();
  }
  
  /**
   * Close database connection
   */
  close() {
    this.db.close();
  }
}