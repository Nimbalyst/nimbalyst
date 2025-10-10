---
planStatus:
  planId: plan-ai-session-file-tracking
  title: AI Session File Tracking System
  status: completed
  planType: feature
  priority: high
  owner: system
  stakeholders:
    - users
    - developers
  tags:
    - ai
    - sessions
    - file-tracking
    - database
  created: "2025-10-10"
  updated: "2025-10-10T22:30:00.000Z"
  progress: 100
---
# AI Session File Tracking System
<!-- plan-status -->

## Implementation Status

**Status:** ✅ Implementation complete (100%)

### Completed Components

1. **Database Layer** ✅
  - Added `session_files` table with proper indexes
  - Supports three link types: edited, referenced, read
  - JSONB metadata for flexible storage
  - Location: `packages/electron/src/main/database/worker.js:253-271`

2. **Type Definitions** ✅
  - FileLinkType and FileLink interfaces
  - Metadata interfaces for each link type
  - Updated FileEditSummary with linkType field
  - Location: `packages/runtime/src/ai/server/types.ts:179-216`

3. **Repository Layer** ✅
  - SessionFilesRepository with full CRUD operations
  - PGLiteSessionFileStore adapter
  - Integrated into RepositoryManager
  - Location: `packages/runtime/src/storage/repositories/SessionFilesRepository.ts`

4. **File Tracking Service** ✅
  - SessionFileTracker singleton
  - Automatic tool execution tracking
  - @ mention parsing with regex
  - Metadata extraction
  - Location: `packages/electron/src/main/services/SessionFileTracker.ts`

5. **IPC Handlers** ✅
  - Session file query handlers
  - Registered in main process
  - Location: `packages/electron/src/main/ipc/SessionFileHandlers.ts`

6. **UI Updates** ✅
  - AgentTranscriptPanel fetches from database
  - FileEditsSidebar with collapsible sections
  - Visual distinction for each link type
  - Relative path display from workspace root
  - Location: `packages/runtime/src/ui/AgentTranscript/components/`

7. **AIChat Sidebar Integration** ✅
  - FileGutter component for referenced/edited files
  - Top gutter shows referenced documents
  - Bottom gutter shows edited documents
  - Expandable lists for multiple files
  - Real-time updates when files are tracked
  - Clickable file links to open in workspace
  - Location: `packages/electron/src/renderer/components/AIChat/`

8. **Workspace File Opening** ✅
  - IPC handler `workspace:open-file`
  - Opens files in correct workspace window
  - Creates new window if needed
  - Focuses window and loads file
  - Location: `packages/electron/src/main/ipc/WorkspaceHandlers.ts:805-847`

9. **Real-time Event System** ✅
  - `session-files:updated` IPC event
  - Emitted after tracking operations
  - Session-isolated updates
  - UI components auto-refresh
  - Location: `packages/electron/src/main/services/ai/AIService.ts:520-522, 620-621, 756-757`

10. **E2E Tests** ✅
  - Comprehensive test suite created
  - Tests tracking, isolation, multi-file scenarios
  - Location: `packages/electron/e2e/ai/ai-session-file-tracking.spec.ts`

### Future Enhancements

- **Session Discovery by File**: Context menu to show sessions for a file
- **Session Manager Integration**: Filter sessions by file path

## Goals

Implement a comprehensive file tracking system for AI sessions that records three types of file interactions:

1. **Edited Files** - Files that have been modified by the AI during the session
2. **Referenced Files** - Files explicitly mentioned by the user via @ mentions
3. **Read Files** - Files that were read by the AI agent during execution

This system will enable:
- Rich file history display in the AgenticCodingPanel
- Discovery of sessions by file (reverse lookup)
- Better understanding of AI's interaction with the codebase
- Improved session organization and search

## Current System Analysis

### Existing Architecture

