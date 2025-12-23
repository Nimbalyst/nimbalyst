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

