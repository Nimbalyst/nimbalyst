# Nimbalyst v0.47.2 Release Notes

This release brings Windows support, improved collaboration features, and numerous quality-of-life improvements.

## New Features

### Windows Support
- Universal Windows installer now supports both x64 and arm64 architectures
- Full Windows compatibility with cross-platform path handling
- Improved Claude Code integration on Windows

### Collaboration & Sync
- Cross-device AI session sync between desktop and mobile app
- Mobile messages now trigger AI processing on desktop
- QR code pairing for mobile app sync with end-to-end encryption
- Device awareness showing connected devices in sync settings
- Sync status button in navigation gutter with visual indicator
- Session titles and queued prompts are now encrypted end-to-end
- Mobile credentials encrypted via iOS Keychain / Android Keystore

### Authentication
- Stytch authentication with Google OAuth and magic link email support
- Server-side token validation for authentication via CollabV3
- Session persistence across app restarts via encrypted safeStorage
- Account & Sync panel (visible to alpha users only)

### File Management
- Git status icons in file tree showing modified/untracked files
- Toggle control to show/hide git status icons in file tree
- Multi-select files in file tree
- Dirty filter indicator to show unsaved changes
- File tree filtering with type-specific icons
- Natural sorting in file tree
- Recent files quick access

### AI Features
- Toast notification prompting users to install Claude commands in your workspace
- Folder History dialog to browse and restore deleted files
- AI chat @mention now supports CamelCase search for file matching
- Document links now export as standard markdown and support fuzzy search
- Session list shows relative dates (e.g., "2 hours ago") instead of absolute timestamps
- AI Usage Report now shows token counts for Claude Code sessions
- Slash command suggestions displayed in empty chat sessions
- Mouseover tooltips for slash command suggestions
- (+) button to expand and show all suggested slash commands
- Warning dialog before quitting with active AI session
- Virtualized AI transcript for smoother scrolling in long sessions
- Click to enlarge image attachments in AI chat input
- Close attachment viewer with Escape key

### Mockup System
- MockupLM-style mockup editor with AI integration
- `/mockup` command for creating mockups
- Mockup nodes support resizing with size persistence
- Embed mockups as screenshot nodes in documents
- Mockup annotations now sent to agent
- Mockup images load correctly when reopening documents

### UI Improvements
- Feature walkthrough with onboarding images for new users
- Unified settings view with project-level AI provider overrides
- Settings now opens as full view instead of modal window
- Improved onboarding images for better display on different screen sizes
- General UI polish and refinements to onboarding experience
- Session search filter and content search
- Model version now displayed in selector for Claude Code

### Developer Tools
- Database browser developer tool (Developer menu)
- Standup changes summary generator (`/mychanges` command) for recent git commits
- `/mockup` command for creating mockups
- Recursive scanning for Claude commands and agents (BMAD v4 fix)
- Maximum file scan limit increased from 1,000 to 2,000
- Message timestamps show date when not from today
- AI usage analytics dashboard

## Improvements

- Role field now marked as required in data collection form
- Updated data collection form
- Improved git availability detection with more comprehensive checking
- Updated Claude Agent SDK to version 0.1.62
- Rebranded "Claude Code" to "Claude Agent" in UI
- Improved onboarding images for better display on different screen sizes
- Session history sorts by last message time instead of last activity
- Consolidated icons under unified MaterialSymbol system
- Session timestamps now match sort order for consistent display
- Mockup nodes now use standard linked image markdown syntax instead of custom syntax
- Updated LINK and IMAGE transformer regexes to not match linked images
- Use cross-env for build script environment variables (Windows compatibility)
- Renamed "wireframe" to "mockup" throughout codebase for consistency
- Improved mockup annotations styling
- Removed "Send to AI" button from UI
- Updated `/plan` command to use `/mockup`
- Incremental sync that only syncs changed sessions on startup

## Fixed

### Windows Issues
- Fixed Claude Code logout process on Windows
- Windows users now see a warning that they need Claude Code installed

### File & Editor Issues
- Mockup images now load correctly when reopening documents
- Mockup image syntax now matches actual transformer format
- Clicking files in agent mode now properly switches to files mode
- History restore tests now work with diff preview mode
- Git install popup no longer shown if git is not installed
- Mobile app now shows "Running" indicator for desktop-initiated AI prompts
- Onboarding dialog not displaying in production builds
- New projects no longer auto-open settings screen

### AI & Session Issues
- AI Usage Report no longer resets token counts after each message
- Claude Code sessions now work in new/existing projects
- Session list now shows correct user message count
- AI input stays focused when switching modes or tabs
- Slash command menu now shows best matches first
- Project search now shows best matches first
- Queued AI messages no longer fire immediately while AI is responding
- Mobile session view no longer requires refresh after JWT expires

### UI Issues
- Mermaid diagram edit mode now displays correctly in dark mode
- Mermaid diagrams no longer intermittently show "[object Object]" error
- @ typeahead menu now positions correctly when scrolled
- Table action menu and dropdown now display correctly in dark mode
- Table context menu and hover buttons now position correctly when scrolled
- QR pairing modal no longer overflows screen in dev mode
- Session titles now display correctly on mobile
- Mobile-queued prompts now show thinking indicator on desktop

### Security & Privacy
- Encrypted tool names and message metadata in sync system (previously exposed as plaintext)
- Tool names, attachments metadata, and content length now encrypted in synced messages
- No keychain access prompt when sync is disabled
- Sync server now restricts CORS to allowed origins only
- Magic link now requires HTTPS redirect URL in production

### Performance
- Lazy-load session tabs to prevent slow startup with many open sessions
- Token usage bar now shows actual usage instead of appearing full
- Sync no longer creates duplicate messages or excessive WebSockets
- Mobile-queued prompts no longer duplicate or refire on desktop

### Other Fixes
- Prompt caching support for AI responses (reduces API costs and improves response times)
- Users migrating from older versions now see all available Claude Code models
- Speculative fix for NIM-118: cannot-open-file-editorregistry-error-prevents-tab-creation
- npm security vulnerabilities patched
- Stale data now cleared when switching sessions on mobile
- Duplicate thinking indicators no longer appear in AI transcript
- Mockup drawings render correctly on scrolled content
- Mockup Edit button now opens file in tab
- File tree items now have border-radius
- iOS mobile app now decrypts session titles and saves credentials
- Hidden messages now stay hidden when synced to mobile app
- Mobile session list now matches desktop sort order
- Session title updates now sync to mobile app

---

*Generated with Claude Code*
