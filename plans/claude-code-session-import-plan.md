---
planStatus:
  planId: plan-claude-code-session-import
  title: Claude Code Session Import System
  status: in-development
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders:
    - ghinkle
  tags:
    - ai
    - sessions
    - import
    - claude-code
    - integration
  created: "2025-10-06"
  updated: "2025-01-14T00:00:00.000Z"
  progress: 92
  startDate: "2025-01-14"
---

## Implementation Progress

- [x] Create session scanner service to read ~/.claude/projects/
- [x] Implement path normalization (escaped paths to absolute paths)
- [x] Create JSONL parser for Claude Code session files
- [x] Build session metadata extractor (title, dates, message count, tokens)
- [x] Implement session-to-database transformer
- [x] Add gear button to session-history UI
- [x] Create session discovery dialog component
- [x] Implement session list with grouping by workspace
- [x] Add sync status badges and smart selection
- [x] Wire up sync operation with progress tracking
- [x] Add dev-mode feature flag
- [ ] Test with real Claude Code sessions

# Claude Code Session Import System

## Goals

Enable Nimbalyst users to discover and load Claude Code sessions from the shared session storage (`~/.claude/projects/`), providing access to their full conversation history across both CLI and GUI. This includes:
- Sessions created via the official Claude Code CLI
- Sessions created by Nimbalyst itself (already stored in the same format)
- Any Claude Code-compatible sessions from other tools

The feature will scan the session directory, match sessions by workspace path, and present them in Nimbalyst's Session Manager for viewing and continuation.

## Overview

Claude Code (both CLI and Nimbalyst) stores session data in `~/.claude/projects/` using a file-based JSONL format. Nimbalyst **also** maintains a PGLite database for fast querying and UI display.

**Current situation:**
- Nimbalyst creates sessions via Claude Code SDK → sessions are written to `~/.claude/projects/`
- Nimbalyst stores session metadata in PGLite for performance
- CLI sessions also write to `~/.claude/projects/`
- **Problem:** Nimbalyst's database may not know about sessions created via CLI or from other workspaces

**Solution:**
This feature scans `~/.claude/projects/`, discovers all sessions (CLI and GUI), and ensures Nimbalyst's database is synchronized with the filesystem. This gives users a complete view of all their Claude Code activity in one place.

## Session Storage Analysis

### Claude Code Storage Structure

Claude Code uses a hierarchical file-based storage system:

**Directory Structure:**
- `~/.claude/projects/[escaped-workspace-path]/[session-uuid].jsonl`
- Project paths are escaped by replacing `/` with `-` (e.g., `/Users/user/project` becomes `-Users-user-project`)
- Each session is stored as a separate JSONL file (one JSON object per line)
- Global history tracked in `~/.claude/history.jsonl` (simplified prompt history)

**Session File Format:**
Each session file contains a sequence of JSON objects, one per line, representing conversation events:

**Entry Types:**
- `user`: User messages with content and metadata
- `assistant`: AI responses with content, tool use, and usage stats
- `summary`: Conversation summaries with titles
- `system`: System messages
- `file-history-snapshot`: File tracking snapshots

**Common Fields:**
- `uuid`: Unique identifier for this entry
- `parentUuid`: Links to parent entry for threading
- `sessionId`: Session UUID
- `timestamp`: ISO 8601 timestamp
- `type`: Entry type (user/assistant/summary/system)
- `message`: Message object with role and content
- `cwd`: Working directory at time of message
- `gitBranch`: Active git branch
- `version`: Claude Code CLI version
- `userType`: "external" for user entries
- `isSidechain`: Boolean indicating if this is a branched conversation
- `requestId`: API request identifier (assistant messages)

**Message Content Structure:**
- Text content as strings
- Tool use with tool names, IDs, and input parameters
- Tool results with success/error status
- Rich formatting and markdown support

