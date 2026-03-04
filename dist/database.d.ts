import { PoolClient } from 'pg';
import type { Entity, Fact, Event, Relationship, Contradiction, Episode } from './types.js';
export declare class MuninnDatabase {
    private pool;
    constructor(connectionString?: string);
    createEntity(entity: Omit<Entity, 'id' | 'createdAt' | 'updatedAt'>): Promise<Entity>;
    findEntity(name: string, type?: string): Promise<Entity | null>;
    findOrCreateEntity(name: string, type: string, summary?: string): Promise<Entity>;
    createEpisode(episode: Omit<Episode, 'id' | 'ingestedAt'>): Promise<Episode>;
    createFact(fact: Omit<Fact, 'id' | 'createdAt'>): Promise<Fact>;
    getCurrentFacts(entityName: string, predicate?: string): Promise<Fact[]>;
    invalidateFact(factId: string, reason?: string): Promise<void>;
    createEvent(event: Omit<Event, 'id' | 'observedAt'>): Promise<Event>;
    getEntityEvolution(entityName: string, from?: Date, to?: Date): Promise<Event[]>;
    createRelationship(rel: Omit<Relationship, 'id' | 'createdAt'>): Promise<Relationship>;
    traverseGraph(startEntity: string, maxDepth?: number): Promise<any[]>;
    createContradiction(contradiction: Omit<Contradiction, 'id' | 'detectedAt'>): Promise<Contradiction>;
    getUnresolvedContradictions(): Promise<Contradiction[]>;
    close(): Promise<void>;
    transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
}
//# sourceMappingURL=database.d.ts.map