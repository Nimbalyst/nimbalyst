# Release Notes

## v0.42.31 - TBD

### Features
- Image attachment support for AI chat - drag/drop or paste images directly into chat
- Slash command typeahead in agentic coding interface for quick command access
- File mention support with typeahead in chat input (@filename)
- AI session file tracking UI with real-time updates
- Rich markdown formatting in agent transcript output
- Custom update window with markdown support and unified theming
- Session type filtering and improved tab management
- Markdown paste support - automatically transforms pasted markdown into rich text

### Improvements
- Auto-resize chat input with file mention formatting and cancel functionality
- Centralized directory/file exclusion logic with git worktree support
- Better tool filtering based on session type (chat vs coding)
- Dark mode theming improvements for typeahead menu
- Enhanced external change detection on tab switch and window focus

### Bug Fixes
- Fixed session state not being saved before window close on quit
- Fixed AI editing targeting wrong tab
- Fixed sessions connecting to wrong document
- Fixed coding sessions created with incorrect session type
- Fixed agentic coding window session creation

## v0.42.30 - 2025-10-09

### Bug Fixes
- Fix auto-update checksum mismatch by including zip files in releases
- Fix AI text duplication after tool calls in chat
- Fix markdown export filtering of removed diff nodes

### Features
- Add Cmd+Shift+T shortcut to reopen closed tabs
- Add developer option to show all tool calls in AI chat
- Show tool call results when expanded in chat

## v0.42.28 - 2025-10-09

### Bug Fixes
- Fix window ID retrieval for restoring window state
- Fix exclude git worktrees from quick open and file search results
- Fix claude-code provider to properly use its own tools in coding mode
- Fix prevent workspace and agentic window tab state conflicts
- Fix release notes extraction from git tags
- Fix disappearing plan table when filtering

### Features
- Add folder selection and improved drag-and-drop to file tree
- Optimize Quick Open with file name caching and on-demand content search
- Enhance image transformer to store size after resizing
- Add agent integration instructions

### Improvements
- Quick Open performance optimizations with intelligent caching
- Better drag-and-drop file handling in file tree
- Improved window state persistence and restoration

## v0.42.27 - 2025-10-08

### Features
- Content-addressed image storage for better asset management
- Tracker items management with database integration and UI components
- Left gutter navigation and agentic coding window
- PlanScreen and PlanTable components with filtering and sorting

### Bug Fixes
- Fix workspace package bundling to ensure latest code is included in packaged app
- Fix Excalidraw image export "document is not defined" error with dynamic imports
- Fix image decorator node export with proper fallback to text content
- Filter out tabs for deleted files during session restoration
- Decorator nodes transformers for images
- Window restoration ordering
- Plan table row clicks now open documents in tabs
- Colliding window state storage for agent and workspace windows
- Content-based detection for external file changes
- Broken item tracker plugin
- External file change detection with multi-layered approach and history integration
- Plan table not reopening due to missing isVirtual storage
- Wrong search dialog after switching tabs using useIsEditorActive
- Autosave, multitab reference and timing issues

### Improvements
- Migrate to Claude Agents SDK and use bundled version
- Use disallowTools instead of allowedTools for Claude Code
- Switch AI sidebar to new renderer
- Normalize CSS variables across project
- Remove unnecessary console logs from file watchers
- Remove use of require causing build/packaging/performance problems
- Add eslint rule to prevent require usage
- Enable Debug Tree View toggle in development mode
- Add allowed tools configuration for Claude Code in settings

## v0.42.24 - 2025-10-03

### Features
- Add item tracker plugin with task, bug, and plan support

### Bug Fixes
- Fix newlines lost on file open
- Fix error toast dismissal handling
- Fix decorator nodes with non-element transformers not working
- Fix editorRegistry imports and enhance streaming functionality
- Fix tsconfig compilation issues

## v0.42.23 - 2025-10-02

### Bug Fixes
- Fixed AI edits targeting wrong document in multi-tab scenarios
- Fixed dark mode immediate switching for editor and UI elements
- Fixed decorator node duplication on diff applies
- Fixed restore from history functionality

### Features
- Enhanced document link trigger to support dots in filenames
- Added auto-scroll for active tab in tab bar
- Improved kanban compatibility with new tab system