**Tool Usage Tracking:**
Assistant messages may contain arrays of tool use objects including:
- Tool names: Bash, Read, Write, Edit, Grep, TodoWrite, etc.
- Tool inputs and parameters
- Separate tool result entries in user messages

**Token Usage:**
Assistant messages include usage statistics:
- `input_tokens`: Prompt tokens consumed
- `output_tokens`: Response tokens generated
- `cache_creation_input_tokens`: Tokens for cache creation
- `cache_read_input_tokens`: Tokens read from cache

### Nimbalyst Storage Structure

Nimbalyst uses PGLite (PostgreSQL in WebAssembly) with the following schema:

**Table: ai\_sessions**
- `id`: TEXT PRIMARY KEY (session UUID)
- `workspace_id`: TEXT NOT NULL (workspace identifier, defaults to 'default')
- `file_path`: TEXT (associated file path if any)
- `provider`: TEXT NOT NULL (AI provider name, e.g., 'claude', 'claude-code')
- `model`: TEXT (model identifier)
- `title`: TEXT NOT NULL (conversation title, defaults to 'New conversation')
- `session_type`: TEXT (defaults to 'chat')
- `document_context`: JSONB (document context if applicable)
- `provider_config`: JSONB (provider-specific configuration)
- `provider_session_id`: TEXT (external session identifier)
- `draft_input`: TEXT (unsent message draft)
- `token_usage`: JSONB (cumulative token usage, defaults to '{}')
- `total_tokens`: JSONB (total tokens with input/output/total)
- `metadata`: JSONB (additional metadata, defaults to '{}')
- `last_read_message_id`: TEXT (ID of last read message)
- `last_read_timestamp`: TIMESTAMP (timestamp of last read message)
- `created_at`: TIMESTAMP (defaults to CURRENT_TIMESTAMP)
- `updated_at`: TIMESTAMP (defaults to CURRENT_TIMESTAMP)

**Table: ai\_agent\_messages**
Messages are stored in a separate table with a foreign key to ai_sessions:
- `id`: BIGSERIAL PRIMARY KEY (auto-incrementing message ID)
- `session_id`: TEXT NOT NULL (references ai_sessions.id)
- `created_at`: TIMESTAMP WITH TIME ZONE NOT NULL (defaults to NOW())
- `source`: TEXT NOT NULL (message source/type)
- `direction`: TEXT NOT NULL ('input' or 'output')
- `content`: TEXT NOT NULL (message content)
- `metadata`: JSONB (additional message metadata including role, tool calls, etc.)

### Key Structural Differences

**Storage Model:**
- Claude Code: Append-only JSONL files, one file per session
- Nimbalyst: Relational database with separate sessions and messages tables

**Message Storage:**
- Claude Code: Each message is a line in the JSONL file
- Nimbalyst: Messages in separate `ai_agent_messages` table with foreign key to session

**Message Threading:**
- Claude Code: Explicit parent-child relationships via `parentUuid`
- Nimbalyst: Sequential order via auto-incrementing ID and timestamp

**Tool Representation:**
- Claude Code: Separate entries for tool use and tool results
- Nimbalyst: Tool use and results stored in message metadata JSONB field

**Token Tracking:**
- Claude Code: Per-message usage in assistant messages
- Nimbalyst: Cumulative session-level tracking in `token_usage` and `total_tokens` fields

**Session Metadata:**
- Claude Code: Per-message context (cwd, gitBranch, version)
- Nimbalyst: Session-level metadata in JSONB field, per-message metadata in message.metadata

## Session Discovery and Matching

### Workspace Path Mapping

**Path Normalization:**
- Convert Claude Code escaped paths back to absolute paths
- Example: `-Users-user-sources-project` → `/Users/user/sources/project`
- Handle edge cases like paths with multiple consecutive slashes
- Validate that normalized paths exist on the filesystem

