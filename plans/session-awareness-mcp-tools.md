---
planStatus:
  planId: plan-session-awareness-mcp-tools
  title: Session Awareness MCP Tools
  status: draft
  planType: feature
  priority: high
  owner: ghinkle
  stakeholders: []
  tags:
    - mcp
    - session
    - workstream
    - agent-tools
  created: "2026-02-20"
  updated: "2026-02-20T00:00:00.000Z"
  progress: 0
---
# Session Awareness MCP Tools

## Problem Statement

AI agents running inside Nimbalyst have no visibility into the session structure around them. They can't see:

1. **What happened in other sessions** - A user says "implement the plan we created in the session about exposing more mcp tools" and the agent has no way to find or read that session.

2. **Workstream context** - When inside a workstream (parent session with children), the agent can't see the overall picture: what sessions exist, what each one accomplished, what files were edited across them.

3. **Recent session history** - The agent can't browse the user's recent sessions to find relevant context that the user references conversationally.

## Prior Art

An earlier draft plan exists at `plans/workstream-session-tools.md` covering similar ground. This plan supersedes it with a refined scope and architecture decisions (particularly around modularization away from httpServer.ts).

## Architecture Decision: New Standalone MCP Server

**httpServer.ts is already 3,224 lines.** Per user direction, new tools will NOT be added there.

We will create a new standalone MCP server following the `sessionNamingServer.ts` pattern (624 lines, clean, focused). This is the established pattern for MCP servers that need session context.

**New file:** `packages/electron/src/main/mcp/sessionContextServer.ts`

**Server name in MCP config:** `nimbalyst-session-context`

This server will use the closure pattern from sessionNamingServer.ts to capture the `sessionId` and `workspacePath` at connection time, then use the existing repository layer (AISessionsRepository, AgentMessagesRepository, SessionFilesRepository) to query data.

## Proposed Tools

### Tool 1: `get_session_summary`

The foundational building block. Returns a compact summary of a session.

**Input Schema:**
```typescript
{
  sessionId?: string;  // ID of session to summarize. If omitted, summarizes current session.
}
```

**Output format:**
```
Session: "Authentication refactor" (abc123)
Provider: claude-code | Model: sonnet
Created: 2026-02-03 14:30 | Last active: 2026-02-03 16:45

User prompts (3 turns):
1. "Let's refactor the auth module to use JWT tokens"
2. "Add error handling for token expiration"
3. "Write tests for the new auth flow"

Last agent response (truncated):
"Created auth.test.ts covering login, logout, token refresh, and expiration scenarios. All 12 tests passing."

Files edited (4):
- src/auth/login.ts
- src/auth/logout.ts
- src/auth/tokens.ts (created)
- tests/auth.test.ts (created)
```

**Implementation approach:**
- Fetch session metadata from AISessionsRepository.get()
- Fetch messages from AgentMessagesRepository.list() with a reasonable limit
- Extract user prompts: `direction='input'` messages, parse JSON to get `.prompt` field
- Extract last agent response: walk backwards through `direction='output'` messages, find last `type='text'` or `type='assistant'` with text content blocks
- Fetch edited files from SessionFilesRepository.getFilesBySession(sessionId, 'edited')
- Truncate the last agent response to ~500 chars

**Design choice - user prompts + last response vs full turn summaries:**
We show all user prompts (short, captures intent) plus only the last agent response (captures final state). This is much more compact than per-turn summaries and serves the primary use cases (understanding what a session was about, what it accomplished). If the agent needs more detail about a specific turn, it can use the full session data via `get_session_summary` on that session and follow up.

### Tool 2: `get_workstream_overview`

Shows the structure and status of the current workstream (or a specified one).

**Input Schema:**
```typescript
{
  workstreamId?: string;  // If omitted, uses current session's parent workstream
}
```

**Output format:**
```
Workstream: "MCP Tools Feature" (parent-id)
Sessions (3):

1. "Session awareness planning" (abc123) - 5 turns, last active 2h ago
   Files: plans/session-awareness-mcp-tools.md

2. "httpServer refactor" (def456) - 8 turns, last active 1h ago
   Files: httpServer.ts, sessionContextServer.ts (+2 more)

3. "Test session tools" (ghi789) - 2 turns, last active 30m ago
   Files: sessionContextServer.test.ts

All files edited across workstream (6 unique):
- plans/session-awareness-mcp-tools.md
- packages/electron/src/main/mcp/httpServer.ts
- packages/electron/src/main/mcp/sessionContextServer.ts
- packages/runtime/src/ai/server/services/McpConfigService.ts
- packages/electron/src/main/index.ts
- tests/sessionContextServer.test.ts
```

