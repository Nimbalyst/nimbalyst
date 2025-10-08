# Release Notes

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
