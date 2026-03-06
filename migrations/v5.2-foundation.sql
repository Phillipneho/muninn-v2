-- ============================================
-- MUNINN v5.2 Schema Migration
-- Decision Traces + Temporal Validity + Cortex
-- ============================================

-- ============================================
-- 1. DECISION_TRACES (Black Box Recorder)
-- Records "How" we found the answer, not just "What"
-- ============================================
CREATE TABLE IF NOT EXISTS decision_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Query fingerprint
  trace_id UUID DEFAULT gen_random_uuid(),
  query_text TEXT NOT NULL,
  query_intent TEXT,                    -- Tier (1-4) + Cluster ID (e.g., "3:CAREER_SHIFT")
  query_embedding vector(1024),         -- For similarity search
  
  -- Retrieval path
  activated_nodes JSONB,                -- Array of observation_ids used
  predicates_fired TEXT[],              -- Which predicates matched
  cluster_path TEXT[],                  -- Semantic clusters traversed
  logic_path TEXT,                      -- Step-by-step reasoning (Internal Monologue)
  
  -- Outcome
  answer TEXT,                          -- Final answer produced
  confidence REAL,                       -- System confidence (0-1)
  outcome_reward REAL DEFAULT 0,        -- -1 to +1 (feedback loop)
  ground_truth_match BOOLEAN,          -- If benchmark, did it match?
  
  -- Precedent citations
  citation_edges UUID[],                -- Links to previous trace_ids that helped
  
  -- Context
  agent_id TEXT DEFAULT 'leo',          -- Which agent asked
  session_id TEXT,                       -- OpenClaw session ID
  
  -- Timing
  created_at TIMESTAMPTZ DEFAULT now(),
  
  -- Quality gate
  verified BOOLEAN DEFAULT FALSE        -- Human-verified?
);

CREATE INDEX IF NOT EXISTS idx_traces_embedding ON decision_traces 
  USING ivfflat (query_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_traces_intent ON decision_traces(query_intent);
CREATE INDEX IF NOT EXISTS idx_traces_reward ON decision_traces(outcome_reward DESC) 
  WHERE outcome_reward > 0.5;
CREATE INDEX IF NOT EXISTS idx_traces_citations ON decision_traces USING GIN(citation_edges);

-- ============================================
-- 2. TEMPORAL VALIDITY (Graphiti Model)
-- Native bi-temporal graph
-- ============================================

-- Add valid_at / invalid_at to observations
ALTER TABLE observations 
  ADD COLUMN IF NOT EXISTS valid_at TIMESTAMPTZ,      -- When fact became true in world
  ADD COLUMN IF NOT EXISTS invalid_at TIMESTAMPTZ;     -- When fact stopped being true

-- Index for temporal queries
CREATE INDEX IF NOT EXISTS idx_obs_temporal ON observations(entity_id, valid_at, invalid_at)
  WHERE invalid_at IS NULL;

-- ============================================
-- 3. CORTEX PROTOTYPES (Consolidated Knowledge)
-- The "Sleep Cycle" output
-- ============================================
CREATE TABLE IF NOT EXISTS cortex_prototypes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Source cluster
  cluster_id TEXT NOT NULL,            -- e.g., "DANCING", "CAREER"
  entity_id UUID REFERENCES entities(id),
  
  -- Consolidated prototype
  prototype_text TEXT NOT NULL,        -- LLM-summarized narrative
  prototype_embedding vector(1024),
  
  -- Provenance
  source_observation_ids UUID[],       -- 50 atomic facts → 1 prototype
  consolidation_date TIMESTAMPTZ DEFAULT now(),
  
  -- Quality
  token_savings INT,                    -- How many tokens saved
  coherence_score REAL,                  -- Narrative coherence (0-1)
  
  -- Lifecycle
  is_active BOOLEAN DEFAULT TRUE,
  superseded_by UUID REFERENCES cortex_prototypes(id)
);

CREATE INDEX IF NOT EXISTS idx_prototype_cluster ON cortex_prototypes(cluster_id);
CREATE INDEX IF NOT EXISTS idx_prototype_entity ON cortex_prototypes(entity_id);
CREATE INDEX IF NOT EXISTS idx_prototype_embedding ON cortex_prototypes 
  USING ivfflat (prototype_embedding vector_cosine_ops);

-- ============================================
-- 4. TEMPORAL VALIDITY FUNCTIONS
-- ============================================