**Matching Strategy:**
- Direct match: Workspace path exactly matches a Nimbalyst workspace
- Substring match: Workspace path is a parent or child of a Nimbalyst workspace
- Manual match: Allow user to select which Nimbalyst workspace to import into
- No match: Create imported sessions in a special "Imported" workspace or mark as orphaned

**Multiple Workspaces:**
- Handle cases where user has sessions for subdirectories of current workspace
- Present clear hierarchy showing relationship between paths
- Allow batch import of related workspaces

### Session Detection

**Scanning Process:**
- Enumerate directories in `~/.claude/projects/`
- For each directory, read session JSONL files
- Extract session metadata (first user message, summary entries, timestamps)
- Count messages and calculate session size
- Check for existing imports to avoid duplicates

**Metadata Extraction:**
- Parse first few entries to get session start time and initial message
- Look for summary entries to extract session titles
- Count total entries to estimate import size
- Extract git branch and working directory info

**Performance Considerations:**
- Lazy loading: Only read file headers initially
- Progressive parsing: Parse full content only when importing
- Caching: Cache session metadata to avoid repeated file reads
- Batch processing: Import multiple sessions efficiently

## Data Transformation

### Message Conversion

**Entry Type Mapping:**
- `user` entries → User messages in Nimbalyst
- `assistant` entries → Assistant messages with tool use
- `summary` entries → Used for session title, stored in metadata
- `system` entries → Stored in metadata as system context
- `file-history-snapshot` → Ignored or stored in metadata

**Content Transformation:**
- Convert JSONL message content to Nimbalyst message format
- Preserve text content as-is
- Transform tool use into Nimbalyst's tool representation
- Handle multi-part content arrays appropriately
- Maintain markdown formatting and code blocks

**Tool Use Handling:**
- Extract tool use from assistant messages
- Match tool names to Nimbalyst's tool types
- Convert Claude Code tool parameters to Nimbalyst format
- Link tool use with subsequent tool result entries
- Handle unknown or unsupported tools gracefully

**Threading Reconstruction:**
- Use `parentUuid` to rebuild conversation tree
- Flatten branched conversations or preserve as metadata
- Handle sidechains appropriately
- Maintain chronological order via timestamps

### Metadata Mapping

**Session-Level Metadata:**
- Title: Extract from summary entries or first user message
- Provider: Map to 'claude-code' or 'claude' provider
- Model: Extract from assistant message metadata
- Created/Updated: Use first/last entry timestamps
- Workspace: Map from working directory path

**Contextual Metadata:**
- Git branch: Extract from entry metadata
- Working directory: Extract from cwd field
- CLI version: Extract from version field
- File context: Infer from file operations in tool use

**Token Usage Aggregation:**
- Sum input_tokens across all assistant messages
- Sum output_tokens across all assistant messages
- Calculate total tokens consumed
- Store cache statistics if relevant
- Map to Nimbalyst's token_usage and total_tokens fields

**Document Context:**
- Attempt to reconstruct document context from file operations
- Look for Read/Write/Edit tools to identify active files
- Build document_context object if file associations are clear
- Handle cases where no clear document association exists

### Data Integrity

**Validation:**
- Verify JSON parsing for each line
- Check for missing required fields
- Validate UUID references (parentUuid, sessionId)
- Ensure timestamps are valid
- Detect corrupted or incomplete sessions

**Error Handling:**
- Skip malformed entries with logging
- Continue import on non-fatal errors
- Report issues to user after import
- Provide option to skip problematic sessions
- Maintain import transaction integrity

**Duplicate Detection and Idempotency:**
- Use Claude Code session UUID as primary key in Nimbalyst database
- Check if session ID already exists before importing
- For existing sessions, compare:
  - Message counts (has the session grown?)
  - Last activity timestamp (new messages added?)
  - Content hash or last message ID
- Idempotent import behavior:
  - If session already exists with same content: Skip silently (no duplicate created)
  - If session exists but has new messages: Update with new messages only
  - If session exists but local is newer: Show update option in preview
