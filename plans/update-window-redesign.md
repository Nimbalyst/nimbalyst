---
planStatus:
  planId: plan-update-window-redesign
  title: Update Window Redesign
  status: in-development
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders:
    - ghinkle
  tags:
    - ui
    - electron
    - auto-update
    - user-experience
  created: "2025-10-09"
  updated: "2025-10-09T12:00:00.000Z"
  progress: 90
  dueDate: null
  startDate: "2025-10-09"
---
# Update Window Redesign

## Goals

Replace the current native dialog-based update notification system with a custom Electron window that provides:
- Better formatted release notes with proper markdown rendering
- Clean, modern UI similar to LM Studio's update window
- Progressive state transitions: notification -> download progress -> restart prompt
- Consistent theming with the rest of the application

## Current Implementation Issues

The current update system uses native Electron dialogs (lines 46-59 and 89-120 in autoUpdater.ts):
- Release notes are rendered as plain text in the dialog detail field
- No markdown support for formatting lists, headers, code blocks
- HTML in release notes appears as raw markup
- Dialog style is inconsistent with app theming
- No visual download progress indication
- Separate dialogs for "update available" and "update downloaded"

## Proposed Solution

Create a dedicated UpdateWindow component similar to AboutWindow:

### Window States

1. Update Available State
  - Large app icon at top
  - Current version display
  - New version display with arrow
  - Formatted release notes in scrollable area
  - Two buttons: "Later" and "Download Update"

2. Downloading State
  - Window shrinks vertically
  - Shows download progress bar
  - Displays download speed and percentage
  - Shows "Downloading update..." message
  - No buttons (non-dismissible during download)

3. Ready to Install State
  - Shows "Update downloaded" message
  - Single button: "Restart to Update"
  - Shows version being installed
  - Optional "Install Later" to dismiss

### Technical Architecture

#### New Files
- `packages/electron/src/main/window/UpdateWindow.ts` - Main window creation and management
- `packages/electron/src/renderer/update.html` - HTML template for update window
- `packages/electron/src/renderer/update.css` - Styles for update window
- `packages/electron/src/renderer/update.ts` - Renderer-side logic for update UI

#### Modified Files
- `packages/electron/src/main/services/autoUpdater.ts` - Replace dialog calls with UpdateWindow
- `packages/electron/src/preload/index.ts` - Add IPC channels for update window communication

### Window Configuration

Based on AboutWindow pattern:
- Fixed size window (width: 600, initial height: 700)
- Non-resizable
- Non-minimizable
- No maximize button
- Title: "Update Available"
- Hidden inset title bar on macOS
- Modal-style presentation (always on top during interaction)

### State Management

UpdateWindow will listen to autoUpdater events:
- `update-available` - Show window in "update available" state
- `download-progress` - Update progress bar and stats
- `update-downloaded` - Transition to "ready to install" state
- `error` - Show error state with retry option

### IPC Communication

Renderer to Main:
- `update-window:download` - User clicked download button
- `update-window:install` - User clicked restart button
- `update-window:dismiss` - User clicked later button

Main to Renderer:
- `update-window:show-available` - Show update available with info
- `update-window:progress` - Update download progress
- `update-window:show-ready` - Show ready to install
- `update-window:error` - Show error state

### UI Components

Release Notes Rendering:
- Use marked.js or similar for markdown parsing
- Sanitize HTML output for security
- Custom styles for lists, headings, code blocks
- Scrollable container with max-height

Progress Display:
- Animated progress bar
- Show percentage (0-100%)
- Show download speed (MB/s or KB/s)
- Show bytes transferred / total bytes
- Estimated time remaining

### Theming

Follow existing theme system:
- Read theme from store via getTheme()
- Apply theme-specific backgrounds and colors
- Listen for theme-change events
- Support all themes: light, dark, crystal-dark, system

### Window Lifecycle

1. AutoUpdater detects update available
2. Create UpdateWindow if not exists, or focus if already open
3. Show "update available" state
4. User clicks "Download Update" -> emit download event
5. AutoUpdater starts download
6. Window transitions to "downloading" state, shrinks vertically
7. Progress events update the progress bar
8. Download completes
9. Window transitions to "ready to install" state
10. User clicks "Restart to Update" -> app quits and installs
11. User clicks "Install Later" -> window closes, update installs on next quit

### Error Handling

- Network errors during download: Show retry button
- Download verification failures: Show re-download option
- Generic errors: Display error message with contact info

## Implementation Steps

1. ✅ Create UpdateWindow.ts following AboutWindow pattern
2. ✅ Create update.html template with three state containers
3. ✅ Create update.css with theme support and animations
4. ✅ Create update.ts renderer script for state management
5. ✅ Add marked.js dependency for markdown rendering
6. ✅ Modify autoUpdater.ts to use UpdateWindow instead of dialogs
7. ✅ Add IPC handlers for update window communication
8. ✅ Update ThemeManager to send theme changes to update window
9. ✅ Configure electron-vite to build update.ts and copy static files
10. ✅ Build verification completed successfully
11. ⏳ Test all state transitions with real update
12. ⏳ Test theme switching while window is open
13. ⏳ Test error scenarios

## Implementation Notes

The implementation has been completed and successfully builds. All core files have been created:

### Files Created
- `/packages/electron/src/main/window/UpdateWindow.ts` (120 lines) - Window management with state functions
- `/packages/electron/src/renderer/update.html` (132 lines) - Multi-state UI template
- `/packages/electron/src/renderer/update.css` (397 lines) - Theme-aware styles
- `/packages/electron/src/renderer/update.ts` (172 lines) - Client-side state management with marked.js integration

### Files Modified
- `/packages/electron/src/main/services/autoUpdater.ts` - Replaced all dialog calls with UpdateWindow functions
- `/packages/electron/src/main/theme/ThemeManager.ts` - Simplified to send `theme-change` to ALL windows (removed window-specific update functions)
- `/packages/electron/electron.vite.config.ts` - Added update.html, update.css, and update.ts to build configuration
- `/packages/electron/package.json` - Added marked and @types/marked dependencies

### Architecture Improvements
- **Unified theme system**: ThemeManager now sends `theme-change` event to all windows instead of calling window-specific update functions
- **Self-contained windows**: Each window (about, update, AI models) listens to `theme-change` and updates its own UI
- **Simpler maintenance**: No need to register/unregister each new window type in ThemeManager

### Build Output
- Update window bundle: `out/renderer/assets/update-DJt3Y0Rv.js` (55.05 kB)
- All static assets (update.html, update.css) copied to output directory
- No build errors or warnings related to update window

### Next Steps
Testing requires either:
1. Publishing a test release to GitHub to trigger real update flow
2. Creating a local test harness to simulate update events
3. Using development tools to manually trigger update window states

## Acceptance Criteria

- Update window displays properly formatted release notes
- All three states (available, downloading, ready) work correctly
- Download progress is accurate and smooth
- Window respects current theme and responds to theme changes
- Error states provide clear feedback and recovery options
- Window is always on top when shown but doesn't block other windows when dismissed
- Clicking "Later" properly dismisses without affecting background update
- Restart button successfully triggers quit and install
