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

## [0.56.5] - 2026-03-19


### Added
- Developer Dashboard with atomFamily instance tracking, live time-series charts for memory/watchers/atoms, DB query performance monitoring, IPC handler stats, and renderer memory tracking
- Tracked atomFamily wrapper for debug monitoring in Developer menu

## [0.56.4] - 2026-03-19


### Added
- Codex todo_list items now render as checklists in transcript
- Slash command menu sections appear in logical order

### Changed
- Replaced correlated subqueries with pre-aggregated LEFT JOIN for better query performance

### Fixed
- Codex provider no longer silently drops unrecognized event types
- Symlinked skills and commands now discovered in slash menu

## [0.56.3] - 2026-03-18


### Added
- Opus 4.6 and Sonnet 4.6 1M context models in model selector

### Changed
- Updated claude-agent-sdk 0.2.69 to 0.2.76, codex-sdk 0.110.0 to 0.114.0
- Plan mode tool restrictions now delegated to SDK natively

### Fixed
- Remove extensionFileTypesLoader not in AgentToolHooksOptions interface
- Require plan path when exiting planning mode
- Keep started agent sessions on their original provider
- Prevent agent response text from appearing twice in transcript

## [0.56.2] - 2026-03-18


### Added
- Marketplace Cloudflare Worker, packaging pipeline, and CDN redirects
- Packaged third-party notices and license audit report

### Fixed
- Tracker items with source=native are now always editable
- Docker E2E tests no longer corrupt host platform-specific binaries
- PromptQuickOpen now scrolls transcript to the selected prompt
- Infinite reconnect loop on collab doc decryption failure with auto-recovery for lost org keys
- preventSleepWhenSyncing setting no longer lost on app restart
- Deleting inline tracker items now removes the line from the source file
- Tracker table multi-select and double-click to open file
- Git panel no longer loops refreshing in empty repos
- Tracker and workspace summary header alignment

### Removed
<!-- Removed features go here -->

## [0.56.1] - 2026-03-17


### Added
- Tracker MVP: drag-and-drop reordering, inline editing, multi-select, delete/archive all items, multi-select filters, frontmatter editing

### Changed
- useEditorLifecycle hook moved to extension-sdk package
- Floating-ui positioning rule extracted to dedicated rules file

### Fixed
- Context menus and kanban scroll use floating-ui for correct positioning
- Queued messages not firing when SessionStateManager.endSession did not emit session:completed
- Queued prompts not continuing after guarded turn completion
- Missing build script for editor configuration
- Duplicate last message appearing when loading session transcript
- iOS background SQLite crash from full index sync on every reconnect

### Removed
<!-- Removed features go here -->

## [0.56.0] - 2026-03-16


### Added
- Session recovery system: survive app restart with pending questions
- Extension marketplace with security warning and alpha gate
- Keep Awake option to prevent Mac sleep while syncing
- E2E encrypted document sync between desktop and iOS
- Native Android client with mobile sync parity
- Extension project intro modal with simplified creation flow (neutral starter scaffold)
- Extension examples in intro modal
- Richer documentation scaffolding for new extension projects
- CLAUDE.md and .agents.md generation in new extension projects
- useEditorLifecycle hook with migration of all extensions
- Extension API for direct AI chat completions with responseFormat support
- Extension contribution points for commands, keybindings, and panel tooltips
- Context menu to hide/show navigation gutter buttons
- Collaborative cursors that scroll with content and fade on inactivity
- Per-table database query stats with blocked time tracking
- Git extension improvements: hover card positioning, branch submenus, pull rebase, auto-refresh
- Created/updated timestamps in tracker document header
- Cmd+Shift+V to force-paste text without attachment conversion
- Android/iOS parity improvements and PostHog analytics

### Changed
- Sync identity uses path-based SHA-256 instead of YAML frontmatter syncId
- DataModelLM auto-layout replaced with ELK layout engine
- OpenAI model defaults refreshed to current GPT-5.x and GPT-4.1 IDs
- ClaudeCodeProvider static DI and SDK options extracted into focused modules
- MCP tool schemas colocated with handler implementations
- httpServer.ts (4,258 lines) split into focused modules

### Fixed
- SSE keepalive pings prevent MCP connection death during long tool waits
- Orphaned UUID-keyed files purged on server during sync handshake
- Single app activation on launch instead of per-window focus steal
- Skip writing remote sync files when local content already matches
- New projects no longer open with terminal panel visible
- Extensions can no longer hijack keyboard input in text fields
- AskUserQuestion no longer hangs when routed through MCP server path
- Sessions no longer stuck as 'running' after git commit proposal with dead subprocess
- SDK result messages now render correctly in agent transcript
- Theme type consistency across extension APIs (string type)
- PDF-viewer extension fileIcons format causing manifest validation failure
- Mobile AskUserQuestion answers not reaching MCP server
- Extension chat completion API: skip DB logging, simplify ResponseFormat, reduce noise
- Virtual refs in floating-ui cast for TypeScript strict checks
- Windows publisherName set to prevent auto-update rejection on cert change
- Claude-code user-agent set on usage API requests
- E2E session-management tests passing with proper data-testid selectors
- TypeScript strict null errors blocking git push

## [0.55.31] - 2026-03-12


### Added
- PostHog DAU tracking via app_foregrounded event
- Mobile and desktop PostHog users now merge on QR pairing

### Changed
- Convert file tree scanning from synchronous to async fs operations
- Narrow extensions find-files scan root using glob literal prefix
- Eliminate main-process blocking when opening large non-git projects
- Git remote lookups no longer block the main process on startup
- Opening large projects no longer freezes the UI

### Fixed
- File tree loading spinner no longer spins forever on empty workspaces
- Community dialog logo now shows in packaged builds
- TypeScript errors in playwright extension

## [0.55.30] - 2026-03-12


### Changed
- Centralize WalkthroughProvider IPC listeners into store
- Centralize UpdateToast IPC listeners into store

### Fixed
- Mobile sync initial setup not syncing and pairing without projects
- Thinking indicator hidden and waiting state not restored after session switch
- AskUserQuestion widget stays pending after session abort
- Automations extension incorrectly on stable channel (reverted to alpha)
- TypeScript errors across electron and playwright packages

## [0.55.29] - 2026-03-12


### Added
- PostHog analytics tracking for session kanban board interactions

### Changed
- Adopted @floating-ui/react for all dropdown and popover positioning (replaces custom positioning logic)
- Consolidated E2E test suite to reduce Electron launches from ~83 to 29 files

