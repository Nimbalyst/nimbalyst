# Nimbalyst v0.46.0 - Public Release Notes

### New Features

- **File tree filtering**: Filter files by git status (modified, untracked, all files)
- **Choose your Claude model**: Select from Opus 4.5, Opus 4, Sonnet 4, and other Claude models when chatting with AI
- **Session archiving**: Archive AI sessions you're done with to keep your workspace organized
- **Image attachments work everywhere**: Pasted images now work correctly in all markdown editors, not just Nimbalyst
- **File mentions auto-attach**: @ mentioned files automatically attach when using OpenAI, LMStudio, or Claude API providers
- **Image thumbnails in chat**: View image thumbnails directly in the AI agent transcript
- **Reopen closed tabs**: Press Cmd+Shift+T to reopen the last tab you closed
- **Native spell check**: Right-click misspelled words to see spelling suggestions, learn spellings, or ignore them
- **Blue dot indicators**: See which documents have pending AI edits that haven't been accepted yet

### Improvements

- **Cleaner projects**: Chat attachments are now stored in a dedicated folder instead of cluttering your project directory
- **Better file navigation**: Clicking files in AI agent transcripts now properly opens them in editor mode
- **Improved file mention display**: Better display and scrolling for file mention typeahead

### Fixed

- **Session dropdown sync**: Session dropdown now syncs correctly across agent and files modes
- **Better error visibility**: API errors now show clearly in the chat instead of failing silently
- **Code diff view restored**: Diff visualization now properly displays for code files when reviewing AI changes
- **Manual edits preserved**: Edits you make while reviewing AI diffs are no longer lost when accepting, rejecting, or switching tabs
- **More reliable AI editing**: Fixed issues where AI edits could go to the wrong document when switching tabs
- **Cross-platform compatibility**: Better path handling for Windows compatibility
- **OpenAI, LMStudio, and Claude API providers fixed**: These providers were completely broken - responses weren't showing and AI edits weren't being applied. They now work correctly
