-- Migration: Create shared_sessions table for session share links
-- Stores metadata about HTML session exports uploaded to R2

CREATE TABLE IF NOT EXISTS shared_sessions (
  id TEXT PRIMARY KEY,              -- shareId (22-char base62, ~131 bits entropy)
  user_id TEXT NOT NULL,            -- Stytch user ID (owner)
  session_id TEXT NOT NULL,         -- original AI session ID
  title TEXT,                       -- session title for listing
  r2_key TEXT NOT NULL,             -- R2 object key
  size_bytes INTEGER NOT NULL,      -- file size
  created_at TEXT NOT NULL,         -- ISO timestamp
  expires_at TEXT,                  -- optional expiry (NULL = never)
  view_count INTEGER DEFAULT 0,    -- how many times viewed
  is_deleted INTEGER DEFAULT 0     -- soft delete
);

CREATE INDEX IF NOT EXISTS idx_shared_sessions_user ON shared_sessions(user_id, is_deleted);
