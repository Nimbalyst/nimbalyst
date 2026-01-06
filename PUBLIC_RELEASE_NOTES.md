# Nimbalyst v0.50.18 Release Notes

This release includes cumulative improvements from v0.49.15 through v0.50.18, bringing major enhancements to extensions, permissions, and overall stability.

## New Features

### Extension System
- Extensions can now provide custom editors for binary files
- Extensions can add slash commands to the AI chat
- Extension settings UI with enable/disable toggles
- Extension Developer Kit with hot-reload tools for building extensions
- Built-in CSV spreadsheet extension with formula support
- Built-in PDF viewer with text selection and fit-to-width zoom
- Built-in DatamodelLM extension for visualizing database schemas

### CSV Spreadsheet Editor
- Edit CSV files with a spreadsheet-style interface
- Formula support for calculations
- Header row toggle with persistent settings
- Row and column selection by clicking headers
- Undo/redo support
- Sorting from column headers
- Right-click context menu
- Dark mode support

### PDF Viewer
- View PDF files directly in Nimbalyst
- Text selection and copy
- Fit-to-width zoom controls
- Works in packaged builds

### AI Agent Permissions
- Agent tool permission system with workspace trust levels
- Smart permissions mode (Beta) for selective approval
- URL pattern permissions for WebFetch and WebSearch
- Compound bash command detection and approval
- Directory-based permissions that persist across restarts
- Trust toast with clear permission options

### Mobile Sync
- Cross-device AI session sync between desktop and mobile
- Send AI prompts from mobile that execute on desktop
- Running/pending status indicators on mobile
- QR code pairing with end-to-end encryption
- Session titles sync to mobile
- Pull-to-refresh on mobile session list
- Choose project when creating sessions on mobile

### Session Management
- Session archiving with multi-select support
- Inline session rename
- Session quick search (Cmd+L)
- Session list shows relative dates
- Search button in agent mode for quick session access
- Archive button shows undo toast

### MCP Server Support
- MCP server configuration UI
- OAuth authorization for MCP remote servers
- On/off toggle for MCP servers
- Template selection flow with 17+ templates
- Brand icons for MCP templates
- PostHog MCP server for analytics queries

### Terminal Support
- Terminal sessions in agent mode (Alpha)
- Terminal scrollback and command history persistence
- Terminal respects light/dark theme
- Terminal history uses shell bootstrap files

### UI Improvements
- Floating AI sessions dropdown for current document
- File tree filters (git modified, dirty files, all files)
- Dotfiles now visible with "All Files" filter
- Natural sorting in file tree
- Git status icons in file tree
- New File dialog with type selection and folder picker
- Mouse back/forward buttons navigate tabs
- Dirty filter indicator in file tree
- Enhanced session dropdown with provider icons

### Document Features
- Text selection context auto-included in AI prompts
- Large text pastes become attachments
- Pasted images use asset storage system
- Click to enlarge image attachments
- Document links export as standard markdown
- Mermaid diagrams have Redraw button
- Word wrap option for inline code blocks

### Developer Features
- Extension dev mode indicator with restart button
- Database browser tool (Developer menu)
- Developer tools include all one-time modals
- AI agents can query PGLite database via MCP
- Extension errors visible with diagnostics

## Improvements

### Performance
- Virtualized AI transcript for smoother scrolling
- Lazy-load session tabs to prevent slow startup
- Incremental sync only syncs changed sessions
- Optimized file tree rendering

### UX Enhancements
- Monaco diff header shows change count and navigation
- AI edits show pending review status in file gutter
- Unified diff approval header across editors
- Context limit errors show helpful compact widget
- Archive toast shows session name
- New session button shows Cmd+N shortcut tooltip
- Slash command menu shows best matches first
- Auto-updater uses subtle toast instead of popup
- Settings auto-save with scope descriptions

### AI Features
- Claude can ask clarifying questions (AskUserQuestion)
- Cmd+L to quickly search and open sessions
- Visual diff viewer for AI-generated mockups
- Copy button for AI messages in transcript
- Session list shows user message count
- Token usage tracking for all providers
- AI Usage Report shows Claude Code sessions

### Mobile App
- Mobile app allows device to sleep after inactivity
- Mobile session detail layout works on iPhone/iPad
- Mobile keyboard no longer creates large gap
- Mobile layout respects iOS safe area
- No keychain prompt when sync disabled

