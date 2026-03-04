-- ============================================
-- MIGRATION: Entity Aliases (P2)
-- Enables canonical entity resolution
-- ============================================

-- ============================================
-- ENTITY_ALIASES (Nickname/variation mapping)
-- ============================================
CREATE TABLE IF NOT EXISTS entity_aliases (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  alias TEXT NOT NULL,              -- 'Lish', 'Phillip', 'Phil'
  source TEXT DEFAULT 'extracted',  -- 'user', 'inferred', 'extracted'
  confidence REAL DEFAULT 0.5,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(entity_id, alias)
);

CREATE INDEX IF NOT EXISTS idx_aliases_entity ON entity_aliases(entity_id);
CREATE INDEX IF NOT EXISTS idx_aliases_alias ON entity_aliases(alias COLLATE NOCASE);

-- ============================================
-- Add canonical_id to entities (for merged entities)
-- ============================================
ALTER TABLE entities ADD COLUMN canonical_id TEXT REFERENCES entities(id);

-- ============================================
-- Add embedding to facts (for P3 hybrid search)
-- ============================================
-- ALTER TABLE facts ADD COLUMN summary_embedding BLOB;
-- (Deferred to P3)