### Fixed
- Guard against pending-cleared reload race condition during diff tag clearing
- Sessions stuck in 'running' state after completion
- Opening files from the file tree now uses IPC instead of scrolling the virtualized tree
- Preserve Keep All content in chained diff replacements when applying sequential markdown changes
- Prevent false diff markers on list items with bold text
- Kanban peek panel and context menu rendered transparent in the Complete column

## [0.55.25] - 2026-03-07


### Changed
- CollabV3 updated to 0.1.36

### Fixed
- Suppress mobile push notifications when desktop app is active
- Mobile session creation fails after sync reconnection

## [0.55.24] - 2026-03-06


### Added
- "Other" freetext option in AskUserQuestion widget for custom responses

### Changed
- CollabV3 updated to 0.1.35

### Fixed
- Prevent sign-out on network errors and persist sync identity across restarts

## [0.55.23] - 2026-03-06


### Changed
- CollabV3 updated to 0.1.34

### Fixed
- Prevent sync echoes from overwriting active typing in AIInput
- Mobile session sync broken by multi-org auth changes

## [0.55.22] - 2026-03-06


### Added
- Folder-based navigation for shared collab docs with create folder/document flows, drag-and-drop reordering, and persisted tree UI state

### Changed
- CollabV3 0.1.32 with improved team vs personal org tracking

### Fixed
- Restore shared link ownership and labels by classifying Stytch orgs with explicit personal/team metadata
- Keep AI input typeahead selection in sync
- Show Codex web search calls in session transcripts
- Restore Codex image attachments in session transcripts
- Deduplicate repeated transcript edit previews
- Render Codex session reminders as system cards instead of raw text
- Restore AI session creation tracking in modern flows (PostHog `create_ai_session` events)

## [0.55.21] - 2026-03-05


### Fixed
- Replace emoji with Material Symbols icon in session mention typeahead
- Git commit proposal widget disabled when model sends filesToStage as string instead of array
- Update Claude Haiku version label from 3.5 to 4.5 in model picker
- CI test failures on Linux

## [0.55.20] - 2026-03-05


### Added
- Configurable thinking level for OpenAI Codex sessions
- `nimbalyst_version` super property added to all PostHog events
- Open transcript file links directly in the editor instead of the browser
- AskUserQuestion support in Codex agent flow
- First-turn reminder for Codex session metadata tool usage

### Changed
- Split ClaudeCodeProvider into focused workflow modules

### Fixed
- Harden Codex MCP prompt routing, server config, and broken startup
- Isolate git commit proposal responses per session
- Sanitize dotted MCP server names for Codex TOML config (e.g., `@scope/name` no longer produces invalid TOML keys)
- Restore Configure Models navigation from model selector
- Restore Monaco background for Monokai theme with built-in theme ID mapping
- Prevent table resizer crash on stale cell refs

## [0.55.18] - 2026-03-05


### Fixed
- Correct GPT-5.4 model ID (renamed from gpt-5.4-codex to gpt-5.4) with migration alias for existing users
- Remove silent model fallback that masked invalid model errors by switching to a different model

## [0.55.17] - 2026-03-05


### Added
- GPT-5.4 Codex model support

### Changed
- Update @openai/codex-sdk 0.107.0 -> 0.110.0
- Update iOS App Store link with correct Apple ID and remove Coming Soon badge

### Fixed
- Show archive confirmation dialog after clean worktree merge
- Regenerate lock file to fix corrupted Codex binary integrity hashes
- Session HTML export typecheck failure on ES2020 target
- Bulk archive now correctly archives all selected sessions

## [0.55.16] - 2026-03-05


### Added
- Unified tracker system with database-first storage, file import, and MCP tools
- @@ session mention typeahead in chat input
- Drag-and-drop session mentions onto chat input
- MCP servers can be enabled per-provider (Claude/Codex)
- Auto-compare blitz sessions when all sessions finish
- Codex usage indicator re-enable toggle

### Changed
- Update claude-agent-sdk 0.2.63 -> 0.2.69, codex-sdk 0.106.0 -> 0.107.0
- Remove beta label and warning from OpenAI Codex

### Fixed
- Checkbox state changes silently lost in diff mode
- Session provider icon uses correct provider and updates on model change
- Keep session history metadata in sync (provider, model, title changes broadcast to renderer)
- Prevent session export/share from freezing on large sessions
- Deduplicate concurrent usage API refresh calls to prevent redundant network requests
- Reduce usage API polling frequency to prevent 429 rate limiting
- Add ToolSearch to SDK_NATIVE_TOOLS to prevent tool execution failure
- Correct Codex token accounting and context usage display (treat turn usage as cumulative snapshots)
- Scope AI session-state updates to the owning workspace window to prevent cross-workspace interference
- Resolve claude-agent-sdk path for non-hoisted npm workspace layout
- Stabilize unit test execution and CI coverage with deterministic vitest run mode
- Consolidate E2E tests to minimize app launches for CI

## [0.55.12] - 2026-03-04


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Claude Agent API key test no longer returns 404 (updated discontinued model ID)

### Removed
<!-- Removed features go here -->

## [0.55.11] - 2026-03-04


### Added
- Voice agent session navigation and activation sound
- Drag files from file tree into AI input as @-mentions
- Drag files from edited sidebar into AI input as @-mentions

### Changed
- Densified AI sessions dropdown into single-row menu items
- Removed click-to-copy on inline code blocks in transcripts

### Fixed
- Enforced Claude Agent key separation and refresh auth config
- Gitignore bypass only registers for write tools, not Bash
- AI file edits in gitignored directories now detected
- AI file edits now detected regardless of path format
- Persisted unread=false to database when tray session is clicked
- Matched FileGutter vertical spacing to FileEditsSidebar
- Workstream parents inherit phase from children on kanban board

## [0.55.10] - 2026-03-04


### Added
- Track new user creation with user_created analytics event
- Button to open memory file from memory prompt indicator
- Worktree archiving auto-skips confirmation dialog when branch is clean and merged
- Session meta tool shows tag/phase/name transitions in rich widget
- Kanban drag-to-archive cleans up worktree on last session
- Windows code signing via DigiCert KeyLocker

### Changed
- Densified AI sessions dropdown in editor header bar
- Merged name_session and update_tags into single update_session_meta tool
- Split test signing into fast credential check and full build steps

### Fixed
- Removed broken message count from document session history display
- Fixed history dialog session link click target
- Tracker sidebar counts now include frontmatter-based items
- Restored selected session on app restart and page refresh
- Prevented error toast flooding from repeated identical errors
- Prevented tracker items from leaking across workspaces
- Restored runtime prompt build parsing
- Persisted selected workstream immediately to survive app restart
- Used config.userId for sync room routing instead of JWT sub claim
- Fixed signtool.exe discovery by searching Windows SDK directory
- Merged duplicate "overrides" keys in root package.json
- Fixed electron-builder invocation in test signing workflow
- Prevented test signing workflow from publishing to GitHub Releases