**Implementation approach:**
- If no workstreamId: look up current session, get its parentSessionId
- If session has no parent: return "not in a workstream" message
- Query child sessions via database (same pattern as `sessions:list-children` IPC handler)
- For each child: get basic metadata + files edited (batch via getFilesBySessionMany)
- Deduplicate files for the aggregate list

### Tool 3: `list_recent_sessions`

Lets the agent browse recent sessions to find relevant context.

**Input Schema:**
```typescript
{
  query?: string;   // Optional search string to filter by title/content
  limit?: number;   // Max results (default 10, max 25)
}
```

**Output format:**
```
Recent sessions (showing 5 of 23):

1. "Session MCP tools planning" - 3h ago, 4 turns
   Provider: claude-code | Type: session

2. "Autosave race condition fix" - 1d ago, 6 turns
   Provider: claude-code | Type: session | Workstream: "Bug fixes"

3. "Extension architecture review" - 2d ago, 2 turns
   Provider: claude-code | Type: session

4. "Voice mode listen window" - 3d ago, 8 turns
   Provider: claude-code | Type: session | Workstream: "Voice features"

5. "E2E test debugging" - 4d ago, 12 turns
   Provider: claude-code | Type: session
```

**Implementation approach:**
- If query provided: use AISessionsRepository.search(workspaceId, query)
- If no query: use AISessionsRepository.list(workspaceId) which returns sorted by updatedAt DESC
- Filter out workstream parents (sessionType='workstream') from the list - show only leaf sessions
- Include parent workstream title if session has a parentSessionId (requires a join or separate lookup)
- Limit to requested count

### Tool 4: `get_workstream_edited_files`

Returns all files edited across all sessions in the current workstream. (Moved from the earlier draft plan.)

**Input Schema:**
```typescript
{
  groupBySession?: boolean;  // If true, group files by session. Default: false (flat deduplicated list)
}
```

**Output (flat):**
```
Files edited across workstream (12 total, 8 unique):
- src/components/Button.tsx
- src/utils/helpers.ts
- tests/Button.test.ts
...
```

**Output (grouped):**
```
Files edited across workstream by session:

Session: "Authentication refactor" (abc123)
- src/auth/login.ts
- src/auth/logout.ts

Session: "Add tests" (def456)
- tests/auth.test.ts

Total: 3 unique files across 2 sessions
```

**Implementation approach:**
- Get current session's parentSessionId
- Query all child sessions
- Use SessionFilesRepository.getFilesBySessionMany() for efficient batch query
- Deduplicate or group based on parameter

## Implementation Plan

### Phase 1: Create sessionContextServer.ts

1. **Create the MCP server module** at `packages/electron/src/main/mcp/sessionContextServer.ts`
  - Follow sessionNamingServer.ts pattern (closure-based context, SSE + StreamableHTTP)
  - Register all 4 tools in ListToolsRequestSchema handler
  - Implement CallToolRequestSchema handler with separate functions per tool

2. **Implement tool handlers as separate functions** within the file:
  - `handleGetSessionSummary(sessionId, workspaceId, currentSessionId)`
  - `handleGetWorkstreamOverview(workstreamId, workspaceId, currentSessionId)`
  - `handleListRecentSessions(query, limit, workspaceId)`
  - `handleGetWorkstreamEditedFiles(groupBySession, workspaceId, currentSessionId)`

3. **Message parsing utility** for extracting user prompts and last agent response:
  - Parse `direction='input'` messages: JSON content has `.prompt` field
  - Parse `direction='output'` messages: JSON content has `.type` field
  - Walk backwards to find last substantive text response
  - Truncation logic for long responses

### Phase 2: Wire into the app

4. **Register in McpConfigService** (`packages/runtime/src/ai/server/services/McpConfigService.ts`):
  - Add `sessionContextServerPort` to McpConfigServiceDeps
  - Add `nimbalyst-session-context` entry in getMcpServersConfig()
  - Pass sessionId and workspacePath as query params

5. **Start server in main process** (`packages/electron/src/main/index.ts`):
  - Import and start sessionContextServer
  - Inject port into McpConfigService deps

