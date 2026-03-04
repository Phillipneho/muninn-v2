import type { RecallOptions, RecallResult } from './types.js';
import { MuninnDatabase } from './database-sqlite.js';
export declare class Retriever {
    private db;
    constructor(db: MuninnDatabase);
    /**
     * Main retrieval function - implements priority order
     */
    recall(query: string, options?: RecallOptions): Promise<RecallResult>;
    /**
     * Extract entities from query using simple patterns
     */
    private extractEntitiesSimple;
    /**
     * Extract temporal bounds from query (e.g., "in August", "last week")
     */
    private extractTemporalBounds;
    /**
     * Filter facts by temporal bounds
     */
    private filterByTemporalBounds;
    /**
     * Parse temporal intent from query
     */
    private parseTemporalIntent;
    /**
     * Map database fact to TypeScript type
     */
    private mapFact;
    /**
     * Map database event to TypeScript type
     */
    private mapEvent;
}
//# sourceMappingURL=retrieval-sqlite.d.ts.map