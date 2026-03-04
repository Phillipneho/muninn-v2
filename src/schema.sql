-- ============================================
-- MUNINN v2 SCHEMA
-- Memory as evolving reality, not stored text
-- ============================================

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- 1. EPISODES (Raw event storage)
-- Non-lossy source data
-- ============================================
CREATE TABLE episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  source TEXT NOT NULL,           -- 'conversation', 'document', 'api'
  actor TEXT,                      -- Who said/wrote it
  occurred_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ DEFAULT now(),
  embedding vector(1024),          -- For semantic fallback
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_episodes_occurred ON episodes(occurred_at DESC);
CREATE INDEX idx_episodes_source ON episodes(source);

-- ============================================
-- 2. ENTITIES (Named nodes in knowledge graph)
-- ============================================
CREATE TABLE entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL,              -- 'person', 'org', 'project', 'concept', 'location'
  summary TEXT,
  embedding vector(1024),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(name, type)
);

CREATE INDEX idx_entities_name ON entities USING gin(to_tsvector('english', name));
CREATE INDEX idx_entities_type ON entities(type);
CREATE INDEX idx_entities_embedding ON entities USING ivfflat (embedding vector_cosine_ops);

-- ============================================
-- 3. FACTS (Typed assertions about entities)
-- Bi-temporal: real-world time + system time
-- ============================================
CREATE TABLE facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_entity_id UUID REFERENCES entities(id),
  predicate TEXT NOT NULL,         -- 'attended', 'works_at', 'prefers', 'knows'
  object_entity_id UUID REFERENCES entities(id),
  object_value TEXT,               -- For literal values (not entity references)
  value_type TEXT DEFAULT 'entity', -- 'entity', 'string', 'number', 'boolean', 'date'
  confidence REAL DEFAULT 0.8,
  source_episode_id UUID REFERENCES episodes(id),
  
  -- Bi-temporal timestamps
  valid_from TIMESTAMPTZ,          -- When this became true in the world
  valid_until TIMESTAMPTZ,         -- When this stopped being true (NULL = still true)
  created_at TIMESTAMPTZ DEFAULT now(),
  invalidated_at TIMESTAMPTZ,      -- When system learned it was wrong
  
  -- Evidence
  evidence TEXT[],                 -- Array of source quotes/references
  
  CONSTRAINT valid_time_range CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE INDEX idx_facts_subject ON facts(subject_entity_id);
CREATE INDEX idx_facts_object ON facts(object_entity_id);
CREATE INDEX idx_facts_predicate ON facts(predicate);
CREATE INDEX idx_facts_valid ON facts(valid_from, valid_until) WHERE invalidated_at IS NULL;
CREATE INDEX idx_facts_current ON facts(subject_entity_id, predicate) 
  WHERE invalidated_at IS NULL AND valid_until IS NULL;

-- ============================================
-- 4. EVENTS (State transitions)
-- Models change over time
-- ============================================
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_id UUID REFERENCES facts(id),
  entity_id UUID REFERENCES entities(id),
  attribute TEXT NOT NULL,         -- What changed
  old_value TEXT,
  new_value TEXT,
  cause TEXT,                      -- Why it changed
  occurred_at TIMESTAMPTZ NOT NULL,
  observed_at TIMESTAMPTZ DEFAULT now(),
  source_episode_id UUID REFERENCES episodes(id)
);

CREATE INDEX idx_events_entity ON events(entity_id, occurred_at DESC);
CREATE INDEX idx_events_fact ON events(fact_id);
CREATE INDEX idx_events_occurred ON events(occurred_at DESC);

-- ============================================
-- 5. RELATIONSHIPS (Directed edges)
-- Traversable links between entities
-- ============================================
CREATE TABLE relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_entity_id UUID REFERENCES entities(id) NOT NULL,
  target_entity_id UUID REFERENCES entities(id) NOT NULL,
  relationship_type TEXT NOT NULL, -- 'attends', 'works_for', 'knows', 'prefers'
  
  -- Temporal validity
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,

  -- Evidence trail
  evidence TEXT[],
  source_episode_id UUID REFERENCES episodes(id),
  
  created_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT valid_rel_time CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE INDEX idx_rel_source ON relationships(source_entity_id);
CREATE INDEX idx_rel_target ON relationships(target_entity_id);
CREATE INDEX idx_rel_type ON relationships(relationship_type);
CREATE INDEX idx_rel_current ON relationships(source_entity_id, relationship_type) 
  WHERE invalidated_at IS NULL AND valid_until IS NULL;

-- ============================================
-- 6. CONTRADICTIONS (Conflict preservation)
-- Both sides preserved, not overwritten
-- ============================================
CREATE TABLE contradictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_a_id UUID REFERENCES facts(id) NOT NULL,
  fact_b_id UUID REFERENCES facts(id) NOT NULL,
  conflict_type TEXT NOT NULL,     -- 'value_conflict', 'temporal_overlap', 'logical'
  detected_at TIMESTAMPTZ DEFAULT now(),
  detected_by TEXT,                -- 'llm', 'rule', 'user'
  resolution_status TEXT DEFAULT 'unresolved', -- 'unresolved', 'resolved_by_user', 'resolved_by_time'
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  
  UNIQUE(fact_a_id, fact_b_id)
);

