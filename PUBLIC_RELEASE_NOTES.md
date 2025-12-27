# Nimbalyst v0.49.14 Release Notes

## New Features

### Claude Agent Integration
- **Agent permission interface** - Integrating with claude-code settings json, control which tools agents can use with workspace trust levels
- **Wildcard domain patterns** - Permission multiple domains at once with wildcards like `*.example.com`
- **Permissions for compound commands** - Layer in individual permission checks for compound bash commands
- **Project Trust** - Check if user trusts project source
- **Clarifying questions** - Claude can now ask you clarifying questions during agentic sessions for better results
- **Context limit error widget** - Helpful widget when context limits are exceeded
- **Copy button for messages** - Copy AI responses and user messages from the transcript
- **Session quick open** - Press Cmd+L to quickly search and open AI sessions
- **Text attachments clickable** - Click text attachments to preview their content
- **Selected text context** - Text selection automatically included in AI prompts

### Editor & Extensions
- **PDF viewer** - View PDFs with text selection and fit-to-width zoom
- **Mockup Visual diff viewer** - See AI-generated mockup changes with before/after comparison

### Files Enhancements
- **Dotfiles in file tree** - Show dotfiles when "All Files" filter is selected
- **Enhanced New File dialog** - File type selection and folder picker
- **Quick Open improvements** - Find all files including dotfiles and images


## Fixed

- Improved reliability of queued messages
- File tree shows all folders in workspaces with large dependency directories
- Database backups no longer overwrite good data with corrupted backups
- File mentions match files with spaces in names
- Slash command menu arrow keys navigate in visual order
- Tabs reliably reopen with Cmd+Shift+T
- Closing AI session navigates to adjacent tab instead of first tab
- Typeahead menus no longer auto-select item under cursor on open
- MCP connection timeout increased to 20 seconds for slower server startups