## [0.55.9] - 2026-03-03


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Worktree archive from kanban board updates UI immediately without requiring refresh
- Resolved false Codex workspace trust warning by using actual workspace path for connection tests

### Removed
<!-- Removed features go here -->

## [0.55.8] - 2026-03-03


### Added
- Resizable panels, keyboard shortcut, and help tooltip for CollabMode
- Sharing discovery callout on Account & Sync page
- Multi-select and batch drag-drop on session kanban board
- Tracker kanban view (gated behind alpha release channel)

### Changed
- Session context menu reordered into logical groups with dividers

### Fixed
- Worktree sessions load instantly instead of spawning hundreds of git processes
- Single-instance lock so Windows OAuth deep links route to existing app on Windows
- Transcript peek widget no longer flashes at top-left on keyboard navigation
- Terminal panel visibility persists per-workspace instead of globally
- Tray icon included in packaged builds via extraResources
- Team name no longer leaks to Stytch org metadata
- File scope walkthrough delayed until sidebar has actual files

## [0.55.7] - 2026-03-03


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Toggling auto-commit ON in commit widget now actually triggers a commit
- Commit widget shows real progress indicator when toggling auto-commit on

### Removed
<!-- Removed features go here -->

## [0.55.6] - 2026-03-03


### Added
- Collaboration features gated behind alpha release channel flag
- Slack notifications for alpha release builds
- Developer mode users routed to agent mode after onboarding

### Changed
- Unified session context menu across sidebar, kanban, and tabs (shared SessionContextMenu component)
- Paired devices persist across disconnects with online/offline status and "last seen" time

### Fixed
- QuickOpen reveals folders in file tree instead of failing to open them
- iOS CI builds against iOS SDK instead of macOS (xcodebuild targeting iOS Simulator)
- iOS test fixtures aligned with camelCase wire protocol
- iOS transcript bundle tests skip gracefully instead of failing when bundle is absent

## [0.55.5] - 2026-03-02


### Added
- @ mention shows files immediately on typing "@" and supports directory mentions with folder icon
- Context-aware walkthrough guides: agent-mode-intro in Files mode, files-mode-intro in Agent mode
- Hide collab UI when no team configured; show gear icon for disconnected projects

### Changed
- Cmd+1-9 now exclusively switches tabs (removed conflicting window switching shortcuts)
- Sessions Board removed from tracker panel (lives in AgentMode now)

### Fixed
- iOS mobile prompt send failures now show user-visible error alerts and restore draft text
- Draft text no longer bounces back after mobile prompt submit (draftUpdatedAt timestamp for stale rejection)
- Secondary account JWTs auto-refresh on 401 in TeamService instead of failing
- "Share to Team" menu hidden when project has no team
- Tray menu no longer shows stale "blocked" status for completed sessions
- Skip YAML parsing for .astro files whose --- blocks contain JavaScript
- Gutter popover placement fixed to open right instead of above

## [0.55.4] - 2026-03-02


### Added
- Bidirectional draft sync and queued prompts between desktop and iOS
- Multi-account team management with admin role editing and account picker for team creation
- Editable tag rollup in workstream headers with inline autocomplete
- Cmd+Shift+N shortcut to create new AI session from any mode
- New agent sessions pre-populated with @file reference to currently open document
- Kanban board walkthrough and PostHog analytics for session view mode switching

### Changed
- Reduced verbose logging across CollabV3Sync, TeamService, SyncManager, AIService, TrackerSyncManager
- Skip model fetching for disabled AI providers (fixes LM Studio fetch error when not in use)

### Fixed
- Kanban view auto-exits when navigating to a specific session (tray, quick open, double-click)
- Session token corruption when exchanging for secondary accounts
- Undecryptable project entries cleaned up during sync instead of logging errors
- Tray icon uses macOS template images for correct dark/light menu bar rendering
- Tray icon uses system appearance instead of app theme for foreground color
- Tray BGRA byte order fix (blue dots were rendering as orange)
- Unread sessions now seeded from database on tray init
- Key envelope overwrite vulnerability closed in DocumentRoom (empty sender_user_id truthiness check)
- Sub-agent transcript truncation and tool name mismatch (Agent vs Task rename)
- Stale session data when navigating to completed sessions with cached mid-stream snapshots

## [0.55.3] - 2026-03-02


### Added
- Custom Claude executable path setting for corporate SSO wrappers (Browse file picker in Claude Agent settings)
- iOS AI model picker synced from desktop with provider/model fields in CreateSessionRequest
- iOS cancel button for running AI sessions via control messages
- Session archive/unarchive control messages from mobile
- Pre-rendered logo template assets for system tray icon (crisp splat silhouette with hash cutout)
- Uncommitted/committed tag tracking in agent session naming prompt
- /ios-release command for iOS App Store releases with platform-prefixed tags

### Fixed
- Child sessions of worktree-group parents now visible in session list
- Team JWT refresh before personal session exchange to prevent stale token 401s after idle/sleep
- iOS session creation menu shows on single tap instead of requiring long press
- Diff stats color toned down in agent turn summary (opacity-60 to match surrounding text)
- TypeScript error for openFileDialog in ClaudeCodePanel (missing ElectronAPI type)

## [0.55.2] - 2026-03-01


### Added
- System tray menu showing AI session status with click-to-navigate, dock badge for sessions needing attention
- Session kanban board as right-panel view in AgentMode (Cmd+Shift+K toggle)
- Live sub-agent progress tracking in teammate panel (status, elapsed time, tool count)
- Multi-account support: user avatar menu, add/remove accounts, per-project account binding
- Click/tap-to-copy on inline code blocks in transcripts with green flash feedback
- iOS jump-to-prompt bottom sheet in session detail view
- iOS hierarchical session navigation with worktree/workstream sync (6 new metadata fields)
- Log rotation on startup (keeps 2 previous sessions) and Developer menu "Rotate Logs" option
- Rate limit warning/blocked widgets with amber/red styling

### Changed
- Updated claude-agent-sdk to 0.2.63
- SDK now handles background sub-agents natively instead of TeammateManager interception

