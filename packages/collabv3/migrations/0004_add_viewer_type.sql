-- Migration: Add viewer_type column to shared_sessions
-- Tracks which viewer to use for rendering shared content.
-- NULL or 'static-html' = existing iframe viewer (default for sessions/markdown).
-- Extension viewer types: 'mindmap', 'excalidraw', 'datamodellm', 'csv', etc.

ALTER TABLE shared_sessions ADD COLUMN viewer_type TEXT DEFAULT NULL;
