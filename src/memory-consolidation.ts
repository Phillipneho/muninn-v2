// v3.4: Memory Consolidation - The "Sleep Cycle"
// Periodic semantic merging to prevent "Micro-Fact" accumulation

import type { MuninnDatabase } from './database-sqlite.js';

export interface ConsolidationResult {
  entityId: string;
  entityName: string;
  newAttributes: Array<{
    predicate: string;
    object: string;
    confidence: number;
    source: 'consolidated';
  }>;
  archiveIds: string[];
  summaryUpdate: string;
  factsProcessed: number;
  factsConsolidated: number;
  factsArchived: number;
}

export interface FactCluster {
  entityId: string;
  entityName: string;
  predicate: string;
  facts: Array<{
    id: string;
    object_value: string;
    confidence: number;
    created_at: string;
    evidence?: string;
  }>;
  count: number;
  consolidationScore: number; // 0-1, higher = more consolidation needed
}

// Predicates that should NEVER be pruned (Milestone Events)
const PROTECTED_PREDICATES = [
  'born_on',
  'married_to',
  'started_job_at',
  'ended_job_at',
  'moved_to',
  'graduated_from',
  'founded',
  'acquired_by',
  'died_on'
];

// Predicates that are typically transient (can be archived after 30 days)
const TRANSIENT_PREDICATES = [
  'feeling',
  'weather',
  'ate',
  'ordered',
  'watched',
  'currently_reading',
  'wearing',
  'mood',
  'temporary_location'
];

// Predicates that can be consolidated (repeated observations)
const CONSOLIDATABLE_PREDICATES = [
  'likes',
  'prefers',
  'dislikes',
  'habit',
  'routine',
  'works_with',
  'uses',
  'owns',
  'travels_to'
];

/**
 * Finds entities that need consolidation (> threshold facts)
 */
export function findEntitiesNeedingConsolidation(
  db: MuninnDatabase,
  threshold: number = 50
): Array<{ entityId: string; entityName: string; factCount: number }> {
  const results = db['db'].prepare(`
    SELECT 
      e.id as entity_id,
      e.name as entity_name,
      COUNT(f.id) as fact_count
    FROM entities e
    JOIN facts f ON e.id = f.subject_entity_id
    WHERE f.invalidated_at IS NULL
    GROUP BY e.id
    HAVING COUNT(f.id) >= ?
    ORDER BY fact_count DESC
  `).all(threshold) as any[];
  
  return results.map(r => ({
    entityId: r.entity_id,
    entityName: r.entity_name,
    factCount: r.fact_count
  }));
}

/**
 * Clusters facts by predicate for consolidation analysis
 */
export function clusterFactsByPredicate(
  db: MuninnDatabase,
  entityId: string
): FactCluster[] {
  const facts = db['db'].prepare(`
    SELECT 
      f.id,
      f.predicate,
      f.object_value,
      f.confidence,
      f.created_at,
      f.evidence
    FROM facts f
    WHERE f.subject_entity_id = ?
      AND f.invalidated_at IS NULL
    ORDER BY f.predicate, f.created_at DESC
  `).all(entityId) as any[];
  
  // Group by predicate
  const clusters: Map<string, FactCluster> = new Map();
  
  for (const fact of facts) {
    const predicate = fact.predicate;
    
    if (!clusters.has(predicate)) {
      clusters.set(predicate, {
        entityId,
        entityName: '',
        predicate,
        facts: [],
        count: 0,
        consolidationScore: 0
      });
    }
    
    const cluster = clusters.get(predicate)!;
    cluster.facts.push({
      id: fact.id,
      object_value: fact.object_value,
      confidence: fact.confidence,
      created_at: fact.created_at,
      evidence: fact.evidence
    });
    cluster.count++;
  }
  
  // Calculate consolidation scores
  for (const cluster of clusters.values()) {
    // High consolidation score if:
    // - Many similar facts (count > 5)
    // - Consolidatable predicate
    // - Low variance in object values (similar content)
    const isConsolidatable = CONSOLIDATABLE_PREDICATES.includes(cluster.predicate);
    const highVolume = cluster.count >= 5;
    
    // Check variance - are facts similar?
    const uniqueValues = new Set(cluster.facts.map(f => 
      f.object_value.toLowerCase().substring(0, 50)
    ));
    const lowVariance = uniqueValues.size <= 2;
    
    cluster.consolidationScore = 
      (isConsolidatable ? 0.4 : 0) +
      (highVolume ? 0.3 : 0) +
      (lowVariance ? 0.3 : 0);
  }
  
  return Array.from(clusters.values());
}

/**
 * Identifies transient facts for archival
 */
export function identifyTransientFacts(
  db: MuninnDatabase,
  entityId: string,
  olderThanDays: number = 30
): string[] {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
  
  const facts = db['db'].prepare(`
    SELECT f.id, f.predicate, f.created_at
    FROM facts f
    WHERE f.subject_entity_id = ?
      AND f.invalidated_at IS NULL
      AND f.is_current = FALSE
      AND f.created_at < ?
  `).all(entityId, cutoffDate.toISOString()) as any[];
  
  const archiveIds: string[] = [];
  
  for (const fact of facts) {
    // Skip protected predicates
    if (PROTECTED_PREDICATES.includes(fact.predicate)) {
      continue;
    }
    
    // Archive transient predicates
    if (TRANSIENT_PREDICATES.includes(fact.predicate)) {
      archiveIds.push(fact.id);
    }
  }
  
  return archiveIds;
}

/**
 * Consolidates a cluster of similar facts into a single high-confidence attribute
 */