-- Find what was true at a specific point in time
CREATE OR REPLACE FUNCTION query_temporal_state(
  entity_name TEXT,
  at_time TIMESTAMPTZ DEFAULT now(),
  attr_predicate TEXT DEFAULT NULL
) RETURNS TABLE (
  subject TEXT,
  predicate TEXT,
  object TEXT,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  source TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.name AS subject,
    o.predicate,
    o.object_value AS object,
    o.valid_at AS valid_from,
    o.invalid_at AS valid_until,
    o.evidence->>0 AS source
  FROM observations o
  JOIN entities e ON o.entity_id = e.id
  WHERE 
    e.name ILIKE entity_name
    AND (attr_predicate IS NULL OR o.predicate = attr_predicate)
    AND o.valid_at <= at_time
    AND (o.invalid_at IS NULL OR o.invalid_at > at_time)
    AND o.confidence > 0.5
  ORDER BY o.valid_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Invalidate old facts when new contradicting facts arrive
CREATE OR REPLACE FUNCTION invalidate_previous(
  p_entity_id UUID,
  p_predicate TEXT,
  p_new_value TEXT,
  p_valid_from TIMESTAMPTZ DEFAULT now()
) RETURNS VOID AS $$
BEGIN
  UPDATE observations
  SET invalid_at = p_valid_from
  WHERE 
    entity_id = p_entity_id
    AND predicate = p_predicate
    AND object_value != p_new_value
    AND invalid_at IS NULL
    AND valid_at < p_valid_from;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 5. PRECEDENT RETRIEVAL (Two-Stage Search)
-- ============================================

CREATE OR REPLACE FUNCTION find_precedent(
  p_query_embedding vector(1024),
  p_entity_ids UUID[],
  p_similarity_threshold REAL DEFAULT 0.15
) RETURNS TABLE (
  trace_id UUID,
  query_intent TEXT,
  predicates TEXT[],
  cluster_path TEXT[],
  confidence REAL,
  outcome_reward REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    dt.trace_id,
    dt.query_intent,
    dt.predicates_fired AS predicates,
    dt.cluster_path,
    dt.confidence,
    dt.outcome_reward
  FROM decision_traces dt
  WHERE 
    dt.query_embedding <-> p_query_embedding < p_similarity_threshold
    AND dt.outcome_reward > 0.5
    AND EXISTS (
      SELECT 1 FROM unnest(dt.activated_nodes::jsonb[]) AS node
      WHERE node->>'entity_id' = ANY(p_entity_ids::text[])
    )
  ORDER BY dt.outcome_reward DESC, dt.confidence DESC
  LIMIT 5;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 6. CORTEX CONSOLIDATION FUNCTION
-- Called by "Sleep Cycle" cron
-- ============================================

CREATE OR REPLACE FUNCTION consolidate_cluster(
  p_cluster_id TEXT,
  p_entity_id UUID DEFAULT NULL,
  p_min_observations INT DEFAULT 10
) RETURNS UUID AS $$
DECLARE
  v_observation_ids UUID[];
  v_prototype_text TEXT;
  v_prototype_embedding vector(1024);
  v_token_savings INT;
  v_prototype_id UUID;
BEGIN
  -- Collect observations for this cluster
  SELECT array_agg(id) INTO v_observation_ids
  FROM observations
  WHERE 
    (p_entity_id IS NULL OR entity_id = p_entity_id)
    AND predicate IN (
      SELECT jsonb_array_elements_text(cluster_predicates::jsonb)
      FROM semantic_clusters
      WHERE cluster_id = p_cluster_id
    )
    AND invalid_at IS NULL
  HAVING count(*) >= p_min_observations;
  
  IF v_observation_ids IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Calculate token savings
  v_token_savings := array_length(v_observation_ids, 1) * 50; -- ~50 tokens per obs
  
  -- LLM consolidation (called from application layer)
  -- This is a placeholder - actual LLM call happens in TypeScript
  v_prototype_id := gen_random_uuid();
  
  INSERT INTO cortex_prototypes (
    id, cluster_id, entity_id, source_observation_ids, token_savings
  ) VALUES (
    v_prototype_id, p_cluster_id, p_entity_id, v_observation_ids, v_token_savings
  );
  
  RETURN v_prototype_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- MIGRATION NOTES
-- ============================================
-- Run this migration with:
--   psql muninn_v2 -f migrations/v5.2-foundation.sql
--
-- After migration:
-- 1. Update observation extraction to set valid_at/invalid_at
-- 2. Add precedent search to recall-enhanced.ts
-- 3. Schedule "sleep cycle" cron for consolidation
-- ============================================