- Preview dialog clearly marks:
  - Already imported (up-to-date)
  - Needs update (new messages available)
  - New (not yet imported)
- Multiple re-imports are safe and won't create duplicates
- Track last import timestamp per session for efficient incremental detection

## Import Implementation

### User Interface

**Session History Panel Integration:**
- Add gear button in the session-history section of the agent panel
- Clicking gear button opens session discovery dialog
- Dialog scans `~/.claude/projects/` for all sessions
- Displays:
  - Total number of sessions found (both Nimbalyst and CLI)
  - Sessions grouped by workspace
  - Session metadata (title, date, message count, tokens used)
  - Workspace path mapping
  - Session source indicator (CLI, Nimbalyst, or both)
  - Warning indicators for problematic sessions
- Preview is read-only analysis before synchronizing database

**Session Discovery Dialog:**
- Header shows total sessions found across all workspaces
- Grouped list of sessions by workspace with expand/collapse
- Each session shows:
  - Session title (from summary or first message)
  - Creation date and last activity
  - Message count and token usage
  - Associated workspace path
  - Source: "CLI only", "Nimbalyst only", or "Both"
  - Sync status indicator (in sync, needs update, new)
- Filter controls for date range, workspace, and source
- Search to find sessions by content or title
- "Sync Selected" and "Sync All" buttons
- Cancel option to close without syncing

**Session Selection UI:**
- Checkbox selection for individual sessions or entire workspaces
- Select/deselect all functionality
- Status badges for each session:
  - "New to Nimbalyst" - Session exists in filesystem but not in database
  - "In sync" - Database matches filesystem (auto-deselected by default)
  - "Update available" - Filesystem has new messages since database was updated
  - "CLI session" - Created via CLI, not yet in Nimbalyst database
  - "Warning" - Parsing errors or issues detected
  - "Large" - Very large sessions that may take time
- Smart defaults:
  - New sessions: Selected by default
  - In-sync sessions: Deselected by default (can still be manually selected)
  - Update available: Selected by default
- Clear count showing: X new, Y updates, Z in sync

**Sync Progress:**
- Real-time progress bar with session count
- Per-session status (pending, syncing, complete, error)
- Detailed logs for debugging
- Cancel option for long syncs
- Summary report when complete

**Post-Sync Actions:**
- Navigate to synced sessions
- Review sync report
- Handle conflicts or errors
- Export sync log for troubleshooting

### Sync Process Flow

**Phase 1: Discovery (triggered by gear button)**
- User clicks gear button in session-history section
- Scan `~/.claude/projects/` directory in background
- Parse session metadata without full content (lightweight scan)
- Compare filesystem sessions with database records
- Identify: new sessions, updated sessions, in-sync sessions
- Display discovery dialog with all sessions and their sync status
- Show counts, warnings, and selection options

**Phase 2: Selection**
- User reviews sessions in discovery dialog
- User selects specific sessions or clicks "Sync All"
- Smart defaults select only new and updated sessions
- User confirms sync action

**Phase 3: Sync (Idempotent)**
- For each selected session:
  - Check if session UUID exists in database
  - Compare database message count with JSONL file line count
  - If new or updated: Parse JSONL file (full or incremental)
  - Transform entries to Nimbalyst message format
  - Validate data integrity
- Begin database transaction per session:
  - New session: INSERT into `ai_sessions` table
  - Existing session: UPDATE `ai_sessions` metadata and timestamps
  - New messages: INSERT into `ai_agent_messages` table (append only)
  - Update token usage totals
  - Record sync metadata (last_synced_at, source_message_count)
  - Commit transaction
- Sessions can be synced multiple times safely without duplicates

**Phase 4: Verification**
- Verify imported sessions are accessible
- Check message counts match source
- Validate token counts
- Test session loading and display

**Phase 5: Completion**
- Display import summary
- Log any errors or warnings
- Offer to open imported sessions
- Update UI to reflect new sessions

