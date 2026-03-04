// Muninn v2 Types
// Memory as evolving reality, not stored text

export type EntityType = 'person' | 'org' | 'project' | 'concept' | 'location' | 'technology';
export type ValueType = 'entity' | 'string' | 'number' | 'boolean' | 'date';
export type ConflictType = 'value_conflict' | 'temporal_overlap' | 'logical' | 'source_conflict';
export type ResolutionStatus = 'unresolved' | 'resolved_by_user' | 'resolved_by_time' | 'resolved_by_source' | 'dismissed';

// Core entities
export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  summary?: string;
  embedding?: number[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Episode {
  id: string;
  content: string;
  source: string;
  actor?: string;
  occurredAt: Date;
  ingestedAt: Date;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

export interface Fact {
  id: string;
  subjectEntityId: string;
  predicate: string;
  objectEntityId?: string;
  objectValue?: string;
  valueType: ValueType;
  confidence: number;
  sourceEpisodeId?: string;
  
  // Bi-temporal timestamps
  validFrom?: Date;
  validUntil?: Date;
  createdAt: Date;
  invalidatedAt?: Date;
  
  evidence?: string[];
  
  // P3: Summary embedding for hybrid search
  summaryEmbedding?: Buffer;
}

export interface Event {
  id: string;
  factId?: string;
  entityId: string;
  attribute: string;
  oldValue?: string;
  newValue?: string;
  cause?: string;
  occurredAt: Date;
  observedAt: Date;
  sourceEpisodeId?: string;
}

export interface Relationship {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: string;
  validFrom?: Date;
  validUntil?: Date;
  invalidatedAt?: Date;
  evidence?: string[];
  sourceEpisodeId?: string;
  createdAt: Date;
}

export interface Contradiction {
  id: string;
  factAId: string;
  factBId: string;
  conflictType: ConflictType;
  detectedAt: Date;
  detectedBy?: string;
  resolutionStatus: ResolutionStatus;
  resolvedAt?: Date;
  resolutionNote?: string;
}

// Extraction types
export interface ExtractedFact {
  subject: string;
  predicate: string;
  object: string;
  objectType: 'entity' | 'literal';
  validFrom?: string;
  confidence: number;
  evidence: string;
}

export interface ExtractedEntity {
  name: string;
  type: EntityType;
}

export interface ExtractedEvent {
  entity: string;
  attribute: string;
  oldValue?: string;
  newValue: string;
  occurredAt?: string;
  cause?: string;
}

export interface ExtractionResult {
  facts: ExtractedFact[];
  entities: ExtractedEntity[];
  events: ExtractedEvent[];
  relationships?: ExtractedRelationship[];
}

// v3.1: Relationship extraction
export interface ExtractedRelationship {
  source: string;
  target: string;
  relationshipType: string;  // 'is_partner_of', 'works_for', 'parent_of', 'friend_of'
  confidence: number;
  evidence?: string;
}

// Retrieval types
export interface RecallOptions {
  limit?: number;
  entityFilter?: string[];
  predicateFilter?: string[];
  timeRange?: {
    from?: Date;
    to?: Date;
  };
  includeContradictions?: boolean;
}

export interface RecallResult {
  source: 'structured' | 'graph' | 'events' | 'semantic';
  facts?: Fact[];
  path?: Array<{
    entity: string;
    relationship: string;
    relatedEntity: string;
    depth: number;
  }>;
  events?: Event[];
  memories?: Episode[];
  contradictions?: Contradiction[];
}