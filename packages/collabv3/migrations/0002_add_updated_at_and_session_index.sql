-- Migration: Add updated_at column and unique index for upsert support
-- Enables re-sharing a session without changing its share ID/URL

ALTER TABLE shared_sessions ADD COLUMN updated_at TEXT;

-- Index for looking up existing share by user + session (for upsert)
CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_sessions_user_session
  ON shared_sessions(user_id, session_id)
  WHERE is_deleted = 0;