### Import Modes

**Full Import:**
- Import all sessions from all workspaces
- Create workspace mappings as needed
- Preserve all metadata and context

**Selective Import:**
- User selects specific sessions or workspaces
- Only import selected items
- More control over what enters Nimbalyst

**Incremental Import (Idempotent):**
- Detect new sessions since last import
- Detect updated sessions (new messages added)
- Only import new content, skip already-imported sessions
- Efficient for repeated imports
- Safe to run multiple times without duplicates

**Merge Import:**
- Combine with existing sessions if duplicates found
- Append new messages to existing sessions
- Update metadata to reflect merged state

## Future: Continuous Sync

While the initial feature is a one-time import, the architecture should support future continuous sync capabilities:

### Sync Architecture Considerations

**File Watching:**
- Monitor `~/.claude/projects/` for new session files
- Detect modifications to existing session files
- Trigger incremental imports automatically

**Bidirectional Sync:**
- Export Nimbalyst sessions to Claude Code format
- Keep both stores in sync
- Handle conflicts (last-write-wins or user resolution)

**Real-Time Updates:**
- Stream new messages from Claude Code sessions into Nimbalyst
- Show live indicator when Claude Code is active
- Update session in real-time as CLI adds entries

**Sync Settings:**
- Enable/disable automatic sync
- Configure sync frequency
- Select which workspaces to sync
- Set conflict resolution policies

**Performance Impact:**
- Minimize file I/O overhead
- Use efficient change detection
- Batch sync operations
- Respect system resources

## Technical Considerations

### File System Access

**Permissions:**
- Verify read access to `~/.claude/` directory
- Handle permission errors gracefully
- Request elevated permissions if needed on Windows

**Path Handling:**
- Cross-platform path resolution
- Handle spaces and special characters in paths
- Normalize path separators
- Support symlinks and aliases

**Large Files:**
- Sessions can be very large (multiple MB)
- Stream parsing rather than loading entire file
- Implement progress reporting
- Handle out-of-memory scenarios

### Database Operations

**Transaction Management:**
- Use database transactions for import operations (session + messages together)
- Rollback on errors to maintain consistency
- Batch inserts for messages table (e.g., 100 messages at a time)
- Commit strategy for long imports (per-session commits)

**Performance Optimization:**
- Bulk insert operations for messages table
- Index updates deferred until after import
- Prepared statements for repeated inserts
- Efficient JSON serialization for metadata fields

**Storage Impact:**
- Estimate database size increase before import
- Warn user if insufficient space
- Consider compression for large sessions
- Implement cleanup tools for old sessions

### Error Recovery

**Partial Imports:**
- Track which sessions were successfully imported
- Allow resuming failed imports
- Maintain import state across app restarts
- Provide manual recovery tools

**Logging:**
- Detailed logs for debugging
- User-friendly error messages
- Export logs for support requests
- Separate logs for discovery vs. import phases

**Fallback Strategies:**
- Degrade gracefully when features unavailable
- Skip unsupported features rather than failing
- Provide manual import options if auto-import fails
- Export failed sessions for manual review

## Security and Privacy

### Data Handling

**Sensitive Information:**
- Sessions may contain API keys, tokens, or credentials
- Warn users about sensitive data in sessions
- Provide option to exclude specific sessions
- Consider sanitization of sensitive patterns

**Local Storage:**
- Sessions remain local, no cloud upload
- Database encrypted if Nimbalyst supports it
- Respect existing Claude Code privacy settings
- Clear communication about data handling

**Access Control:**
- Only import sessions user has permission to read
- Respect file system permissions
- No elevation of privileges
- Secure database access patterns

## Testing Strategy

### Unit Tests

**Parser Tests:**
- Parse valid JSONL entries
- Handle malformed JSON
- Process all entry types correctly
- Extract metadata accurately

