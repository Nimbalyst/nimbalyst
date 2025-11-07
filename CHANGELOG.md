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

