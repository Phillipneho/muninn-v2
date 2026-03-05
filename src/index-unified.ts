// Muninn v2.1 - Unified Observations API
// Main entry point using the new observation-based architecture

export { ObservationExtractor, calculateObservationWeight } from './observation-extractor.js';
export { ObservationDatabase } from './observation-database.js';
export * from './types.js';

import { ObservationDatabase, CreateObservationInput } from './observation-database.js';
import { ObservationExtractor, ExtractionResult } from './observation-extractor.js';
import type { RecallOptions, RecallResult } from './types.js';

/**
 * Parse session date from natural language format
 * Examples: "1:56 pm on 8 May, 2023", "7:55 pm on 9 June, 2023"
 */
function parseSessionDate(dateStr: string): Date | undefined {
  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  
  // Try natural language parsing
  // Match patterns like "1:56 pm on 8 May, 2023" or "8 May 2023"
  const patterns = [
    /(\d{1,2}):(\d{2})\s*(am|pm)?\s*on\s*(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[,\s]+(\d{4})/i,
    /(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[,\s]+(\d{4})/i,
  ];
  
  for (const pattern of patterns) {
    const match = dateStr.match(pattern);
    if (match) {
      let day: number, month: number, year: number;
      
      if (match[4]) { // Full format with time
        const hour = match[1];
        const minute = match[2];
        const ampm = match[3]?.toLowerCase();
        day = parseInt(match[4]);
        year = parseInt(match[6]);
        
        const monthStr = match[5].toLowerCase();
        const monthMap: Record<string, number> = {
          'jan': 0, 'january': 0, 'feb': 1, 'february': 1, 'mar': 2, 'march': 2,
          'apr': 3, 'april': 3, 'may': 4, 'jun': 5, 'june': 5, 'jul': 6, 'july': 6,
          'aug': 7, 'august': 7, 'sep': 8, 'september': 8, 'oct': 9, 'october': 9,
          'nov': 10, 'november': 10, 'dec': 11, 'december': 11
        };
        month = monthMap[monthStr] ?? 0;
        
        let hourNum = parseInt(hour);
        if (ampm === 'pm' && hourNum < 12) hourNum += 12;
        if (ampm === 'am' && hourNum === 12) hourNum = 0;
        
        const parsed = new Date(year, month, day, hourNum, parseInt(minute));
        if (!isNaN(parsed.getTime())) return parsed;
      } else { // Simple format without time
        day = parseInt(match[1]);
        year = parseInt(match[3]);
        
        const monthStr = match[2].toLowerCase();
        const monthMap: Record<string, number> = {
          'jan': 0, 'january': 0, 'feb': 1, 'february': 1, 'mar': 2, 'march': 2,
          'apr': 3, 'april': 3, 'may': 4, 'jun': 5, 'june': 5, 'jul': 6, 'july': 6,
          'aug': 7, 'august': 7, 'sep': 8, 'september': 8, 'oct': 9, 'october': 9,
          'nov': 10, 'november': 10, 'dec': 11, 'december': 11
        };
        month = monthMap[monthStr] ?? 0;
        
        const parsed = new Date(year, month, day);
        if (!isNaN(parsed.getTime())) return parsed;
      }
    }
  }
  
  // Fallback to Date constructor
  try {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) return parsed;
  } catch (e) {
    // Invalid
  }
  
  return undefined;
}

/**
 * Muninn v2.1 - Unified Memory System
 * 
 * Core principle: Memory is multidimensional signal, not binary events/facts.
 * 
 * What it stores:
 * - Observations: Tagged assertions (IDENTITY, TRAIT, ACTIVITY, STATE)
 * - Entities: People, places, concepts with aliases
 * - Relationships: Directed, typed links between entities
 * 
 * What it answers:
 * - What is true about X? (weighted by tag relevance)
 * - What did X do? (temporal query)
 * - How has X changed? (state evolution)
 */
export class Muninn {
  private db: ObservationDatabase;
  private extractor: ObservationExtractor;
  
  constructor(dbPath?: string) {
    this.db = new ObservationDatabase(dbPath);
    this.extractor = new ObservationExtractor();
  }
  
  /**
   * Ingest a conversation or document
   * Extracts observations using the Universal Observer
   */
  async remember(
    content: string,
    options?: {
      source?: string;
      actor?: string;
      sessionDate?: string;
    }
  ): Promise<{
    episodeId: string;
    observationsCreated: number;
    entitiesCreated: number;
  }> {
    // 1. Create episode
    let occurredAt: Date | undefined = undefined;
    if (options?.sessionDate) {
      occurredAt = parseSessionDate(options.sessionDate);
    }
    
    // 2. Extract observations using the Universal Observer
    // Pass normalized session date to the extractor
    const normalizedSessionDate = occurredAt ? occurredAt.toISOString().split('T')[0] : undefined;
    const extraction = await this.extractor.extract(content, normalizedSessionDate);
    
    // 3. Create episode
    const episode = this.db.createEpisode({
      content,
      source: options?.source || 'conversation',
      actor: options?.actor,
      occurredAt
    });
    
    // 3. Create entities (with alias resolution)
    const entityIdMap = new Map<string, string>();
    
    for (const entity of extraction.entities) {
      let resolved = this.db.resolveEntity(entity.name);
      if (!resolved) {
        resolved = this.db.createEntity({ name: entity.name, type: entity.type });
      }
      entityIdMap.set(entity.name.toLowerCase(), resolved.id);
    }
    
    // 4. Create observations
    let observationsCreated = 0;
    
    for (const obs of extraction.observations) {
      const entityId = entityIdMap.get(obs.entity_name.toLowerCase());
      if (!entityId) {
        // Create entity if not found
        const newEntity = this.db.createEntity({ name: obs.entity_name, type: 'person' });
        entityIdMap.set(obs.entity_name.toLowerCase(), newEntity.id);
      }
      
      const finalEntityId = entityIdMap.get(obs.entity_name.toLowerCase())!;
      
      // Create observation with all tags
      this.db.createObservation({
        entity_id: finalEntityId,
        tags: obs.tags,
        predicate: obs.predicate,
        object_value: obs.content,
        valid_from: obs.valid_from,
        valid_until: obs.valid_until,
        observed_at: options?.sessionDate || new Date().toISOString(),
        confidence: obs.confidence,
        source_episode_id: episode.id,
        evidence: obs.evidence
      });
      
      observationsCreated++;
    }
    
    return {
      episodeId: episode.id,
      observationsCreated,
      entitiesCreated: extraction.entities.length
    };
  }
  
  /**
   * Query memory with weighted retrieval
   * Priority: IDENTITY > STATE > TRAIT > ACTIVITY
   */
  async recall(query: string, options?: RecallOptions): Promise<RecallResult> {
    // Extract entities from query
    const entities = this.extractEntitiesSimple(query);
    
    if (entities.length === 0) {
      return { source: 'semantic', memories: [] };
    }
    
    // Resolve entity
    const entityName = entities[0];
    const resolved = this.db.resolveEntity(entityName);
    
    if (!resolved) {
      return { source: 'semantic', memories: [] };
    }
    
    // Get weighted observations (increase limit to capture more relevant facts)
    const observations = this.db.getWeightedObservations(entityName, options?.limit || 50);
    
    if (observations.length === 0) {
      return { source: 'semantic', memories: [] };
    }
    
    // Map to RecallResult format
    return {
      source: 'structured',
      facts: observations.map(obs => ({
        id: obs.id,
        subjectEntityId: obs.entity_id,
        subject: entityName,
        predicate: obs.predicate,
        object: obs.object_value,
        objectValue: obs.object_value,
        valueType: 'string' as const,
        validFrom: obs.valid_from ? new Date(obs.valid_from) : undefined,
        confidence: obs.confidence,
        evidence: obs.evidence ? [obs.evidence] : [],
        createdAt: new Date(obs.created_at),
        tags: obs.tags,
        weight: obs.weight
      }))
    };
  }
  
  /**
   * Get observations by tag
   */
  async getObservationsByTag(entityName: string, tag: string): Promise<RecallResult> {
    const resolved = this.db.resolveEntity(entityName);
    if (!resolved) return { source: 'semantic', memories: [] };
    
    const observations = this.db.getObservationsByEntity(resolved.id, {
      tags: [tag as any]
    });
    
    return {
      source: 'structured',
      facts: observations.map(obs => ({
        id: obs.id,
        subjectEntityId: obs.entity_id,
        subject: entityName,
        predicate: obs.predicate,
        object: obs.object_value,
        objectValue: obs.object_value,
        valueType: 'string' as const,
        validFrom: obs.valid_from ? new Date(obs.valid_from) : undefined,
        confidence: obs.confidence,
        evidence: obs.evidence ? [obs.evidence] : [],
        createdAt: new Date(obs.created_at),
        tags: obs.tags
      }))
    };
  }
  
  /**
   * Temporal query: What was true at a specific time?
   */
  async recallAtTime(entityName: string, date: Date): Promise<RecallResult> {
    const resolved = this.db.resolveEntity(entityName);
    if (!resolved) return { source: 'semantic', memories: [] };
    
    const observations = this.db.getObservationsByDateRange(
      resolved.id,
      new Date(0), // From beginning
      date
    );
    
    // Filter to only include observations valid at that time
    const validObs = observations.filter(obs => {
      if (!obs.valid_from) return true;
      const from = new Date(obs.valid_from);
      if (from > date) return false;
      if (obs.valid_until) {
        const until = new Date(obs.valid_until);
        if (until < date) return false;
      }
      return true;
    });
    
    return {
      source: 'structured',
      facts: validObs.map(obs => ({
        id: obs.id,
        subjectEntityId: obs.entity_id,
        subject: entityName,
        predicate: obs.predicate,
        object: obs.object_value,
        objectValue: obs.object_value,
        valueType: 'string' as const,
        validFrom: obs.valid_from ? new Date(obs.valid_from) : undefined,
        validUntil: obs.valid_until ? new Date(obs.valid_until) : undefined,
        confidence: obs.confidence,
        evidence: obs.evidence ? [obs.evidence] : [],
        createdAt: new Date(obs.created_at),
        tags: obs.tags
      }))
    };
  }
  
  /**
   * Get entity evolution (how did it change over time?)
   */
  async getEvolution(entityName: string, from?: Date, to?: Date): Promise<{
    observations: Array<{
      predicate: string;
      value: string;
      validFrom: string;
      validUntil?: string;
      tags: string[];
    }>;
  }> {
    const resolved = this.db.resolveEntity(entityName);
    if (!resolved) return { observations: [] };
    
    const observations = this.db.getObservationsByEntity(resolved.id);
    
    return {
      observations: observations
        .filter(obs => {
          if (!obs.valid_from) return false;
          const obsDate = new Date(obs.valid_from);
          if (from && obsDate < from) return false;
          if (to && obsDate > to) return false;
          return true;
        })
        .map(obs => ({
          predicate: obs.predicate,
          value: obs.object_value || '',
          validFrom: obs.valid_from || '',
          validUntil: obs.valid_until,
          tags: obs.tags
        }))
    };
  }
  
  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
  
  /**
   * Get database stats
   */
  getStats(): { entityCount: number; observationCount: number; episodeCount: number } {
    return this.db.getStats();
  }
  
  /**
   * Simple entity extraction from query
   */
  private extractEntitiesSimple(query: string): string[] {
    const questionWords = ['who', 'what', 'where', 'when', 'why', 'how', 'which', 'does', 'is', 'are', 'was', 'were', 'the', 'a', 'an', 'that', 'this', 'these', 'those'];
    
    // Find capitalized words
    const capitalized = query.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
    
    // Find quoted strings
    const quoted = query.match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, '')) || [];
    
    const all = [...capitalized, ...quoted];
    
    return [...new Set(all)]
      .map(e => e.trim())
      .filter(e => e.length > 1)
      .filter(e => !questionWords.includes(e.toLowerCase()));
  }
  
  /**
   * Get raw database for advanced operations
   */
  getDatabase(): ObservationDatabase {
    return this.db;
  }
}