### Fixed
- Voice agent answering interactive prompts (prompt forwarding race, IPC channels, widget display)
- iOS transcript blank screen caused by React hooks ordering violation
- iOS compact button now sends /compact command through native bridge
- iOS voice playback routed through VPIO bus 0 for proper echo cancellation
- Auto-delete undecryptable session index entries so they re-sync with correct key
- Rate limit events from Claude Code SDK now handled instead of dumped as unhandled messages
- Git commit widget shows committed state when reloading sessions (missing tool_result)
- Tracker items now load automatically on startup via deferred workspace scan
- Scroll-to-bottom button is now a proper circle
- Rate limit reset times use Unix timestamps to prevent timezone parsing bugs

## [0.55.1] - 2026-02-27


### Added
- Voice mode: interactive prompt support (answer AskUserQuestion, ExitPlanMode, GitCommitProposal verbally)
- Voice mode: OpenAI API key input directly on Voice Mode settings panel
- Maximize button in chat sidebar to open current session in agent mode
- File count and +/- line stats in agent turn summary ("Finished in 6m 57s · 3 files +45 -12")
- Session kanban board: keyboard navigation (arrows, Enter, Space), Cmd+arrows to move cards between phases, collapsible columns

### Changed
- Updated claude-agent-sdk 0.2.45 -> 0.2.62, mcp-sdk 1.26.0 -> 1.27.1, codex-sdk 0.104.0 -> 0.106.0
- Auto-commit toggle moved from Claude Agent settings to Advanced panel
- Reduced log noise for worktree operations

### Fixed
- Mobile sync broken after team session exchange (personal JWT now preserved across org switches)
- Team panel showing wrong project when multiple teams exist
- Team key envelope distribution: new members now receive shared documents via broadcast + polling
- Voice mode: idle timer running during assistant speech, wake-from-sleep, voice drift, echo cancellation
- Voice agent now receives coding agent results and recent conversation context
- Auto-commit toggle not persisting across app restarts (atom never hydrated from store)
- Zombie WebSocket preventing mobile session sync after network changes
- CI TypeScript check failure for collabv3 test files

## [0.55.0] - 2026-02-26


### Added
- E2E encrypted collaborative document editing via Lexical + yJS through Cloudflare Workers
- E2E encrypted tracker sync with team-scoped Durable Objects
- Team trust model with ECDH key exchange, key envelopes, and Stytch B2B org discovery
- CollabMode for real-time document collaboration with team members
- TrackerMode with kanban board, item detail panel, and sidebar
- Team setup UI: TeamPanel, TrackerConfigPanel, team invite/join dialogs
- Session kanban board atoms and E2E tests
- "Remove from workstream" context menu for child sessions
- WebSocket proxy (IPC-bridged) for document sync to bypass Cloudflare browser blocks
- Lazy batch message loading for session sync (3 sessions at a time)

### Changed
- Consolidated file watchers into single ref-counted WorkspaceEventBus per workspace
- Merged rexical package into runtime (all editor code now in packages/runtime/src/editor/)
- Project rename uses atomic fs.rename() instead of copy+delete to prevent data loss
- Project move no longer auto-deletes original directory; user verifies before deleting
- Session drag-drop onto standalone session now creates proper workstream parent
- Worktree sessions blocked from drag-drop in both directions
- Throttle uncaught exception dialogs (dedup within 5s, max 3/min)
- Multiple dev instances now fully isolated with per-instance outDir and userData

### Fixed
- Shared document list and document sync failures (migration, reconnect, cross-mode handoff)
- Session list not refreshing after importing Claude Code sessions
- Session sync instability across org switches (personalOrgId for consistent room IDs)
- Team collaboration security: sender_user_id tracking, P-256 key validation, JWKS cache-miss refresh
- Session invalidation on team deletion and auth token persistence after session exchange
- OS notification click now switches to agent mode to show the session
- Flush pending DB writes before session completion to prevent stale transcript after /compact
- Clipboard copy silently failing in Electron renderer
- Session context MCP server startup and workstream-aware commit prompts
- All TypeScript compilation errors resolved (38 -> 0)
- Session drag-drop creating broken parent-child relationships

### Removed
- Capacitor package (will build native Android app instead)
- Playground package (no longer needed after rexical merge)
- ChokidarFileWatcher, SimpleFileWatcher, SimpleWorkspaceWatcher (replaced by WorkspaceEventBus)

## [0.54.20] - 2026-02-26


### Added
- Agent prompt now includes multi-session awareness and commit tool guidance
- App update restart is deferred until all active AI sessions finish

### Fixed
- Blitz archive now recursively archives child worktrees
- Built-in terminal now has same PATH as Claude Code sessions

## [0.54.19] - 2026-02-25


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Raised file descriptor limit to prevent silent watcher failures

### Removed
<!-- Removed features go here -->

## [0.54.18] - 2026-02-25


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Fixed Bash edits on gitignored files showing the entire file as green instead of just the changed lines

### Removed
<!-- Removed features go here -->

## [0.54.17] - 2026-02-25


### Added
<!-- New features go here -->

### Changed
- Consolidated file watchers into single WorkspaceEventBus per workspace, halving file descriptor usage
- Added .gitignore-aware filtering and circuit breaker protection against event flooding

### Fixed
- Fixed Bash diff baseline advancing per tracked change
- Fixed Nimbalyst hanging when workspace has thousands of dirty files

### Removed
<!-- Removed features go here -->

## [0.54.16] - 2026-02-25


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Shared links can no longer be created without expiration
- Stable baseline used for Bash file diffs
- Pending AI diffs now apply without manual refresh
- Pending-review diffs preserved for ignored file updates
- Unified files-mode pending review and edited file sync
- Stabilized Codex file baseline and Bash edit visibility

### Removed
<!-- Removed features go here -->

## [0.54.15] - 2026-02-25


### Added
- Share dialog shows inline sign-in (Google/magic-link) when not authenticated instead of redirecting to Settings

### Changed
- Share link expiration capped at 30 days; "No expiration" option removed
- Legacy null (no-expiration) share preferences convert to 7-day default
- Codex API key field labeled as optional with explanation of account-based vs API key pricing

### Fixed
- External file edits no longer dropped when they arrive immediately after a save
- Pre-edit baseline preserved correctly when watcher tag starts empty
- Codex commit widget completion state persists across tab navigation
- Vendored ripgrep now available in enhanced PATH for search functionality
- Community modal social icons restyled to match design (transparent background, blue icons, larger text)
- Community modal stays open when clicking social links; "Accept Invite" renamed to "Join Discord"

## [0.54.14] - 2026-02-25


### Added
- Share modal with expiration options (1/7/30 days or none) and end-to-end encryption notice
- Community channels popup replacing Discord-only popup, with links to Discord, YouTube, LinkedIn, X, TikTok, Instagram
- Persistent Community submenu in Help menu with all social channels
- Smarter community popup timing: triggers after 3 completed AI sessions instead of on app launch