The codebase currently has:
- **PGLite Database** at `/packages/electron/src/main/database/worker.js` with `ai_sessions` table
- **SessionData interface** in `/packages/runtime/src/ai/server/types.ts` with `metadata` field
- **AgentTranscriptPanel** in `/packages/runtime/src/ui/AgentTranscript/components/AgentTranscriptPanel.tsx` with Files sidebar
- **FileEditSummary interface** in `/packages/runtime/src/ui/AgentTranscript/types/index.ts` for displaying file changes
- **AISessionsRepository** in `/packages/runtime/src/storage/repositories/AISessionsRepository.ts` for session CRUD operations

### Current Limitations

- File edits are stored in session metadata as an array, not queryable by file
- No tracking of files referenced by @ mentions
- No tracking of files read by the agent
- Cannot efficiently query "which sessions touched this file?"
- File metadata is duplicated across sessions

## Implementation Plan

### 1. Database Schema Changes

#### New Table: session_files

```sql
CREATE TABLE IF NOT EXISTS session_files (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  link_type TEXT NOT NULL CHECK (link_type IN ('edited', 'referenced', 'read')),
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}',

  CONSTRAINT fk_session
    FOREIGN KEY (session_id)
    REFERENCES ai_sessions(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_files_session ON session_files(session_id);
CREATE INDEX IF NOT EXISTS idx_session_files_file ON session_files(file_path);
CREATE INDEX IF NOT EXISTS idx_session_files_type ON session_files(link_type);
CREATE INDEX IF NOT EXISTS idx_session_files_workspace ON session_files(workspace_id);
CREATE INDEX IF NOT EXISTS idx_session_files_workspace_file ON session_files(workspace_id, file_path);
```

#### Metadata Field Structure

The `metadata` JSONB field can store link-type-specific information:

**For 'edited' links:**
```json
{
  "operation": "edit" | "create" | "delete" | "rename",
  "linesAdded": 42,
  "linesRemoved": 10,
  "toolName": "Edit"
}
```

**For 'referenced' links:**
```json
{
  "mentionContext": "User mentioned this file in prompt",
  "messageIndex": 5
}
```

**For 'read' links:**
```json
{
  "toolName": "Read",
  "bytesRead": 1024,
  "wasPartial": true
}
```

### 2. Runtime Type Definitions

Location: `/packages/runtime/src/ai/server/types.ts`

```typescript
export type FileLinkType = 'edited' | 'referenced' | 'read';

export interface FileLink {
  id: string;
  sessionId: string;
  workspaceId: string;
  filePath: string;
  linkType: FileLinkType;
  timestamp: number;
  metadata?: {
    // For edited files
    operation?: 'edit' | 'create' | 'delete' | 'rename';
    linesAdded?: number;
    linesRemoved?: number;
    toolName?: string;

    // For referenced files
    mentionContext?: string;
    messageIndex?: number;

    // For read files
    bytesRead?: number;
    wasPartial?: boolean;
  };
}
```

### 3. Database Repository Layer

Location: `/packages/runtime/src/storage/repositories/SessionFilesRepository.ts`

```typescript
export const SessionFilesRepository = {
  async addFileLink(link: Omit<FileLink, 'id'>): Promise<void>
  async getFilesBySession(sessionId: string, linkType?: FileLinkType): Promise<FileLink[]>
  async getSessionsByFile(workspaceId: string, filePath: string, linkType?: FileLinkType): Promise<string[]>
  async deleteFileLink(id: string): Promise<void>
  async deleteSessionLinks(sessionId: string): Promise<void>
}
```

### 4. File Tracking Service

Location: `/packages/electron/src/main/services/SessionFileTracker.ts`

This service will:
- Listen to AI tool executions
- Extract file paths from tool calls
- Determine link type based on tool name
- Write to SessionFilesRepository

**Tool Mapping:**
- `Write`, `Edit`, `NotebookEdit` → 'edited'
- `Read`, `Glob`, `Grep` → 'read'
- User message parsing → 'referenced'

### 5. User Message Parsing

Implement @ mention detection in user prompts:

```typescript
function extractFileMentions(message: string): string[] {
  // Match @filename.ext or @path/to/file.ext
  const regex = /@([^\s]+\.[a-zA-Z0-9]+)/g;
  const matches = [];
  let match;
  while ((match = regex.exec(message)) !== null) {
    matches.push(match[1]);
  }
  return matches;
}
```

