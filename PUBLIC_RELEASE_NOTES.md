# Nimbalyst v0.45.34

## New Features

**Session History**
- Search session history by pressing Tab while browsing sessions
- Full-text search across all your AI chat sessions

**File Tree**
- Filter file tree to show only git modified files
- Filter files by read/written status
- Type-specific icons for better file type recognition
- Natural sorting for easier navigation

**AI Chat**
- Token usage breakdown showing category details
- Sessions automatically named via MCP
- Floating actions in agent transcript for quick access
- Find functionality in agent transcript

**Code Editing**
- Inline diff mode for Monaco code editor with approval controls
- Markdown syntax highlighting in Monaco editor
- AI edits to code files now show approval controls for review

**Commands**
- /bug-report command for interactive bug reports

**Other**
- Discord link added to Help menu
- Image viewer for standalone image files
- Project-aware file opening from OS
- File tree filter and icon visibility settings are now persisted

## Improvements

- Better display for MCP tool calls in chat
- Login button remains visible even when logged in (prevents OAuth expiry issues)
- View mode toggle replaces markdown mode conversion for simpler workflow

## Fixed

**Session Management**
- Session history now refreshes more smoothly when switching between sessions
- Session list correctly maintains your selected sort order when filtering
- Sessions now open correctly when switching from Files to Agent mode
- Session state tracking improved for better cross-mode visibility
- Search box preserved when no sessions match in agent mode

**AI Chat**
- Fixed issue that could cause errors when creating new AI sessions
- Expired Claude Code sessions now display clear error messages
- Claude Code session import message filtering and ordering improved

**File Tree & Editor**
- Session history timestamps now display correctly in your timezone
- File tree sync and auto-scroll issues resolved
- File tree auto-expand and selection clearing fixed
- Monaco editor now updates correctly when files change on disk
- Scrolling behavior for change groups in editor improved

**Performance & Stability**
- App no longer freezes on large workspace directories
- Performance limits added to workspace manager file scanning
- Monaco diff editor disposal errors fixed
- Prevented editor.registerCommand crash during hot module reload
- Workspace-relative paths in workspace:open-file handler resolved

**UI/UX**
- Slash commands now load correctly
- Monaco diff approval bar now appears for AI edits to code files
- Fixed visual "TEST MODE" indicator in development builds
- Removed double scrollbars in Monaco markdown mode
- Removed duplicate Files header in agent sidebar
- Discord invite URL updated to correct link
- Prevented false diffs for hashtags in unchanged content
- DiffApprovalBar now appears correctly after view mode switch

**Other**
- DMG/ZIP files without version in filename are now handled correctly
- Quick open name match badge removed for cleaner interface
- Newlines preserved in user messages in transcript
