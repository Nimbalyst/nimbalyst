-- Y.js document snapshots
CREATE TABLE ydoc_snapshots (
  id TEXT PRIMARY KEY,           -- Durable Object ID (userId:sessionId)
  user_id TEXT NOT NULL,         -- For querying by user
  session_id TEXT NOT NULL,      -- AI session ID
  state_vector BLOB NOT NULL,    -- Y.Doc binary state (encrypted)
  created_at INTEGER NOT NULL,   -- Unix timestamp (milliseconds)
  updated_at INTEGER NOT NULL    -- Unix timestamp (milliseconds)
);

CREATE INDEX idx_user_sessions ON ydoc_snapshots(user_id, updated_at DESC);
CREATE INDEX idx_session_updated ON ydoc_snapshots(session_id, updated_at DESC);

-- Session metadata (for listing and querying)
CREATE TABLE session_metadata (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,                    -- Optional session title
  created_at INTEGER NOT NULL,
  last_synced_at INTEGER NOT NULL,
  device_count INTEGER DEFAULT 1,
  snapshot_count INTEGER DEFAULT 0
);

CREATE INDEX idx_user_metadata ON session_metadata(user_id, last_synced_at DESC);
