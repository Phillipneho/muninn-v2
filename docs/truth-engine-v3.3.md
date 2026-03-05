# Truth Engine v3.3 — Dethroning Script

## Purpose

Resolve state conflicts when facts change over time. When Tim stops learning piano and starts violin, the system needs to mark piano as HISTORICAL and serve violin as the current truth.

## Implementation

### File: `src/engine/truth-resolver.ts`

```typescript
/**
 * Truth Resolver — Post-Extraction Hook
 * Runs immediately after Knowledge Extractor identifies a new STATE or TRAIT
 * 
 * Purpose: Detect conflicts and dethrone old truths
 */

interface Observation {
  id: string;
  entity_id: string;
  predicate: string;
  content: string;
  tags: string[];
  valid_from: string;
  valid_until?: string;
  confidence: number;
  source: string;
}

// Predicates that represent mutually exclusive states
// Only ONE can be current at a time
const EXCLUSIVE_PREDICATES = [
  'learning_instrument',    // Can't learn two instruments simultaneously
  'lives_in',              // One residence at a time
  'current_employer',      // One primary job
  'marital_status',        // One status at a time
  'relationship_status',   // One status at a time
  'current_city',          // One city at a time
  'current_role',          // One role at a time
  'favorite_X',            // One favorite per category
];

/**
 * Main conflict resolution function
 * Called after each observation is inserted
 */
export async function resolveConflicts(
  newObs: Observation,
  db: any
): Promise<void> {
  
  // Only process exclusive predicates
  if (!EXCLUSIVE_PREDICATES.includes(newObs.predicate)) {
    return;
  }

  // Find the current "King" (existing truth that was considered permanent)
  const oldKing = await db.observations.findFirst({
    where: {
      entity_id: newObs.entity_id,
      predicate: newObs.predicate,
      valid_until: null,  // Was "permanently true" until now
      id: { not: newObs.id }  // Not the new observation
    }
  });

  if (!oldKing) {
    // No conflict — this is a new fact
    console.log(`👑 New truth established: ${newObs.predicate} = ${newObs.content}`);
    return;
  }

  // Conflict detected
  if (oldKing.content !== newObs.content) {
    console.log(`⚔️ Conflict detected: ${newObs.predicate}`);
    console.log(`   Old: ${oldKing.content} (since ${oldKing.valid_from})`);
    console.log(`   New: ${newObs.content} (since ${newObs.valid_from})`);
    
    // Dethrone the old king
    await dethroneObservation(oldKing.id, newObs.valid_from, db);
    
    // Crown the new king (ensure it has is_current tag)
    await crownObservation(newObs.id, db);
    
    console.log(`👑 Dethroned: ${oldKing.content} -> ${newObs.content}`);
  } else {
    // Same content — just update confidence
    console.log(`✓ Reinforced: ${newObs.predicate} = ${newObs.content}`);
  }
}

/**
 * Mark an observation as historical (no longer current)
 */
async function dethroneObservation(
  obsId: string,
  endTime: string,
  db: any
): Promise<void> {
  await db.observations.update({
    where: { id: obsId },
    data: {
      valid_until: endTime,
      tags: {
        push: 'HISTORICAL'
      }
    }
  });
  
  // Remove STATE tag if present
  // (Implementation depends on your DB)
}

/**
 * Mark an observation as the current truth
 */
async function crownObservation(
  obsId: string,
  db: any
): Promise<void> {
  await db.observations.update({
    where: { id: obsId },
    data: {
      tags: {
        push: 'STATE',
        push: 'CURRENT'
      }
    }
  });
}

/**
 * Query-time helper: Get the current truth for a predicate
 */
export async function getCurrentTruth(
  entityId: string,
  predicate: string,
  db: any
): Promise<Observation | null> {
  return await db.observations.findFirst({
    where: {
      entity_id: entityId,
      predicate: predicate,
      valid_until: null,  // Still current
      tags: { has: 'STATE' }
    },
    orderBy: {
      valid_from: 'desc'  // Most recent
    }
  });
}

/**
 * Query-time helper: Get historical truths for a predicate
 */
export async function getHistoricalTruths(
  entityId: string,
  predicate: string,
  db: any
): Promise<Observation[]> {
  return await db.observations.findMany({
    where: {
      entity_id: entityId,
      predicate: predicate,
      tags: { has: 'HISTORICAL' }
    },
    orderBy: {
      valid_from: 'desc'
    }
  });
}
```

## Integration Point

In `src/index-unified.ts` or `src/extraction.ts`:

```typescript
// After inserting a new observation
const newObs = await db.observations.create({
  data: observationData
});

// Run conflict resolution
await resolveConflicts(newObs, db);
```

## Test Cases

### Case 1: Tim's Instrument Learning

```typescript
// Day 1: Tim starts learning piano
await remember("Tim has been playing the piano for about four months.");
// → Creates: { predicate: "learning_instrument", content: "piano", valid_until: null }

// Day 30: Tim starts learning violin
await remember("Tim recently started learning the violin.");
// → Detects conflict
// → Dethrones: piano { valid_until: "Day30", tags: ["HISTORICAL"] }
// → Crowns: violin { valid_until: null, tags: ["STATE", "CURRENT"] }

// Query: "What instrument is Tim learning?"
// → getCurrentTruth("Tim", "learning_instrument") → "violin" ✅
```

### Case 2: John's Location

```typescript
// 2023: John lives in New York
await remember("John moved to New York in 2023.");
// → Creates: { predicate: "lives_in", content: "New York", valid_until: null }

// 2025: John moves to Brisbane
await remember("John relocated to Brisbane in January 2025.");
// → Dethrones: New York
// → Crowns: Brisbane

// Query: "Where does John live?"
// → getCurrentTruth("John", "lives_in") → "Brisbane" ✅

// Query: "Where did John live before Brisbane?"
// → getHistoricalTruths("John", "lives_in") → ["New York"] ✅
```

## Logging

The script outputs clear conflict resolution logs:

```
⚔️ Conflict detected: learning_instrument
   Old: piano (since 2024-06-01)
   New: violin (since 2024-12-01)
👑 Dethroned: piano -> violin
```

This makes debugging easy — you can trace exactly when and why facts changed.

---

**Status:** Ready for Charlie to implement
**Priority:** High — This is the fix for the "Piano vs Violin" class of errors
**Estimated Impact:** +5-10% accuracy on state-change questions