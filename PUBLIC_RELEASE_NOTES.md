# January 12 Release

We've been shipping fast. This release brings CSV spreadsheet editing, Excalidraw diagrams, inline charts in agent sessions, and a critical fix for Windows MCP users. Here are the highlights:

## CSV Spreadsheet Editor
Edit CSV files with a full spreadsheet experience - and let Claude Code edit them too:
- **Basic spreadsheet functions **
- **AI-driven spreadsheet editing with Claude Code **
- **Cell-level diff highlighting** - see exactly what the AI changed

## Excalidraw Drawing Editor
Draw diagrams and let Claude Code help:
- **AI-driven diagram editing** - ask Claude to create and modify your diagrams
- **Layout and Editing tools** for human editing
- **Import from Mermaid**

## Inline Charts and Images in Agent Sessions
Claude Code can now show you charts and images directly in the chat:
- **Display charts inline** - bar, line, pie, area, scatter
- **Display images** from disk in the conversation

## File  to AI Session Links and Unified Header Bar
All editor types now share a consistent header bar:
- **File AI Session History** - reopen any ai session that edited this file for seamless context
- **Breadcrumb navigation** across all editors
- **Diff approval bar **now appears for markdown, Monaco, and mockup files

## Windows MCP Fix
For our Windows users - MCP servers now work correctly:
- **Environment variable expansion** fixed
- **Argument quoting** fixed
- **OAuth lock file cleanup** prevents connection errors

## Quality of Life Improvements
- **Clickable file paths** in agent transcript tool arguments
- **File tree auto-scroll** now works when switching tabs

## Bug Fixes
We squashed many bugs:
- Consecutive AI edits now correctly update diff mode
- Cmd+Y no longer opens document history when in agent mode
- Claude Code now sees file-scoped extension tools
- Sync connections no longer fail silently when limit reached
- Typing in AI input no longer causes lag
- AI session lookups work across multiple windows
- Plugins installed from the Claude Code CLI now correctly work in Nimbalyst

Thanks for being part of the Nimbalyst community. Your feedback drives these improvements!

