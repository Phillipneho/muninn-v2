// Muninn v2 Unified Observation Database
// Replaces separate facts and events tables

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

export interface Observation {
  id: string;
  entity_id: string;
  tags: string[];
  predicate: string;
  object_value?: string;
  object_entity_id?: string;
  valid_from?: string;
  valid_until?: string;
  observed_at: string;
  confidence: number;
  source_episode_id?: string;
  evidence?: string;
  previous_value?: string;
  created_at: string;
}

export interface Entity {
  id: string;
  name: string;
  type: string;
  created_at: string;
}

export interface CreateEntityInput {
  name: string;
  type: string;
}

export interface CreateObservationInput {
  entity_id: string;
  tags: string[];
  predicate: string;
  object_value?: string;
  object_entity_id?: string;
  valid_from?: string;
  valid_until?: string;
  observed_at?: string;
  confidence?: number;
  source_episode_id?: string;
  evidence?: string;
  previous_value?: string;
}

export class ObservationDatabase {
  private db: Database.Database;
  
  constructor(dbPath?: string) {
    this.db = new Database(dbPath || ':memory:');
    this.initialize();
  }
  
  private initialize() {
    // Enable foreign keys
    this.db.pragma('journal_mode = WAL');
    
    // Create tables
    this.db.exec(`
      -- Episodes (source of truth)
      CREATE TABLE IF NOT EXISTS episodes (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        source TEXT,
        actor TEXT,
        occurred_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Entities
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'concept',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
      
      -- Entity Aliases
      CREATE TABLE IF NOT EXISTS entity_aliases (
        id TEXT PRIMARY KEY,
        entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
        alias TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_aliases_entity ON entity_aliases(entity_id);
      CREATE INDEX IF NOT EXISTS idx_aliases_alias ON entity_aliases(alias);
      
      -- Unified Observations
      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        tags TEXT NOT NULL DEFAULT '[]',
        predicate TEXT NOT NULL,
        object_value TEXT,
        object_entity_id TEXT REFERENCES entities(id),
        valid_from TEXT,
        valid_until TEXT,
        observed_at TEXT NOT NULL,
        confidence REAL DEFAULT 0.8,
        source_episode_id TEXT REFERENCES episodes(id),
        evidence TEXT,
        previous_value TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_obs_entity ON observations(entity_id);
      CREATE INDEX IF NOT EXISTS idx_obs_predicate ON observations(predicate);
      CREATE INDEX IF NOT EXISTS idx_obs_temporal ON observations(valid_from, valid_until);
      CREATE INDEX IF NOT EXISTS idx_obs_tags ON observations(tags);
      
      -- Entity Relationships (for graph traversal)
      CREATE TABLE IF NOT EXISTS entity_relationships (
        id TEXT PRIMARY KEY,
        source_entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
        target_entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
        relationship_type TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_rel_source ON entity_relationships(source_entity_id);
      CREATE INDEX IF NOT EXISTS idx_rel_target ON entity_relationships(target_entity_id);
    `);
  }
  
  // Entity operations
  createEntity(input: CreateEntityInput): Entity {
    const id = uuidv4();
    const now = new Date().toISOString();
    
    this.db.prepare(`
      INSERT INTO entities (id, name, type, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, input.name, input.type, now);
    
    return { id, name: input.name, type: input.type, created_at: now };
  }
  
  getEntity(id: string): Entity | undefined {
    return this.db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as Entity | undefined;
  }
  
  resolveEntity(name: string, type?: string): Entity | undefined {
    const normalizedName = name.toLowerCase().trim();
    
    // Try exact match first
    let entity = this.db.prepare(`
      SELECT * FROM entities WHERE LOWER(name) = ?
    `).get(normalizedName) as Entity | undefined;
    
    if (entity) return entity;
    
    // Try alias match
    entity = this.db.prepare(`
      SELECT e.* FROM entities e
      JOIN entity_aliases a ON e.id = a.entity_id
      WHERE LOWER(a.alias) = ?
    `).get(normalizedName) as Entity | undefined;
    
    return entity;
  }
  
  createAlias(entityId: string, alias: string): void {
    this.db.prepare(`
      INSERT INTO entity_aliases (id, entity_id, alias)
      VALUES (?, ?, ?)
    `).run(uuidv4(), entityId, alias.toLowerCase().trim());
  }
  
  // Observation operations
  createObservation(input: CreateObservationInput): Observation {
    const id = uuidv4();
    const now = new Date().toISOString();
    
    // Handle date parsing - try to parse, fall back to now
    let observedAt: string;
    if (input.observed_at) {
      try {
        const parsed = new Date(input.observed_at);
        observedAt = isNaN(parsed.getTime()) ? now : parsed.toISOString();
      } catch {
        observedAt = now;
      }
    } else {
      observedAt = now;
    }
    
    const tagsJson = JSON.stringify(input.tags);
    
    this.db.prepare(`
      INSERT INTO observations (
        id, entity_id, tags, predicate, object_value, object_entity_id,
        valid_from, valid_until, observed_at, confidence,
        source_episode_id, evidence, previous_value, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.entity_id, tagsJson, input.predicate,
      input.object_value || null, input.object_entity_id || null,
      input.valid_from || null, input.valid_until || null,
      observedAt, input.confidence || 0.8,
      input.source_episode_id || null, input.evidence || null,
      input.previous_value || null, now
    );
    
    return this.getObservation(id)!;
  }
  
  getObservation(id: string): Observation | undefined {
    const row = this.db.prepare('SELECT * FROM observations WHERE id = ?').get(id);
    if (!row) return undefined;
    return this.rowToObservation(row);
  }
  
  getObservationsByEntity(entityId: string, options?: {
    tags?: string[];
    predicate?: string;
    limit?: number;
  }): Observation[] {
    let sql = 'SELECT * FROM observations WHERE entity_id = ?';
    const params: any[] = [entityId];
    
    if (options?.tags && options.tags.length > 0) {
      // JSON array contains check (SQLite)
      const tagConditions = options.tags.map(() => "tags LIKE ?");
      sql += ` AND (${tagConditions.join(' OR ')})`;
      options.tags.forEach(tag => {
        params.push(`%"${tag}"%`);
      });
    }
    
    if (options?.predicate) {
      sql += ' AND predicate = ?';
      params.push(options.predicate);
    }
    
    sql += ' ORDER BY observed_at DESC';
    
    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }
    
    const rows = this.db.prepare(sql).all(...params);
    return rows.map(r => this.rowToObservation(r));
  }
  