**Transformer Tests:**
- Convert messages correctly
- Map tool use appropriately
- Aggregate token usage
- Handle edge cases

**Path Tests:**
- Normalize escaped paths correctly
- Match workspaces accurately
- Handle special characters
- Cross-platform compatibility

### Integration Tests

**Import Flow Tests:**
- End-to-end import of sample sessions
- Verify data integrity post-import
- Test error handling and recovery
- Validate UI state updates

**Database Tests:**
- Correct schema operations
- Transaction rollback on errors
- Query performance with imported data
- Index utilization

### Performance Tests

**Large Session Tests:**
- Import sessions with thousands of messages
- Handle large file sizes
- Memory usage profiling
- Import time benchmarks

**Batch Import Tests:**
- Import hundreds of sessions
- Database performance under load
- UI responsiveness during import
- Resource utilization

## User Documentation

**Feature Description:**
- Explain what Claude Code session import does
- Benefits of importing sessions
- Limitations and caveats
- Link to Claude Code documentation

**How-To Guide:**
- Step-by-step import instructions
- Screenshots of import UI
- Troubleshooting common issues
- FAQ section

**Technical Details:**
- Data transformation explanation
- What gets imported vs. what doesn't
- Database impact
- Privacy considerations

## Success Criteria

- Successfully import sessions with 100% data integrity
- Imported sessions fully functional in Nimbalyst
- Clear user feedback throughout import process
- Graceful handling of edge cases and errors
- Reasonable performance (under 1 second per session for typical sessions)
- Comprehensive error reporting and recovery options
- User satisfaction with feature completeness and usability

## Session Continuation

### How It Works

Since Nimbalyst uses the Claude Code SDK (`@anthropic-ai/claude-agent-sdk`) directly, imported sessions can be **continued seamlessly**:

**Simple continuation mechanism:**
1. Import the session (parse JSONL, store in database)
2. When user wants to continue, pass the original Claude Code session UUID to the SDK
3. The SDK handles all session state, context, and history automatically
4. New messages append to the existing Claude Code session file
5. Both CLI and Nimbalyst can interchangeably work with the same session

**Key insight:** We don't need to transform or reconstruct anything for continuation. The Claude Code SDK manages:
- All tool implementations (Task, TodoWrite, Glob, Grep, etc.)
- File system state and context
- Session history and threading
- Git branch tracking
- Document context

### Implementation Details

**Session ID preservation:**
- Store the original Claude Code session UUID in `ai_sessions.id`
- Use the same UUID when calling the Claude Agent SDK
- The SDK reads/writes to `~/.claude/projects/[workspace]/[session-uuid].jsonl`

**Provider configuration:**
- Imported sessions use provider: 'claude-code'
- Pass session ID to SDK via configuration
- SDK handles all message routing and state management

**Bidirectional sync:**
- Changes made in Nimbalyst appear in CLI sessions
- Changes made in CLI appear when Nimbalyst re-imports
- Idempotent import keeps Nimbalyst database in sync with JSONL files

### User Experience

**Continuing imported sessions:**
1. User imports Claude Code sessions from preview dialog
2. Sessions appear in Session Manager with full history
3. User can immediately send new messages to continue the conversation
4. Messages are handled by Claude Code SDK, maintaining full compatibility
5. User can switch between Nimbalyst GUI and CLI seamlessly

**Session sync:**
- Re-running import updates sessions with new messages from CLI usage
- No conflicts or duplicates due to idempotent import
- Sessions remain fully functional in both environments

## Open Questions

- Should we support importing from specific Claude Code version ranges, or all versions?
- How should we handle sessions with missing or corrupted data?
- What level of detail should import logs contain?
- Should imported sessions be visually marked or tagged as "imported from CLI"?
- Is there value in importing the global history.jsonl file separately?
- Should we provide a "sync" mode that automatically re-imports when JSONL files change?
- How should we handle workspace path mismatches when continuing imported sessions?
