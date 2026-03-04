import { MuninnDatabase } from './database-sqlite.js';
import type { RecallOptions, RecallResult, Fact, Event } from './types.js';
export declare class Retriever {
    private db;
    constructor(db: MuninnDatabase);
    /**
     * Main retrieval function - implements priority order
     * 1. Structured state (facts)
     * 2. Graph traversal (relationships)
     * 3. Temporal reasoning (events)
     * 4. Semantic fallback (embeddings)
     */
    recall(query: string, options?: RecallOptions): Promise<RecallResult>;
    /**
     * Multi-hop query: Find path from entity A to entity B
     */
    findPath(fromEntity: string, toEntity: string, maxDepth?: number): Promise<{
        found: boolean;
        path: Array<{
            entity: string;
            relationship: string;
            relatedEntity: string;
        }>;
    }>;
    /**
     * Get all facts about an entity
     */
    getEntityFacts(entityName: string): Fact[];
    /**
     * Get entity evolution (state changes over time)
     */
    getEntityEvolution(entityName: string, from?: Date, to?: Date): Event[];
    /**
     * Extract entities from query using LLM
     */
    extractEntities(query: string): Promise<string[]>;
    /**
     * Parse temporal intent from query
     */
    private parseTemporalIntent;
    /**
     * Semantic search fallback
     */
    private semanticSearch;
    /**
     * Generate embedding using OpenAI
     */
    private generateEmbedding;
    /**
     * Map database row to Fact type
     */
    private mapFact;
    /**
     * Map database Row to Event type
     */
    private mapEvent;
}
//# sourceMappingURL=retrieval.d.ts.map