# P2: Entity Aliases Implementation Plan

## Problem
Muninn treats "Lish" and "Alisha" as different entities, causing graph fragmentation.

## Solution: Canonical Mapping

### 1. Database Schema
```sql
-- Add aliases table
CREATE TABLE entity_aliases (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  source TEXT,  -- 'user', 'inferred', 'extracted'
  confidence REAL DEFAULT 0.5,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id)
);

CREATE INDEX idx_aliases_entity ON entity_aliases(entity_id);
CREATE INDEX idx_aliases_alias ON entity_aliases(alias);
```

### 2. Extraction Enhancement
```typescript
// When extracting entities, check for aliases
function findOrCreateEntity(name: string, type: string): Entity {
  // 1. Exact match first
  const exact = findEntity(name, type);
  if (exact) return exact;
  
  // 2. Check aliases
  const aliasMatch = findEntityByAlias(name);
  if (aliasMatch) return getEntity(aliasMatch.entityId);
  
  // 3. Fuzzy match (Levenshtein distance)
  const fuzzy = findSimilarEntity(name, type);
  if (fuzzy && fuzzy.similarity > 0.8) {
    // Log potential alias for review
    logPotentialAlias(name, fuzzy.entity.id);
    return fuzzy.entity;
  }
  
  // 4. Create new entity
  return createEntity(name, type);
}
```

### 3. Alias Detection Strategies

| Strategy | Example | Confidence |
|----------|---------|------------|
| Nickname patterns | "Lish" → "Alisha" | 0.7 |
| Prefix matching | "Phillip" → "Phillip Neho" | 0.6 |
| Context matching | "her sister Alisha" + "Lish said" | 0.8 |
| Explicit mention | "Alisha (Lish)" | 1.0 |

### 4. Implementation Steps

1. **Schema Migration**
   - Add `entity_aliases` table
   - Add `canonical_id` to `entities` table

2. **Fuzzy Match Utility**
   - Levenshtein distance
   - Jaro-Winkler similarity
   - Nickname database (Liz→Elizabeth, etc.)

3. **Extraction Integration**
   - Check aliases before creating new entity
   - Log potential aliases for review

4. **API Methods**
   - `addAlias(entityId, alias, source)`
   - `resolveEntity(name)` → canonical entity
   - `getAliases(entityId)` → all aliases

### 5. Test Cases

```typescript
// Test: Nickname resolution
await muninn.remember('Lish went to the store.');
await muninn.remember('Alisha bought groceries.');
// Should create ONE entity with alias

// Test: Canonical resolution
const result = await muninn.recall('What did Lish buy?');
// Should find facts for Alisha
```

## Implementation Priority

| Step | Estimated Time | Impact |
|------|---------------|--------|
| Schema migration | 10 min | Foundation |
| Fuzzy match utility | 15 min | Core |
| Extraction integration | 20 min | Auto-resolution |
| Nickname database | 30 min | Accuracy |
| Testing | 15 min | Validation |

**Total: ~90 minutes**