### Changed
- Share link button moved to header bar; removed duplicate from editor dropdown menu

### Fixed
- Share TTL defaults normalized to prevent bad expiration values
- Codex diff baselines preserved correctly for existing files (path normalization, empty-baseline skip)
- Restored dialogRef export from dialogs index (fixes SessionListItem module loading)
- Removed redundant service error modal for Claude outages (error already shown inline)
- Codex no longer inherits OPENAI_API_KEY env variable (must be set explicitly)

## [0.54.13] - 2026-02-25


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Hardened diff tracking security with path validation and size limits
- Same-session multi-edits now show cumulative diffs instead of only the last edit
- Per-tool-call diff tracking correctly isolates diffs for multi-edit files
- Codex diff tracking hardened for async safety, deduplication, and edge cases
- Per-tool diffs preserved correctly for Codex file_change edits
- Codex Bash edits now consistently produce viewable diffs

### Removed
<!-- Removed features go here -->

## [0.54.12] - 2026-02-24


### Added
<!-- New features go here -->

### Changed
- Codex moved back behind beta feature flag (reverted public visibility)

### Fixed
- Settings sidebar widened to fit "OpenAI Codex (BETA)" label without truncation

### Removed
<!-- Removed features go here -->

## [0.54.11] - 2026-02-24


### Added
<!-- New features go here -->

### Changed
- Codex moved back behind beta feature flag

### Fixed
- AI file diffs now show only changed lines instead of entire file
- AI diffs route to the visible editor instance instead of potentially targeting a hidden one
- Database schema creation order fixed so ai_agent_messages precedes ai_tool_call_file_edits
- AI agents more reliably name sessions on their first turn
- Clicking a teammate in the sidebar scrolls to its spawn message in the transcript

### Removed
<!-- Removed features go here -->

## [0.54.10] - 2026-02-24


### Added
- Teammate sidebar shows elapsed time, tool count, and click-to-scroll navigation

### Fixed
- Lead agent no longer hangs waiting for a teammate that already finished
- All sub-agent cards now visible in transcript

## [0.54.9] - 2026-02-24


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Teammate messages no longer hang when lead agent is mid-turn

### Removed
<!-- Removed features go here -->

## [0.54.8] - 2026-02-23


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Codex file_change (apply_patch) diffs no longer missing from tool output
- Session file watcher no longer exhausts file descriptors on macOS/Windows
- Workspace watcher no longer exhausts file descriptors on macOS/Windows
- Super loop progress MCP no longer appears in regular sessions
- Active session now correctly initialized for worktree selections

### Removed
<!-- Removed features go here -->

## [0.54.7] - 2026-02-23


### Added
- Session file watcher now respects project .gitignore rules

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Subagent permission bypass prevented by isolating settings per agent
- Diagnostic logging added to HistoryManager.createTag error path
- Bash pre-tag race condition that dropped red/green diffs in tool output
- Restart indicator no longer shown on brand new sessions
- Cross-session file edit misattribution prevented
- Non-git projects no longer watch node_modules and build directories

### Removed
<!-- Removed features go here -->

## [0.54.6] - 2026-02-23


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- File descriptor exhaustion from workspace watcher opening per-file FDs (2500+ per workspace), causing spawn EBADF with default ulimit
- File descriptor leak from session file watchers causing spawn EBADF errors
- Sub-agents now spawn correctly in packaged builds
- Worktree timestamps no longer shift by local timezone offset

### Removed
<!-- Removed features go here -->

## [0.54.5] - 2026-02-23


### Fixed
- Codex file change diffs now match the correct tool call across machines
- Worktree and workstream session tabs now stay in their creation order
- Bash file changes now detected on Windows
- Codex bash commands now unwrap correctly on Windows
- Claude usage API forbidden responses now log full details for diagnostics

## [0.54.4] - 2026-02-23


### Added
- Codex is now available without enabling beta features

### Fixed
- Usage indicators remain visible when load errors occur
- Grouped session context menus now align with plain session menus
- Improved Claude usage diagnostics with explicit auth failure logging
- Session share links no longer gated behind alpha flag
- Codex bash commands no longer show /bin/zsh -lc wrapper

## [0.54.3] - 2026-02-21


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Tool call diffs now appear for Codex sessions
- File change diffs use history snapshots and exclude human edits
- Shell-wrapped bash commands properly unwrapped for file tracking
- Claude Code no longer leaks or uses the Claude Chat API key
- @ mention file search fixed in dev mode
- Claude usage indicator no longer hidden when utilization is at 0%

### Removed
<!-- Removed features go here -->

## [0.54.2] - 2026-02-21


### Added
- File change diffs shown per tool call in agent transcripts (ToolCallMatcher)
- Share markdown files from editor overflow menu
- Codex local file history diffs with dirty/untracked baseline snapshots
- Agent model choice for git conflict resolution

### Changed
- Codex API key separated from OpenAI API key
- Usage indicators remain visible when usage data is present

### Fixed
- Bash command diffs now display as attachments in tool call widgets
- Tool call file matching stabilized with time cutoff and filename-based scoring
- Failed MCP database queries no longer break subsequent DB operations
- Auto-commit widget now shows success state instead of broken interactive form
- Clearing API key in settings now actually removes it
- EBADF errors no longer break all process spawning including sessions
- Auto-commit no longer shows "No files were staged" error
- Commit widget prefers tool result content

## [0.54.1] - 2026-02-20


### Added
- Voice mode overhaul with persistent button, session tracking, and listen window
- Automations extension for scheduled AI-powered tasks
- Session context MCP server with session awareness tools
- Extensions can now contribute document headers above any editor
- Marketing screenshots work with packaged app, no dev server required

### Fixed
- Session read state now syncs properly between desktop and iOS
- Marketing screenshots fail when launched from packaged Nimbalyst
- Exclude automation documents from frontmatter header processing

## [0.54.0] - 2026-02-20


### Added
- Clicking links in terminal opens them in default browser
- Configurable document history retention in Advanced Settings
- Custom tracker types fully supported in bottom panel and document header
- Account deletion for Apple App Store compliance (5.1.1)
- App Store compliance: privacy manifest and in-app privacy policy link
- Tracker creation writes canonical frontmatter format
- Playwright-based marketing screenshot and video capture system
- Show restart indicator line in AI session transcripts (dev mode)

### Changed
- Unified file actions across context menus

