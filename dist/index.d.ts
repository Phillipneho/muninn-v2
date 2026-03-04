export { MuninnDatabase } from './database-sqlite.js';
export { FactExtractor, resolveEntities, detectContradictions } from './extraction.js';
export { Retriever } from './retrieval-sqlite.js';
export * from './types.js';
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
export declare class Muninn {
    private db;
    private extractor;
    private retriever;
    constructor(dbPath?: string);
    /**
     * Ingest a conversation or document
     * Extracts facts, entities, events and stores them
     */
    remember(content: string, options?: {
        source?: string;
        actor?: string;
        occurredAt?: Date;
        sessionDate?: string;
    }): Promise<{
        episodeId: string;
        factsCreated: number;
        entitiesCreated: number;
        eventsCreated: number;
        contradictions: number;
    }>;
    /**
     * Query memory
     * Priority: Structured → Graph → Events → Semantic
     */
    recall(query: string, options?: {
        limit?: number;
        entityFilter?: string[];
        timeRange?: {
            from?: Date;
            to?: Date;
        };
    }): Promise<import("./types.js").RecallResult>;
    /**
     * Get entity evolution (how did it change over time?)
     */
    getEvolution(entityName: string, from?: Date, to?: Date): Promise<any[]>;
    /**
     * Traverse knowledge graph
     */
    traverseGraph(startEntity: string, maxDepth?: number): Promise<any[]>;
    /**
     * Get unresolved contradictions
     */
    getContradictions(): Promise<any[]>;
    /**
     * Close database connection
     */
    close(): void;
}
//# sourceMappingURL=index.d.ts.map