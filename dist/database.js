// Muninn v2 Database Client
// PostgreSQL with pgvector
import { Pool } from 'pg';
export class MuninnDatabase {
    pool;
    constructor(connectionString) {
        this.pool = new Pool({
            connectionString: connectionString || process.env.DATABASE_URL || 'postgresql://localhost:5432/muninn_v2',
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });
    }
    // ============================================
    // ENTITY OPERATIONS
    // ============================================
    async createEntity(entity) {
        const result = await this.pool.query(`
      INSERT INTO entities (name, type, summary, embedding)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (name, type) DO UPDATE SET 
        summary = COALESCE(EXCLUDED.summary, entities.summary),
        updated_at = now()
      RETURNING *
    `, [entity.name, entity.type, entity.summary || null, entity.embedding || null]);
        return result.rows[0];
    }
    async findEntity(name, type) {
        const result = await this.pool.query(`
      SELECT * FROM entities
      WHERE name ILIKE $1
      ${type ? 'AND type = $2' : ''}
      LIMIT 1
    `, type ? [name, type] : [name]);
        return result.rows[0] || null;
    }
    async findOrCreateEntity(name, type, summary) {
        const existing = await this.findEntity(name, type);
        if (existing)
            return existing;
        return this.createEntity({ name, type: type, summary });
    }
    // ============================================
    // EPISODE OPERATIONS
    // ============================================
    async createEpisode(episode) {
        const result = await this.pool.query(`
      INSERT INTO episodes (content, source, actor, occurred_at, embedding, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
            episode.content,
            episode.source,
            episode.actor || null,
            episode.occurredAt,
            episode.embedding || null,
            episode.metadata || {}
        ]);
        return result.rows[0];
    }
    // ============================================
    // FACT OPERATIONS
    // ============================================
    async createFact(fact) {
        const result = await this.pool.query(`
      INSERT INTO facts (
        subject_entity_id, predicate, object_entity_id, object_value,
        value_type, confidence, source_episode_id, valid_from, valid_until,
        evidence
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
            fact.subjectEntityId,
            fact.predicate,
            fact.objectEntityId || null,
            fact.objectValue || null,
            fact.valueType || 'entity',
            fact.confidence || 0.8,
            fact.sourceEpisodeId || null,
            fact.validFrom || null,
            fact.validUntil || null,
            fact.evidence || []
        ]);
        return result.rows[0];
    }
    async getCurrentFacts(entityName, predicate) {
        const result = await this.pool.query(`
      SELECT * FROM query_current_facts($1, $2)
    `, [entityName, predicate || null]);
        return result.rows;
    }
    async invalidateFact(factId, reason) {
        await this.pool.query(`
      UPDATE facts
      SET invalidated_at = now()
      WHERE id = $1
    `, [factId]);
    }
    // ============================================
    // EVENT OPERATIONS
    // ============================================
    async createEvent(event) {
        const result = await this.pool.query(`
      INSERT INTO events (
        fact_id, entity_id, attribute, old_value, new_value,
        cause, occurred_at, source_episode_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
            event.factId || null,
            event.entityId,
            event.attribute,
            event.oldValue || null,
            event.newValue,
            event.cause || null,
            event.occurredAt,
            event.sourceEpisodeId || null
        ]);
        return result.rows[0];
    }
    async getEntityEvolution(entityName, from, to) {
        const result = await this.pool.query(`
      SELECT * FROM entity_evolution($1, $2, $3)
    `, [entityName, from || null, to || null]);
        return result.rows;
    }
    // ============================================
    // RELATIONSHIP OPERATIONS
    // ============================================
    async createRelationship(rel) {
        const result = await this.pool.query(`
      INSERT INTO relationships (
        source_entity_id, target_entity_id, relationship_type,
        valid_from, valid_until, evidence, source_episode_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
            rel.sourceEntityId,
            rel.targetEntityId,
            rel.relationshipType,
            rel.validFrom || null,
            rel.validUntil || null,
            rel.evidence || [],
            rel.sourceEpisodeId || null
        ]);
        return result.rows[0];
    }
    async traverseGraph(startEntity, maxDepth = 3) {
        const result = await this.pool.query(`
      SELECT * FROM traverse_graph($1, $2)
    `, [startEntity, maxDepth]);
        return result.rows;
    }
    // ============================================
    // CONTRADICTION OPERATIONS
    // ============================================
    async createContradiction(contradiction) {
        const result = await this.pool.query(`
      INSERT INTO contradictions (
        fact_a_id, fact_b_id, conflict_type, detected_by, resolution_status
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (fact_a_id, fact_b_id) DO NOTHING
      RETURNING *
    `, [
            contradiction.factAId,
            contradiction.factBId,
            contradiction.conflictType,
            contradiction.detectedBy || 'llm',
            contradiction.resolutionStatus || 'unresolved'
        ]);
        return result.rows[0];
    }
    async getUnresolvedContradictions() {
        const result = await this.pool.query(`
      SELECT * FROM find_contradictions()
    `);
        return result.rows;
    }
    // ============================================
    // UTILITY
    // ============================================
    async close() {
        await this.pool.end();
    }
    async transaction(fn) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        }
        catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
        finally {
            client.release();
        }
    }
}
//# sourceMappingURL=database.js.map