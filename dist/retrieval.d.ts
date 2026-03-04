import type { RecallOptions, RecallResult } from './types.js';
import { MuninnDatabase } from './database.js';
export declare class Retriever {
    private db;
    constructor(db: MuninnDatabase);
    /**
     * Main retrieval function - implements priority order
     */
    recall(query: string, options?: RecallOptions): Promise<RecallResult>;
    /**
     * Extract entities from query using simple patterns + LLM
     */
    private extractEntities;
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
     * Map database fact to TypeScript type
     */
    private mapFact;
    /**
     * Map database event to TypeScript type
     */
    private mapEvent;
}
//# sourceMappingURL=retrieval.d.ts.map