export function consolidateCluster(
  cluster: FactCluster
): ConsolidationResult['newAttributes'] {
  const newAttributes: ConsolidationResult['newAttributes'] = [];
  
  if (cluster.count < 5 || cluster.consolidationScore < 0.5) {
    return newAttributes; // Not enough to consolidate
  }
  
  // Find the most common object value
  const valueCounts = new Map<string, number>();
  for (const fact of cluster.facts) {
    const value = fact.object_value.toLowerCase();
    valueCounts.set(value, (valueCounts.get(value) || 0) + 1);
  }
  
  // Get most common value
  let maxValue = '';
  let maxCount = 0;
  for (const [value, count] of valueCounts) {
    if (count > maxCount) {
      maxCount = count;
      maxValue = value;
    }
  }
  
  // Calculate consolidated confidence
  const avgConfidence = cluster.facts.reduce((sum, f) => sum + f.confidence, 0) / cluster.facts.length;
  const observationBoost = Math.min(cluster.count * 0.05, 0.2); // Up to +0.2 for many observations
  const consolidatedConfidence = Math.min(avgConfidence + observationBoost, 1.0);
  
  newAttributes.push({
    predicate: cluster.predicate,
    object: maxValue,
    confidence: consolidatedConfidence,
    source: 'consolidated'
  });
  
  return newAttributes;
}

/**
 * Main consolidation function - runs during "sleep cycle"
 */
export async function runConsolidation(
  db: MuninnDatabase,
  options: {
    minFacts?: number;
    archiveOlderThan?: number;
    dryRun?: boolean;
  } = {}
): Promise<ConsolidationResult[]> {
  const {
    minFacts = 50,
    archiveOlderThan = 30,
    dryRun = false
  } = options;
  
  const results: ConsolidationResult[] = [];
  
  // Step 1: Find entities needing consolidation
  const entities = findEntitiesNeedingConsolidation(db, minFacts);
  console.log(`[Consolidation] Found ${entities.length} entities with >= ${minFacts} facts`);
  
  for (const entity of entities) {
    // Step 2: Cluster facts by predicate
    const clusters = clusterFactsByPredicate(db, entity.entityId);
    
    // Step 3: Consolidate high-score clusters
    const newAttributes: ConsolidationResult['newAttributes'] = [];
    let factsConsolidated = 0;
    
    for (const cluster of clusters) {
      if (cluster.consolidationScore >= 0.5) {
        const attributes = consolidateCluster(cluster);
        newAttributes.push(...attributes);
        factsConsolidated += cluster.count;
      }
    }
    
    // Step 4: Identify transient facts for archival
    const archiveIds = identifyTransientFacts(db, entity.entityId, archiveOlderThan);
    
    // Step 5: Generate summary update
    const summaryUpdate = newAttributes.length > 0
      ? `Consolidated ${factsConsolidated} observations into ${newAttributes.length} core attributes.`
      : 'No consolidation needed.';
    
    const result: ConsolidationResult = {
      entityId: entity.entityId,
      entityName: entity.entityName,
      newAttributes,
      archiveIds,
      summaryUpdate,
      factsProcessed: clusters.reduce((sum, c) => sum + c.count, 0),
      factsConsolidated,
      factsArchived: archiveIds.length
    };
    
    results.push(result);
    
    // Step 6: Apply changes (unless dry run)
    if (!dryRun) {
      // Create consolidated facts
      for (const attr of newAttributes) {
        try {
          db['db'].prepare(`
            INSERT INTO facts (id, subject_entity_id, predicate, object_value, confidence, evidence, created_at, is_current)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, TRUE)
          `).run(
            `consolidated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            entity.entityId,
            attr.predicate,
            attr.object,
            attr.confidence,
            JSON.stringify({ source: 'consolidation', observations: factsConsolidated })
          );
        } catch (e) {
          console.warn(`Failed to create consolidated fact: ${e}`);
        }
      }
      
      // Archive transient facts
      for (const archiveId of archiveIds) {
        try {
          db['db'].prepare(`
            UPDATE facts SET invalidated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(archiveId);
        } catch (e) {
          console.warn(`Failed to archive fact ${archiveId}: ${e}`);
        }
      }
    }
  }
  
  return results;
}

/**
 * Generates a consolidation report for review
 */
export function generateConsolidationReport(results: ConsolidationResult[]): string {
  const lines: string[] = [
    '# Memory Consolidation Report',
    '',
    `## Summary`,
    `- Entities processed: ${results.length}`,
    `- Total facts processed: ${results.reduce((sum, r) => sum + r.factsProcessed, 0)}`,
    `- Facts consolidated: ${results.reduce((sum, r) => sum + r.factsConsolidated, 0)}`,
    `- Facts archived: ${results.reduce((sum, r) => sum + r.factsArchived, 0)}`,
    '',
    '## Entity Details'
  ];
  
  for (const result of results) {
    lines.push('');
    lines.push(`### ${result.entityName}`);
    lines.push(`- Facts processed: ${result.factsProcessed}`);
    lines.push(`- Facts consolidated: ${result.factsConsolidated}`);
    lines.push(`- Facts archived: ${result.factsArchived}`);
    
    if (result.newAttributes.length > 0) {
      lines.push('');
      lines.push('**New Consolidated Attributes:**');
      for (const attr of result.newAttributes) {
        lines.push(`- ${attr.predicate}: ${attr.object} (confidence: ${attr.confidence.toFixed(2)})`);
      }
    }
  }
  
  return lines.join('\n');
}