CREATE INDEX idx_contradictions_facts ON contradictions(fact_a_id, fact_b_id);
CREATE INDEX idx_contradictions_unresolved ON contradictions 
  WHERE resolution_status = 'unresolved';

-- ============================================
-- 7. ENTITY_MENTIONS (Episode → Entity linking)
-- Non-lossy traceability
-- ============================================
CREATE TABLE entity_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID REFERENCES episodes(id) NOT NULL,
  entity_id UUID REFERENCES entities(id) NOT NULL,
  mention_context TEXT,            -- Quote from episode mentioning entity
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(episode_id, entity_id)
);

CREATE INDEX idx_mentions_episode ON entity_mentions(episode_id);
CREATE INDEX idx_mentions_entity ON entity_mentions(entity_id);

-- ============================================
-- RETRIEVAL FUNCTIONS
-- ============================================

-- 1. Query current facts about an entity
CREATE OR REPLACE FUNCTION query_current_facts(
  entity_name TEXT,
  attr_predicate TEXT DEFAULT NULL
) RETURNS TABLE (
  subject TEXT,
  predicate TEXT,
  object TEXT,
  valid_from TIMESTAMPTZ,
  source TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e1.name AS subject,
    f.predicate,
    COALESCE(e2.name, f.object_value) AS object,
    f.valid_from,
    ep.source
  FROM facts f
  JOIN entities e1 ON f.subject_entity_id = e1.id
  LEFT JOIN entities e2 ON f.object_entity_id = e2.id
  LEFT JOIN episodes ep ON f.source_episode_id = ep.id
  WHERE 
    e1.name ILIKE entity_name
    AND (attr_predicate IS NULL OR f.predicate = attr_predicate)
    AND f.invalidated_at IS NULL
    AND (f.valid_until IS NULL OR f.valid_until > now())
    AND (f.valid_from IS NULL OR f.valid_from <= now())
  ORDER BY f.valid_from DESC;
END;
$$ LANGUAGE plpgsql;

-- 2. Traverse knowledge graph (recursive CTE)
CREATE OR REPLACE FUNCTION traverse_graph(
  start_entity TEXT,
  max_depth INT DEFAULT 3
) RETURNS TABLE (
  entity TEXT,
  relationship TEXT,
  related_entity TEXT,
  depth INT,
  path TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE graph_traversal AS (
    -- Base case
    SELECT 
      e.name AS entity,
      r.relationship_type::TEXT,
      e2.name AS related_entity,
      1 AS depth,
      ARRAY[e.name, e2.name] AS path
    FROM relationships r
    JOIN entities e ON r.source_entity_id = e.id
    JOIN entities e2 ON r.target_entity_id = e2.id
    WHERE e.name ILIKE start_entity
      AND r.invalidated_at IS NULL
    
    UNION ALL
    
    -- Recursive case
    SELECT 
      gt.related_entity AS entity,
      r.relationship_type::TEXT,
      e2.name AS related_entity,
      gt.depth + 1,
      gt.path || e2.name
    FROM graph_traversal gt
    JOIN relationships r ON r.source_entity_id = (
      SELECT id FROM entities WHERE name = gt.related_entity
    )
    JOIN entities e2 ON r.target_entity_id = e2.id
    WHERE gt.depth < max_depth
      AND r.invalidated_at IS NULL
      AND NOT (e2.name = ANY(gt.path))  -- Prevent cycles
  )
  SELECT * FROM graph_traversal;
END;
$$ LANGUAGE plpgsql;

-- 3. Query entity evolution (temporal)
CREATE OR REPLACE FUNCTION entity_evolution(
  entity_name TEXT,
  time_from TIMESTAMPTZ DEFAULT NULL,
  time_to TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE (
  attribute TEXT,
  old_value TEXT,
  new_value TEXT,
  cause TEXT,
  occurred_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ev.attribute,
    ev.old_value,
    ev.new_value,
    ev.cause,
    ev.occurred_at
  FROM events ev
  JOIN entities e ON ev.entity_id = e.id
  WHERE e.name ILIKE entity_name
    AND (time_from IS NULL OR ev.occurred_at >= time_from)
    AND (time_to IS NULL OR ev.occurred_at <= time_to)
  ORDER BY ev.occurred_at DESC;
END;
$$ LANGUAGE plpgsql;

-- 4. Find contradictions
CREATE OR REPLACE FUNCTION find_contradictions()
RETURNS TABLE (
  subject TEXT,
  predicate TEXT,
  value_a TEXT,
  value_b TEXT,
  detected_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.name AS subject,
    fa.predicate,
    COALESCE(ea.name, fa.object_value) AS value_a,
    COALESCE(eb.name, fb.object_value) AS value_b,
    c.detected_at
  FROM contradictions c
  JOIN facts fa ON c.fact_a_id = fa.id
  JOIN facts fb ON c.fact_b_id = fb.id
  JOIN entities e ON fa.subject_entity_id = e.id
  LEFT JOIN entities ea ON fa.object_entity_id = ea.id
  LEFT JOIN entities eb ON fb.object_entity_id = eb.id
  WHERE c.resolution_status = 'unresolved'
  ORDER BY c.detected_at DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- INITIAL DATA
-- ============================================

-- Insert some initial entity types
INSERT INTO entities (name, type, summary) VALUES
  ('System', 'concept', 'The Muninn memory system itself')
ON CONFLICT (name, type) DO NOTHING;