# Changelog

All notable changes to Nimbalyst will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [Unreleased]

### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
<!-- Bug fixes go here -->

### Removed
<!-- Removed features go here -->

## [0.52.43] - 2026-02-05


### Added
- Standalone Claude helper binary setting (experimental) for improved performance

### Changed
- CI now pins Bun version to 1.1.43 for deterministic builds
- Claude helper binary build extended to support all platforms

### Fixed
<!-- Bug fixes go here -->

### Removed
<!-- Removed features go here -->

## [0.52.42] - 2026-02-05


### Added
- Durable interactive prompts architecture for session persistence
- Database dashboard in database browser extension
- Support for reference images in image generation
- PostHog analytics tracking for auto-update system
- Startup delay for walkthrough triggers to improve UX

### Changed
- Git commit widget now renders from tool call data directly

### Fixed
- Header row pinning and column freezing disabled due to UX issues in spreadsheets

### Removed
- Unused git commit proposal atoms

## [0.52.41] - 2026-02-04


### Added
- Claude usage indicator with pace tracking for monitoring API costs
- CLI `--file` flag to open a specific file when launching a workspace
- Project move/rename feature with automatic data migration
- Worktree merge now allows uncommitted changes

### Changed
- Large text attachments now written to /tmp instead of sent inline
- Worktree rebases use file-level conflict detection
- Transcript search rewritten to use CSS Custom Highlight API
- GitHub MCP template updated to use official remote server

### Fixed
- Session cancellation now properly stops SDK and rejects pending interactions
- Attachment previews now center on screen instead of in scroll panel
- Archived sessions toggle race condition
- Session draft input displays correctly when creating sessions from rebase
- Cross-platform path handling for worktree names
- "Resolve with Agent" button now works for bad git state in worktrees
- Hide dock icon when spawning Claude Code subprocess on macOS
- Persist showUsageIndicator setting in AI settings
- Hide redundant CODE provider badge for claude-code sessions
- Register confirm-dialog with DialogProvider
- Only show context window walkthrough after /context runs
- Batch git log calls for performance

### Removed
<!-- Removed features go here -->

## [0.52.40] - 2026-02-04


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- ExitPlanMode now requires planFilePath parameter with cross-platform path support

### Removed
<!-- Removed features go here -->

## [0.52.39] - 2026-02-03


### Added
- OS notifications when AI sessions are blocked waiting for user input

### Changed
- Reduced verbose logging output

### Fixed
- Git commit widget only triggers on explicit "smart commit" requests

## [0.52.38] - 2026-02-03


### Added
- Model picker for image generation with Gemini 2.5 Flash and Gemini 3 Pro options

### Changed
- Default to group-by-directory view in Files Edited sidebar

### Fixed
- Prevent duplicate git commit widgets from showing as active
- Prevent HelpTooltip from appearing when returning to app window
- Hide prompt additions feature in packaged builds
- Show commit checkboxes for files in non-git directories
- Show uncommitted files link when session has edits
- Add run-name to CI workflow to distinguish from release runs

## [0.52.37] - 2026-02-03


### Changed
- Reduced verbose logging in CustomTrackerLoader and agentMode atoms

### Fixed
- Build rexical before runtime in CI workflow to fix build dependency order
- Include package-lock.json in version control

## [0.52.36] - 2026-02-03


### Changed
- Default file scope mode now shows all session edits instead of just the current session

### Fixed
- Built-in themes now included in CI packaged builds

## [0.52.35] - 2026-02-03


### Added
- HelpTooltip system for contextual UI help with hover tooltips
- Status indicator on workstream/worktree parent headers showing active sessions
- Plan status check integrated into prepare-commit command
- Claude 500 error detection with link to Anthropic status page
- Allow editing extension-registered file types in planning mode
- Persist file scope mode at workspace level
- Added status values, plan types, and best practices to plan mode prompt

### Changed
- Migrated crystal-dark theme to file-based theming system
- Extracted plan mode prompts to shared module for reuse
- Consolidated getAllFilesInDirectory into shared utility
- Code cleanup and DRY improvements for worktree support

### Fixed
- Cross-platform path compatibility in httpServer.ts
- Worktree path handling for mockups and document service
- Properly count and display files in untracked directories
- Scope 'all uncommitted files' to worktree when in worktree session
- Include worktreeId in sessionStoreAtom when adding sessions
- Path resolution now worktree-aware throughout the codebase
- Remove premature git staging from commit command
- Derive missing theme colors from base colors for custom themes
- Clear unread indicator when selecting child session in SessionHistory
- TypeScript type errors in electron package
- Document header updates when file is externally modified
- Prevent document header from losing content on field changes
- Prevent tracker panel empty state flash during loading
- Rename postcss.config.js to .mjs to eliminate module type warning
- Convert sessionArchivedAtom to derived atom, restore draft persistence
- Stack empty state links vertically in Files Edited sidebar
- Prevent session mode/model atoms from diverging during reloads
- Use user's default model when creating child sessions
- Respect sort order for sub-sessions in workstreams and worktrees
- Build all extensions in crystal-run.sh
- Terminal cursor position corruption when switching tabs
- Handle system/auto theme and Claude plugin-only extensions
- Persist Claude SDK session ID immediately on init

### Removed
- Removed unused agent-mode-toggle help content

## [0.52.33] - 2026-02-02


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->
- Expanded visual communication guidance in Claude Code prompt
- Refactored worktree file state to use centralized IPC listener architecture

### Fixed
<!-- Bug fixes go here -->
- Fixed crash when loading tool permission dialogs from database

### Removed
<!-- Removed features go here -->

## [0.52.32] - 2026-02-02


### Changed
- ExitPlanMode migrated to durable DB-backed prompts
- Interactive prompts (git commit proposals) now persist across app restarts

### Fixed
- Transcript no longer flashes when switching sessions
- Transcript auto-scroll now uses per-session state to prevent scroll position bleeding between sessions

## [0.52.31] - 2026-02-02


### Added
- "Copy Session ID" option to session context menu
- Redesigned Files Edited sidebar with clearer scope modes

### Changed
- Simplified session scope filter to binary choice (This Session / All Sessions)
- Centralized IPC listeners for file state and session list to prevent race conditions
- Reduced verbose logging in main process

### Fixed
- Session model atom now initialized on add to prevent flash of default value
- Restored data-session-id attributes to session components

## [0.52.30] - 2026-02-02


### Added
- Support for .mdc files as markdown

### Changed
- Updated @anthropic-ai/claude-agent-sdk to 0.2.29
- Mockup annotation prompt now uses capture_editor_screenshot

### Fixed
- Clear mockup annotation indicator when switching tabs
- Include mockup annotations in capture_editor_screenshot tool
- Theme variable for text selection indicator corrected
- Theme variable for mockup annotation indicator text corrected
- Mockup annotation data now properly passes through IPC serialization
- Tailwind theme classes corrected for dark mode compatibility
- ExtensionDevIndicator now updates reactively when setting changes
- Built-in themes included in production build extraResources
- Tracker bottom panel tab and icon behavior improved

## [0.52.29] - 2026-02-01


### Added
- Flash animation when focusing existing worktree terminal
- Smart commit detection for worktree rebase using git cherry
- Support for deleted and renamed files in uncommitted files list
- Inline rename for worktrees and sessions
- Git panel refresh on session completion and visibility
- E2E runner agent for containerized test execution

### Changed
- Session naming improved to put descriptive part first
- Claude Code system prompt unified for all session types

### Fixed
- Running session no longer steals tab focus in worktrees
- Linux terminal startup error resolved (bash args reorder)
- Checkboxes now shown for all uncommitted files in Files Edited sidebar
- Terminal scrollback corruption in Ghostty prevented
- Stale stash corruption in worktree rebase/merge operations prevented
- Rebase enabled for worktrees that are behind main even when merged
- System message additions stripped from prompt history recall
- Microphone entitlement removed to prevent unwanted permission prompts
- Test database cleared on each Playwright test launch
- Walkthroughs blocked when dialogs/overlays are visible
- Sessions auto-unarchive when new message is sent
- Copyright year updated to 2025-2026 in about page

## [0.52.27] - 2026-02-01


### Added
- PDF attachment support for Claude providers

### Fixed
- Auto-update YML files now generated correctly for Windows and Linux

## [0.52.26] - 2026-01-31


### Added
- AI session tabs and input now visible in FILES layout mode

### Changed
- Tracker panel shortcut changed to Cmd+T
- Extension command namespaces standardized with nimbalyst- prefix
- Tracker panel state migrated to Jotai atoms

### Fixed
- Empty screenshots no longer cause API errors
- MCP tools now use session-specific document state
- Document content read from disk for AI context
- Auto-switch to agent mode when /implement command is used
- Find-previous stack overflow in search

## [0.52.25] - 2026-01-31


### Added
- File context and text selection support in agent mode (including worktrees)

### Fixed
- MCP tools (like git commit proposal) now work correctly in worktree sessions
- Removed deprecated "no document open" warning from system prompt

## [0.52.24] - 2026-01-31


### Added
- Optional email field to feedback survey
- Diagnostic logging for theme and preload path debugging
- Renderer eval MCP tool for debugging
- Rebuild Extensions submenu to Extension Dev Mode
- Git commit mode walkthrough
- Fuzzy file search and content search shortcut to QuickOpen
- Walkthrough system improvements and new walkthroughs
- Layout controls walkthrough with markdown support

### Changed
- Unified document context handling across all AI providers
- Eliminated hardcoded colors in favor of theme variables
- Improved Prompt Additions widget for all AI providers
- Reduced context usage for Claude Code by truncating long documents

### Fixed
- Email format validation in feedback survey
- Onboarding dialog not showing for new users
- Todo panel error on truthyness
- Reverted bad user-select CSS changes

### Removed
<!-- Removed features go here -->

## [0.52.23] - 2026-01-31


### Added
- Terminal tab indicator showing when a command is running
- Session tabs now wrap to multiple rows when overflowing
- Text selection context included in AI chat messages
- Enhanced prompt additions widget with document context, attachments, and persistence
- Archive/unarchive functionality for individual sessions in worktrees

### Changed
- Moved document context from system prompt to user message for better context handling
- Simplified text selection to just the selected text string
- Optimized document content by omitting unchanged content between messages

### Fixed
- Suppressed error logs when user aborts Claude Code request
- Prevented terminal display corruption from interleaved writes
- Plan mode implementation now creates new session in worktree instead of workstream
- Fixed worktree session tabs showing 'Untitled' after restart
- Fixed new sessions in worktrees using 'New Session' instead of worktree name

### Removed
<!-- Removed features go here -->

## [0.52.22] - 2026-01-30


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Improved error handling for AskUserQuestion tool resolution in Claude Code sessions
- Added comprehensive analytics diagnostics with fail-open error handling for better reliability
- Fixed Intel Mac terminal support by enabling npmRebuild in Electron build configuration
- Fixed text selection styling using correct CSS layer utilities

### Removed
<!-- Removed features go here -->

## [0.52.21] - 2026-01-30


### Added
- "No uncommitted changes" message when session has committed all its files
- File scope filter and root checkbox to Files Edited sidebar
- Cmd+Alt+W keyboard shortcut to create new worktree
- Environment variables UI in Claude Code settings
- Helpful error dialog for Bedrock MCP tool incompatibility
- Analytics tracking for configured AI provider in claude_code_session_started event

### Fixed
- Text selection now enabled in AI session transcripts
- Dropdown positioning, keyboard shortcuts, and IPC type safety improvements
- New session dropdown menu no longer hidden behind search input
- Login popup formatting improved with line breaks

## [0.52.20] - 2026-01-30


### Changed
- Disabled text selection on UI chrome elements, opt-in for content areas

### Fixed
- Auto-updater now selects correct architecture on arm64 Macs
- Block message send while image attachments are still processing

