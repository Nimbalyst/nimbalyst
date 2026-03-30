/**
 * Shared schema definition for the ai_transcript_events table.
 * Used by both worker.js (migration) and ApplicationMenu.ts (reset).
 *
 * Plain JS so worker.js (which is not processed by TypeScript) can require() it.
 */

const TRANSCRIPT_EVENTS_CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS ai_transcript_events (
    id                    BIGSERIAL PRIMARY KEY,
    session_id            TEXT NOT NULL,
    sequence              INTEGER NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type            TEXT NOT NULL CHECK (event_type IN (
                            'user_message',
                            'assistant_message',
                            'system_message',
                            'tool_call',
                            'tool_progress',
                            'interactive_prompt',
                            'subagent',
                            'turn_ended'
                          )),
    searchable_text       TEXT,
    payload               JSONB NOT NULL DEFAULT '{}',
    parent_event_id       BIGINT,
    searchable            BOOLEAN NOT NULL DEFAULT FALSE,
    subagent_id           TEXT,
    provider              TEXT NOT NULL,
    provider_tool_call_id TEXT,

    CONSTRAINT fk_transcript_session
        FOREIGN KEY (session_id)
        REFERENCES ai_sessions(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_transcript_parent
        FOREIGN KEY (parent_event_id)
        REFERENCES ai_transcript_events(id)
        ON DELETE SET NULL,

    CONSTRAINT uq_transcript_session_sequence
        UNIQUE (session_id, sequence)
)`;

const TRANSCRIPT_EVENTS_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_transcript_session_seq
      ON ai_transcript_events (session_id, sequence)`,
  `CREATE INDEX IF NOT EXISTS idx_transcript_tool_call_id
      ON ai_transcript_events (provider_tool_call_id) WHERE provider_tool_call_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_transcript_parent
      ON ai_transcript_events (parent_event_id) WHERE parent_event_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_transcript_event_type
      ON ai_transcript_events (session_id, event_type)`,
  `CREATE INDEX IF NOT EXISTS idx_transcript_subagent_id
      ON ai_transcript_events (subagent_id) WHERE subagent_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_transcript_fts
      ON ai_transcript_events
      USING GIN (to_tsvector('english', COALESCE(searchable_text, '')))
      WHERE searchable = TRUE`,
];

module.exports = { TRANSCRIPT_EVENTS_CREATE_TABLE, TRANSCRIPT_EVENTS_INDEXES };