  // Weighted retrieval for answer generation
  getWeightedObservations(entityName: string, limit: number = 20): Array<Observation & { weight: number }> {
    const entity = this.resolveEntity(entityName);
    if (!entity) return [];
    
    // Get ALL observations for this entity (no limit yet)
    // We need to sort by weight, not by date
    const observations = this.getObservationsByEntity(entity.id, { limit: 1000 });
    
    // Calculate weights based on tags
    const WEIGHTS: Record<string, number> = {
      'IDENTITY': 10.0,
      'STATE': 5.0,
      'TRAIT': 3.0,
      'ACTIVITY': 1.0
    };
    
    const weighted = observations.map(obs => {
      const maxWeight = Math.max(...obs.tags.map(t => WEIGHTS[t] || 1.0));
      return { ...obs, weight: obs.confidence * maxWeight };
    }).sort((a, b) => b.weight - a.weight);
    
    // NOW apply the limit
    return weighted.slice(0, limit);
  }
  
  // Temporal queries
  getObservationsByDateRange(entityId: string, from: Date, to: Date): Observation[] {
    const rows = this.db.prepare(`
      SELECT * FROM observations
      WHERE entity_id = ?
        AND valid_from IS NOT NULL
        AND valid_from >= ?
        AND valid_from <= ?
      ORDER BY valid_from ASC
    `).all(entityId, from.toISOString(), to.toISOString());
    
    return rows.map(r => this.rowToObservation(r));
  }
  
  // Episode operations
  createEpisode(input: { content: string; source?: string; actor?: string; occurredAt?: Date }): { id: string } {
    const id = uuidv4();
    // Handle invalid dates gracefully
    let occurredAtStr: string | null = null;
    if (input.occurredAt) {
      try {
        occurredAtStr = input.occurredAt.toISOString();
      } catch (e) {
        // Invalid date, use null
        occurredAtStr = null;
      }
    }
    this.db.prepare(`
      INSERT INTO episodes (id, content, source, actor, occurred_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, input.content, input.source || null, input.actor || null, occurredAtStr);
    return { id };
  }
  
  // Stats
  getStats(): { entityCount: number; observationCount: number; episodeCount: number } {
    const entityCount = (this.db.prepare('SELECT COUNT(*) as count FROM entities').get() as any).count;
    const observationCount = (this.db.prepare('SELECT COUNT(*) as count FROM observations').get() as any).count;
    const episodeCount = (this.db.prepare('SELECT COUNT(*) as count FROM episodes').get() as any).count;
    
    return { entityCount, observationCount, episodeCount };
  }
  
  // Graph traversal (unchanged from v2)
  traverseGraph(startEntityName: string, maxDepth: number = 3): Array<{
    entity: string;
    relationship: string;
    relatedEntity: string;
    depth: number;
  }> {
    const startEntity = this.resolveEntity(startEntityName);
    if (!startEntity) return [];
    
    const results: Array<{ entity: string; relationship: string; relatedEntity: string; depth: number }> = [];
    const visited = new Set<string>();
    const queue: Array<{ id: string; name: string; depth: number }> = [{ id: startEntity.id, name: startEntityName, depth: 0 }];
    
    while (queue.length > 0 && results.length < 50) {
      const current = queue.shift()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      
      if (current.depth > 0) {
        // Find entity name from observations
        const obs = this.getObservationsByEntity(current.id, { limit: 1 });
        if (obs.length > 0) {
          // Add relationship info
        }
      }
      
      if (current.depth < maxDepth) {
        // Find related entities through observations
        const relationships = this.db.prepare(`
          SELECT DISTINCT e.name, o.predicate, o.object_value
          FROM observations o
          JOIN entities e ON o.object_entity_id = e.id
          WHERE o.entity_id = ?
        `).all(current.id) as Array<{ name: string; predicate: string; object_value: string }>;
        
        for (const rel of relationships) {
          if (!visited.has(rel.name)) {
            results.push({
              entity: current.name,
              relationship: rel.predicate,
              relatedEntity: rel.name,
              depth: current.depth
            });
            queue.push({ id: '', name: rel.name, depth: current.depth + 1 });
          }
        }
      }
    }
    
    return results;
  }
  
  close(): void {
    this.db.close();
  }
  
  private rowToObservation(row: any): Observation {
    return {
      id: row.id,
      entity_id: row.entity_id,
      tags: JSON.parse(row.tags || '[]'),
      predicate: row.predicate,
      object_value: row.object_value,
      object_entity_id: row.object_entity_id,
      valid_from: row.valid_from,
      valid_until: row.valid_until,
      observed_at: row.observed_at,
      confidence: row.confidence,
      source_episode_id: row.source_episode_id,
      evidence: row.evidence,
      previous_value: row.previous_value,
      created_at: row.created_at
    };
  }
}