## [0.52.19] - 2026-01-30


### Added
- Plan mode indicator displayed on user messages in transcript
- Shift+Tab keyboard shortcut to toggle plan mode in Claude Code
- `/clear` command now creates a new session in current context

### Changed
- Plan mode instructions moved from system prompt to user message for better visibility
- AskUserQuestion state persisted using Jotai atoms for improved state management

### Fixed
- AskUserQuestion state now persists across session navigation
- Object destroyed errors prevented when window refreshes during AI requests

## [0.52.18] - 2026-01-30


### Added
- Offscreen editor mounting system for MCP tools
- Session import dialog in Developer menu

### Changed
- GitCommitConfirmationWidget styling aligned with FileEditsSidebar

### Fixed
- FTS indexing now includes user prompts and assistant text for better search
- Session content search now works reliably with time/direction filters
- Optimized session list query to prevent redundant loading
- WebSocket "Sent before connected" error in announceDevice
- Improved performance by caching session files query and preventing extension double-load
- Extension 'main' field now optional for Claude plugin-only extensions

## [0.52.17] - 2026-01-29


### Added
- "Open in External Editor" context menu option with configurable editor path
- License attribution for third-party themes

### Changed
- Themes separated from extension system for faster loading
- Improved installed extensions panel layout and organization
- Built-in commands and mockup editor migrated to extension system

### Fixed
- PID-based database locking to prevent corruption when multiple instances attempt to open
- Slash command menu now responds to clicks and shows no duplicates
- Extension MCP tools now register correctly when workspace path is set
- Prevent extension initialization crash when aiTools is not an array
- Prevent infinite render loop in GitCommitConfirmationWidget
- Stop EISDIR errors when scanning .nimbalyst directories
- Smart commit prompt now correctly references developer_git_commit_proposal tool
- "Reveal in Finder" context menu now works correctly

### Removed
- Redundant database queries at startup

## [0.52.16] - 2026-01-29


### Added
- Terms of Service and Privacy Policy links in onboarding flow
- Single-session worktrees now display as flat items with worktree icon for better visibility
- Current PATH shown in Advanced Settings for debugging environment issues
- Terminal tab context menu with Clear option and list refresh listener
- Analytics tracking for worktrees, plan mode, and git commits
- Warning when archiving worktree with uncommitted changes

### Changed
- Review-branch command now supports flexible review scopes and parallel sub-agent processing
- Archive worktree dialog logic extracted into reusable hook

### Fixed
- Alpha features toggle crash and auto-enable for upgrading users
- Database init failure now shows recovery options instead of crashing
- Terminal cleanup improved to prevent stale closures during auto-restart
- Terminals associated with archived worktrees are now properly deleted
- Terminal scrollback restoration and error handling improved
- Worktree deletion now ensures disk cleanup before marking as archived
- Sessions losing messages (speculative fix)
- Terminal crash from corrupted scrollback with invalid code points

## [0.52.14] - 2026-01-28


### Added
- Display worktree name in terminal tabs for better identification
- YAML frontmatter instructions in plan mode prompt for structured plan metadata
- ExitPlanMode now supports options: new session, approve, or continue with feedback

### Changed
- Plan mode agent now chooses plan name with validation on exit
- Plan implementation uses natural prompt instead of /implement command
- AskUserQuestion widget now uses 90% width for better display
- Plan mode workflow now works more like the CLI

### Fixed
- Plan file link now opens correctly in workstream editor tabs
- Developer mode selection from onboarding now properly updates Jotai atom

### Removed
- /plan slash command removed from Nimbalyst (plan mode is now internal)

## [0.52.13] - 2026-01-28


### Added
- Collapsible "Other Uncommitted Files" section in git commit panel with persisted state

### Fixed
- Session list refresh handling and increased slow query threshold
- Timezone handling in AI Usage Report graph
- Dialog overlay issues by extracting DialogProvider
- "Open in Files Mode" context menu now correctly switches to Files mode

## [0.52.12] - 2026-01-28


### Added
- `/update-libs` command to update Anthropic Agent SDK and MCP library to latest versions

### Fixed
- Git operations (commit, status, diff) now work correctly in worktree sessions
- Module import issue with store module in build

## [0.52.11] - 2026-01-28


### Added
- Folder @ mentions in AI chat input with delimiter-separated fuzzy matching
- Project-focused File menu items replacing generic Open Folder and Recent Files

### Changed
- Cmd+E and Cmd+K now toggle left panel when already in that mode
- Files-edited sidebar title now reflects session type (Workstream vs Worktree)
- Image generation feature gated behind alpha flag

### Fixed
- Auto-updater spinner no longer gets stuck after clicking "Remind me later"
- Git commit panel sync issues when staging/unstaging files
- Git commit proposal now properly rejects when no files to commit
- Diff highlighting broken after theme changes

## [0.52.10] - 2026-01-27


### Added
- Custom PATH configuration in Advanced Settings for managing shell environment variables

### Changed
- Unified git operations UI for both regular and worktree sessions
- Made PATH detection async to avoid blocking startup
- Gated card view mode behind alpha feature flag
- Made "Enable All Alpha Features" a stored state with migration for existing users

### Fixed
- Improved PATH detection for homebrew and nvm installations
- Treat missing lastKnownVersion as upgrade from <=0.52.10

## [0.52.9] - 2026-01-27


### Added
- Unified cross-mode navigation history for seamless back/forward navigation across files
- Enhanced keyboard shortcuts dialog with tabs and improved formatting
- Unified onboarding flow with developer mode selection
- Developer feature flags for worktrees and terminal

### Changed
- Remove developer section from keyboard shortcuts dialog

### Fixed
- Users with old databases can now start the app without errors
- Make all onboarding fields optional except mode selection
- Use standard --nim-* CSS variables in onboarding screens
- Prevent race condition in navigation history restore
- Make Cmd+Shift+A toggle AI chat panel correctly
- Handle missing history array in navigation state restore
- Restore list bullet and number visibility broken by Tailwind Preflight reset
- Resolve remaining typecheck errors in session files, agent mode, and todo panel
- Fix show archived sessions

## [0.52.7] - 2026-01-26


### Added
- Collapsible todo panel in agent mode sidebar for tracking task progress
- Collapsible left panel toggle for Files and Agent modes
- Terminal integration with theme system for consistent styling

### Fixed
- Fallback to dark theme when configured theme ID is not found
- Correct timezone handling for TIMESTAMPTZ session timestamps
- Keep smart mode when AI proposes commit, show proposal UI inline
- Restore processing state on renderer refresh
- Handle WASM memory errors when restoring terminal scrollback

## [0.52.6] - 2026-01-26


### Added
- Restore session unread state with database persistence
- Developer option to show prompt additions
- Confirmation dialog when archiving worktrees
- Persist user-resized column widths in CSV spreadsheet
- Checkbox file selection in FilesEditedSidebar for Manual/Worktree commit modes
- Slow query diagnostics to PGLite database layer
- Dialog for untracked files conflict during worktree rebase

### Changed
- Replace xterm.js with ghostty-web for terminal emulation
- Improve archive button labels in session history

### Fixed
- Restore visibility of ChatSidebar New button
- Clicking on a session under a worktree/workstream now behaves consistently
- Prevent text wrapping in session history new menu
- Scope git commit proposals to workstream instead of workspace
- Improve checkbox selection and auto-clear committed files in GitOperationsPanel
- Apply theme colors to file tree resize handle
- Reduce vertical padding in AI input panel
- Populate GitOperationsPanel commit message from MCP git_commit_proposal
- Ensure state persistence handles missing fields from old data
- Correct disabled state styling for Generate button in image-generation
- Use correct theme variables and Tailwind classes in image-generation lightbox
- Image generation lightbox uses correct theme colors and closes on Escape
- Optimize smart commit prompt to reduce unnecessary analysis
- Show ModelSelector for sessions without model and process mobile prompts
- Strip whitespace padding from terminal scrollback restoration
- Process queued prompts when user cancels AskUserQuestion
- Aggregate session status for worktrees/workstreams in card view
- Archived sessions disappear immediately from agent sessions panel
- Correct text color classes in dark mode

### Refactored
- Complete Tailwind migration across all packages

## [0.52.5] - 2026-01-25


### Added
- Show AI errors in transcript instead of silent failures
- Add refresh button to worktree tab in git operations panel
- Enable auto-restart for dev server via loop mode
- Add context menu support to session history card view
- Enable worktree rebase with uncommitted changes via auto-stashing
- Migrate to Tailwind CSS with unified theming system

### Changed
- Session names now reflect user's request, not agent's solution
- ChatSidebar now uses user's default model for new sessions
- Model switching, persistence, and defaults improved for AI sessions

### Fixed
- Remove redundant type comparison in extractModelForProvider
- Correct CSS typo in SessionHistory.css
- Restore card view toggle and styling for session history
- Correct Tailwind CSS for worktree view and restore card view toggle
- Display (1M) suffix for extended context Claude Code models
- Use ModelIdentifier as single source of truth for default models
- Resolve TypeScript strict mode errors across codebase

### Refactored
- Migrate extensions to unified --nim-* CSS variables
- Migrate components from inline styles to Tailwind CSS
- Remove unused CSS import from ChatSidebar

## [0.52.4] - 2026-01-25


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Fixed AI provider field not syncing when model ID contains provider prefix

### Removed
- Removed deprecated DiffMode and WorktreeMode components

## [0.52.3] - 2026-01-25


### Added
- Right-click context menu for workstreams
- Allow adding new sessions to existing worktrees

### Removed
- Alternative Claude Code provider (alpha feature reverted)

## [0.52.2] - 2026-01-24


### Added
- Card view display mode for session history
- Real-time worktree display name sync across UI
- Dynamic alpha feature registry system
- Alternative Claude Code provider support (alpha)
- Worktree terminal button and improved terminal switching

### Fixed
- Pasted text starting with '#' no longer incorrectly activates memory mode
- Alpha feature settings now persist across sessions
- New Worktree button now enabled in agent mode for git repos
- Enter key no longer sends message during IME composition

## [0.52.1] - 2026-01-23


### Added
- Update session uncommitted badges on git commit

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Prevent state bleeding between concurrent AI sessions
- Skip unnecessary database lookups for non-worktree paths

### Removed
<!-- Removed features go here -->

## [0.52.0] - 2026-01-23


### Added
- Terminal bottom panel with dedicated storage for terminal sessions
- Full commit details display in git commit widget (expanded commit info)
- Auto-reconnect sync when network becomes available
- Auto-approve pending reviews on git commit
- Show uncommitted files count on workstream session items
- Inline session renaming with improved session state management
- Track Bash command file edits in session files and local history
- File status colors in git commit widget
- Prompt history quick-open dialog
- Comprehensive log access tools for AI agents
- Interactive git commit proposals with directory tree file picker
- Session status indicators to quick open dialog
- AI sessions now organize into workstreams for multi-file work
- Image generation extension with Google Imagen API
- Agent mode sessions now manage their own document context
- Agent mode sessions now have embedded editor tabs
- Custom editors can register menu items in header bar

### Changed
- Git status now uses event-driven updates instead of polling
- Simplified normalizeWorkspaceState with deepMerge pattern
- Improved session list icon system and alignment
- Files Edited sidebar now shows only edited files
- Deprecated React state-based AI session components removed
- Extension get_logs disabled in favor of file-based log tools
- Performance monitoring interval increased from 5 seconds to 10 seconds
- Reduced verbose dev console logging

