# Muninn v3 Roadmap — The Reasoning Layer

## Current State: 40% Accuracy (v2)

**Ceiling Cause:** Single-hop limitation — AI can find facts but can't connect them across sessions.

## v3.1: Recursive Relationship Mapping (The "Social Graph")

### Problem
Queries like "What did Phillip's partner do in August?" fail because:
1. System doesn't know Phillip → is_partner_of → Alisha
2. Can't traverse relationship to find subject

### Solution: First-Class Relationships
```sql
CREATE TABLE entity_relationships (
  id TEXT PRIMARY KEY,
  source_entity_id TEXT REFERENCES entities(id),
  target_entity_id TEXT REFERENCES entities(id),
  relationship_type TEXT NOT NULL,  -- 'is_partner_of', 'works_for', 'parent_of'
  valid_from TEXT,
  valid_until TEXT,
  confidence REAL DEFAULT 0.8,
  evidence TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### Traversal Logic
```
Query: "What did Phillip's partner do in August?"
Step 1: Find Phillip's partner → Alisha
Step 2: Query facts for Alisha + August filter
Step 3: Return results
```

### Expected Accuracy Gain: +15%

## v3.2: Multi-Hop Inference (The "Chain of Memory")

### Problem
Queries like "Where did Caroline go with the person she met at the cafe?" fail because:
1. Fact 1 (Session 2): Caroline met Dave at cafe
2. Fact 2 (Session 15): Caroline went to Botanic Gardens with Dave
3. System can't connect these across sessions

### Solution: Query Expansion via Entity-Linkage
```typescript
// If query contains "the person she met"
// 1. Identify as "Missing Entity" pattern
// 2. Sub-query: Find entity from "met at cafe"
// 3. Re-run primary search with Subject: Caroline AND Object: Dave
```

### Expected Accuracy Gain: +20%

## v3.3: Automated Contradiction Resolution (The "Truth Engine")

### Problem
Conflicting facts cause hallucination:
- Fact A: "Caroline lives in Sydney" (2023)
- Fact B: "Caroline moved to Brisbane" (2024)

### Solution: Temporal Decay Weighting
```typescript
// When contradiction detected:
// 1. Compare valid_from timestamps
// 2. Mark older fact as valid_until = newer_fact.valid_from
// 3. Treat newer fact as "Current Truth"
```

### Expected Accuracy Gain: +5%

## v3.4: Proactive Memory Consolidation (The "Sleep Cycle")

### Tasks
| Task | Action |
|------|--------|
| Deduplication | Merge 50 facts into 1 high-confidence preference |
| Abstractive Summarization | Turn 10 sessions into 1 Event |
| Pruning | Move low-confidence facts to cold storage |

### Expected Accuracy Gain: Speed + Maintenance

---

## Implementation Priority

| Phase | Focus | Gain | Status |
|-------|-------|------|--------|
| v3.1 | Relationship Graph | +15% | **NEXT** |
| v3.2 | Multi-Hop Retrieval | +20% | Pending |
| v3.3 | Truth Resolution | +5% | Pending |
| v3.4 | Memory Consolidation | Speed | Pending |

---

*Last updated: 2026-03-04 11:46 UTC*