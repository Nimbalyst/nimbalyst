# Release Notes - v0.42.60

## Bug Fixes
- Fixed file selection not clearing when tab is closed
- Fixed tracker document header not appearing on initial load
- Fixed files not marked dirty when tracker updates frontmatter
- Fixed error handling for missing directories in folder contents retrieval

## Improvements
- Claude Code now updates database and notifies panel to check for updates
- MCP stream tool now operates synchronously for better reliability
- AI tools now require explicit file paths for better clarity

## Refactoring
- Modernized end-to-end test infrastructure
- Removed deprecated getDocument tool
