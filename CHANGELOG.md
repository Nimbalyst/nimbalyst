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