### Security
- Session titles encrypted end-to-end
- Mobile credentials encrypted via Keychain/Keystore
- Sync server restricts CORS to allowed origins
- Encrypted tool names and metadata in sync

## Fixed

### File Tree & Navigation
- File tree truncation causing folders to disappear
- File tree shows all folders in workspaces with large dependency directories
- File mentions match files with spaces in names
- Sessions from other workspaces no longer appear in wrong project
- Ctrl+W on Windows closes tabs instead of whole window
- Tabs reliably reopen with Cmd+Shift+T
- Closing AI session navigates to adjacent tab
- File tree no longer auto-scrolls while browsing

### Permissions & Security
- Permissions modal UX improvements to prevent race conditions
- Users can no longer click outside permissions modal to dismiss it
- Permissions modal messaging made less intimidating
- API keys no longer logged in console
- Compound bash commands now require approval for each part
- Long Bash commands in permission dialog scroll vertically
- Permission prompts no longer repeat
- URL permissions persist correctly across AI sessions
- Parallel tool permissions now queue instead of overwriting

### Editor & Extensions
- Mermaid diagram changes now visible in diff mode
- Extension manifest/output mismatches caught at build time
- Table action menu positioning when document is scrolled
- PDF viewer loading in packaged builds
- CSV and custom editors no longer re-render on autosave
- Diff mode table widths display correctly
- CSV spreadsheet delete correctly clears cells
- Custom editors interactive on session restore
- PDF and DataModelLM extension styles load correctly
- Extensions include dist folders in packaged builds
- Extensions load correctly on Windows
- Custom editors save on close and support source mode
- CSV spreadsheet dark mode improvements
- CSV editor no longer steals keyboard input from dialogs
- Images display correctly in all tabs
- Tab state corruption preventing files from opening

### AI & Sessions
- AI diffs now show only new changes after approving with Keep All
- Cmd+F in files mode opens editor find instead of transcript find
- AI chat in files mode knows which document is open
- Locally queued AI prompts now execute reliably
- AI session search works correctly
- OpenAI model import mismatch causing connection errors
- Queued messages appear in chat transcript
- Queued messages send reliably with 5-second fallback
- Auto /context no longer runs after agent errors
- Session quick open shows all sessions and filters instantly
- Agent transcript updates immediately when turn completes
- Mobile queued prompts process correctly
- AI tools now return useful data instead of failing
- Token counting works correctly
- Login widget no longer triggers on normal AI responses

### MCP & Servers
- Many MCP server configuration issues fixed
- PATH handling for MCP servers
- Playwright MCP configuration
- Mobile sync commands fail gracefully when encryption unavailable
- Connection tested state now resets correctly
- AWS logo in MCP templates

### Theme & UI
- Theme changes now apply to all open editors
- Diff header buttons visible in narrow panels
- Settings panel content scrolls properly
- Slash command suggestions match transcript width
- Archive button updates immediately
- Toast notification positioning
- Typeahead menus no longer auto-select item under cursor
- Diff colors now use CSS variables for dark mode support

### Other Fixes
- Enter key sends messages containing @ or / characters
- Doubled up login widgets display issue
- Claude Code login button visibility
- Mockup screen no longer goes white on accept for new files
- Screenshot tools return proper errors instead of crashing
- Sync status icon shows for newly authenticated users
- Newly created files show diff mode for AI edits
- Mobile layout respects iOS safe area properly
- Quick Open finds all files including dotfiles and images
- Workspaces restore correctly after dev mode restart
- Cmd+N reliably triggers correct action based on current mode
- Restart tool preserves session state
- Database backups no longer overwrite good data
- Single-line code blocks render inline in AI chat
- Extensions with minified variable names load correctly
- Slash command menu arrow keys navigate in visual order
- Windows Claude Code installation detection
- Manual "Check for Updates" no longer hangs
- Lexical editor crashes in production builds
- QR pairing button enabled with default sync server
- Mobile session detail layout works on iPhone and iPad
- Windows forced shutdowns no longer leave database locks
- Validate todos is array before calling .filter()
- Opening already-open project focuses existing window
- PDF viewer no longer freezes in infinite loading loop

---

**Full Changelog**: https://github.com/nimbalyst/nimbalyst-code/blob/main/CHANGELOG.md
