-- ============================================
-- MUNINN v2 SCHEMA (SQLite Version)
-- Memory as evolving reality, not stored text
-- 
-- For development. Migrate to PostgreSQL + pgvector for production.
-- ============================================

-- ============================================
-- 1. EPISODES (Raw event storage)
-- Non-lossy source data
-- ============================================
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  source TEXT NOT NULL,           -- 'conversation', 'document', 'api'
  actor TEXT,                      -- Who said/wrote it
  occurred_at TEXT NOT NULL,       -- ISO timestamp
  ingested_at TEXT DEFAULT CURRENT_TIMESTAMP,
  embedding BLOB,                  -- Serialized float array
  metadata TEXT                    -- JSON
);

CREATE INDEX IF NOT EXISTS idx_episodes_occurred ON episodes(occurred_at);
CREATE INDEX IF NOT EXISTS idx_episodes_source ON episodes(source);

-- ============================================
-- 2. ENTITIES (Named nodes in knowledge graph)
-- ============================================
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,              -- 'person', 'org', 'project', 'concept', 'location'
  summary TEXT,
  embedding BLOB,                  -- Serialized float array
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(name, type)
);

CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);

-- ============================================
-- 3. FACTS (Typed assertions about entities)
-- Bi-temporal: real-world time + system time
-- ============================================
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  subject_entity_id TEXT REFERENCES entities(id),
  predicate TEXT NOT NULL,         -- 'attended', 'works_at', 'prefers', 'knows'
  object_entity_id TEXT REFERENCES entities(id),
  object_value TEXT,               -- For literal values (not entity references)
  value_type TEXT DEFAULT 'entity', -- 'entity', 'string', 'number', 'boolean', 'date'
  confidence REAL DEFAULT 0.8,
  source_episode_id TEXT REFERENCES episodes(id),
  
  -- Bi-temporal timestamps
  valid_from TEXT,                 -- When this became true in the world
  valid_until TEXT,                 -- When this stopped being true (NULL = still true)
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  invalidated_at TEXT,              -- When system learned it was wrong
  
  -- Evidence
  evidence TEXT                     -- JSON array of source quotes/references
);

CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject_entity_id);
CREATE INDEX IF NOT EXISTS idx_facts_object ON facts(object_entity_id);
CREATE INDEX IF NOT EXISTS idx_facts_predicate ON facts(predicate);
CREATE INDEX IF NOT EXISTS idx_facts_current ON facts(subject_entity_id, predicate) 
  WHERE invalidated_at IS NULL AND valid_until IS NULL;

-- ============================================
-- 4. EVENTS (State transitions)
-- Models change over time
-- ============================================
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  fact_id TEXT REFERENCES facts(id),
  entity_id TEXT REFERENCES entities(id),
  attribute TEXT NOT NULL,         -- What changed
  old_value TEXT,
  new_value TEXT,
  cause TEXT,                       -- Why it changed
  occurred_at TEXT NOT NULL,
  observed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  source_episode_id TEXT REFERENCES episodes(id)
);

CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_fact ON events(fact_id);
CREATE INDEX IF NOT EXISTS idx_events_occurred ON events(occurred_at DESC);

-- ============================================
-- 5. RELATIONSHIPS (Directed edges)
-- Traversable links between entities
-- ============================================
CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  source_entity_id TEXT REFERENCES entities(id) NOT NULL,
  target_entity_id TEXT REFERENCES entities(id) NOT NULL,
  relationship_type TEXT NOT NULL, -- 'attends', 'works_for', 'knows', 'prefers'
  
  -- Temporal validity
  valid_from TEXT,
  valid_until TEXT,
  invalidated_at TEXT,

  -- Evidence trail
  evidence TEXT,                    -- JSON array
  source_episode_id TEXT REFERENCES episodes(id),
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_type ON relationships(relationship_type);

-- ============================================
-- 6. CONTRADICTIONS (Conflict preservation)
-- Both sides preserved, not overwritten
-- ============================================
CREATE TABLE IF NOT EXISTS contradictions (
  id TEXT PRIMARY KEY,
  fact_a_id TEXT REFERENCES facts(id) NOT NULL,
  fact_b_id TEXT REFERENCES facts(id) NOT NULL,
  conflict_type TEXT NOT NULL,     -- 'value_conflict', 'temporal_overlap', 'logical'
  detected_at TEXT DEFAULT CURRENT_TIMESTAMP,
  detected_by TEXT,                -- 'llm', 'rule', 'user'
  resolution_status TEXT DEFAULT 'unresolved', -- 'unresolved', 'resolved_by_user', 'resolved_by_time'
  resolved_at TEXT,
  resolution_note TEXT,
  
  UNIQUE(fact_a_id, fact_b_id)
);

CREATE INDEX IF NOT EXISTS idx_contradictions_facts ON contradictions(fact_a_id, fact_b_id);

-- ============================================
-- 7. ENTITY_MENTIONS (Episode → Entity linking)
-- Non-lossy traceability
-- ============================================
CREATE TABLE IF NOT EXISTS entity_mentions (
  id TEXT PRIMARY KEY,
  episode_id TEXT REFERENCES episodes(id) NOT NULL,
  entity_id TEXT REFERENCES entities(id) NOT NULL,
  mention_context TEXT,            -- Quote from episode mentioning entity
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(episode_id, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_mentions_episode ON entity_mentions(episode_id);
CREATE INDEX IF NOT EXISTS idx_mentions_entity ON entity_mentions(entity_id);

-- ============================================
-- INITIAL DATA
-- ============================================

INSERT OR IGNORE INTO entities (id, name, type, summary) 
VALUES ('system', 'System', 'concept', 'The Muninn memory system itself');