### Fixed
- Persist workstream selection and child sessions across reload
- Chat button now opens sessions in Files mode instead of Agent mode
- TypeScript configuration excludes collabv3 and electron/release from root
- Restore prompt history navigation with up/down arrows
- Voice commands now execute when AI is idle
- Workstream headers now highlight when child session is active
- Slash command typeahead no longer shows duplicate menus
- Keyboard shortcuts now route to focused component in agent mode
- Session timestamps now display correctly in workstream list
- Queued prompts now auto-execute when AI finishes responding
- Workstream child sessions show timestamps and affect sort order
- Render single typeahead menu element to prevent duplicates
- Workstream session selection and new session content bugs
- Workstream child sessions appear and update immediately
- Inherit session name when converting to workstream
- Unify session state into single registry to fix sync bugs
- Route git commit requests to active session instead of workstream
- Prevent duplicate typeahead menu rendering during position calculation
- TypeScript compilation errors resolved
- Route CMD+F to focused component in agent workstream panel
- Wire up compact button to send /compact command
- Prevent AgentWorkstreamPanel rerenders on message updates
- Prevent ChatSidebar from creating duplicate sessions on mount
- Correct indentation for files inside folders in git commit widget
- Parse array-format tool results in git commit widget
- Restore AI session processing indicators and optimize transcript rendering
- Persist MCP tool calls so git commit widget shows correct state after HMR
- Git commit widget correctly shows success/cancelled state after HMR
- Remove stale session processing state initialization
- Sessions no longer incorrectly show as running after errors
- Files Edited sidebar now shows Keep All for pending changes
- Shrink agent session header and improve dark mode icon visibility
- iPad split view session list no longer overlaps status bar

### Removed
<!-- Removed features go here -->

## [0.51.24] - 2026-01-22


### Added
- Custom Bash tool widget for terminal-style display
- MCP tool search for Claude Code sessions
- Visual feedback for attachment processing
- Timing instrumentation to diagnose Windows hang issues
- PowerShell script for Windows development (crystal-run.ps1)

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Infinite render loop and UI freeze in DiffMode on Windows
- Windows backslashes in Files sidebar filename display
- Path module usage for cross-platform workspace detection
- Worktree session button disabled in non-git workspaces
- MCP config migration incorrectly restoring deleted servers
- TypeScript errors in CI checks

### Removed
<!-- Removed features go here -->

## [0.51.23] - 2026-01-21


### Added
- Send-time image compression for Claude API 5MB limit
- Proprietary license file
- Blockmap files included in public releases

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Shell detection and error handling in TerminalSessionManager
- Packaged app crashes when processing HEIC images
- ModelSelector dropdown closing when clicking help tooltips
- /context parsing for Claude Agent SDK 0.2.x
- TypeScript errors in ImageCompressor

### Removed
<!-- Removed features go here -->

## [0.51.22] - 2026-01-21


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- macOS build signing now uses correct target architecture for ripgrep
- macOS CI builds now properly import certificates on both Apple Silicon and Intel runners
- macOS artifacts maintain backwards compatibility with arm64 naming convention

### Removed
<!-- Removed features go here -->

## [0.51.21] - 2026-01-21


### Added
<!-- New features go here -->

### Changed
- macOS artifacts now use user-friendly architecture names (Apple Silicon, Intel)
- Updated Claude Agent SDK to 0.2.14

### Fixed
- ClaudeCodeProvider now properly cleans up resources on destroy
- Home directory resolution now uses os.homedir() for reliability
- Chat image attachments now automatically compressed for better performance

### Removed
<!-- Removed features go here -->

## [0.51.20] - 2026-01-21


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Claude Code login flow now uses interactive /login instead of setup-token
- Linux node-pty packaging fixed by moving to extraResources
- Session creation error handling and provider validation improved

### Removed
<!-- Removed features go here -->

## [0.51.19] - 2026-01-20


### Added
- Session branching for AI conversations
- Worktree rename functionality to agentic coding UI
- HTTP headers support and workspace MCP server detection
- HTTP header support for MCP server configuration
- Commands to open files and workspaces in new windows
- Mobile voice mode with synced settings from desktop
- Mobile voice mode UI and capture services
- Mobile voice mode receives OpenAI API key from desktop
- Smarter notification suppression for both desktop and mobile

### Changed
- MCP config migration and file watching
- Bundled mcp-remote as dependency instead of downloading via npx
- Agent mode state now uses Jotai atoms instead of prop drilling
- Window mode and settings navigation state moved to Jotai atoms
- Settings panels now self-contained with Jotai atoms
- Tab editor content state refactored to avoid redundancy

### Fixed
- Provider fallback logic in session creation
- LM Studio configuration storage and error handling
- Session naming tool can only be called once
- MCP server OAuth detection for HTTP servers with API key auth
- New worktrees now default to the last used model
- Workspace MCP server deletion by syncing both config locations
- MCP config file watcher robustness and error handling
- MCP analytics event naming and tracking
- OAuth status warning icons to MCP server list
- Visual indicator for project-specific MCP servers in global settings
- Agent now sees why tool calls are denied in planning mode
- Skip sync when server connection fails instead of full resync
- OOM crashes during session sync with large histories prevented
- Mobile session list now updates turn counts in real-time
- Mobile push notifications now show session name as title
- Mobile session creation works after app sits idle
- Microphone permission only prompts when enabling voice mode

### Removed
<!-- Removed features go here -->

## [0.51.10] - 2026-01-16


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Windows Claude auth now uses 'login' command instead of deprecated 'setup-token'

### Removed
<!-- Removed features go here -->

## [0.51.9] - 2026-01-16


### Added
- SQLite extension as custom editor with query history and AI tools
- Export markdown documents as PDF
- Extension panels system with SQLite browser demo
- Voice commands show countdown before submitting to agent
- Voice mode live transcription streaming and token usage tracking
- AI-generated project summary for voice mode context
- AI chat panel receives context from extension panels
- Manual pairing for devices that can't scan QR codes
- Error bar support to visual display widget
- Mobile push notifications for agent completion
- Clearer mobile sync setup with encryption explanation
- Faster AI session search with GIN index
- Comprehensive Node.js version manager support for PATH detection (nvm, fnm, asdf, volta, n, nodenv, mise)
- Enhanced font smoothing for Monaco code editor

### Changed
- Updated Claude Agent SDK to 0.2.7 for MCP tool search
- Diff tree grouping setting persists per project

### Fixed
- Packaged builds no longer crash with 'process is not defined'
- Prevent database corruption when restarting from Extension Dev panel
- Voice agent now passes user requests verbatim to coding agent
- Fullscreen shortcut no longer conflicts with Find on Windows
- Voice commands no longer create duplicate queued prompts
- iOS simulator builds without Rosetta on Apple Silicon
- Normalized file tree row heights and simplified indentation
- Reduced excessive indentation in grouped file-edits sidebar
- iPad AI input safe area

### Removed
<!-- Removed features go here -->

## [0.51.5] - 2026-01-14


### Added
- Pre-flight conflict detection for worktree rebases
- Claude Code Sonnet 1M context variant support

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
<!-- Bug fixes go here -->

### Removed
<!-- Removed features go here -->

## [0.51.4] - 2026-01-14


### Added
- Archive worktree dialog after successful merge
- Automatic terminal process cleanup when archiving worktrees
- Worktree merge workflow now offers archive option
- Pinned sessions appear at top of session list
- Worktree system prompt instructions to keep agent in worktree context

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- `/context` command now works correctly in worktrees
- Terminal no longer gets cut off at the bottom
- Merge conflict detection and resolution with Claude Agent for worktrees

### Removed
<!-- Removed features go here -->

## [0.51.3] - 2026-01-14


### Added
- Commit squashing feature to git worktree DiffMode
- Auto-stash functionality for merge operations
- Fast-forward merges for git worktrees
- Improved collapsed right panel UI in worktree mode

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- TypeScript compilation errors

### Removed
<!-- Removed features go here -->

## [0.51.2] - 2026-01-13


### Added
- Maximize button to worktree files mode

### Changed
- Folder nesting in diff screen now more IntelliJ-like
- Strengthen wording around session naming tool call to ensure it's called before ending turn

### Fixed
- Terminal spawn failing in packaged app (posix_spawnp failed)
- Session history now uses worktree creation time for 'created' sort

### Removed
<!-- Removed features go here -->

## [0.51.1] - 2026-01-13


### Added
- Git worktree integration for isolated AI coding sessions (alpha)
- Worktree archiving with background cleanup queue
- Multiple sessions per worktree support
- Terminal session support for git worktrees
- Session and worktree pinning in agent view
- File mode layout for worktree sessions
- Git rebase support for worktree branches
- Worktree permission inheritance
- Inline rename for sessions and terminals
- Claude Code plugin marketplace GUI (alpha)
- Walkthrough guide system for feature discovery
- Voice mode settings UI with reactive state management
- Voice agent tools and system prompt customization
- PostHog analytics for voice mode, mobile app, and AI message queuing
- Diff tree grouping preference persists per project
- Directory grouping in file edits panels
- Error detection and analytics for database initialization failures

### Changed
- Worktree mode changed from per-session to per-worktree
- Worktree comparisons now relative to repo root branch
- Expanded worktree name pool to 16,384 combinations
- Softer database recovery dialog messaging
- MCP server manual add option moved to top of templates
- Removed broken GitLab and Slack MCP servers

### Fixed
- Prevent crash when archive API unavailable during hot reload
- Voice transcription display now visible and no longer duplicates text
- Diff viewer text no longer overlaps on long lines
- Mobile back button now returns to session list instead of projects
- Prevent incorrect "behind base" indicator after worktree merge
- Use stored base branch for worktree git comparisons
- Restore terminal working directory in worktree sessions
- Resizable chat panel in file view
- Improved worktree file opening robustness and error handling

### Removed
<!-- Removed features go here -->

## [0.51.0] - 2026-01-12


### Added
<!-- New features go here -->

### Changed
- Updated extension release channel restrictions

### Fixed
<!-- Bug fixes go here -->

### Removed
<!-- Removed features go here -->

## [0.50.31] - 2026-01-12


### Added
- Clicking breadcrumb folders navigates to them in file tree

### Changed
- Pre-bundle Lexical and other deps to reduce Vite reloads during development

### Fixed
- DataModelLM files no longer show dirty state immediately on open
- Markdown files no longer show dirty state immediately on open
- Agent transcript diffs now show full context lines
- Editors now correctly save dirty content on tab close and window close

### Removed
<!-- Removed features go here -->

## [0.50.30] - 2026-01-12


### Added
- Load Claude CLI plugins into Agent SDK provider for extended functionality

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
<!-- Bug fixes go here -->

### Removed
<!-- Removed features go here -->

## [0.50.29] - 2026-01-11


### Added
- PostHog analytics for voice mode usage

### Changed
- Disabled Excalidraw relayout tool due to poor layout performance

### Fixed
- Mockup editor now shows updated content after accepting diff
- CSV deleted rows now properly disappear after accepting diff
- Resolved TypeScript errors in voice mode and MaterialSymbol

### Removed
<!-- Removed features go here -->

## [0.50.28] - 2026-01-11


### Added
- Voice control for coding agent via OpenAI Realtime API
- Mobile now shows AI session context usage
- Excalidraw diagrams create faster with batch tools

### Changed
- Lazy-initialize electron-store for custom user-data-dir support

### Fixed
- Excalidraw dark mode flash on load
- Suppress Claude Agent SDK stream error dialog on session abort
- Eliminate dynamic import to prevent electron-log duplication
- Prevent duplicate IPC handler crashes on startup
- Session back button returns to correct project on mobile
- Question prompts remain accessible on mobile
- Mobile session creation now uses correct project

### Removed
<!-- Removed features go here -->

## [0.50.27] - 2026-01-10


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- CSV files no longer save trailing empty columns
- AI session lookups work across multiple windows
- Built-in extensions now load in E2E tests

### Removed
<!-- Removed features go here -->

## [0.50.26] - 2026-01-09


### Changed
- Image and chart display MCP tool moved from alpha to general availability
- Consolidated visual display functionality into unified display_to_user tool