### Fixed
- Share link fails until logout/login due to missing server URL
- Improve session loading performance for large transcripts
- Terminal cursor polish: bar style, focus-aware color, ghost cursor fix
- Terminal cursor only blinks when terminal has focus
- Terminal panel keeps terminals alive when hidden, fixing cursor position bug
- Skip re-uploading TTL-expired sessions to sync server
- Add optional chaining for terminal renderer setTheme call
- Mobile chat input now clears immediately after sending
- Model selector dropdown no longer clipped by agent panel overflow

## [0.53.13] - 2026-02-19


### Changed
- Moved Blitz from beta to alpha feature flag

## [0.53.12] - 2026-02-18


### Added
- QR code opens Nimbalyst iOS app when scanned with Camera
- Extended context settings toggle for 1M context models

### Fixed
- Blitz sessions now show full worktree UI (git ops, terminal, merge)
- Codex usage indicator shown without requiring provider to be enabled
- Folder collapse state preserved in files-edited sidebar
- iOS sessions reorder to top of list when viewed
- iOS shows correct connection status dot when desktop is connected
- Use SDK [1m] suffix for 1M context models

## [0.53.11] - 2026-02-18


### Added
- Sonnet 4.6 support with effort slider, pin 1M context to Sonnet 4.5
- Prompt for push notifications after iOS pairing
- Redesigned Account & Sync settings panel, removed alpha gate

### Changed
- Migrate from Stytch B2C to B2B Discovery OAuth

### Fixed
- iOS push notifications suppressed because device always reported as active
- Stale "waiting for response" indicator after git commit proposal
- Stytch auth deep link now opens Nimbalyst instead of bare Electron
- Codex 401 errors now show the OpenAI auth setup widget

## [0.53.10] - 2026-02-18


### Added
- iOS slash command typeahead and image attachments
- Session search walkthrough with HelpTooltip
- PostHog analytics for sync account flows
- Version tracking for collabv3 deploys

### Fixed
- Context window usage tracking from SDK per-step usage
- Show compaction summary in transcript instead of hiding it
- Collabv3 deploy script version parsing and wrangler define inheritance
- Revert claude-agent-sdk downgrade (restore 0.2.45)

## [0.53.9] - 2026-02-18


### Added
- Track sharing, export, and feature toggle usage in PostHog
- OpenAI Codex 401 errors now show setup instructions
- Teammates now require user approval for tool use
- Queued prompts now show attachment indicators
- Session open buttons now appear in agent mode file headers
- File paths in FILE CHANGES widget are clickable

### Changed
- Unify session types and sync sessionType to iOS
- Revert claude-agent-sdk 0.2.45 to 0.2.42
- Update codex-sdk 0.101.0 to 0.104.0

### Fixed
- Codex beta toggle now enables the provider automatically
- Teammate permission widgets no longer hidden by noise filter
- Worktree file paths now persist correctly when navigating away and back
- AI Sessions popover now groups worktree sessions correctly
- Second queued prompt no longer gets empty response
- Deny button in tool permission widget is now clearly visible
- File-session links now work correctly for agent mode in worktrees
- Hide system-generated user messages from transcript view
- Exclude system-generated user messages from prompt history
- Prevent tool calls from being hidden after teammate notifications
- iOS session list shows model info and readable timestamps
- Show file path as chip in session quick open to prevent text overlap
- Restore horizontal scrolling in database browser tables
- Resolve iOS test runtime crash from Int16 overflow and static var
- Resolve Swift 6 strict concurrency errors in iOS tests

## [0.53.8] - 2026-02-17


### Added
- Super Loop iterations now enforce progress reporting via MCP tool
- Blocked Super Loop sessions show inline feedback widget
- Onboarding survey asks AI referrals what model/prompt they used
- Blitz sessions show model names instead of AI-chosen titles
- Track Codex session starts in PostHog
- Sync pending prompt state to iOS and show indicator

### Changed
- Model blitzes stored as ai_sessions instead of separate table

### Fixed
- Fix packaged Codex SDK loading in Electron
- Resolve TypeScript errors in Super Loop blocked feedback
- Clear stale isExecuting flags on startup and prevent sync overlap
- Add missed files for FileTreeRow tree keyboard handler

## [0.53.7] - 2026-02-17


### Added
- Brand iOS projects list with app icon and Nimbalyst name
- Sync AI session context usage to iOS via encrypted client metadata
- Agent-readable decryption instructions and session keep-alive

### Fixed
- iOS scroll to top functionality in session detail view
- Reduce sync spam by increasing message sync debounce to 10s
- Enable horizontal scrolling in database browser table rows
- Mobile-created sessions now use user's default model preference
- Breadcrumb filename click now clears file tree filter

## [0.53.6] - 2026-02-17


### Added
- Error detection, reporting, and retry for iOS session detail view

### Changed
- Replaced old file tree with new virtualized implementation
- Centralized file tree IPC listener to follow project patterns

### Fixed
- iOS voice mode crash when starting audio capture
- Index WebSocket reconnection loop stops permanently after failed retry
- File tree no longer jumps scroll when expanding directories

## [0.53.5] - 2026-02-16


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Codex models now appear without an OpenAI API key
- Sub-agent messages no longer lost when session ends early

### Removed
<!-- Removed features go here -->

## [0.53.4] - 2026-02-16


### Added
- Show "Waiting for N agents to finish" instead of generic "Thinking..." during multi-agent sessions
- Codex usage indicator in sidebar for subscription users
- Codex CLI prerequisites section in settings panel
- Teammate spawn cards now show live status instead of error icon
- Teammate messages now show as distinct notifications in chat
- Share markdown files as encrypted links
- Show expiry date in share link toast notifications

### Changed
- Move Super Loops from beta to alpha channel
- Make Codex beta status notice more prominent in settings

### Fixed
- Alpha features now properly hide when switching off alpha channel
- Fix endSession race when lead completes inside generator loop
- Fix sub-agent output nesting and session lifecycle
- Prevent BlitzDialog from overflowing viewport
- OpenAI Codex provider now loads in packaged builds
- Fix handleShutdownResult so it emits teammates:allCompleted when last teammate removed
- Cancelled parallel agent spawns no longer show in transcript
- Teammate messages no longer get dropped or stuck
- Always attempt interrupt() for teammate messages instead of queueing
- Cancelling rebase/merge no longer leaves conflict markers in files
- Disable development environment toggle in SyncPanel
- Prevent share operations from signing user out on JWT refresh failure
- QR scanner reliability in release builds
- Show provider icon and name in assistant transcript avatar
- Make transcript avatar icons perfectly round
- Skip TestFlight encryption compliance questions on upload

## [0.53.3] - 2026-02-16


### Added
- Client-side encryption for shared sessions

