# Nimbalyst v0.48.13 Release Notes

## New Features


### AI Improvements
- Claude model selection: Choose between Opus 4.5, Opus 4, Sonnet 4, and more
- Session archiving with multi-select support
- Large text pastes automatically become attachments to keep transcripts clean
- Slash command suggestions displayed in empty chat sessions
- Memory mode for quick context addition


### Editor Enhancements
- DataModelLM: Visual data model schema editor with AI integration, auto-layout and export to DDL, JSON, DBML
- Git status icons in file tree showing modified/untracked files
- File tree filtering for modified files and by file type
- Multi-select files in file tree
- Mouse back/forward buttons navigate between tabs
- Cmd+Shift+T reopens last closed tab
- Native spell check with correction suggestions


### File & History
- Folder History dialog to browse and restore deleted files
- Document links now export as standard markdown and support fuzzy search
- File context menu opens files in system default application
- @ mentions in AI chat support CamelCase search for file matching


## Improvements

- Auto-updater uses subtle toast instead of intrusive popup window (you'll see this in the next release)
- Session list shows relative dates ("2 hours ago") instead of timestamps
- Window title shows AI session name when in agent mode
- Unified settings view with project-level AI provider overrides
- Improved mockup annotations styling


## Fixed

- Images display correctly in all tabs
- Mermaid diagrams error handling improved
- Table action menu and context menu position correctly when scrolled
- Mockup images load correctly when reopening documents
- One failing editor tab no longer breaks the entire app