### Fixed
- Improved error handling and validation messages for display_to_user tool
- Resolved path shadowing in display_to_user MCP tool
- Fixed validateDOMNesting warning by replacing nested button with span in VisualDisplayWidget
- Improved single image display in VisualDisplayWidget

## [0.50.25] - 2026-01-09


### Added
<!-- New features go here -->

### Changed
- Fixed all high and moderate npm audit vulnerabilities

### Fixed
- Packaged build works with Vite code splitting
- Session naming tool uses correct MCP server prefix
- Playwright tests work with dev server, screenshot tool finds correct editor
- CSV select-all now selects only data columns, range delete works
- CSV spreadsheet extension passes CI typecheck

### Removed
<!-- Removed features go here -->

## [0.50.24] - 2026-01-09


### Added
- Unified header bar for all editor types with breadcrumb navigation
- Document type management for markdown files with submenu options
- Mobile app now has dedicated project selection screen
- Database Browser now handles large datasets smoothly
- Claude can now detect when running against packaged build
- Docker dev container support for E2E testing

### Changed
- Upgraded claude-agent-sdk to 0.2.2

### Fixed
- Excalidraw no longer saves on tab switch
- Typing in AI input no longer causes lag from SessionHistory re-renders
- DatamodelLM extension passes CI typecheck
- Toggle Debug Tree menu item now works in header bar
- Context usage display now shows correct /context data
- Set Document Type submenu now visible in header bar menu
- File tree auto-scroll now works when switching tabs
- Consecutive AI edits now correctly update diff mode
- Incorrect clickable links in agent transcript tool arguments
- npm run dev -- user-data-dir=<dir> now works correctly

### Removed
<!-- Removed features go here -->

## [0.50.23] - 2026-01-08


### Added
- Excalidraw extension for AI-driven diagram editing with colors and viewport persistence
- CSV spreadsheet cell-level diff highlighting for AI edits
- CSV spreadsheet Cmd+A select-all and auto-expand on paste
- CSV spreadsheet Tab key navigation while editing
- Excalidraw layout tools and improved arrow binding
- Feedback survey dark mode support

### Changed
- Improved state management with Jotai to eliminate unnecessary re-renders

### Fixed
- Auto-updater no longer flickers when starting download
- Diff approval bar now appears for markdown, Monaco, and mockup files
- Cmd+Y no longer opens document history when in agent mode
- Claude Code now sees file-scoped extension tools
- Sync connections no longer fail silently when limit reached
- AI Usage Report graph now shows Claude Code token usage
- CSV spreadsheet row operations now persist across re-renders
- Agent now uses correct screenshot tool for all editors
- CSV spreadsheet now preserves empty rows in the middle of data
- CSV spreadsheet no longer adds metadata comment to plain CSV files
- CSV spreadsheet Delete key now clears selected range
- Session cancel now requires sessionId, preventing silent failures
- TypeScript compiles cleanly with zero errors

### Removed
<!-- Removed features go here -->

## [0.50.22] - 2026-01-08


### Added
- Added clickable file paths to agent transcript UI
- Added display_chart MCP tool for inline chart visualization

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Fixed OAuth EADDRINUSE error with stale lock file cleanup

### Removed
<!-- Removed features go here -->

## [0.50.21] - 2026-01-07


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- MCP server environment variable expansion now works correctly
- MCP server argument quoting fixed on Windows

### Removed
- Removed unofficial MCP servers from templates
- Updated deprecated MCP server configurations

## [0.50.20] - 2026-01-07


### Added
<!-- New features go here -->

### Changed
- Improved MCP OAuth error messages for missing commands

### Fixed
<!-- Bug fixes go here -->

### Removed
<!-- Removed features go here -->

## [0.50.19] - 2026-01-07


### Added
<!-- New features go here -->

### Changed
- Replaced node-pty fork with official package for Windows compatibility

### Fixed
- MCP server command resolution on Windows
- MCP server installation on Windows and improved cross-platform PATH resolution
- Document scanner now continues scanning tracker files beyond limit
- Tracker metadata refresh for agent-edited files

### Removed
<!-- Removed features go here -->

## [0.50.18] - 2026-01-06


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- File tree truncation causing folders to disappear

### Removed
<!-- Removed features go here -->

## [0.50.16] - 2026-01-05


### Added
- PostHog analytics tracking for permissions system interactions

### Changed
- Developer tools now include all one-time modals for testing

### Fixed
- Permissions modal UX improvements to prevent race conditions
- Users can no longer click outside permissions modal to dismiss it
- Permissions modal messaging made less intimidating

## [0.50.15] - 2026-01-05

### Fixed
- AI diffs now show only new changes after approving with Keep All

## [0.50.14] - 2026-01-05


### Added
- Context menu to convert text attachments back to prompt text

### Changed
- Diff colors now use CSS variables for dark mode support

### Fixed
- Mermaid diagram changes now show in diff mode
- Extension manifest/output mismatches caught at build time
- iOS-dev extension builds without tsconfig warning
- Table action menu now positions correctly when document is scrolled
- PDF viewer now loads in packaged builds

### Removed
<!-- Removed features go here -->

## [0.50.13] - 2026-01-05


### Added
- PDF extension build support for crystal-run

### Changed
- More efficient Nimbalyst build in worktrees

### Fixed
- PDF viewer now outputs ES module with .mjs extension

### Removed
<!-- Removed features go here -->

## [0.50.12] - 2026-01-04


### Added
<!-- New features go here -->

### Changed
- Extension SDK now exports complete EditorHost types

### Fixed
- Cmd+F in files mode now opens editor find instead of transcript find
- AI chat in files mode now knows which document is open
- Theme changes now apply to all open editors
- Locally queued AI prompts now execute instead of sitting idle
- Duplicate prompt queue submissions no longer possible
- Removed outdated authentication error string matching logic

### Removed
<!-- Removed features go here -->

## [0.50.11] - 2026-01-03


### Added
<!-- New features go here -->

### Changed
- Simplified diff header UI

### Fixed
- CSV and other custom editors no longer re-render on autosave
- Diff mode table widths now display correctly in Lexical editor
- CSV spreadsheet delete now correctly clears cells
- AI session search now works correctly
- Session state changes no longer trigger unnecessary App re-renders
- CSV spreadsheet now saves edits when tab is closed
- File tree updates and dirty state no longer trigger editor re-renders
- Custom editors now interactive on session restore
- PDF and DataModelLM extension styles now load correctly after Vite 7 upgrade

### Removed
<!-- Removed features go here -->

## [0.50.10] - 2026-01-03


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Fixed OpenAI model import mismatch causing connection errors

### Removed
<!-- Removed features go here -->

## [0.50.9] - 2026-01-02


### Added
- Inline session rename functionality
- PostHog tracking for terminal usage
- PostHog tracking for MCP configuration

### Changed
- Improved MCP logo appearance in light/dark modes
- Moved 'test' button outside hidden section in MCP templates

### Fixed
- Connection tested state not resetting
- AWS logo in MCP templates
- Many MCP server configuration issues
- PATH handling for MCP servers
- Playwright MCP configuration
- Doubled up login widgets display issue
- Claude Code login button not showing

### Removed
<!-- Removed features go here -->

## [0.50.8] - 2026-01-02


### Added
<!-- New features go here -->

### Changed
- Added guidance for users to start a new session when using chat models

### Fixed
- Fixed broken build in PDF viewer package
- Added module description to PDF viewer package for better clarity

### Removed
<!-- Removed features go here -->

## [0.50.7] - 2026-01-02


### Added
- 17 new MCP server templates with brand icons
- Brand icons for MCP server templates replacing text fallbacks

### Changed
- Terminal history initialization refactored to use shell bootstrap files
- Terminal initialization commands now filtered from output
- Terminal sessions now respect light/dark theme

### Fixed
<!-- Bug fixes go here -->

### Removed
<!-- Removed features go here -->

## [0.50.6] - 2026-01-02


### Added
- PostHog MCP server slash command for analytics queries
- OAuth authorization support for MCP remote servers
- On/off toggle for MCP servers
- Template selection flow for MCP server configuration
- PostHog template with improved connection testing
- Terminal session support in agent mode (Alpha)
- Terminal scrollback and command history persistence

### Changed
- Redesigned MCP servers configuration UI with template selection flow
- Document changes in PostHog events list

### Fixed
- Mockup screen no longer goes white on accept for new files
- Mockup diff slider hidden on new files
- API keys no longer logged in console

### Removed
<!-- Removed features go here -->

## [0.50.5] - 2026-01-01


### Added
<!-- New features go here -->

### Changed
- Split CLAUDE.md into per-package documentation

### Fixed
- Editor screenshots now work for CSV and custom extension editors
- CSV spreadsheet styles now load correctly after Vite 7 upgrade
- Screenshot tools return proper errors instead of crashing sessions
- Enter key now sends messages containing @ or / characters
- Diff header buttons now visible in narrow panels

### Removed
<!-- Removed features go here -->

## [0.50.3] - 2025-12-31

### Added
- Mobile can cancel running sessions and answer questions via sync
- Mobile AskUserQuestion prompts can now be cancelled
- Extension dev menu shows process uptime
- CSV cells save on click-away like Google Sheets
- Extension errors now visible with detailed diagnostics
- iOS development tools extension

### Fixed
- Encrypt project_id in mobile sync for privacy
- Markdown view mode switch no longer crashes on diff header
- CSV spreadsheet keyboard focus preserved after cell edits
- Mobile sync commands now fail if encryption unavailable
- CSV requires alpha release channel
- Extension AI tools now return useful data instead of failing
- PDF viewer no longer freezes in infinite loading loop
- Opening already-open project focuses existing window instead of creating duplicate
- Validate todos is an array before calling .filter()
- Permissions on internal build

## [0.50.2] - 2025-12-29


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Build extension-sdk before extensions in CI

### Removed
<!-- Removed features go here -->

## [0.50.1] - 2025-12-29


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Extensions now include dist folders in packaged builds

### Removed
<!-- Removed features go here -->

## [0.50.0] - 2025-12-29


### Added
- Monaco diff header now shows change count and navigation arrows
- AI edits show pending review status with session links in file gutter
- Mobile session list now supports pull-to-refresh
- Mobile users can now choose project when creating new session
- Database Browser now runs queries on Cmd+Enter
- AI agents can now query PGLite database via MCP tool

### Changed
- Unified diff approval header across Monaco and Lexical editors

### Fixed
- Queued and mobile-synced messages now appear in transcript
- Extensions now load correctly on Windows
- Sync status icon now shows for newly authenticated users
- Newly created files now show diff mode for AI edits
- Extension SDK Documentation help link only visible to alpha users
- Ctrl+W on Windows now closes tabs instead of the whole window
- Sessions from other workspaces no longer appear in wrong project
- Mobile session list no longer allows horizontal panning
- Mobile keyboard no longer creates large gap below input
- File tree no longer auto-scrolls while browsing folders
- Mobile layout now respects iOS safe area properly
- CSV spreadsheet no longer freezes when dialogs exist elsewhere

## [0.49.14] - 2025-12-27


### Added
- Support wildcard domain patterns and "Allow All Domains" button

### Fixed
- Provider icons now visible in dark mode session picker

## [0.49.13] - 2025-12-27


### Added
- Text attachments now clickable to preview content

### Changed
- Increase AI session message limit from 2000 to 5000

### Fixed
- Queued messages now appear in chat transcript
- MockupViewer now uses EditorHost API for content management
- MonacoCodeEditor fails diff view for source mode
- Custom editors now properly save on close and support source mode
- Thinking dots touch side of panel
- File tree now shows all folders in workspaces with large dependency dirs
- DatamodelLM editor no longer reloads on every user edit
- Extension reload validation now correctly detects components export

## [0.49.12] - 2025-12-26


### Added
- Context limit errors now show helpful widget with compact button
- E2E tests for agent tool permission system