### Fixed
- Reduce macOS build size from 1.5GB to 631MB by excluding unused node_modules
- Auto-enable alpha features when switching to alpha release channel
- Add macOS platform to NimbalystNative Package.swift
- Update iOS CI to macos-15 runner with Xcode 26.2

## [0.53.2] - 2026-02-16


### Added
- 30-day TTL for synced sessions to automatically clean up old data
- Email magic link login for iOS app (alternative to QR code pairing)
- Screenshot mode for App Store submission

### Fixed
- Cmd+F find routing in Agent Mode split screen now correctly targets the active editor
- Unified iOS splash screen to simple logo on both iPhone and iPad
- Session sharing no longer requires sync config to be set up
- Project sync now triggers immediately and iOS re-pairing works correctly
- Prevent QR scanner from setting invalid rectOfInterest
- Update Xcode scheme and project settings for compatibility

## [0.53.1] - 2026-02-16


### Added
- Sub-agents now appear in sidebar alongside teammates
- Codex reasoning blocks expanded by default for better visibility
- Codex sessions now show "Finished in" duration reflecting actual session time
- AI sessions button shows cross-worktree file history
- "Clear Gitignored Files" context menu action for worktrees
- Shell environment and enhanced PATH passed to Codex SDK

### Fixed
- Auto-commit no longer blocks session when not viewing it
- Fixed text[] cast in getMany query to match ai_sessions.id column type
- Resolved race conditions and reliability issues in teammate management
- Sequential teammate spawning instructions moved to deny responses
- Codex reasoning blocks render inline instead of grouped at top
- Escaped SQL LIKE wildcards and added clean gitignored feedback
- Git clean exclude approach and trim preserve list
- AI sessions button visible in agent mode file viewer
- Resolved Codex CLI in packaged builds

## [0.53.0] - 2026-02-16


### Added
- Native iOS app with SwiftUI navigation and encrypted sync
- Voice mode for native iOS app with OpenAI Realtime API

### Changed
- Standardized wire protocol on camelCase across all sync layers
- Removed deprecated tool packages system
- Removed window title file tracking and IPC overhead

### Fixed
- Prevent bulk sync from clobbering isExecuting and lastReadAt state
- Debounce session data reload during active streaming to prevent flickering
- Enable drag-and-drop of standalone sessions into workstreams
- Resolve TypeScript errors in AI protocol and UI components

## [0.52.70] - 2026-02-15


### Added
- Super Loop iterations now carry learnings forward via progress.json
- Super Loop progress.json snapshots visible in chat transcript with dedicated widget
- Super Loop progress panel in files sidebar showing phase, iteration count, learnings, and blockers
- Super Loop auto-commits .superloop to .gitignore in worktrees
- Super Loop state hardening: startup recovery, session completion signaling, progress file resilience, force-resume for completed/failed/blocked loops
- Force-resume dropdown with configurable iteration options (0/5/10/20)
- Auto-approve commits option for git commit proposals with toggle in settings and widget
- Virtualized session list for faster startup with many sessions
- Codex file changes now show a rich widget with content preview

### Changed
- Renamed Ralph Loops to Super Loops (files, types, IPC channels, DB tables, UI)

### Fixed
- Restored Virtuoso virtualization in SessionHistory after accidental removal
- Super Loop review fixes: pauseResolvers memory leak, forceResumeLoop atomicity
- Codex blocking widgets no longer time out (removed MCP tool timeout for interactive widgets)
- Session list items no longer re-render unnecessarily (React.memo + memoized date formatting)
- Session list no longer slows down with many sessions (O(1) parent-to-children index)
- Super Loop icon alignment in new menu
- Added detailed logging to git commit staging for debugging

## [0.52.69] - 2026-02-14


### Added
- Super Loops - autonomous AI agent iteration system (inspired by Ralph Loops)

### Changed
- Polish blitz creation dialog UI

### Fixed
- Command execution bash widget

## [0.52.68] - 2026-02-13


### Added
- Blitz mode for parallel AI worktree sessions
- Beta features configuration system with user-facing settings

### Changed
- Codex now gated behind beta flag only (no longer requires alpha channel)
- Updated claude-agent-sdk 0.2.39 to 0.2.42 and codex-sdk 0.98.0 to 0.101.0

### Fixed
- Codex packaged binary path resolution
- App icon path in packaged builds using app.getAppPath()
- Blocking prompt icon now clears after commit and shows correctly in groups
- TypeScript errors after SDK dependency update
- Clarified beta features and Blitz descriptions

### Removed
- Activity History panel (reverted)

## [0.52.67] - 2026-02-13


### Added
- Codex file changes now appear in "all session edits" sidebar
- Show elapsed time at end of completed agent turns

### Fixed
- Extension MCP tools now load in worktree sessions
- Prevent double-handling of teammate shutdown requests
- Multi-agent teammate message delivery and session hang
- Teammate/background agent output no longer leaks into main transcript
- Background sub-agents now defer session end like teammates
- Defer session end while teammates are still active
- Codex provider crashes in production builds

## [0.52.66] - 2026-02-13


### Added
- MCP support to OpenAI Codex provider
- Codex SDK to update-libs command

### Changed
- Improved code quality in MCP servers and OpenAI Codex provider
- Improved Codex model discovery security and performance
- Restricted Codex to Allow Edits mode and use permission-based sandbox
- Made shutdownHttpServer async to await transport cleanup

### Fixed
- Claude Code model selection not respected when initializing provider
- Exclude hidden messages from activity history
- Use proper Codex SDK system prompt configuration
- Capture Codex thread IDs from thread.started events for proper session resumption
- Persist all SDK events as raw_event for audit trail
- Remove incorrect documentStateBySession cleanup on disconnect

### Removed
<!-- Removed features go here -->

## [0.52.65] - 2026-02-12


### Added
- Codex raw event storage and grouping in database
- Codex tool calls now render with same widget as Claude Code

### Changed
- Improved Codex provider code quality and performance

### Fixed
- Global-scoped extension tools now visible without active file
- Edit tool now shows red/green diffs after agent refactoring
- Codex text extraction from item.text field
- Codex output saving to database
- TypeScript type errors in AgentToolHooks integration

## [0.52.64] - 2026-02-12


### Added
- Enhanced quick open dialogs with cross-dialog navigation and file search
- Binary path resolution for Codex SDK in packaged builds

### Changed
- Extracted shared agent infrastructure for multi-platform support