6. **Auto-allow new tools** in ClaudeCodeProvider's canUseTool:
  - Add `mcp__nimbalyst-session-context__get_session_summary`
  - Add `mcp__nimbalyst-session-context__get_workstream_overview`
  - Add `mcp__nimbalyst-session-context__list_recent_sessions`
  - Add `mcp__nimbalyst-session-context__get_workstream_edited_files`

7. **Add shutdown handler** in app before-quit for clean server shutdown

### Phase 3: System prompt integration

8. **Update CLAUDE.md addendum** (the system prompt in Nimbalyst):
  - Document the new tools so the agent knows when to use them
  - Add guidance: "When a user references a previous session or asks about past work, use list_recent_sessions or get_session_summary to find the relevant context"

## Key Data Sources

| Data | Source | Method |
| --- | --- | --- |
| Session metadata | AISessionsRepository | `.get(id)`, `.list(workspaceId)`, `.search(workspaceId, query)` |
| Session messages | AgentMessagesRepository | `.list(sessionId, { limit })` |
| Files edited | SessionFilesRepository | `.getFilesBySession(id, 'edited')`, `.getFilesBySessionMany(ids, 'edited')` |
| Child sessions | Direct SQL query | `WHERE parent_session_id = $1` (same pattern as sessions:list-children IPC) |
| Workstream parent | AISessionsRepository | `.get(currentSessionId)` -> `.parentSessionId` |

## Database Access

The MCP server runs in the Electron main process and can access the database directly via the same pattern used by PGLiteSessionStore and other stores. We use the repository layer (AISessionsRepository, AgentMessagesRepository, SessionFilesRepository) which abstracts the database access.

For the child sessions query, we'll need direct database access (same as SessionHandlers.ts does for `sessions:list-children`). Import `database` from `../database/PGLiteDatabaseWorker`.

## Message Content Format

Agent messages in `ai_agent_messages` table:

**Input messages** (`direction='input'`):
```json
{
  "prompt": "Let's refactor the auth module...",
  "options": { "model": "sonnet", "cwd": "/path/to/project" }
}
```

**Output messages** (`direction='output'`):
- Text chunks: `{"type": "text", "content": "Here's what I'll do..."}`
- Assistant messages: `{"type": "assistant", "message": {"content": [{"type": "text", "text": "..."}]}}`
- Tool use: `{"type": "assistant", "message": {"content": [{"type": "tool_use", ...}]}}` (skip these)
- Tool results: `{"type": "assistant", "message": {"content": [{"type": "tool_result", ...}]}}` (skip these)

**Extraction algorithm for user prompts:**
1. Filter messages where `direction='input'`
2. Parse JSON, extract `.prompt` field
3. Skip system-generated inputs (check `isUserInput` in metadata if available)

**Extraction algorithm for last agent text response:**
1. Walk messages from end backwards
2. Find `direction='output'` messages
3. Parse JSON, look for `type='text'` or `type='assistant'` with text content blocks
4. Concatenate text blocks, truncate to ~500 chars
5. Stop at first substantive text found (don't walk further back)

## Open Questions

1. **Should \****`get_session_summary`**\*\* include per-turn agent summaries?**
   The earlier plan included them. This plan opts for a lighter approach (all user prompts + last response only) to keep output compact. We could add an `includeTurnSummaries?: boolean` parameter later if agents need it.

2. **Should we include git commit info?**
   The earlier plan mentioned this. It's complex (commits don't have session IDs) and not essential for the primary use cases. Defer to a future iteration - the `developer_git_log` tool already exists for git history.

3. **How to handle the "implement the plan from session X" use case?**
   The agent would use `list_recent_sessions(query: "mcp tools")` to find the session, then `get_session_summary(sessionId: ...)` to understand what was planned. For a plan document, the actual plan content is in a file, so the agent would also need to read that file. The session summary gives enough context to know which file to look at.

## File Inventory

| File | Action | Description |
| --- | --- | --- |
| `packages/electron/src/main/mcp/sessionContextServer.ts` | Create | New MCP server with 4 tools |
| `packages/runtime/src/ai/server/services/McpConfigService.ts` | Edit | Add sessionContextServerPort dep + config entry |
| `packages/electron/src/main/index.ts` | Edit | Start server, inject port |
| `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` | Edit | Auto-allow new tools in canUseTool |
