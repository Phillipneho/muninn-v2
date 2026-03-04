import type { Entity, Fact, Event, Relationship, Contradiction, Episode } from './types.js';
export declare class MuninnDatabase {
    private db;
    constructor(dbPath?: string);
    private initialize;
    createEntity(entity: Omit<Entity, 'id' | 'createdAt' | 'updatedAt'>): Entity;
    findEntity(name: string, type?: string): Entity | null;
    findOrCreateEntity(name: string, type: string, summary?: string): Entity;
    addAlias(entityId: string, alias: string, source?: string, confidence?: number): void;
    findEntityByAlias(alias: string): {
        entityId: string;
        alias: string;
        confidence: number;
    } | null;
    getAliases(entityId: string): Array<{
        alias: string;
        source: string;
        confidence: number;
    }>;
    resolveEntity(nameOrAlias: string, type?: string): Entity | null;
    createEpisode(episode: Omit<Episode, 'id' | 'ingestedAt'>): Episode;
    createFact(fact: Omit<Fact, 'id' | 'createdAt'>): Fact;
    getCurrentFacts(entityName: string, predicate?: string): any[];
    invalidateFact(factId: string, reason?: string): void;
    createEvent(event: Omit<Event, 'id' | 'observedAt'>): Event;
    getEntityEvolution(entityName: string, from?: Date, to?: Date): any[];
    createRelationship(rel: Omit<Relationship, 'id' | 'createdAt'>): Relationship;
    traverseGraph(startEntity: string, maxDepth?: number): any[];
    createContradiction(contradiction: Omit<Contradiction, 'id' | 'detectedAt'>): Contradiction | null;
    getUnresolvedContradictions(): any[];
    getStats(): {
        entityCount: number;
        factCount: number;
        eventCount: number;
        relationshipCount: number;
        contradictionCount: number;
    };
    close(): void;
    transaction<T>(fn: () => T): T;
}
//# sourceMappingURL=database-sqlite.d.ts.map