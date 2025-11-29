-- Add compression flag to ydoc_snapshots table
-- This allows us to store gzip-compressed state vectors to work within D1's 2MB BLOB limit

ALTER TABLE ydoc_snapshots ADD COLUMN compressed INTEGER DEFAULT 0 NOT NULL;

-- Create index on compressed column for monitoring compression usage
CREATE INDEX idx_compressed ON ydoc_snapshots(compressed);
