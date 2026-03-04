// Muninn v2 Retrieval Pipeline (SQLite Version)
// Priority: Structured → Graph → Events → Semantic
export class Retriever {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Main retrieval function - implements priority order
     */
    async recall(query, options) {
        // 1. Extract entities from query
        const entities = this.extractEntitiesSimple(query);
        // 2. Parse temporal intent
        const temporalIntent = this.parseTemporalIntent(query);
        // 3. Try structured state query
        if (entities.length > 0) {
            const facts = this.db.getCurrentFacts(entities[0], temporalIntent.predicate);
            if (facts.length > 0) {
                return {
                    source: 'structured',
                    facts: facts.map(this.mapFact)
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
            const events = this.db.getEntityEvolution(entities[0], temporalIntent.timeRange?.from, temporalIntent.timeRange?.to);
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
    extractEntitiesSimple(query) {
        // Find capitalized words (likely named entities)
        const capitalized = query.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
        // Find quoted strings
        const quoted = query.match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, '')) || [];
        // Combine and dedupe
        return [...new Set([...capitalized, ...quoted])];
    }
    /**
     * Parse temporal intent from query
     */
    parseTemporalIntent(query) {
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
    mapFact(row) {
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
    mapEvent(row) {
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
//# sourceMappingURL=retrieval-sqlite.js.map