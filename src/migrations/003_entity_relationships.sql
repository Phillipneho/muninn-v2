-- ============================================
-- MIGRATION: Entity Relationships (v3.1)
-- First-class relationships for social graph traversal
-- ============================================

CREATE TABLE IF NOT EXISTS entity_relationships (
  id TEXT PRIMARY KEY,
  source_entity_id TEXT NOT NULL REFERENCES entities(id),
  target_entity_id TEXT NOT NULL REFERENCES entities(id),
  relationship_type TEXT NOT NULL,  -- 'is_partner_of', 'works_for', 'parent_of', 'friend_of'
  
  -- Temporal validity
  valid_from TEXT,
  valid_until TEXT,
  invalidated_at TEXT,
  
  -- Confidence and evidence
  confidence REAL DEFAULT 0.8,
  evidence TEXT,                    -- JSON array of source quotes
  source_episode_id TEXT REFERENCES episodes(id),
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast traversal
CREATE INDEX IF NOT EXISTS idx_rel_source ON entity_relationships(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_target ON entity_relationships(target_entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_type ON entity_relationships(relationship_type);
CREATE INDEX IF NOT EXISTS idx_rel_current ON entity_relationships(source_entity_id, relationship_type) 
  WHERE invalidated_at IS NULL AND valid_until IS NULL;