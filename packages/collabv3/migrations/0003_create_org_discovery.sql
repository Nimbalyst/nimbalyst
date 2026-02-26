-- Minimal cross-org discovery table.
-- Maps org_id -> git_remote_hash so the desktop client can find which
-- team org corresponds to a local git repo. This is the ONLY team-related
-- D1 table. All other team data (metadata, roles, keys, doc index) lives
-- in the per-org TeamRoom Durable Object with physical isolation.

CREATE TABLE IF NOT EXISTS org_discovery (
  org_id TEXT PRIMARY KEY,
  git_remote_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_org_discovery_git_remote ON org_discovery(git_remote_hash);