### 6. UI Updates

#### Update FileEditSummary Interface

Location: `/packages/runtime/src/ui/AgentTranscript/types/index.ts`

```typescript
export interface FileEditSummary {
  filePath: string;
  linkType: FileLinkType;  // Add this field
  operation?: 'create' | 'edit' | 'delete' | 'rename';
  linesAdded?: number;
  linesRemoved?: number;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
```

#### Update FileEditsSidebar Component

Location: `/packages/runtime/src/ui/AgentTranscript/components/FileEditsSidebar.tsx`

Changes:
- Group files by link type with collapsible sections
- Add icons for each type (pencil for edited, mention for referenced, eye for read)
- Add filter buttons to show/hide each type
- Display metadata in tooltips

#### Update AgentTranscriptPanel

Location: `/packages/runtime/src/ui/AgentTranscript/components/AgentTranscriptPanel.tsx`

Changes:
- Fetch file links from database instead of metadata
- Pass all file types to FileEditsSidebar
- Update badge count to include all file types

### 7. IPC Handlers

Location: `/packages/electron/src/main/ipc/SessionFileHandlers.ts` (new file)

```typescript
	ipcMain.handle('session-files:add-link', async (event, link) => { ... });
ipcMain.handle('session-files:get-by-session', async (event, sessionId, linkType?) => { ... });
ipcMain.handle('session-files:get-sessions-by-file', async (event, workspaceId, filePath, linkType?) => { ... });
```

### 8. Session Discovery by File

Create a new UI component or context menu action:

**In Editor Context Menu:**
- Right-click on file in project tree
- "Show AI Sessions..." option
- Opens a modal showing all sessions that touched this file
- Grouped by link type with timestamps

**In Session Manager:**
- Add "Filter by file" search
- Type a file path to see all sessions that interacted with it

## Migration Strategy

### Phase 1: Database Foundation
1. Add `session_files` table to PGLite worker schema
2. Add migration logic to create table if not exists
3. Test database operations

### Phase 2: Repository Layer
1. Implement SessionFilesRepository
2. Write unit tests for repository methods
3. Integrate with existing AI tool execution flow

### Phase 3: File Tracking
1. Implement SessionFileTracker service
2. Hook into tool execution events
3. Parse @ mentions from user messages
4. Write file links to database

### Phase 4: UI Integration
1. Update type definitions
2. Modify AgentTranscriptPanel to fetch from database
3. Update FileEditsSidebar with new features
4. Add visual indicators for link types

### Phase 5: Discovery Features
1. Add IPC handlers for reverse lookup
2. Implement "Show sessions" context menu
3. Add file filter to Session Manager
4. Test end-to-end workflows

## Technical Considerations

### Performance

- Indexes on `file_path`, `session_id`, and `workspace_id` ensure fast queries
- Composite index on `(workspace_id, file_path)` for reverse lookup
- JSONB metadata allows flexible schema without migrations

### Data Integrity

- Foreign key constraint ensures cleanup when sessions are deleted
- Workspace scoping prevents cross-workspace data leakage
- Unique constraint on `(session_id, file_path, link_type)` prevents duplicates

### Backwards Compatibility

- Existing sessions without file links will continue to work
- Metadata-based file tracking can be gradually migrated
- UI gracefully handles sessions with no file links

## Testing Plan

### Unit Tests
- SessionFilesRepository CRUD operations
- @ mention parser with various formats
- Link type determination logic

### Integration Tests
- File tracking during tool execution
- Session-file relationship queries
- Cascading deletes

### E2E Tests
- Create session, edit files, verify tracking
- Reference files via @mentions, verify links
- Query sessions by file path
- Verify UI displays all link types correctly

## Success Criteria

1. All file interactions are tracked in database
2. AgenticCodingPanel displays all file types with visual distinction
3. Users can discover sessions by file path
4. No performance degradation in AI operations
5. Existing sessions continue to work without migration

## Future Enhancements

- Track file content snapshots at time of interaction
- Diff view showing what changed in each session
- Timeline view of file evolution across sessions
- Export session file history as report
- Smart suggestions: "Files you might want to edit based on this session"