### Fixed
- @ mention file search now finds all workspace files
- Transcript scroll-to-bottom button not clickable
- Ctrl+` terminal shortcut not working on macOS and missing tracker tooltip shortcut
- Git commit widget shows actual commit date instead of render time
- TypeScript errors for Claude Agent SDK and Codex test
- Video recording for E2E tests in Docker
- Query type not exported by claude-agent-sdk

## [0.52.63] - 2026-02-11


### Added
- OpenAI Codex provider rewritten from CLI spawning to SDK integration
- Activity History panel (behind alpha flag)
- Managed teammates for agent teams
- Auto-continue AI sessions after restart

### Changed
- Bumped claude-agent-sdk from 0.2.37 to 0.2.39

### Fixed
- Improved rebase instructions to verify correct stash before restore
- Sessions with more than 5000 messages now load fully
- Worktree path used correctly for git commit operations in worktree sessions
- CRLF line endings normalized in markdown import to fix mermaid/code block parsing

## [0.52.62] - 2026-02-10


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Resolved all TypeScript typecheck errors across monorepo
- Fixed per-package typecheck errors matching CI configuration
- Fixed dark mode variants not applying to descendant elements
- Added typecheck scripts to all CI-checked extension packages

### Removed
<!-- Removed features go here -->

## [0.52.61] - 2026-02-09


### Added
- Shareable session links via Cloudflare R2
- Session HTML export and clipboard copy IPC handlers
- Mobile-to-desktop git commit proposal sync
- Syntax-highlighted JSON in database browser cell popup
- New file creation rendered as syntax-highlighted preview instead of all-green diff

### Changed
- Updated @anthropic-ai/claude-agent-sdk to 0.2.37

### Fixed
- Claude Code subprocess now receives full shell environment
- Database browser cell modal closes on Escape key
- Frontmatter UI now appears immediately after Set Document Type
- Nimbalyst mockup Style Guide updated with correct color palette and typography
- Scroll button visibility and behavior in RichTranscriptView
- "Already has a parent" error when selecting workstream child sessions
- Excalidraw MCP tools now always visible to Claude Code agents
- YAML frontmatter stripped from markdown new-file previews; fixed code syntax colors
- Devcontainer npm install no longer overwrites host node_modules

## [0.52.60] - 2026-02-06


### Added
- Splash screen displayed during app startup

### Changed
- Updated @anthropic-ai/claude-agent-sdk 0.2.32 to 0.2.34

### Fixed
- Normalized file paths in git commit handler for cross-platform compatibility
- Resolved TypeScript errors breaking CI typecheck

## [0.52.59] - 2026-02-06


### Added
<!-- New features go here -->

### Changed
- Reverted parallel initialization startup optimization

### Fixed
- Worktree merge errors now show a dialog instead of failing silently
- Prevented bash heredoc content from creating false file tracking entries
- Prevented open_workspace MCP tool from creating duplicate windows

### Removed
<!-- Removed features go here -->

## [0.52.58] - 2026-02-06


### Added
<!-- New features go here -->

### Changed
- Restored 'Use Standalone Binary' option for bun runtime

### Fixed
<!-- Bug fixes go here -->

### Removed
<!-- Removed features go here -->

## [0.52.57] - 2026-02-06


### Added
<!-- New features go here -->

### Changed
- Faster app startup via parallel initialization

### Fixed
- Pinned PGLite to 0.3.14 to prevent regression from 0.3.15

### Removed
<!-- Removed features go here -->

## [0.52.56] - 2026-02-06


### Added
- Warning dialog when running x64 build on Apple Silicon via Rosetta

### Fixed
- Image generation now respects aspect ratio setting via Gemini API
- Git index.lock race condition between status and commit operations
- ToolPermissionWidget not rendering for compound Bash commands
- Skip redundant permission prompts for built-in MCP tools
- Handle EMFILE errors gracefully in file watchers
- Suppress git errors when opening non-git workspaces
- Updated mobile splash screen

## [0.52.55] - 2026-02-06


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
<!-- Bug fixes go here -->

### Removed
- Removed experimental 'Use Standalone Binary' bun runtime feature for spawning Claude Code sessions

## [0.52.54] - 2026-02-06


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Fixed clicks being blocked after Claude Code login by properly passing auth error flag through IPC error handler and clearing pointer-events overlay

### Removed
<!-- Removed features go here -->

## [0.52.53] - 2026-02-06


### Added
- Agent Teams support for Claude Code sessions with UI toggle in Settings, teammate metadata parsing, and distinct teammate rendering with progress indicators

### Fixed
- Terminal no longer crashes when stored CWD points to a deleted directory (e.g., from a removed worktree)

## [0.52.52] - 2026-02-06


### Added
- Onboarding "Other" referral source now includes a write-in text field
- Effort level selector for Opus 4.6 sessions

### Fixed
- Prevent duplicate error dialog when database lock is detected

## [0.52.51] - 2026-02-05


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Worktree git commits now target the correct directory
<!-- Bug fixes go here -->

### Removed
<!-- Removed features go here -->

## [0.52.50] - 2026-02-05


### Added
- Diff/Full view toggle in history dialog
- Pending-review dot indicator replaces Keep All banner in git repos
- Claude Usage indicator enabled by default with disable button
- Include executing state for mobile sync in session metadata
- Interactive prompts generalized for Capacitor mobile app

### Changed
- Centralized git operation locking to prevent concurrent state corruption

### Fixed
- File rename now updates open tabs correctly
- Prevent autosave from recreating deleted or renamed files
- Git commit proposal now commits only selected files
- Verify staged files match selection before committing
- Stop Ctrl+ shortcuts from intercepting terminal input on macOS
- Resolve ExitPlanMode SDK promise when approved from mobile
- Remove window.focus() calls that steal foreground on startup
- Increase minimum width of files scope dropdown
- Files scope dropdown click-outside behavior
- Destructure getClaudeCodeExecutableOptions correctly in check-login handler

## [0.52.49] - 2026-02-05


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Restore code accidentally reverted by refactoring commit (Bun signature stripping, session pin transfer, ExitPlanMode null check)

### Removed
<!-- Removed features go here -->

## [0.52.48] - 2026-02-05


### Added
- Claude Opus 4.6 model support

### Changed
- Update claude-agent-sdk to 0.2.32 and mcp-sdk to 1.26.0

### Fixed
- Prevent duplicate ELECTRON_LOG handler registration

### Removed
<!-- Removed features go here -->

## [0.52.45] - 2026-02-05


### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
- Strip Bun binary signature before macOS codesign to fix notarization

### Removed
<!-- Removed features go here -->

## [0.52.44] - 2026-02-05


### Added
<!-- New features go here -->

### Changed
- Use bash explicitly for claude-helper build scripts on Windows

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


<!-- system test edit 2026-02-24 -->
<!-- system test: minor edit -->