### Changed
- Use Claude Code native settings for tool permissions

### Fixed
- Quoted strings and heredocs no longer trigger compound command detection
- Compound bash commands now require approval for each part
- Trust toast now shows current permission mode when changing settings
- Long Bash commands in permission dialog now scroll vertically
- Bypass-all mode now skips compound command permission checks
- Custom editor file changes no longer clobber user edits
- Permission prompts no longer repeat and show specific patterns
- Agentic panel now scrolls to show sent messages
- Windows forced shutdowns no longer leave database locks

## [0.49.11] - 2025-12-23


### Added
- Beta badge to Smart Permissions option in trust toast

### Changed
- Simplify permission trust model and add Allow All WebFetches option

### Fixed
- Update button label from "Trust Project" to "Save"

## [0.49.10] - 2025-12-23


### Added
- Show dotfiles in file tree when "All Files" filter is selected

### Fixed
- Quick Open now finds all files including dotfiles and images
- Session history spinner now animates during processing
- WebSearch and WebFetch permission "Allow Always" now persists correctly

## [0.49.9] - 2025-12-23


### Changed
- Redesign project trust dialog with clearer permission choices

## [0.49.8] - 2025-12-23


### Added
- CSV spreadsheet supports clicking row/column headers to select entire rows/columns
- MCP tools for AI agents to debug extensions

### Fixed
- CSV row header selection now correctly handles header rows
- AI edits no longer trigger false autosaves in diff mode
- CSV spreadsheet no longer types characters when Cmd+key is pressed
- /compact command no longer shows false "no output" error
- CSV spreadsheet cell editing now uses dark background in dark mode
- OS notifications now show agent's final summary instead of first message
- Allow All mode now bypasses URL permission prompts
- CSV spreadsheet dark mode cell borders now visible and selection highlights correctly
- CSV spreadsheet sorting now excludes empty rows and works from column headers
- Workspaces now restore correctly after dev mode restart

## [0.49.7] - 2025-12-22


### Added
- Extension dev mode indicator with restart button
- New session button tooltip now shows Cmd+N shortcut
- QuickOpen now searches all text file types

### Changed
- Remove obsolete permission mode setting from global settings

### Fixed
- URL permissions now persist correctly across AI sessions
- Cmd+N now reliably triggers correct action based on current mode

## [0.49.6] - 2025-12-22


### Added
- Archive toast now shows session name
- Context menu "New File..." now opens full file dialog
- Add /restart command for quick app restart during development

### Changed
- Remove internal clipboard, use system clipboard only

### Fixed
- CSV editor no longer steals keyboard input from dialogs
- Queued messages now send reliably with 5-second fallback
- Auto /context command no longer runs after agent errors
- Typeahead menus no longer auto-select item under cursor on open
- Parallel tool permissions now queue instead of overwriting
- Dismissing trust toast no longer revokes workspace trust
- New File menu item now works when triggered from Agent mode

## [0.49.5] - 2025-12-22


### Changed
- Temporarily disable Windows code signing

## [0.49.4] - 2025-12-22


### Added
- Undo/redo support for CSV spreadsheet editor

### Fixed
- Tabs now reliably reopen when using Cmd+Shift+T
- Resolve DigiCert code signing action reference

## [0.49.3] - 2025-12-22


### Added
- Edit button for queued messages
- Enhanced New File dialog with file type selection and folder picker
- Folder context menu now shows all file type options inline
- Text selection context automatically included in AI prompts

### Changed
- Clarified agent vs chat terminology in UI
- Use DigiCert signing manager to sign Windows builds

### Fixed
- Settings panel content now scrolls properly
- Queued prompts now properly fail instead of silently completing
- Restart tool now preserves session state and works reliably in dev

### Removed
- Removed unused mockupEnabled feature flag

## [0.49.2] - 2025-12-21


### Added
- Agent tool permission system with workspace trust levels
- Add restart_nimbalyst tool to extension dev MCP server
- CSV spreadsheet right-click context menu
- Open file button on edit tool result cards in agent transcript
- Search button in agent mode header for session quick search

### Changed
- Use es-module-shims for extension loading

### Fixed
- Database backups no longer overwrite good data with corrupted/empty backups
- URL patterns and directory permissions now persist across restarts
- File mentions now match files with spaces in names
- Single-line code blocks now render inline in AI chat
- Extensions with minified variable names now load correctly
- Slash command menu arrow keys now navigate in visual order

## [0.49.1] - 2025-12-19


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Mockup images sent to Claude Code are now compressed and lower resolution to work around SDK display bug

### Removed
<!-- Removed features go here -->

## [0.49.0] - 2025-12-19


### Added
- Claude can ask clarifying questions during agentic sessions (AskUserQuestion tool support)
- CSV spreadsheet extension with formula support
- PDF viewer with text selection and fit-to-width zoom
- Extension Developer Kit with MCP tools for hot-reloading extensions
- Cmd+L shortcut to quickly search and open AI sessions
- Extension SDK documentation with examples
- CSV spreadsheet header row toggle with persistent settings
- Copy button for AI responses and user messages in agent transcript
- Visual diff viewer for AI-generated mockup changes
- Optional word wrap for inline code blocks in AI chat

### Changed
- Alpha-only extensions are now hidden from stable channel users
- Extension dev tools now validate manifests before install/reload
- extension_reload now rebuilds before hot-reloading
- Extensions now bundle their own utility libraries

### Fixed
- Increase MCP connection timeout to 20 seconds for slower server startups
- Move extensionsReady state declaration to the top of the App component
- Update @anthropic-ai/claude-agent-sdk to version 0.1.73
- Update @anthropic-ai/claude-agent-sdk to version 0.1.72
- Add Stytch public token configuration for OAuth integration in sync server
- Update CapacitorMlkitBarcodeScanning to version 7.5.0
- CSV spreadsheet extension now loads correctly
- Session quick open now shows all sessions and filters instantly
- Closing AI session now navigates to adjacent tab instead of first tab
- Windows Claude Code installation via npm now detected correctly
- Mockup image viewing when image is on disk instead of returned in tool call
- Code block rendering in AI chat

## [0.48.13] - 2025-12-17


### Fixed
- DataModel extension now loads correctly in production builds

## [0.48.12] - 2025-12-17


### Added
- Mouse back/forward buttons now navigate between tabs
- Analytics tracking for editor and navigation events

### Changed
- Prevent switching between SDK and Agent modes (prevents session corruption)
- Clarification added to developer dropdown
- Reduced logging output

### Fixed
- Images now display correctly in all tabs
- DataModelNode and MockupNode screenshots now work correctly in all tabs
- Windows-only Claude Code checks no longer run on macOS/Linux
- DataModelLM editor now auto-reloads when AI edits .prisma files
- Token counting now works correctly with Claude Agent SDK 0.1.62
- Token counts display correctly for Claude Code sessions
- Resized prompt input box

## [0.48.11] - 2025-12-16


### Added
- DataModelLM can export schemas to SQL, JSON, DBML formats
- Support for model and field descriptions from comments in Prisma parser
- "Learn more" button for slash commands with explanation modal
- Info about nimbalyst-local directory shown before creating

### Changed
- Downgraded @anthropic-ai/claude-agent-sdk to version 0.1.62

### Fixed
- List of edited files in sidebar no longer takes over the screen

## [0.48.10] - 2025-12-16


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Build extensions before packaging in CI
- Manual "Check for Updates" no longer hangs on checking state

### Removed
<!-- Removed features go here -->

## [0.48.9] - 2025-12-16


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Lexical editor crashes in production builds
- Mobile queued prompts now process correctly
- Agent transcript updates immediately when turn completes
- Only add markdown header when creating markdown files

### Removed
<!-- Removed features go here -->

## [0.48.8] - 2025-12-16


### Added
- Extension system: extensions can now provide Claude Code slash commands
- Extension system: extensions can open binary files with custom editors
- Extension settings UI with enable/disable and configuration support
- File context menu now opens files in system default app
- Archive button shows undo toast, archived sessions show unarchive option

### Changed
- Updated to latest version of Anthropic Agent SDK
- Removed 'New Window' option from application menu
- Updated welcome message to recommend opening project root folder

### Fixed
- Tab state corruption preventing files from opening
- Toast notification now appears below tabs
- Slash command suggestions now match transcript content width
- Archive button updates immediately after unarchiving
- Datamodel and mockup screenshots work without files being open
- Bundle built-in extensions in packaged app
- Clarify file type error message
- Search files button tooltip shows correct shortcut (Cmd+O)
- QR pairing button now enabled when using default sync server URL
- Stytch auth handlers now use production sync in production builds
- Production builds no longer use dev sync server from persisted config
- Ensure serverUrl is set before allowing login actions
- Sync server now correctly uses production when selected in dev builds
- Capacitor app icon
- Mockup annotations now sent to AI when using "+ mockup annotations"
- Skip button restored to data collection form, all fields optional

## [0.48.7] - 2025-12-14


### Added
- Large text pastes become attachments to keep transcript clean
- Close and Archive button on agent transcript panel
- Mermaid diagrams now have Redraw button and better error messages
- Auto-updater now uses subtle toast instead of popup window
- Mobile app now allows device to sleep after inactivity
- Easier browser testing for mobile sync

### Fixed
- Pasting text starting with '#' no longer triggers memory mode
- Tracker typeahead no longer triggers on markdown headers
- Closing Project Manager no longer reopens it indefinitely
- DatamodelLM entity headers now readable
- Remove update.html entry from vite config (file was deleted)
- One failing editor tab no longer breaks the entire app
- Custom editors now load correctly after app restart
- New projects now sync to mobile immediately when enabled
- Login widget no longer triggers on normal AI responses
- Login widget no longer re-renders when scrolling old sessions
- Use SDK's first-class auth error detection for login widget
- Mobile session detail layout works correctly on iPhone and iPad
- Skip export compliance prompt on TestFlight uploads
- Update pod paths for Capacitor dependencies

## [0.48.6] - 2025-12-13

### Added
- Auto-updater now uses subtle toast instead of popup window
- Mobile app now allows device to sleep after inactivity
- Easier browser testing for mobile sync

### Fixed
- One failing editor tab no longer breaks the entire app
- Custom editors now load correctly after app restart
- New projects now sync to mobile immediately when enabled
- Login widget no longer triggers on normal AI responses
- Login widget no longer re-renders when scrolling old sessions
- Use SDK's first-class auth error detection for login widget
- Mobile session detail layout works correctly on iPhone and iPad
- Skip export compliance prompt on TestFlight uploads
- Update pod paths for Capacitor dependencies

## [0.48.5] - 2025-12-12

### Added
- Extension system with DatamodelLM as first plugin
- Extensions can add slash commands and custom Lexical nodes
- Extensions can add items to the New File menu
- Extensions can use shared host dependencies like MaterialSymbol
- DatamodelLM view modes and auto-layout
- DatamodelLM now uses Prisma schema format (.prisma files)

### Changed
- Removed 'New Window' option from application menu
- Updated welcome message to recommend opening project root folder

### Fixed
- Mobile app header no longer hidden under notch, input no longer cut off at bottom
- Duplicate messages no longer appear in AI session sync
- Error now shown to user when environment switch fails
- Environment toggle now saves config when Stytch API unavailable
- Stytch auth now defaults to production in dev builds
- Sync server now correctly uses production when selected in dev builds
- Ensure serverUrl is set before allowing login actions
- Search files button tooltip shows correct shortcut (Cmd+O)
- Capacitor app icon

## [0.48.4] - 2025-12-11


### Fixed
- QR pairing button now enabled when using default sync server URL

## [0.48.3] - 2025-12-11


### Fixed
- Stytch auth handlers now use production sync server in production builds

## [0.48.2] - 2025-12-11


