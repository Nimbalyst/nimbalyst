# Nimbalyst v0.50.18

We're excited to announce the latest version of Nimbalyst, packed with powerful new features and improvements to enhance your development workflow.

## New Features

### Terminal & MCP Integration
- **Terminal sessions in agent mode** - Run terminal commands directly with full command history and scrollback persistence
- **17 new MCP server templates** - Pre-configured templates with brand icons for popular services
- **OAuth authorization for MCP servers** - Connect to remote MCP servers with OAuth support
- **PostHog MCP server** - Query your analytics data directly with slash commands
- **Enhanced MCP configuration UI** - Toggle servers on/off with improved template selection flow

### AI & Agent Features
- **Claude can ask clarifying questions** - AskUserQuestion support for better collaboration during sessions
- **Agent tool permission system** - Control what tools agents can use with workspace trust levels
- **Context limit error widgets** - Helpful widgets when hitting context limits with clear action buttons
- **Session quick search** - Cmd+L shortcut to quickly search and open AI sessions
- **Session archiving** - Archive completed sessions with multi-select support
- **Inline session rename** - Quickly rename sessions without opening dialogs
- **Full-text session search** - Search across all sessions to find past conversations
- **Claude model selection** - Choose from Claude Opus 4.5, Opus 4, Sonnet 4, and more

### Editors & Extensions
- **CSV spreadsheet editor** - Full spreadsheet functionality with formulas, undo/redo, right-click menus, and header row toggle
- **PDF viewer** - View PDFs with text selection and fit-to-width zoom
- **Extension Developer Kit** - Build custom extensions with hot-reloading MCP tools
- **Visual mockup diff viewer** - See AI-generated mockup changes side-by-side
- **Monaco diff mode** - Inline diff mode for code editors with change navigation

### File Management
- **Enhanced New File dialog** - Select file types and folders with an improved creation experience
- **File tree filtering** - Filter by git modified files, read/written files, and custom file types
- **Cmd+Shift+T to reopen tabs** - Restore recently closed tabs
- **Quick Open improvements** - Find all files including dotfiles and images
- **Git status icons** - See modified and untracked files in the file tree

### Other Features
- **Text attachments** - Large text pastes automatically become attachments to keep transcripts clean
- **Wildcard domain patterns** - Support for wildcard domain patterns and "Allow All Domains" button
- **Alpha release channel** - Internal testing channel for early access to features

## Improvements

- **Enhanced permissions modal** - Less intimidating messaging and improved UX to prevent race conditions
- **Better diff visualization** - Diffs now show only new changes after approving with Keep All
- **Terminal theme support** - Terminal sessions respect light/dark theme preferences
- **Improved file tree** - Natural sorting, git status icons, and dirty file indicators
- **Better session list** - Shows relative dates and correct message counts
- **Enhanced image handling** - Click to enlarge attachments, close with Escape
- **Improved agent transcript** - Virtualized for smoother scrolling in long sessions
- **Extension system improvements** - Extensions can add slash commands, custom editors, and Lexical nodes
- **Better error messages** - Clearer errors for authentication, file operations, and system issues
- **Streamlined settings** - Auto-save settings with scope descriptions
- **Better URL handling** - Improved URL permission system with persistent choices

## Fixed

### File Tree & Navigation
- File tree truncation causing folders to disappear
- File tree shows all folders in workspaces with large dependency directories
- File mentions match files with spaces in names
- Sessions from other workspaces no longer appear in wrong project
- Ctrl+W on Windows closes tabs instead of whole window
- Tabs reliably reopen with Cmd+Shift+T
- Closing AI session navigates to adjacent tab

### Permissions & Security
- Permissions modal race conditions and UX improvements
- API keys no longer logged in console
- Encrypt project_id in mobile sync for privacy
- Permissions on internal builds
- Compound bash commands now require approval for each part
- Long Bash commands in permission dialog scroll vertically
- Permission prompts no longer repeat
- URL permissions persist correctly across AI sessions
- WebSearch and WebFetch permission "Allow Always" persists correctly
- Parallel tool permissions now queue instead of overwriting

### Editors & Extensions
- Mermaid diagram changes now visible in diff mode
- Extension manifest/output mismatches caught at build time
- Table action menu positioning when document is scrolled
- PDF viewer loading in packaged builds
- CSV and custom editors no longer re-render on autosave
- Diff mode table widths display correctly
- CSV spreadsheet delete now correctly clears cells
- Custom editors interactive on session restore
- PDF and DataModelLM extension styles load after Vite 7 upgrade
- Extensions include dist folders in packaged builds
- Extensions load correctly on Windows
- Extension reload validation correctly detects components export
- Custom editors save on close and support source mode
- DatamodelLM editor no longer reloads on every user edit
- CSV spreadsheet row header selection
- AI edits no longer trigger false autosaves in diff mode
- CSV spreadsheet dark mode improvements
- CSV editor no longer steals keyboard input from dialogs
- Images display correctly in all tabs
- Tab state corruption preventing files from opening

### AI & Sessions
- Cmd+F in files mode now opens editor find instead of transcript find
- AI chat in files mode now knows which document is open
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
- Token counting works with Claude Agent SDK
- Login widget no longer triggers on normal AI responses
- Diffs now show only new changes after approving with Keep All

### MCP & Servers
- Many MCP server configuration issues
- PATH handling for MCP servers
- Playwright MCP configuration
- Mobile sync commands fail gracefully when encryption unavailable

### Theme & UI
- Theme changes now apply to all open editors
- Diff header buttons visible in narrow panels
- Settings panel content scrolls properly
- Slash command suggestions match transcript width
- Archive button updates immediately
- Toast notification positioning
- Typeahead menus no longer auto-select item under cursor

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

This release represents significant progress in stability, features, and user experience. We hope you enjoy using Nimbalyst!
