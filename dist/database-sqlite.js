// Muninn v2 Database Client (SQLite Version)
// For local development. Use PostgreSQL + pgvector for production.
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
export class MuninnDatabase {
    db;
    constructor(dbPath) {
        const path = dbPath || process.env.DATABASE_PATH || '/home/homelab/.openclaw/muninn-v2.db';
        this.db = new Database(path);
        this.db.pragma('journal_mode = WAL');
        this.initialize();
    }
    initialize() {
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
        evidence TEXT
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
      
      CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject_entity_id);
      CREATE INDEX IF NOT EXISTS idx_facts_predicate ON facts(predicate);
      CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_id);
      CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_entity_id);
    `);
    }
    // ============================================
    // ENTITY OPERATIONS
    // ============================================
    createEntity(entity) {
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
        const result = stmt.get(id, entity.name, entity.type, entity.summary || null, entity.embedding ? Buffer.from(new Float32Array(entity.embedding).buffer) : null, now, now);
        return result;
    }
    findEntity(name, type) {
        const stmt = this.db.prepare(`
      SELECT * FROM entities
      WHERE name = ? ${type ? 'AND type = ?' : ''}
      LIMIT 1
    `);
        const result = type
            ? stmt.get(name, type)
            : stmt.get(name);
        return result;
    }
    findOrCreateEntity(name, type, summary) {
        const existing = this.findEntity(name, type);
        if (existing)
            return existing;
        return this.createEntity({ name, type: type, summary });
    }
    // ============================================
    // EPISODE OPERATIONS
    // ============================================
    createEpisode(episode) {
        const id = randomUUID();
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
      INSERT INTO episodes (id, content, source, actor, occurred_at, ingested_at, embedding, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `);
        const result = stmt.get(id, episode.content, episode.source, episode.actor || null, episode.occurredAt.toISOString(), now, episode.embedding ? Buffer.from(new Float32Array(episode.embedding).buffer) : null, JSON.stringify(episode.metadata || {}));
        return result;
    }
    // ============================================
    // FACT OPERATIONS
    // ============================================
    createFact(fact) {
        const id = randomUUID();
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
      INSERT INTO facts (
        id, subject_entity_id, predicate, object_entity_id, object_value,
        value_type, confidence, source_episode_id, valid_from, valid_until,
        created_at, evidence
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `);
        const result = stmt.get(id, fact.subjectEntityId, fact.predicate, fact.objectEntityId || null, fact.objectValue || null, fact.valueType || 'entity', fact.confidence || 0.8, fact.sourceEpisodeId || null, fact.validFrom?.toISOString() || null, fact.validUntil?.toISOString() || null, now, JSON.stringify(fact.evidence || []));
        return result;
    }
    getCurrentFacts(entityName, predicate) {
        const stmt = this.db.prepare(`
      SELECT 
        e1.name as subject,
        f.predicate,
        COALESCE(e2.name, f.object_value) as object,
        f.valid_from,
        f.confidence,
        f.evidence,
        ep.source
      FROM facts f
      JOIN entities e1 ON f.subject_entity_id = e1.id
      LEFT JOIN entities e2 ON f.object_entity_id = e2.id
      LEFT JOIN episodes ep ON f.source_episode_id = ep.id
      WHERE 
        e1.name = ?
        AND f.invalidated_at IS NULL
        AND (f.valid_until IS NULL OR datetime(f.valid_until) > datetime('now'))
        ${predicate ? 'AND f.predicate = ?' : ''}
      ORDER BY f.valid_from DESC
    `);
        return predicate ? stmt.all(entityName, predicate) : stmt.all(entityName);
    }
    invalidateFact(factId, reason) {
        const stmt = this.db.prepare(`
      UPDATE facts SET invalidated_at = ? WHERE id = ?
    `);
        stmt.run(new Date().toISOString(), factId);
    }
    // ============================================
    // EVENT OPERATIONS
    // ============================================
    createEvent(event) {
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
        const result = stmt.get(id, event.factId || null, event.entityId, event.attribute, event.oldValue || null, event.newValue, event.cause || null, event.occurredAt.toISOString(), now, event.sourceEpisodeId || null);
        return result;
    }
    getEntityEvolution(entityName, from, to) {
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
    createRelationship(rel) {
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
        const result = stmt.get(id, rel.sourceEntityId, rel.targetEntityId, rel.relationshipType, rel.validFrom?.toISOString() || null, rel.validUntil?.toISOString() || null, rel.invalidatedAt?.toISOString() || null, JSON.stringify(rel.evidence || []), rel.sourceEpisodeId || null, now);
        return result;
    }
    traverseGraph(startEntity, maxDepth = 3) {
        // Simplified BFS traversal for SQLite
        const results = [];
        const visited = new Set();
        const queue = [{ entity: startEntity, depth: 1, path: [startEntity] }];
        while (queue.length > 0 && results.length < 100) {
            const current = queue.shift();
            if (current.depth > maxDepth || visited.has(current.entity))
                continue;
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
            const relations = stmt.all(current.entity);
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
    createContradiction(contradiction) {
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
            const result = stmt.get(id, contradiction.factAId, contradiction.factBId, contradiction.conflictType, contradiction.detectedBy || 'llm', contradiction.resolutionStatus || 'unresolved', now);
            return result;
        }
        catch (e) {
            return null;
        }
    }
    getUnresolvedContradictions() {
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
    close() {
        this.db.close();
    }
    transaction(fn) {
        return this.db.transaction(fn)();
    }
}
//# sourceMappingURL=database-sqlite.js.map