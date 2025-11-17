---
planStatus:
  planId: plan-session-history-fts
  title: Session History Full-Text Search
  status: in-review
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders:
    - ghinkle
  tags:
    - search
    - ai-sessions
    - database
    - ux-improvement
  created: "2025-11-17"
  updated: "2025-11-17T08:32:00.000Z"
  progress: 100
  startDate: "2025-11-17"
---
## Implementation Progress

- [x] Add search method to AISessionsRepository interface
- [x] Implement FTS query in PGLiteSessionStore
- [x] Add IPC handler for session search
- [x] Update SessionHistory UI to use new search endpoint
- [x] Users can search session titles (existing behavior preserved)
- [x] Users can search message content to find sessions
- [x] Search results are ranked by relevance (title matches first)
- [x] Search handles partial word matches intelligently
- [x] Search performance is acceptable with 100+ sessions and 1000+ messages
- [x] Empty search shows all sessions (current behavior)
- [x] Search input is debounced to avoid excessive queries
- [x] No regressions in existing session list functionality

# Session History Full-Text Search

## Goals

- Enable searching AI session messages, not just session titles
- Use PostgreSQL full-text search (FTS) capabilities in PGLite
- Rank search results by relevance (title matches > message matches)
- Improve session discoverability for users with many sessions
- Move search filtering from client-side to server-side for better performance

## Current State

The session history search (Cmd+Alt+S) currently only searches session **titles** with a simple case-insensitive substring match. This happens entirely client-side in the React component:

```typescript
// SessionHistory.tsx line 196-199
if (searchQuery) {
  return session.title?.toLowerCase().includes(searchQuery.toLowerCase());
}
```

**Limitations:**
- Cannot find sessions by conversation content
- All sessions must be loaded into memory before filtering
- No relevance ranking
- Messages in `ai_agent_messages` table are completely unsearchable

## Database Schema

**ai\_sessions table:**
- `id`, `workspace_id`, `title`, `session_type`, `provider`, `model`, `created_at`, `updated_at`
- Currently only `title` is searchable

**ai\_agent\_messages table:**
- `session_id` (foreign key), `content` (TEXT), `direction`, `source`, `created_at`
- Contains all user and assistant messages
- `content` field is the target for full-text search

## Implementation Approach

### 1. Repository Layer

Add search method to `AISessionsRepository` interface:
- New method: `searchSessions(workspaceId: string, query: string)`
- Returns sessions ranked by relevance
- Interface defined in `packages/runtime/src/storage/repositories/AISessionsRepository.ts`

### 2. Database Implementation

Implement FTS query in `PGLiteSessionStore`:
- Location: `packages/electron/src/main/services/PGLiteSessionStore.ts`
- Use PostgreSQL's `to_tsvector()` and `to_tsquery()` for FTS
- Join `ai_sessions` with `ai_agent_messages`
- Rank results using `ts_rank_cd()` function
- Weight title matches higher than message matches

### 3. IPC Communication

Add new IPC handler for search:
- Location: `packages/electron/src/main/window/AgenticCodingWindow.ts`
- New handler: `sessions:search`
- Takes workspace path and search query
- Returns ranked list of matching sessions

### 4. UI Updates

Update `SessionHistory` component:
- Location: `packages/electron/src/renderer/components/AgenticCoding/SessionHistory.tsx`
- Replace client-side filtering with IPC call to `sessions:search`
- Debounce search input to avoid excessive queries
- Show loading state while searching

## Key Technical Decisions

### FTS vs Simple ILIKE

Use PostgreSQL's full-text search (`@@` operator) instead of `ILIKE`:
- **Advantages:** Relevance ranking, handles word boundaries, language-aware stemming
- **Performance:** Better for large message datasets
- **User experience:** More intelligent matching (e.g., "authentication" matches "auth")

### Search Scope

Search both titles AND message content:
- Title matches ranked higher (more relevant)
- Message content searched using FTS
- Combine results with UNION and rank aggregation

### Message Content Extraction

The `content` field may contain:
- Plain text messages
- JSON with `prompt` field (Claude Code format)
- Structured content with tool calls

Extract searchable text appropriately based on message format.

## Files to Modify

1. `packages/runtime/src/storage/repositories/AISessionsRepository.ts` - Add search method interface
2. `packages/electron/src/main/services/PGLiteSessionStore.ts` - Implement FTS query
3. `packages/electron/src/main/window/AgenticCodingWindow.ts` - Add IPC handler
4. `packages/electron/src/renderer/components/AgenticCoding/SessionHistory.tsx` - Update UI to use search endpoint

## Acceptance Criteria

- [ ] Users can search session titles (existing behavior preserved)
- [ ] Users can search message content to find sessions
- [ ] Search results are ranked by relevance (title matches first)
- [ ] Search handles partial word matches intelligently
- [ ] Search performance is acceptable with 100+ sessions and 1000+ messages
- [ ] Empty search shows all sessions (current behavior)
- [ ] Search input is debounced to avoid excessive queries
- [ ] No regressions in existing session list functionality

## Future Enhancements

- Add search highlighting in session list
- Support advanced search operators (AND, OR, NOT)
- Add filters by date range, provider, or session type
- Create GIN index on message content for better performance with large datasets
- Add search within session view (not just list view)
