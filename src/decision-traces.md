# Decision Traces — Schema Design

## Purpose
Store successful QA paths as precedent. Next agent with similar question searches Successful Decisions, not just facts. Knowledge compounds.

## Schema

```sql
-- ============================================
-- DECISION_TRACES (Successful QA paths)
-- "Precedent" for multi-agent learning
-- ============================================
CREATE TABLE decision_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Query fingerprint
  question_hash TEXT NOT NULL,           -- SHA-256 of normalized question
  question_pattern TEXT,                  -- "What does X do for Y?"
  
  -- Entities involved
  entity_ids UUID[] NOT NULL,             -- Array of entity IDs
  
  -- Retrieval path
  predicates_used TEXT[] NOT NULL,        -- Which predicates matched
  cluster_path TEXT[],                     -- Semantic clusters traversed
  observations_used UUID[],                -- Observation IDs that contributed
  
  -- Outcome
  confidence REAL NOT NULL,                -- Final confidence score
  answer_quality TEXT,                     -- 'verified', 'high', 'medium', 'low'
  ground_truth_match BOOLEAN,              -- If benchmark, did it match?
  
  -- Context
  agent_id TEXT DEFAULT 'leo',             -- Which agent used this
  session_id TEXT,                         -- OpenClaw session ID
  
  -- Timing
  created_at TIMESTAMPTZ DEFAULT now(),
  
  -- Embedding for similarity search
  question_embedding vector(1024)
);

CREATE INDEX idx_traces_hash ON decision_traces(question_hash);
CREATE INDEX idx_traces_entities ON decision_traces USING GIN(entity_ids);
CREATE INDEX idx_traces_predicates ON decision_traces USING GIN(predicates_used);
CREATE INDEX idx_traces_embedding ON decision_traces 
  USING ivfflat (question_embedding vector_cosine_ops);
```

## Retrieval Logic

When a new question arrives:

1. **Check Precedent First**
   ```sql
   SELECT predicates_used, cluster_path, confidence
   FROM decision_traces
   WHERE question_embedding <-> query_embedding < 0.15
     AND entity_ids && current_entity_ids
   ORDER BY confidence DESC
   LIMIT 5;
   ```

2. **If Precedent Found**
   - Use the predicates_used to prioritize retrieval
   - Follow the cluster_path for multi-hop
   - Start with observations_used

3. **If No Precedent**
   - Fall back to standard retrieval
   - Store successful path as new precedent

## Benefits

| Before | After |
|--------|-------|
| Every query starts from scratch | Similar queries reuse successful paths |
| Knowledge siloed per agent | Agents learn from each other's wins |
| No feedback loop | Quality score improves retrieval ranking |
| Predicate chaos | Learned prototypes stabilize predicates |

## Example Flow

**Agent Leo asks:** "What does Caroline do to destress?"
- Muninn retrieves: `[hobby: dancing, coping_mechanism: meditation]`
- Answer quality: `verified` (ground truth matched)
- Precedent stored: `predicates_used=['hobby', 'coping_mechanism']`

**Agent Sammy asks later:** "How does Melanie relax?"
- Embedding similarity finds Caroline precedent
- Predicates prioritized: `['hobby', 'coping_mechanism']`
- Retrieval faster, answer quality higher

**Knowledge compounding.**