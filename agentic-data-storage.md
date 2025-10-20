---
planStatus:
  planId: plan-ai-agentic-sessions-storage
  title: AI Agentic Sessions Raw Storage Table
  status: completed
  planType: feature
  priority: high
  owner: jordanbentley
  stakeholders:
    - ai-platform
    - database
  tags:
    - ai
    - database
    - storage
    - agentic
  created: "2025-10-19"
  updated: "2025-10-20T00:00:00.000Z"
  progress: 100
  dueDate: ""
  startDate: "2025-10-19"
---
# AI Agentic Sessions Raw Storage Table
<!-- plan-status -->

## Goals

Create a dedicated write-only database table to store raw, unprocessed AI agent responses and interactions. This table will serve as a complete audit trail and data source for AI agent sessions, capturing every message exchange in its original form without any processing or transformation.

**Important:** This is a write-only audit table. The existing `ai_sessions` table will continue to be used for all read operations and application logic. This new table exists solely for logging, debugging, and future analysis capabilities.

## Problem Statement

The current AI sessions storage in the `ai_sessions` table stores processed, application-level data structures and is used for all read operations. We need a separate write-only audit table to:

- Store raw AI responses exactly as received from the provider
- Capture complete message chunks without any processing
- Maintain complete audit trail of all AI agent interactions
- Enable post-processing, analysis, and debugging of agent behavior
- Distinguish between input (user/system) and output (AI) messages
- Support multiple AI providers (Claude Code, Claude API, OpenAI, etc.)

**Scope:** This table will NOT be used for reading messages in the application. All message retrieval will continue to use the existing `ai_sessions` table. This is purely a write-only audit log.

## User Value

- Complete transparency into AI agent behavior for debugging and analysis
- Ability to replay or reprocess agent sessions
- Support for compliance and audit requirements
- Foundation for advanced features like session analytics and agent performance monitoring
- Enables investigation of streaming issues and partial responses

## Functional Requirements

### Data Capture
- Store one row per complete message chunk
- Capture raw text content without any processing or parsing
- Record timestamp with microsecond precision
- Track message source (provider type)
- Distinguish input vs output direction
- Automatic ordering via sequential primary key
- Write-only operations (no application reads)

### Data Integrity
- Immutable records (insert-only, no updates)
- Foreign key relationship to parent AI session
- Timestamps for creation tracking
- Support for binary or very large text blobs

### Query Performance
- Efficient retrieval of all messages for debugging and analysis (future use)
- Time-range queries for analysis tools
- Filtering by source and direction
- Note: Not used for application-level message retrieval

## Database Schema

```sql
-- Write-only raw storage for AI agent messages (complete chunks only)
-- This table is NOT used for application reads - ai_sessions table handles that
CREATE TABLE ai_agent_messages (
  -- Primary key with automatic ordering
  id BIGSERIAL PRIMARY KEY,

  -- Foreign key to parent AI session
  session_id TEXT NOT NULL,

  -- Timestamp with microsecond precision
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- AI provider source (e.g., 'claude-code', 'claude', 'openai', 'lmstudio')
  source TEXT NOT NULL,

  -- Message direction: 'input' (user/system to AI) or 'output' (AI response)
  direction TEXT NOT NULL CHECK (direction IN ('input', 'output')),

  -- Raw message content as received from provider (complete chunks only)
  content TEXT NOT NULL,

  -- Optional metadata (JSON) for provider-specific fields
  metadata JSONB,

  -- Indexes for common query patterns
  CONSTRAINT fk_session
    FOREIGN KEY (session_id)
    REFERENCES ai_sessions(session_id)
    ON DELETE CASCADE
);

-- Index for retrieving all messages for a session in order (debugging/analysis)
CREATE INDEX idx_ai_agent_messages_session
  ON ai_agent_messages(session_id, id);

-- Index for time-based queries (analysis tools)
CREATE INDEX idx_ai_agent_messages_created
  ON ai_agent_messages(created_at DESC);

-- Index for filtering by source and direction
CREATE INDEX idx_ai_agent_messages_source_direction
  ON ai_agent_messages(source, direction);
```

## Technical Considerations

### Storage Efficiency
- TEXT type for content allows unlimited size while optimizing small messages
- JSONB for metadata provides flexible schema for provider-specific data
- Indexes designed for common access patterns while avoiding over-indexing

### Data Retention
- Consider partitioning by created_at for large-scale deployments
- Implement retention policies to archive or purge old messages
- Compression at database level for cold storage

### Concurrency
- Insert-only pattern minimizes locking concerns
- BIGSERIAL provides high-throughput ID generation
- No contention on updates since records are immutable

### Migration Path
- Add table to existing PGLite database schema
- Integrate with existing AI session lifecycle
- Backfill not required (start fresh with new sessions)

## Implementation Phases

### Phase 1: Schema & Core Integration
- Create table in database migration system
- Add TypeScript types and interfaces
- Integrate insert operations in AI provider code

### Phase 2: Provider Integration
- Update ClaudeCodeProvider to log raw messages
- Update ClaudeProvider to log raw messages
- Update other providers (OpenAI, LM Studio)

### Phase 3: Developer Debugging UI
- Add developer option to toggle between normal session view and raw message view
- When enabled, display raw audit log messages instead of processed session data
- Provide message-by-message inspection with timestamps, direction, and source
- Enable developers to debug streaming issues and provider-specific behavior
- Toggle persists per-session for convenience during debugging
