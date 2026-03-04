// Muninn v2 Database Client (SQLite Version)
// For local development. Use PostgreSQL + pgvector for production.

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { Entity, Fact, Event, Relationship, Contradiction, Episode } from './types.js';

export class MuninnDatabase {
  private db: Database.Database;
  
  constructor(dbPath?: string) {
    const path = dbPath || process.env.DATABASE_PATH || '/home/homelab/.openclaw/muninn-v2.db';
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.initialize();
  }
  
  private initialize(): void {
    // Create tables if not exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episodes (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        actor TEXT,
        occurred_at TEXT NOT NULL,
        ingested_at TEXT DEFAULT CURRENT_TIMESTAMP,
        embedding BLOB,
        metadata TEXT
      );
      
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        summary TEXT,
        embedding BLOB,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(name, type)
      );
      
      CREATE TABLE IF NOT EXISTS facts (
        id TEXT PRIMARY KEY,
        subject_entity_id TEXT REFERENCES entities(id),
        predicate TEXT NOT NULL,
        object_entity_id TEXT REFERENCES entities(id),
        object_value TEXT,
        value_type TEXT DEFAULT 'entity',
        confidence REAL DEFAULT 0.8,
        source_episode_id TEXT REFERENCES episodes(id),
        valid_from TEXT,
        valid_until TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        invalidated_at TEXT,
        evidence TEXT,
        summary_embedding BLOB
      );
      
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        fact_id TEXT REFERENCES facts(id),
        entity_id TEXT REFERENCES entities(id),
        attribute TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        cause TEXT,
        occurred_at TEXT NOT NULL,
        observed_at TEXT DEFAULT CURRENT_TIMESTAMP,
        source_episode_id TEXT REFERENCES episodes(id)
      );
      
      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        source_entity_id TEXT REFERENCES entities(id) NOT NULL,
        target_entity_id TEXT REFERENCES entities(id) NOT NULL,
        relationship_type TEXT NOT NULL,
        valid_from TEXT,
        valid_until TEXT,
        invalidated_at TEXT,
        evidence TEXT,
        source_episode_id TEXT REFERENCES episodes(id),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS contradictions (
        id TEXT PRIMARY KEY,
        fact_a_id TEXT REFERENCES facts(id) NOT NULL,
        fact_b_id TEXT REFERENCES facts(id) NOT NULL,
        conflict_type TEXT NOT NULL,
        detected_at TEXT DEFAULT CURRENT_TIMESTAMP,
        detected_by TEXT,
        resolution_status TEXT DEFAULT 'unresolved',
        resolved_at TEXT,
        resolution_note TEXT,
        UNIQUE(fact_a_id, fact_b_id)
      );
      
      CREATE TABLE IF NOT EXISTS entity_mentions (
        id TEXT PRIMARY KEY,
        episode_id TEXT REFERENCES episodes(id) NOT NULL,
        entity_id TEXT REFERENCES entities(id) NOT NULL,
        mention_context TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(episode_id, entity_id)
      );
      
      CREATE TABLE IF NOT EXISTS entity_aliases (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL REFERENCES entities(id),
        alias TEXT NOT NULL,
        source TEXT DEFAULT 'extracted',
        confidence REAL DEFAULT 0.5,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(entity_id, alias)
      );
      
      CREATE INDEX IF NOT EXISTS idx_aliases_entity ON entity_aliases(entity_id);
      CREATE INDEX IF NOT EXISTS idx_aliases_alias ON entity_aliases(alias COLLATE NOCASE);
      
      CREATE TABLE IF NOT EXISTS entity_relationships (
        id TEXT PRIMARY KEY,
        source_entity_id TEXT NOT NULL REFERENCES entities(id),
        target_entity_id TEXT NOT NULL REFERENCES entities(id),
        relationship_type TEXT NOT NULL,
        valid_from TEXT,
        valid_until TEXT,
        invalidated_at TEXT,
        confidence REAL DEFAULT 0.8,
        evidence TEXT,
        source_episode_id TEXT REFERENCES episodes(id),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_er_source ON entity_relationships(source_entity_id);
      CREATE INDEX IF NOT EXISTS idx_er_target ON entity_relationships(target_entity_id);
      CREATE INDEX IF NOT EXISTS idx_er_type ON entity_relationships(relationship_type);
      
      CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject_entity_id);
      CREATE INDEX IF NOT EXISTS idx_facts_predicate ON facts(predicate);
      CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_id);
      CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_entity_id);
    `);
  }
  
  // ============================================
  // ENTITY OPERATIONS
  // ============================================
  
  createEntity(entity: Omit<Entity, 'id' | 'createdAt' | 'updatedAt'>): Entity {
    const id = randomUUID();
    const now = new Date().toISOString();
    
    const stmt = this.db.prepare(`
      INSERT INTO entities (id, name, type, summary, embedding, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (name, type) DO UPDATE SET 
        summary = COALESCE(EXCLUDED.summary, entities.summary),
        updated_at = EXCLUDED.updated_at
      RETURNING *
    `);
    
    const result = stmt.get(
      id,
      entity.name,
      entity.type,
      entity.summary || null,
      entity.embedding ? Buffer.from(new Float32Array(entity.embedding).buffer) : null,
      now,
      now
    ) as Entity;
    
    return result;
  }
  
  findEntity(name: string, type?: string): Entity | null {
    const stmt = this.db.prepare(`
      SELECT * FROM entities
      WHERE name = ? ${type ? 'AND type = ?' : ''}
      LIMIT 1
    `);
    
    const result = type 
      ? stmt.get(name, type) 
      : stmt.get(name);
    
    return result as Entity | null;
  }
  
  findOrCreateEntity(name: string, type: string, summary?: string): Entity {
    const existing = this.findEntity(name, type);
    if (existing) return existing;
    return this.createEntity({ name, type: type as any, summary });
  }
  
  // ============================================
  // ENTITY ALIAS OPERATIONS
  // ============================================
  
  addAlias(entityId: string, alias: string, source: string = 'extracted', confidence: number = 0.5): void {
    const id = randomUUID();
    const now = new Date().toISOString();
    
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO entity_aliases (id, entity_id, alias, source, confidence, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(id, entityId, alias.toLowerCase(), source, confidence, now);
  }
  
  findEntityByAlias(alias: string): { entityId: string; alias: string; confidence: number } | null {
    const stmt = this.db.prepare(`
      SELECT entity_id, alias, confidence
      FROM entity_aliases
      WHERE alias = ? COLLATE NOCASE
      ORDER BY confidence DESC
      LIMIT 1
    `);
    
    const result = stmt.get(alias.toLowerCase()) as any;
    if (!result) return null;
    
    // Map snake_case to camelCase
    return {
      entityId: result.entity_id,
      alias: result.alias,
      confidence: result.confidence
    };
  }
  
  getAliases(entityId: string): Array<{ alias: string; source: string; confidence: number }> {
    const stmt = this.db.prepare(`
      SELECT alias, source, confidence
      FROM entity_aliases
      WHERE entity_id = ?
      ORDER BY confidence DESC
    `);
    
    const results = stmt.all(entityId) as any[];
    // Map snake_case to camelCase if needed
    return results.map(r => ({
      alias: r.alias,
      source: r.source,
      confidence: r.confidence
    }));
  }
  
  resolveEntity(nameOrAlias: string, type?: string): Entity | null {
    // 1. Exact match
    const exact = this.findEntity(nameOrAlias, type);
    if (exact) return exact;
    
    // 2. Alias match
    const aliasMatch = this.findEntityByAlias(nameOrAlias);
    if (aliasMatch) {
      const stmt = this.db.prepare('SELECT * FROM entities WHERE id = ?');
      return stmt.get(aliasMatch.entityId) as Entity;
    }
    
    return null;
  }
  
  // ============================================
  // EPISODE OPERATIONS
  // ============================================
  
  createEpisode(episode: Omit<Episode, 'id' | 'ingestedAt'>): Episode {
    const id = randomUUID();
    const now = new Date().toISOString();
    
    const stmt = this.db.prepare(`
      INSERT INTO episodes (id, content, source, actor, occurred_at, ingested_at, embedding, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `);
    
    const result = stmt.get(
      id,
      episode.content,
      episode.source,
      episode.actor || null,
      episode.occurredAt.toISOString(),
      now,
      episode.embedding ? Buffer.from(new Float32Array(episode.embedding).buffer) : null,
      JSON.stringify(episode.metadata || {})
    ) as Episode;
    
    return result;
  }
  
  // ============================================
  // FACT OPERATIONS
  // ============================================
  
  createFact(fact: Omit<Fact, 'id' | 'createdAt'>): Fact {
    const id = randomUUID();
    const now = new Date().toISOString();
    
    const stmt = this.db.prepare(`
      INSERT INTO facts (
        id, subject_entity_id, predicate, object_entity_id, object_value,
        value_type, confidence, source_episode_id, valid_from, valid_until,
        created_at, evidence, summary_embedding
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `);
    
    const result = stmt.get(
      id,
      fact.subjectEntityId,
      fact.predicate,
      fact.objectEntityId || null,
      fact.objectValue || null,
      fact.valueType || 'entity',
      fact.confidence || 0.8,
      fact.sourceEpisodeId || null,
      fact.validFrom?.toISOString() || null,
      fact.validUntil?.toISOString() || null,
      now,
      JSON.stringify(fact.evidence || []),
      fact.summaryEmbedding || null
    ) as Fact;
    
    return result;
  }
  
  getCurrentFacts(entityName: string, predicate?: string): any[] {
    const stmt = this.db.prepare(`
      SELECT 
        e1.name as subject,
        f.predicate,
        COALESCE(e2.name, f.object_value) as object,
        f.object_value,
        f.object_entity_id,
        f.confidence,
        f.valid_from,
        f.evidence,
        f.id,
        f.subject_entity_id,
        f.value_type
      FROM facts f
      JOIN entities e1 ON f.subject_entity_id = e1.id
      LEFT JOIN entities e2 ON f.object_entity_id = e2.id
      WHERE 
        e1.name = ? COLLATE NOCASE
        AND f.invalidated_at IS NULL
        AND (f.valid_until IS NULL OR datetime(f.valid_until) > datetime('now'))
        ${predicate ? 'AND f.predicate = ?' : ''}
      ORDER BY f.valid_from DESC
    `);
    
    return predicate ? stmt.all(entityName, predicate) : stmt.all(entityName);
  }
  
  invalidateFact(factId: string, reason?: string): void {
    const stmt = this.db.prepare(`
      UPDATE facts SET invalidated_at = ? WHERE id = ?
    `);
    stmt.run(new Date().toISOString(), factId);
  }
  
  // ============================================
  // EVENT OPERATIONS
  // ============================================
  
  createEvent(event: Omit<Event, 'id' | 'observedAt'>): Event {
    const id = randomUUID();
    const now = new Date().toISOString();
    
    const stmt = this.db.prepare(`
      INSERT INTO events (
        id, fact_id, entity_id, attribute, old_value, new_value,
        cause, occurred_at, observed_at, source_episode_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `);
    
    const result = stmt.get(
      id,
      event.factId || null,
      event.entityId,
      event.attribute,
      event.oldValue || null,
      event.newValue,
      event.cause || null,
      event.occurredAt.toISOString(),
      now,
      event.sourceEpisodeId || null
    ) as Event;
    
    return result;
  }
  
  getEntityEvolution(entityName: string, from?: Date, to?: Date): any[] {
    const stmt = this.db.prepare(`
      SELECT 
        ev.attribute,
        ev.old_value,
        ev.new_value,
        ev.cause,
        ev.occurred_at
      FROM events ev
      JOIN entities e ON ev.entity_id = e.id
      WHERE e.name = ?
        AND (? IS NULL OR datetime(ev.occurred_at) >= datetime(?))
        AND (? IS NULL OR datetime(ev.occurred_at) <= datetime(?))
      ORDER BY ev.occurred_at DESC
    `);
    
    const fromStr = from?.toISOString() || null;
    const toStr = to?.toISOString() || null;
    
    return stmt.all(entityName, fromStr, fromStr, toStr, toStr);
  }
  
  // ============================================
  // RELATIONSHIP OPERATIONS
  // ============================================
  
  createRelationship(rel: Omit<Relationship, 'id' | 'createdAt'>): Relationship {
    const id = randomUUID();
    const now = new Date().toISOString();
    
    const stmt = this.db.prepare(`
      INSERT INTO relationships (
        id, source_entity_id, target_entity_id, relationship_type,
        valid_from, valid_until, invalidated_at, evidence, source_episode_id, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `);
    
    const result = stmt.get(
      id,
      rel.sourceEntityId,
      rel.targetEntityId,
      rel.relationshipType,
      rel.validFrom?.toISOString() || null,
      rel.validUntil?.toISOString() || null,
      rel.invalidatedAt?.toISOString() || null,
      JSON.stringify(rel.evidence || []),
      rel.sourceEpisodeId || null,
      now
    ) as Relationship;
    
    return result;
  }
  
  traverseGraph(startEntity: string, maxDepth: number = 3): any[] {
    // Simplified BFS traversal for SQLite
    const results: any[] = [];
    const visited = new Set<string>();
    const queue: { entity: string; depth: number; path: string[] }[] = [{ entity: startEntity, depth: 1, path: [startEntity] }];
    
    while (queue.length > 0 && results.length < 100) {
      const current = queue.shift()!;
      
      if (current.depth > maxDepth || visited.has(current.entity)) continue;
      visited.add(current.entity);
      
      // Find all relationships from this entity
      const stmt = this.db.prepare(`
        SELECT 
          e.name as entity,
          r.relationship_type,
          e2.name as related_entity
        FROM relationships r
        JOIN entities e ON r.source_entity_id = e.id
        JOIN entities e2 ON r.target_entity_id = e2.id
        WHERE e.name = ? AND r.invalidated_at IS NULL
      `);
      
      const relations = stmt.all(current.entity) as any[];
      
      for (const rel of relations) {
        results.push({
          entity: rel.entity,
          relationship: rel.relationship_type,
          related_entity: rel.related_entity,
          depth: current.depth,
          path: [...current.path, rel.related_entity]
        });
        
        if (!visited.has(rel.related_entity)) {
          queue.push({
            entity: rel.related_entity,
            depth: current.depth + 1,
            path: [...current.path, rel.related_entity]
          });
        }
      }
    }
    
    return results;
  }
  
  // ============================================
  // CONTRADICTION OPERATIONS
  // ============================================
  
  createContradiction(contradiction: Omit<Contradiction, 'id' | 'detectedAt'>): Contradiction | null {
    const id = randomUUID();
    const now = new Date().toISOString();
    
    try {
      const stmt = this.db.prepare(`
        INSERT INTO contradictions (
          id, fact_a_id, fact_b_id, conflict_type, detected_by, resolution_status, detected_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (fact_a_id, fact_b_id) DO NOTHING
        RETURNING *
      `);
      
      const result = stmt.get(
        id,
        contradiction.factAId,
        contradiction.factBId,
        contradiction.conflictType,
        contradiction.detectedBy || 'llm',
        contradiction.resolutionStatus || 'unresolved',
        now
      ) as Contradiction;
      
      return result;
    } catch (e) {
      return null;
    }
  }
  
  getUnresolvedContradictions(): any[] {
    const stmt = this.db.prepare(`
      SELECT 
        e.name as subject,
        fa.predicate,
        COALESCE(ea.name, fa.object_value) as value_a,
        COALESCE(eb.name, fb.object_value) as value_b,
        c.detected_at,
        c.conflict_type
      FROM contradictions c
      JOIN facts fa ON c.fact_a_id = fa.id
      JOIN facts fb ON c.fact_b_id = fb.id
      JOIN entities e ON fa.subject_entity_id = e.id
      LEFT JOIN entities ea ON fa.object_entity_id = ea.id
      LEFT JOIN entities eb ON fb.object_entity_id = eb.id
      WHERE c.resolution_status = 'unresolved'
      ORDER BY c.detected_at DESC
    `);
    
    return stmt.all();
  }
  
  // ============================================
  // UTILITY
  // ============================================
  
  getStats(): {
    entityCount: number;
    factCount: number;
    eventCount: number;
    relationshipCount: number;
    contradictionCount: number;
  } {
    const entityCount = this.db.prepare('SELECT COUNT(*) as count FROM entities').get() as { count: number };
    const factCount = this.db.prepare('SELECT COUNT(*) as count FROM facts').get() as { count: number };
    const eventCount = this.db.prepare('SELECT COUNT(*) as count FROM events').get() as { count: number };
    const relationshipCount = this.db.prepare('SELECT COUNT(*) as count FROM relationships').get() as { count: number };
    const contradictionCount = this.db.prepare('SELECT COUNT(*) as count FROM contradictions WHERE resolution_status = ?').get('unresolved') as { count: number };
    
    return {
      entityCount: entityCount.count,
      factCount: factCount.count,
      eventCount: eventCount.count,
      relationshipCount: relationshipCount.count,
      contradictionCount: contradictionCount.count
    };
  }
  
  // ============================================
  // ENTITY RELATIONSHIP OPERATIONS (v3.1)
  // ============================================
  
  createEntityRelationship(relationship: {
    sourceEntityId: string;
    targetEntityId: string;
    relationshipType: string;
    confidence?: number;
    evidence?: string;
    sourceEpisodeId?: string;
  }): { id: string; sourceEntityId: string; targetEntityId: string; relationshipType: string } {
    const id = randomUUID();
    const now = new Date().toISOString();
    
    const stmt = this.db.prepare(`
      INSERT INTO entity_relationships (
        id, source_entity_id, target_entity_id, relationship_type,
        confidence, evidence, source_episode_id, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO UPDATE SET
        confidence = MAX(confidence, EXCLUDED.confidence)
      RETURNING id, source_entity_id, target_entity_id, relationship_type
    `);
    
    const result = stmt.get(
      id,
      relationship.sourceEntityId,
      relationship.targetEntityId,
      relationship.relationshipType,
      relationship.confidence || 0.8,
      relationship.evidence || null,
      relationship.sourceEpisodeId || null,
      now
    ) as any;
    
    return result;
  }
  
  getEntityRelationships(entityId: string, direction: 'outgoing' | 'incoming' | 'both' = 'both'): any[] {
    const outgoingStmt = this.db.prepare(`
      SELECT er.*, e.name as target_name, e.type as target_type
      FROM entity_relationships er
      JOIN entities e ON er.target_entity_id = e.id
      WHERE er.source_entity_id = ? AND er.invalidated_at IS NULL
      ORDER BY er.confidence DESC
    `);
    
    const incomingStmt = this.db.prepare(`
      SELECT er.*, e.name as source_name, e.type as source_type
      FROM entity_relationships er
      JOIN entities e ON er.source_entity_id = e.id
      WHERE er.target_entity_id = ? AND er.invalidated_at IS NULL
      ORDER BY er.confidence DESC
    `);
    
    const results: any[] = [];
    
    if (direction === 'outgoing' || direction === 'both') {
      results.push(...outgoingStmt.all(entityId));
    }
    
    if (direction === 'incoming' || direction === 'both') {
      results.push(...incomingStmt.all(entityId));
    }
    
    return results;
  }
  
  findRelatedEntities(entityId: string, relationshipType?: string): Array<{ relatedEntityId: string; relatedEntityName: string; relationshipType: string }> {
    const stmt = this.db.prepare(`
      SELECT 
        CASE 
          WHEN er.source_entity_id = ? THEN er.target_entity_id
          ELSE er.source_entity_id
        END as related_entity_id,
        CASE 
          WHEN er.source_entity_id = ? THEN e2.name
          ELSE e1.name
        END as related_entity_name,
        er.relationship_type
      FROM entity_relationships er
      JOIN entities e1 ON er.source_entity_id = e1.id
      JOIN entities e2 ON er.target_entity_id = e2.id
      WHERE (er.source_entity_id = ? OR er.target_entity_id = ?)
        AND er.invalidated_at IS NULL
        ${relationshipType ? 'AND er.relationship_type = ?' : ''}
      ORDER BY er.confidence DESC
    `);
    
    const params = relationshipType 
      ? [entityId, entityId, entityId, entityId, relationshipType]
      : [entityId, entityId, entityId, entityId];
    
    return stmt.all(...params) as any[];
  }
  
  traverseRelationships(entityId: string, relationshipType: string, depth: number = 1): Array<{ entityId: string; entityName: string; path: string[] }> {
    if (depth === 0) {
      const entity = this.db.prepare('SELECT id, name FROM entities WHERE id = ?').get(entityId) as any;
      return entity ? [{ entityId: entity.id, entityName: entity.name, path: [] }] : [];
    }
    
    const results: Array<{ entityId: string; entityName: string; path: string[] }> = [];
    const visited = new Set<string>([entityId]);
    
    const traverse = (currentId: string, currentPath: string[], remainingDepth: number) => {
      if (remainingDepth === 0) return;
      
      const related = this.findRelatedEntities(currentId, relationshipType);
      
      for (const rel of related) {
        // Map snake_case from SQL to camelCase
        const relatedId = (rel as any).related_entity_id || rel.relatedEntityId;
        const relatedName = (rel as any).related_entity_name || rel.relatedEntityName;
        const relType = (rel as any).relationship_type || rel.relationshipType;
        
        if (relatedId && !visited.has(relatedId)) {
          visited.add(relatedId);
          const newPath = [...currentPath, relType];
          
          results.push({
            entityId: relatedId,
            entityName: relatedName,
            path: newPath
          });
          
          traverse(relatedId, newPath, remainingDepth - 1);
        }
      }
    };
    
    traverse(entityId, [], depth);
    return results;
  }
  
  close(): void {
    this.db.close();
  }
  
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}