### Added
- Window title now shows AI session name when in agent mode
- Settings now auto-save and display scope description for each setting

### Changed
- Updated Claude Agent SDK to version 0.1.65
- Removed dangerous developer menu database features

### Fixed
- Production builds no longer use dev sync server from persisted config
- Plaintext session titles no longer sent during sync (privacy improvement)
- Claude Code allowed tools section now displays properly in settings
- Global MCP servers now work correctly in Claude Agent sessions

## [0.48.1] - 2025-12-11

### Changed
- Added diagnostic logging for PGLite database initialization

### Fixed
- Show clear error message when attempting to open binary files (PDF, PPTX, etc.)

## [0.48.0] - 2025-12-10

### Added
- Production deployment configuration for CollabV3 sync server at sync.nimbalyst.com

### Changed
- Disabled console logs in AIService and ModelRegistry for cleaner output

### Fixed
- Mobile app no longer lags when typing in chat input
- Sync now connects automatically after app restart
- Auto-updater now downloads latest version even if update window sat idle
- Analytics: ai_session_resumed event no longer fires incorrectly on app startup

## [0.47.2] - 2025-12-10


### Added
- Universal Windows installer supporting both x64 and arm64 architectures

### Changed
- Role field now marked as required in data collection form

### Fixed
- Fixed Claude Code logout process on Windows

### Removed
<!-- Removed features go here -->

## [0.47.1] - 2025-12-09


### Added
<!-- New features go here -->

### Changed
- Improved git availability detection with more comprehensive checking
- Updated Claude Agent SDK to version 0.1.62

### Fixed
<!-- Bug fixes go here -->

### Removed
<!-- Removed features go here -->

## [0.47.0] - 2025-12-09


### Added
- Toast notification prompting users to install Claude commands in their workspace
- Folder History dialog to browse and restore deleted files
- AI chat @mention now supports CamelCase search for file matching
- Document links now export as standard markdown and support fuzzy search
- Session list shows relative dates (e.g., "2 hours ago") instead of absolute timestamps
- AI Usage Report now shows token counts for Claude Code sessions
- Multi-select files in file tree

### Changed
- Updated data collection form

### Fixed
- Mockup images now load correctly when reopening documents
- Mockup image syntax now matches actual transformer format
- AI Usage Report no longer resets token counts after each message
- Clicking files in agent mode now properly switches to files mode
- Session list now shows correct user message count
- Claude Code sessions now work in new/existing projects
- New projects no longer auto-open settings screen
- History restore tests now work with diff preview mode
- Git install popup no longer shown if git is not installed

### Removed
<!-- Removed features go here -->

## [0.46.11] - 2025-12-09


### Added
- Warning dialog before quitting with active AI session
- Windows users now see a warning that they need Claude Code installed

### Changed
- Rebranded "Claude Code" to "Claude Agent" in UI

### Fixed
- AI input stays focused when switching modes or tabs
- Slash command menu now shows best matches first
- Project search now shows best matches first
- Mermaid diagram edit mode now displays correctly in dark mode
- Mermaid diagrams no longer intermittently show "[object Object]" error
- @ typeahead menu now positions correctly when scrolled
- Table action menu and dropdown now display correctly in dark mode
- Table context menu and hover buttons now position correctly when scrolled
- Mobile session view no longer requires refresh after JWT expires
- Queued AI messages no longer fire immediately while AI is responding
- QR pairing modal no longer overflows screen in dev mode
- iOS mobile app now decrypts session titles and saves credentials
- Session titles now display correctly on mobile
- Magic link now requires HTTPS redirect URL in production
- Session titles and queued prompts now encrypted end-to-end
- No keychain access prompt when sync is disabled
- Sync server now restricts CORS to allowed origins only
- Mobile credentials now encrypted via iOS Keychain / Android Keystore
- Speculative fix for NIM-118: cannot-open-file-editorregistry-error-prevents-tab-creation

## [0.46.10] - 2025-12-08


### Added
- Added dirty filter indicator to file tree to show unsaved changes

### Changed
- Improved onboarding images for better display on different screen sizes
- General UI polish and refinements to onboarding experience

### Fixed
<!-- Bug fixes go here -->

### Removed
<!-- Removed features go here -->

## [0.46.8] - 2025-12-07


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Fixed onboarding dialog not displaying in production builds

### Removed
<!-- Removed features go here -->

## [0.46.7] - 2025-12-07


### Added
- Git status icons in file tree showing modified/untracked files
- Toggle control to show/hide git status icons in file tree
- Feature walkthrough with onboarding images for new users
- Stytch authentication with Google OAuth and magic link email support
- Server-side token validation for authentication via CollabV3
- Session persistence across app restarts via encrypted safeStorage
- Account & Sync panel (visible to alpha users only)
- PostHog event tracking for Claude Code login/logout
- PostHog tracking for AI messages using built-in Nimbalyst slash commands
- First-launch detection for Claude Code installation status
- simple-git dependency to electron module

### Changed
- Mockup nodes now use standard linked image markdown syntax `[![alt](screenshot.png)](file.mockup.html)` instead of custom syntax
- Updated LINK and IMAGE transformer regexes to not match linked images

### Fixed
- Mobile app now shows "Running" indicator for desktop-initiated AI prompts
- Encrypted tool names and message metadata in sync system (previously exposed as plaintext)

### Security
- Added security review documentation for upcoming audit
- Tool names, attachments metadata, and content length now encrypted in synced messages

## [0.46.6] - 2025-12-05


### Added
<!-- New features go here -->

### Changed
- Reverted node-pty for Windows Claude login due to stability issues

### Fixed
<!-- Bug fixes go here -->

### Removed
<!-- Removed features go here -->

## [0.46.5] - 2025-12-05


### Added
- Virtualized AI transcript for smoother scrolling in long sessions
- Standup changes summary generator (`/mychanges` command) for recent git commits
- Mobile sync testing capability in desktop browser
- Prompts navigation menu for mobile app

### Changed
- Renamed "wireframe" to "mockup" throughout codebase for consistency
- Improved mockup annotations styling
- Removed "Send to AI" button from UI
- Updated `/plan` command to use `/mockup`
- Use cross-env for build script environment variables (Windows compatibility)
- Use node-pty for Windows Claude login

### Fixed
- AI transcript rendering performance improved
- Duplicate thinking indicators no longer appear in AI transcript
- Stale data now cleared when switching sessions on mobile
- npm security vulnerabilities patched

## [0.46.4] - 2025-12-04


### Added
- Cross-device AI session sync between desktop and mobile app
- Mobile messages now trigger AI processing on desktop
- Running/pending status indicators for AI sessions on mobile
- QR code pairing for mobile app sync with E2E encryption
- Device awareness showing connected devices in sync settings
- Sync status button in navigation gutter with visual indicator
- Unified settings view with project-level AI provider overrides
- Database browser developer tool (Developer menu)
- Incremental sync that only syncs changed sessions on startup
- iOS Capacitor project files for mobile builds
- CollabV3 sync system with E2E encryption (replaces Y.js for mobile sync)
- Click to enlarge image attachments in AI chat input
- Close attachment viewer with Escape key
- Mockup nodes now support resizing with size persistence
- Embed mockups as screenshot nodes in documents

### Changed
- Consolidated icons under unified MaterialSymbol system
- Settings now opens as full view instead of modal window
- Session history sorts by last message time instead of last activity
- Removed abandoned v2 collab implementation

### Fixed
- Hidden messages now stay hidden when synced to mobile app
- Mobile session list now matches desktop sort order
- Session title updates now sync to mobile app
- Token usage bar now shows actual usage instead of appearing full
- Lazy-load session tabs to prevent slow startup with many open sessions
- Sync no longer creates duplicate messages or excessive WebSockets
- Mobile-queued prompts no longer duplicate or refire on desktop
- Mobile-queued prompts now show thinking indicator on desktop
- Mockup drawings render correctly on scrolled content
- Mockup Edit button now opens file in tab
- File tree items now have border-radius
- SyncPanel and provider panels display correctly in settings

### Removed
- Abandoned v2 collab implementation (Y.js overuse)

## [0.46.3] - 2025-12-03


### Added
- Slash command suggestions displayed in empty chat sessions
- Mouseover tooltips for slash command suggestions
- (+) button to expand and show all suggested slash commands
- Description text for slash commands in autocomplete
- `/mockup` command for creating mockups
- "Are you sure?" confirmation dialog when starting fresh database
- MockupLM instructions added to system prompt and `/plan` command
- MCP tool for mockupLM with headless render fallback
- Documentation update instructions to `/review-branch` command
- PostHog tracking for slash command suggestion clicks
- PostHog tracking for mockup file creation

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- `/compact` command broken after "prompt too long" error
- Two absolute imports failing in modules
- Command regex to list speckit in autocomplete
- Directory naming: `.nimbalyst-local` corrected to `nimbalyst-local`
- MockupLM annotations now sent to agent when present

### Removed
<!-- Removed features go here -->

## [0.46.2] - 2025-11-26


### Added
- MockupLM-style mockup editor with AI integration
- Recursive scanning for Claude commands and agents (BMAD v4 fix)
- Maximum file scan limit increased from 1,000 to 2,000
- TypeScript files now show distinct TS icon in file tree
- Message timestamps show date when not from today
- AI usage analytics dashboard

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- AI-created files now open automatically from files panel
- Claude Code session imports now show accurate data
- Corrected missing dots in `.nimbalyst-local` directory references

### Removed
<!-- Removed features go here -->

## [0.46.1] - 2025-11-25


### Added
- Model version now displayed in selector for Claude Code
- Prompt caching support for AI responses (reduces API costs and improves response times)

### Changed
- Session timestamps now match sort order for consistent display

### Fixed
- Users migrating from older versions now see all available Claude Code models

### Removed
<!-- Removed features go here -->

## [0.46.0] - 2025-11-24


### Added
- Users can now disable analytics in settings
- Cmd+Shift+T now reopens last closed tab
- Selection of different Claude models (Opus 4.5, Opus 4, Sonnet 4, etc.)
- Remember what model was used when creating a new session

### Changed
- Refactor: consolidate all file opening to single clean API
- Use store.ts app settings instead of localStorage for onboarding screen state
- Update Claude Agent SDK to latest version to support Opus 4.5

### Fixed
- Skip onboarding check in Playwright tests
- Agent file clicks now open in editor mode
- Pinned tabs now protected from bulk close operations
- Restore correct onboarding implementation
- Onboarding dialog no longer appears in every window

## [0.45.43] - 2025-11-24


### Added
- Pasted images now work in other markdown editors (use asset storage system instead of temp files)
- @ mentioned files auto-attach for non-agent models
- Configure models option to model selector dropdown

### Fixed
- Chat attachments no longer pollute project directories (now stored in dedicated assets folder)
- Image attachments now display in transcript
- API errors now display in chat instead of failing silently
- Swap session action button order to match physical layout

## [0.45.42] - 2025-11-23


### Changed
- Commit command now emphasizes impact over implementation in messages

### Fixed
- OpenAI, LMStudio, and Claude API providers now work correctly (responses and tool calls were not being displayed or executed)
- AI diffs from non-Claude-Code providers now persist across app restarts

## [0.45.41] - 2025-11-23


### Added
- Native spell check context menu with correction suggestions, "Learn Spelling", and "Ignore Spelling"

### Changed
- Remove redundant tab activation polling check

### Fixed
- Wait for editor ready before checking pending diffs
- Prevent AI edits going to wrong document on tab switch
- Restore Monaco diff mode on mount for code files (diff view was not displaying for code files)
- Preserve manual edits during diff mode and save on tab close (manual edits were being lost when accepting/rejecting diffs or closing tabs)

### Removed
- Remove sharp dependency (no longer needed)

## [0.45.40] - 2025-11-23


### Added
- Display image thumbnails in agent transcript
- ExitPlanMode confirmation hook for planning mode
- Memory mode to AIInput for Claude Code
- Allow archiving active/selected sessions
- Token usage tracking restored for all AI providers
- Enhance FileGutter with git status and operation icons
- Session archiving system with multi-select support
- Enhanced session dropdown with name, provider icon, and status
- User role question on first startup
- Analytics for branch-review command
- `.nimbalyst-local` directory with color in project root
- Links to changelogs for agent-sdk and claude-code
- Feedback survey button

### Changed
- Update session message count label from "messages" to "turns"
- Remove dueDate field from plans tracker system
- Windows build changed to x64 instead of arm64
- Detect installed packages on the fly instead of saving state
- Add identifying CSS classes to major React components
- Use vite-plugin-monaco-editor to fix CSS 403 errors

### Fixed
- Hide WelcomeModal in Playwright tests
- Update invoke method for session metadata to use correct namespace
- Place implementation checkboxes after plan title, not before
- Pass workspacePath prop to AgentTranscriptPanel for git status
- Generate unique filenames for pasted images
- Send images directly to Claude SDK instead of file paths
- LMStudio messages not appearing in agent transcript
- Add Monaco CSS import to fix 403 errors in dev mode
- Hide FileGutter in agent mode to avoid duplicating sidebar
- Close session tab when archiving
- Prevent tab context menu from going off screen
- Sync session dropdown across agent and files modes
- Update sharp dependencies for cross-platform compatibility
- Remove platform-specific sharp dependency that broke macOS installs
- Windows was using the old icon
- Add cross-platform path handling for Windows compatibility

### Removed
<!-- Removed features go here -->

## [0.45.39] - 2025-11-20


### Added
- MCP server configuration UI for alpha users
- File type support to history dialog
- Export pathResolver utility from utils
- E2E test for file mention typeahead with all file types
- Blue dot indicator for pending diffs
- Track users who have opened from Crystal
- Message displayed when file tree filter has no results
- Support for --workspace and --filter CLI arguments to launch with specific workspace and filter

### Changed
- Improve file mention typeahead display and scrolling
- Improve tracker loading and file mention path handling
- Force TrackerTable reload when data changes
- Maintain running state between queued messages
- Update filter icon to use actual filter icon
- Improve database corruption message
- Remove redundant hamburger menu
- Remove unused WorkspaceHeader function
- Logging cleanup
- Upgrade @modelcontextprotocol/sdk to 1.22.0

### Fixed
- Configure Monaco Editor to use local workers in Electron
- Support URLs with parentheses in markdown links
- Send completion token on error so UI knows agent turn is done
- NIMBALYST_SYSTEM_MESSAGE showing when pressing up arrow
- Wrong path parsing in non-render components
- Queued messages race conditions with auto-context
- CI build failures caused by peer dependency conflicts and missing MCP SDK dependencies

### Removed
<!-- Removed features go here -->

## [0.45.35] - 2025-11-20


### Added
- MCP server configuration UI for alpha users
- File type support to history dialog
- Export pathResolver utility from utils
- E2E test for file mention typeahead with all file types
- Blue dot indicator for pending diffs
- Track users who have opened from Crystal
- Message displayed when file tree filter has no results
- Support for --workspace and --filter CLI arguments to launch with specific workspace and filter

### Changed
- Improve file mention typeahead display and scrolling
- Improve tracker loading and file mention path handling
- Force TrackerTable reload when data changes
- Maintain running state between queued messages
- Update filter icon to use actual filter icon
- Improve database corruption message
- Remove redundant hamburger menu
- Remove unused WorkspaceHeader function
- Logging cleanup

### Fixed
- Configure Monaco Editor to use local workers in Electron
- Support URLs with parentheses in markdown links
- Send completion token on error so UI knows agent turn is done
- NIMBALYST_SYSTEM_MESSAGE showing when pressing up arrow
- Wrong path parsing in non-render components
- Queued messages race conditions with auto-context

### Removed
<!-- Removed features go here -->

## [0.45.34] - 2025-11-19


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Improve session history refresh experience
- Correct function name in session delete handler

### Removed
<!-- Removed features go here -->

## [0.45.33] - 2025-11-19


### Added
- Tab-triggered content search to session history
- E2E test for Monaco diff approval

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Prevent React event from being passed to createNewSession
- Respect sort selection in session history grouping

### Removed
- Unnecessary log statements

## [0.45.32] - 2025-11-19


### Added
- File tree filter for git modified files
- Orange gutter indicator when running in dev mode

### Changed
- Replace orange dev mode background with "TEST MODE" text indicator
- Update review-branch.md to include OS interoperability

### Fixed
- Session history timestamp display and timezone handling
- Monaco diff approval bar now appears for AI edits to code files
- Detect expired Claude Code sessions and show clear error message
- Path bug causing slash commands not to load

### Removed
- Debug logs from MonacoDiffApprovalBar

## [0.45.31] - 2025-11-18


### Added
- Planning mode file restrictions
- Word boundaries in diff context stripping
- Discord link to Help menu
- Read/written file filters to file tree
- Token usage category breakdown to AI chat
- Auto-name sessions via MCP

### Changed
- Refactor: remove AgenticCodingWindow in favor of unified agent mode
- Refactor: add mode field to separate session behavior from origin
- Better display for MCP tool calls
- Keep showing login button even when logged in (prevents OAuth expiry issues)
- Log reduction

### Fixed
- Preserve search box when no sessions match in agent mode
- Update Discord invite URL to correct link
- Monaco diff editor disposal errors
- Session not opening when switching from Files to Agent mode
- Always fetch release notes from R2 for alpha channel
- Remove duplicate Files header in agent sidebar
- Fork AutoLinkPlugin to filter base64 URLs
- Comment out console warnings for depth scanning limits
- Prevent false diffs for hashtags in unchanged content

### Removed
<!-- Removed features go here -->

## [0.45.30] - 2025-11-17


### Added
- Session state tracking for cross-mode visibility
- /bug-report command for interactive bug reports
- Automated /release-public command with cumulative release notes
- Automated public release notes from CHANGELOG
- Release notes fetching from R2 for alpha channel updates

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Add performance limits to workspace manager file scanning
- Prevent app freezing on large workspace directories
- Remove unused Documentation button from Global Settings
- Prevent Monaco diff editor disposal error when closing tabs
- Resolve workspace-relative paths in workspace:open-file handler
- File tree sync and auto-scroll issues
- Prevent editor.registerCommand crash during HMR
- Remove double scrollbars in Monaco markdown mode

### Removed
<!-- Removed features go here -->

## [0.45.29] - 2025-11-17


### Added
- Full-text search to session history
- Floating actions to agent transcript
- Inline diff mode for Monaco code editor
- Markdown syntax highlighting to Monaco editor
- Project-aware file opening from OS
- Natural sorting to file tree
- Release notes to alpha channel updates

### Changed
- Replace markdown mode conversion with view mode toggle

### Fixed
- Disable console logs for context fetching in AIService and TreeMatcher
- Disable error markers in Monaco editor
- Ensure DiffApprovalBar appears after view mode switch
- Handle DMG/ZIP files without version in filename

### Removed
<!-- Removed features go here -->

## [0.45.28] - 2025-11-16


### Added
- Alpha release channel for internal testing
- Image viewer for standalone image files
- File tree filtering with type-specific icons
- Find functionality to agent transcript
- Tracker type assignment UI to document actions menu
- Dual session opening from floating AI sessions dropdown
- Claude Code session import and sync system

### Changed
- Replace dynamic imports with static imports
- Persist file tree filter and icon visibility settings

### Fixed
- Debounce search input to prevent focus steal
- Route search shortcuts through menu system
- Remove quick open name match badge
- Preserve newlines in user messages in transcript
- OptimizedWorkspaceWatcher not sending file-changed-on-disk events
- Monaco editor not updating when file changes on disk
- Improve scrolling behavior for change groups in editor
- Remove overly broad process exit error classification
- FileTree auto-expand and selection clearing
- Claude Code session import message filtering and ordering
- Correct R2 bucket name in workflow

### Removed
<!-- Removed features go here -->

## [0.45.27] - 2025-11-16


### Added
- Alpha release channel for internal testing
- Image viewer for standalone image files
- File tree filtering with type-specific icons
- Find functionality to agent transcript
- Tracker type assignment UI to document actions menu
- Dual session opening from floating AI sessions dropdown
- Claude Code session import and sync system

### Changed
- Replace dynamic imports with static imports
- Persist file tree filter and icon visibility settings

### Fixed
- Debounce search input to prevent focus steal
- Route search shortcuts through menu system
- Remove quick open name match badge
- Preserve newlines in user messages in transcript
- OptimizedWorkspaceWatcher not sending file-changed-on-disk events
- Monaco editor not updating when file changes on disk
- Improve scrolling behavior for change groups in editor
- Remove overly broad process exit error classification
- FileTree auto-expand and selection clearing
- Claude Code session import message filtering and ordering

### Removed
<!-- Removed features go here -->

## [0.45.26] - 2025-11-14


### Added
- Database backup and corruption recovery system
- Folder contents refresh on expansion
- Review-branch slash command

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Built-in slash commands broken by user prompt addendum
- Open document message showing to user
- Message formatting to append current document name instead of prepend
- Local network usage description for Nimbalyst
- Token count and AI chat broken after merge
- Correct context window usage calculation

### Removed
<!-- Removed features go here -->

## [0.45.25] - 2025-11-14


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
<!-- Bug fixes go here -->

### Removed
- Remove phone number detection from analytics

## [0.45.24] - 2025-11-14


### Added
<!-- New features go here -->

### Changed
- Disable sourcemaps in production builds

### Fixed
<!-- Bug fixes go here -->

### Removed
<!-- Removed features go here -->

## [0.45.23] - 2025-11-14


### Added
<!-- New features go here -->

### Changed
- Switch from accept/reject to undo/keep for clarity in diff approval actions
- Use unified diff for guideposts instead of context-aware hashing

### Fixed
<!-- Bug fixes go here -->

### Removed
<!-- Removed features go here -->

## [0.45.22] - 2025-11-13


### Added
- Strip unchanged context from agent transcript diffs for cleaner display

### Changed
- Comment out console logs for cleaner output during file operations
- Logging cleanup in diff operations

### Fixed
- Handle markdown normalization in diff matching
- Fix file watcher stats for Chokidar implementation
- Prepend current document name to ClaudeCode messages in AIChat
- Remove bad stopFileWatcher causing us to lose track of agent changes
- Allow re-scrolling to current diff with navigation arrows
- Separate pure formatting changes from text changes in inline diff
- Handle formatting changes in inline diff

### Removed
- Reverted experimental markdown normalization for diff matching
- Reverted red/green color coding changes
- Reverted automatic diff acceptance behavior
- Reverted hacky window refresh approach

## [0.45.21] - 2025-11-13


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- AI diff view now properly refreshes when toggling diff view on/off
- Disabled automatic acceptance of AI diffs when diff view is turned off, ensuring file content shown matches what's on disk

### Removed
<!-- Removed features go here -->

## [0.45.20] - 2025-11-13


### Added
<!-- New features go here -->

### Changed
- Disabled red/green color coding by default

### Fixed
- Fixed crash: "Error: The 'screen' module can't be used before the app 'ready' event"

### Removed
- Removed "Getting Started with Nimbalyst" screen

## [0.45.18] - 2025-11-12


### Added
- Sub-agent result display in AI chat transcript
- Better visuals for edit/write tools
- Test normalized Lexical-sourced markdown for original content matching

### Changed
- Update Claude Agent SDK to latest version
- Better UX for Claude Code auth settings
- Hide mode-tag button until wired to sessionType

### Fixed
- Add diagnostic logging for AI diff display issues
- Route notifications by workspace path instead of window ID
- Export horizontal rules as --- instead of ***
- Let dev mode locations fire normally (better for testing)
- Improve diff matching with text-based guide posts
- Copy as Markdown menu item now works and preserves newlines correctly
- Dark mode theming for workspace actions and tracker icons
- History dialog diff preview respects dark mode theme
- Scrollbar theming in dark mode on macOS when user has always show scrollbars on

### Removed
<!-- Removed features go here -->

## [0.45.17] - 2025-11-12


### Added
- Improve search/replace bar with live updates and better UX

### Changed
- Hide mode-tag button until wired to sessionType
- Remove unused editorRef from useIPCHandlers

### Fixed
- Export horizontal rules as --- instead of ***
- Let dev mode locations fire normally (better for testing)
- Improve diff matching with text-based guide posts
- Copy as Markdown menu item now works and preserves newlines correctly
- Dark mode theming for workspace actions and tracker icons
- History dialog diff preview respects dark mode theme
- Scrollbar theming in dark mode on macOS when user has always show scrollbars on

### Removed
<!-- Removed features go here -->

## [0.45.16] - 2025-11-11


### Added
- Floating button to show AI sessions for current document
- Sort dropdown to session history panel

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Update session name in history list immediately after rename

### Removed
<!-- Removed features go here -->

## [0.45.15] - 2025-11-11


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Empty lines appearing at wrong positions in diff operations
- Prevent duplicate snapshot creation and history dialog selection bugs
- Remove debug logging that leaked document contents
- Generate tagIds for incremental-approval tags and update pendingAIEditTagRef
- Incremental diff baseline tracking for subsequent AI edits
- Prevent accepted changes from reappearing in subsequent AI edits

### Removed
<!-- Removed features go here -->

## [0.45.14] - 2025-11-10


### Added
- Dispatch CLEAR_DIFF_TAG_COMMAND in additional edge cases
- incremental-approval support to history dialog
- E2E test for Accept All edge case and metadata parsing
- E2E test for reject-then-accept-all diff behavior

### Changed
- Updated AI input placeholder text to 'Ask a question. @ for files. / for commands'
- Improved no file opened screen design
- Updated empty AI sidebar text

### Fixed
- Infinite autosave loop after editing files
- Dev mode location analytics now fire normally (better for testing)
- Prevent flashing reloads during tab switches in diff mode
- Keyboard shortcuts now reliably target focused window
- Preserve incremental diff state across file close/reopen

### Removed
<!-- Removed features go here -->

## [0.45.13] - 2025-11-10


### Added
- Git status indicators to FileEditsSidebar
- PostHog events for tracking tab usage
- is_dev_user property sent on all non-release builds with setOnce

### Changed
- Extract FileEditsSidebar inline styles to CSS

### Fixed
- Incremental diff accept/reject now properly clears pre-edit tag

### Removed
<!-- Removed features go here -->

## [0.45.12] - 2025-11-10


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- SQL parameter placeholder in mark session as read
- Incremental diff accept/reject now clears pre-edit tag
- OS notifications not appearing in development mode
- Detection of tool packages installation

### Performance
- Optimized AI chat input rendering in long sessions by splitting transcript and input components

### Removed
<!-- Removed features go here -->

## [0.45.11] - 2025-11-09


### Changed
- Claude Code enabled by default for new installations
- Improved login widget UX with better post-login experience
- Enhanced error handling to avoid showing duplicate login messages

### Fixed
- Don't show model config screen on fresh install
- Better logic around showing duplicate login messages
- Don't show error in addition to login widget

## [0.45.9] - 2025-11-09


### Added
- AI prompt queueing system for managing multiple AI requests
- Tool packages system with version tracking for Claude Code
- Typeahead search with keyboard navigation to workspace manager
- Display project-relative paths in agent transcript

### Changed
- Tightened agentic panel UI spacing and improved CSS variable usage
- Made entire folder row clickable to expand/collapse in file tree

### Fixed
- Cmd+Alt+Left tab navigation event name mismatch
- TrackerTable now responds to filterType prop changes
- Pass attachments to AI provider and prevent typeahead conflicts
- Eliminated unnecessary session list reloads and race conditions
- Fixed tab keyboard arrow navigation
- Prevented double-loading of diff editor on file open

### Removed
<!-- Removed features go here -->

## [0.45.8] - 2025-11-08


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Resolve peer dependency conflicts by hoisting ajv and terser

### Removed
<!-- Removed features go here -->

## [0.45.7] - 2025-11-08


### Added
- Working simple todo display

### Changed
- Upgraded vite-plugin-static-copy to 3.1.4 to fix chokidar dependencies
- Upgraded npm to 11.x in CI to fix optional dependencies bug

### Fixed
- Prevent infinite loop in tab activation during diff application
- Add zod dependency and externalize MCP SDK to fix dev mode build
- Improved test reliability and fixed race conditions

### Removed

## [0.45.6] - 2025-11-07


### Added
- /implement command for plan execution and progress tracking

### Changed
- Upgraded Claude Agent SDK to latest version

### Fixed
- Terminal icon no longer shows for every Claude Code interaction
- Analytics now only recorded on official release builds (not development builds)
- Check login status now works correctly in packaged DMG
- History dialog restore button now properly enables when showing diffs
- Claude installation assumed available on Win32 platform

## [0.45.5] - 2025-11-07


### Added
- Settings menu item for non-darwin platforms (File > Settings...)
- E2E test for partial diff acceptance with rejections

### Changed
- Integrated ThresholdedOrderPreservingTree (TOPT) algorithm for order-preserving diffs
- Improved TOPT matching for nested list structures
- Use hybrid content-first matching for list item diffs
- Reorganized and cleaned up DiffPlugin tests
- Use electron-node for Claude Code login/logout operations

### Fixed
- External links now open in default browser instead of in-app
- Reverted bad optimization for local changes that caused full document diff regressions
- History dialog diff navigation now syncs with clicked diff groups
- TOPT now forces exact text matches to prevent false alignments
- Prevent unnecessary processing of children when content is unchanged
- AI edit tag now clears properly after incremental diff operations
- Console.log statements removed from diff utilities and various components
- Electron-node authentication for Claude Code login/logout

### Removed
<!-- Removed features go here -->

## [0.45.4] - 2025-11-05


### Added
- TreeViewPlugin now displays diff state information for debugging

### Changed
- Markdown import/export preserves newlines and spacing more consistently
- LiveNodeKeyState setup is now automated in diff operations
- Reduced debug logging noise in DiffPlugin, SlashCommandService, and markdown import

### Fixed
- History dialog diff preview now displays changes correctly
- Multi-section diff operations no longer create extra blank lines
- Claude Code login/logout workflow improved
- Window close behavior on macOS (removed darwin-specific check)

## [0.45.3] - 2025-11-04


### Added
- Unified diff navigation for document history dialog
- Token usage display for Claude Code AI sessions
- Sound and OS notifications enabled by default for new users
- Login required widget for Claude Code authentication
- E2E tests for AI multi-round editing

### Changed
- Improved Claude Code login widget appearance
- Claude Code now uses SDK-only authentication

### Fixed
- File watchers now stay active for all open tabs (no longer stop when switching tabs)
- Cmd+N new file dialog now opens correctly in files mode
- Unhandled promise rejection in Claude Code login check
- AI diff approval system for consecutive edits
- Adjacent diff changes now group correctly
- Cache read tokens excluded from cumulative usage display
- Session history no longer refreshes on input, improved status indicators
- Title bar overlay error handling
- Multiple debug console log noise issues

### Removed
<!-- Removed features go here -->

## [0.45.2] - 2025-11-03


### Added
- Separate /release-public command for public release phase
- GitHub Actions workflow for publishing to public repository
- Two-phase release process (internal testing, then public release)

### Changed
- Split /release command into two phases for internal testing
- Updated electron-builder to publish to private repo first
- Release workflow now publishes to nimbalyst-code (private) before nimbalyst (public)

### Fixed
- Session unread indicators now use timestamp-based tracking
- PGlite database initialization error handling improved
- Concurrent AI sessions now work properly in agent mode
- Enhanced test helpers with better logging and tab selectors

### Removed
<!-- Removed features go here -->

## [0.45.1] - 2025-11-02


### Added
- Find/replace bar now integrated in fixed tab header
- File-watcher-based diff approval for AI edits
- OS notification support for AI completion
- Completion sound notifications for AI responses
- Auto-focus AI input when creating new session
- Agent mode replacing separate session manager window

### Changed
- AI chat draft input now persisted to database
- AgenticCodingWindow deprecated in favor of AgenticPanel
- Optimized AgenticPanel event handler registrations
- Memoized AISessionView to prevent unnecessary re-renders
- Custom tracker loading extracted to separate service

### Fixed
- Reduced runtime package TypeScript errors from 33 to 9
- Achieved zero TypeScript compilation errors in rexical
- Improved TypeScript compilation with path mappings
- Capture full text context for tracker item titles with whitespace
- Consecutive AI edits now update diff view properly
- Display user message count in agent session list
- Resolve system theme to actual theme before rendering
- Allow tab switching shortcuts when search bar focused
- Route MCP tools to correct window using workspace path
- Use relative paths in onboarding service file creation

## [0.45.0] - 2025-10-31


### Added

Welcome to the first public alpha release of Nimbalyst, a markdown editor with integrated Claude Code support.

**Core Features:**
- Rich markdown editing with Lexical framework
- Native Claude Code integration for AI-assisted editing
- Document history with version snapshots
- Multi-workspace support
- File tree navigation
- Live preview and syntax highlighting

**AI Capabilities:**
- Chat with Claude directly in your documents
- AI-powered diff review and approval
- Multiple AI provider support (Claude, OpenAI, LM Studio)
- Streaming edits with real-time preview

**Built for developers:**
- Clean, distraction-free interface
- Fast local-first architecture
- Cross-platform (macOS, Windows, Linux)

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
<!-- Bug fixes go here -->

### Removed
<!-- Removed features go here -->

## [0.44.0] - 2025-10-31


### Added

Welcome to the first public alpha release of Nimbalyst, a markdown editor with integrated Claude Code support.

**Core Features:**
- Rich markdown editing with Lexical framework
- Native Claude Code integration for AI-assisted editing
- Document history with version snapshots
- Multi-workspace support
- File tree navigation
- Live preview and syntax highlighting

**AI Capabilities:**
- Chat with Claude directly in your documents
- AI-powered diff review and approval
- Multiple AI provider support (Claude, OpenAI, LM Studio)
- Streaming edits with real-time preview

**Built for developers:**
- Clean, distraction-free interface
- Fast local-first architecture
- Cross-platform (macOS, Windows, Linux)

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
<!-- Bug fixes go here -->

### Removed
<!-- Removed features go here -->

## [0.43.0] - 2025-10-31


### Added
- Added slider control for tracker progress fields
- Added comprehensive analytics event tracking for feature usage
- Show workspace onboarding dialog if not completed yet

### Fixed
- Fixed restart button not disabling and showing restarting status
- Fixed missing onRestore callback in history dialog
- Fixed agent transcript sidebar entries not spanning full width
- Fixed code blocks without language specification being dropped on export
- Fixed path.join implementation bug
- Fixed config.json being appended to instead of overwritten when saving

### Changed
- Migrated organization to nimbalyst GitHub organization

### Removed
<!-- Removed features go here -->

## [0.42.60] - 2025-10-30

### Fixed
- Fixed file selection not clearing when tab is closed
- Fixed tracker document header not appearing on initial load
- Fixed files not marked dirty when tracker updates frontmatter
- Fixed error handling for missing directories in folder contents retrieval

### Changed
- Claude Code now updates database and notifies panel to check for updates
- MCP stream tool now operates synchronously for better reliability
- AI tools now require explicit file paths for better clarity

### Removed
- Removed deprecated getDocument tool

### Internal
- Modernized end-to-end test infrastructure

