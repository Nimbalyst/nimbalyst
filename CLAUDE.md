# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Codebase Overview

This is Nimbalyst - a rich text editor built with Meta's Lexical framework. Originally based on the Lexical playground, it's been adapted as the foundation for a new editor project with comprehensive features including rich text editing, tables, collaboration, code highlighting, and various plugins.

## Development Commands

### Electron App
- **Start dev server**: `cd packages/electron && npm run dev` - Runs Electron app with hot reload
- **Build for Mac**: `cd packages/electron && npm run build:mac:local` - Creates local Mac build
- **Build for Mac (notarized)**: `cd packages/electron && npm run build:mac:notarized` - Creates notarized Mac build

### Monorepo Setup
- **Install dependencies**: `npm install` - Install all dependencies
- **Package management**: Uses npm workspaces (not pnpm)

## Releases

For detailed release instructions, see [RELEASING.md](RELEASING.md).

**Quick reference for Claude Code:**
- Use the `/release [patch|minor|major]` command
- The command will guide you through updating CHANGELOG.md and creating the release
- All release notes go in the `[Unreleased]` section of `CHANGELOG.md`
- The release script automatically creates versioned entries and annotated git tags

## Testing

The project uses multiple testing approaches:

- **Unit tests**: Located in `__tests__/unit/` using vitest
- **E2E tests**: Located in `__tests__/e2e/` using Playwright 
- **Regression tests**: Located in `__tests__/regression/` using Playwright

The tests are organized by functionality (CopyAndPaste, Headings, etc.) and include both behavior testing and regression testing for specific issues.

## Architecture

### Core Structure
- `src/App.tsx` - Main application wrapper with LexicalComposer setup
- `src/Editor.tsx` - Core editor component with all plugins
- `src/nodes/` - Custom Lexical nodes (Image, Emoji, Equation, etc.)
- `src/plugins/` - Feature plugins (AutoLink, CodeHighlight, Tables, etc.)
- `src/themes/` - Editor themes and styling
- `src/ui/` - Reusable UI components

### Key Components
- **PlaygroundNodes.ts**: Registers all custom node types
- **Editor.tsx**: Orchestrates all plugins and editor functionality
- **Context providers**: Settings, History, Toolbar, and FlashMessage contexts
- **Plugin system**: Modular features like AutoComplete, DragDrop, FloatingToolbar

### Plugin Architecture
The editor uses a comprehensive plugin system where each feature is implemented as a separate plugin in `src/plugins/`. Plugins handle everything from basic functionality (AutoLink, CodeHighlight) to complex features (Tables, Collaboration, DragDrop).

### Floating Element Positioning (CRITICAL)

When creating floating UI elements (menus, dropdowns, toolbars) that need to appear near editor content:

1. **Portal Target**: Use `floatingAnchorElem` (editor-scroller) as the portal container. This element has `position: relative` and `overflow: auto`.

2. **Position Calculation**: ALWAYS account for scroll offset:
   ```typescript
   const anchorRect = anchorElem.getBoundingClientRect();
   const top = targetRect.top - anchorRect.top + anchorElem.scrollTop;
   const left = targetRect.left - anchorRect.left + anchorElem.scrollLeft;
   ```

3. **Why This Matters**: The editor content scrolls inside `editor-scroller`. Using viewport coordinates without scroll offset will position elements incorrectly when scrolled.

4. **Never use `scrollIntoView()`**: It scrolls ALL ancestors, including the editor. Instead, manually adjust `scrollTop` on the specific container.

See `TableActionMenuPlugin`, `TableHoverActionsPlugin`, and `TypeaheadMenuPlugin` for reference implementations.

### Node System
Custom nodes extend Lexical's base functionality:
- ImageNode/InlineImageNode for image handling
- EquationNode for KaTeX math equations
- EmojiNode, MentionNode, KeywordNode for special text
- Layout nodes for column layouts
- ExcalidrawNode for drawings

### Styling and Themes
- CSS modules and regular CSS files for component styling
- Theme system in `src/themes/` for consistent editor appearance
- Responsive design with mobile considerations

### State Management Patterns

For ephemeral UI state that needs to be shared across React component boundaries (especially between editor and AI chat), the codebase uses window globals as a simple pub/sub mechanism.

**Pattern:**
- Store state on window: `(window as any).__featureName`
- Notify via custom event: `window.dispatchEvent(new CustomEvent('event-name'))`
- Subscribe with `useSyncExternalStore` for React 18 compatibility

**Examples:**
- **Text selection**: `__textSelectionText`, `__textSelectionFilePath`, `__textSelectionTimestamp`
- **Mockup annotations**: `__mockupSelection`, `__mockupDrawing`, `__mockupAnnotationTimestamp`

**Key implementation files:**
- `TextSelectionIndicator.tsx`: Reference implementation showing subscribe/notify pattern
- `TabEditor.tsx`: Example of updating state from editor (with debouncing)
- `AgenticPanel.tsx`: Example of consuming state when sending messages
- `useDocumentContext.ts`: Example of reading state for document context

**Best practices:**
- Use `useSyncExternalStore` for React subscriptions (not manual event listeners in useEffect)
- Debounce high-frequency updates (e.g., selection changes on cursor movement)
- Include timestamps to track when state was last updated
- Clear state when switching tabs or closing relevant UI

**When to use this pattern:**
- State needs to cross major component boundaries (editor ↔ AI chat)
- State is ephemeral and doesn't need persistence
- React context would cause unnecessary re-renders
- State updates are event-driven and asynchronous

**When NOT to use:**
- Persistent state (use IPC to main process instead)
- State within a single component tree (use React state/context)
- Complex state management (consider Redux or Zustand)

## Important File Patterns

- Plugin files follow `src/plugins/[PluginName]Plugin/index.tsx`
- Node files in `src/nodes/[NodeName].tsx`
- UI components in `src/ui/[Component].tsx` with accompanying CSS
- Themes in `src/themes/[ThemeName].ts` and `.css`

## Dependencies

Built with modern React, TypeScript, and Vite. Uses extensive Lexical packages (@lexical/*) for editor functionality, plus supporting libraries like KaTeX for equations, Prettier for code formatting, and Excalidraw for drawings.

## macOS Code Signing & Notarization

The Electron app supports notarized distribution for macOS:

- **Signing configuration**: Uses Developer ID Application certificate
- **Build scripts**: `npm run build:mac:notarized`&#32;for notarized build, `build:mac:local` for local testing
- **Binary handling**: Properly signs ripgrep and other bundled tools
- **JAR exclusion**: Automatically removes JAR files that can't be notarized
- **Entitlements**: Configured for hardened runtime with necessary exceptions

## Electron App Logging

The Electron app has multiple log outputs:

### Main Process Logs
- **Location**: `~/Library/Application Support/@nimbalyst/electron/logs/main.log` (macOS)
- **View live**: `tail -f ~/Library/Application\ Support/@nimbalyst/electron/logs/main.log`
- **What's logged**: Main process events, AI service, sync operations, file operations
- **Categories**: `(MAIN)`, `(AI)`, `(API)`, `(SYNC)`, etc.

### Renderer Console Logs
- **Location**: `~/Library/Application Support/@nimbalyst/electron/nimbalyst-debug.log` (macOS)
- **What's logged**: Browser console messages from renderer process
- **When active**: Only in development mode (`NODE_ENV !== 'production'`)
- **Implementation**: `packages/electron/src/main/index.ts` - uses `webContents.on('console-message')`

### Quick Debug Commands
```bash
# Watch main process logs live
tail -f ~/Library/Application\ Support/@nimbalyst/electron/logs/main.log

# Search for specific events
grep "queuedPrompts\|index_broadcast" ~/Library/Application\ Support/@nimbalyst/electron/logs/main.log | tail -50

# Watch sync-related logs
tail -f ~/Library/Application\ Support/@nimbalyst/electron/logs/main.log | grep -E "CollabV3|Sync"
```

## Theme Support

The editor supports multiple themes:
- **Light**: Clean, bright theme for daytime use
- **Dark**: Standard dark theme with warm gray colors (#2d2d2d, #1a1a1a, #3a3a3a)
- **Crystal Dark**: A premium dark theme with Tailwind gray scale colors (#0f172a, #020617, #1e293b)
- **Auto**: Follows system preference

The Electron app includes a Window > Theme menu to switch between all themes. The selected theme is persisted and applied to all windows.

### CRITICAL THEMING RULES
- **NEVER hardcode colors in CSS files** - Always use CSS variables
- **Single source of truth**: `/packages/electron/src/renderer/index.css` is the ONLY place where theme colors are defined
- **Always set both**: When applying themes, set both `data-theme` attribute AND CSS class on root element
- **See THEMING.md**: Comprehensive theming documentation at `/packages/electron/THEMING.md`

### CSS Variables Reference

**CRITICAL: NEVER MAKE UP CSS VARIABLE NAMES!**

When writing CSS, you MUST use the correct CSS variables from `/packages/rexical/src/themes/PlaygroundEditorTheme.css`. Do NOT invent variable names.

**Correct CSS variables:**
- `--surface-primary` - Primary background surface (NOT `--bg-primary`)
- `--surface-secondary` - Secondary background surface (NOT `--bg-secondary`)
- `--surface-tertiary` - Tertiary background surface (NOT `--bg-tertiary`)
- `--surface-hover` - Hover state background
- `--border-primary` - Primary border color (NOT `--border-color`)
- `--text-primary` - Primary text color
- `--text-secondary` - Secondary text color
- `--text-tertiary` - Tertiary/muted text color
- `--primary-color` - Primary accent color (NOT `--accent-color`)

**CSS Rules:**
1. **ALWAYS reference** `/packages/rexical/src/themes/PlaygroundEditorTheme.css` when writing CSS
2. **NEVER hardcode** theme-specific styles (no `[data-theme="dark"]` selectors)
3. **NEVER invent** CSS variable names - only use variables that exist in PlaygroundEditorTheme.css
4. **CSS variables handle theming** - they automatically adapt to light/dark/crystal-dark themes

## Window State Persistence

The Electron app includes comprehensive window state persistence:

### Session State
- **Global session state**: Restores all windows when the app restarts
- **Window position and size**: Each window's bounds are saved and restored
- **Focus order**: Windows are restored in the correct stacking order
- **Developer tools state**: Dev tools are reopened if they were open when the window was closed

### Project-Specific State
- **Per-project window state**: Each project remembers its own window configuration
- **Persistent across sessions**: Opening a project restores its last window position, size, and dev tools state
- **File state**: Remembers which file was open in each project window

### AI Chat Integration
- **Panel width persistence**: The AI Chat panel width is saved per-window
- **Collapsed state**: Whether the AI Chat panel is visible or hidden is remembered
- **Draft input persistence**: Unsent messages in the chat input are saved with the session
- **Session continuity**: Chat sessions persist across app restarts

## Electron Main and Renderer Processes
Electron apps are split into two main contexts: the **main process** and one or more **renderer processes**.
- **Main process**: Runs Node.js, manages application lifecycle, windows, menus, and system interactions
- **Renderer process**: Runs in a Chromium browser context, handles UI rendering and user interactions

Whenever working in the main process, do your best to use the NodeJS APIs to write platform-independent code. This is
crucial because we target platforms that use different conventions (Windows, macOS, Linux).
Example:
```typescript
// GOOD: Cross-platform path handling
import * as path from 'path';
const fileName = path.basename(filePath, '.md');

// BAD: Hardcoded path separators
const fileName = filePath.split('/').pop()?.replace('.md', '');
```

But the renderer processes cannot access Node.js APIs directly for security reasons. Do not attempt to re-implement NodeJS
native APIs in the renderer as this is fraught with cross-platform challenges. Instead, use IPC to request services from
the main process.

## IPC Communication

The Electron app uses IPC (Inter-Process Communication) between main and renderer processes:

### Preload API
- **Location**: `/packages/electron/src/preload/index.ts`
- **Exposed as**: `window.electronAPI` (NOT `window.api` - this is important!)
- **Generic IPC methods**: The electronAPI includes generic `invoke`, `send`, `on`, and `off` methods for flexible service communication
- **Service pattern**: Renderer services use these generic methods to communicate with main process services

### Document Service
- **Main process**: `ElectronDocumentService` handles file scanning, metadata extraction, and caching
- **Renderer process**: `RendererDocumentService` acts as a facade, using IPC via `window.electronAPI` to communicate with main process
- **Metadata API**: Supports frontmatter extraction and caching for all markdown documents with bounded file reads (4KB)
- **IPC channels**: `document-service:*` for all document-related operations including metadata

### Common IPC Issues
- **window.api undefined**: The preload exposes `window.electronAPI`, not `window.api`. Ensure renderer services use the correct reference.
- **Empty responses**: If IPC calls return empty data, check that the window state is properly set to workspace mode with a valid workspace path.
- **Service resolution**: The main process resolves services based on the window's workspace path. No workspace = no service.

## AI Features

### AI Providers

The application supports multiple AI providers, including two distinct ways to access Claude:

#### Claude (Anthropic API)
- **Direct API integration**: Uses the official Anthropic SDK (`@anthropic-ai/sdk`)
- **Provider ID**: `claude`
- **Location**: `packages/runtime/src/ai/server/providers/ClaudeProvider.ts`
- **Features**: 
  - Standard Claude models (Opus 4.1, Opus 4, Sonnet 4, Sonnet 3.7)
  - Streaming responses with tool use support
  - Direct API key authentication
  - Full control over model selection
- **When to use**: For standard AI chat and code assistance using Claude models directly

#### Claude Code (MCP Integration)
- **MCP Protocol**: Uses Model Context Protocol for enhanced code-aware features
- **Provider ID**: `claude-code`
- **Implementation**: `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts`
  - Dynamically loads `@anthropic-ai/claude-agent-sdk` SDK from user's installation
  - Requires local installation via npm
  - Provides MCP features through SDK
- **Features**:
  - Enhanced code understanding through MCP
  - File system awareness and manipulation
  - Advanced code editing capabilities
  - Manages its own model selection internally (do not pass model IDs)
- **Installation**: Requires `npm install -g @anthropic-ai/claude-agent-sdk` or local installation
- **When to use**: For advanced code editing tasks that benefit from MCP's context protocol
- **Internal MCP Servers**: See [INTERNAL_MCP_SERVERS.md](docs/INTERNAL_MCP_SERVERS.md) for how to implement and add new MCP servers

#### Other Providers
- **OpenAI**: GPT-4 and GPT-3.5 models via OpenAI API
- **LM Studio**: Local model support for privacy-focused usage
- **Multiple provider support**: Extensible architecture for adding new AI providers

### AI Chat Panel
- **Multi-provider support**: Works with Claude, OpenAI, LM Studio, and Claude Code
- **Document-aware**: Sends current document context with messages when a document is open
- **No-document handling**: Clear messaging when no document is open, prevents edit attempts
- **Session management**: Multiple chat sessions per project
- **Edit streaming**: Real-time streaming of code edits directly to the editor
- **Dynamic UI**: Provider-specific icons and names throughout the interface
- **Keyboard shortcut**: Cmd+Shift+A to toggle the AI Chat panel

### Session Manager
- **Global session view**: Access all AI chat sessions across all projects (Cmd+Alt+S)
- **Session search**: Filter sessions by content, project, or date
- **Session details**: View full conversation history for any session
- **Session actions**: Open, export, or delete sessions
- **Left navigation design**: Clean interface with session list on left, details on right

### AI Model Configuration
- **Dynamic model selection**: Models are fetched from provider APIs when available
- **No hardcoded models**: Providers manage their own model defaults
- **Claude Code specifics**: Never pass model IDs to claude-code provider - it manages its own model selection
- **LM Studio detection**: Automatically detects local models running in LM Studio
- **Model management**: Select/deselect all buttons for bulk model configuration
- **Smart defaults**: Doesn't auto-select all models when enabling a provider

### Provider Implementation Details

#### Key Files for Claude Providers
- **Claude API Provider**:
  - Main implementation: `packages/runtime/src/ai/server/providers/ClaudeProvider.ts`
  - UI panel: `packages/electron/src/renderer/components/AIModels/panels/ClaudePanel.tsx`
  - Uses Anthropic SDK directly with API key authentication
  - Supports model selection from predefined list in `packages/runtime/src/ai/modelConstants.ts`

- **Claude Code Provider**:
  - Implementation: `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts`
  - UI panel: `packages/electron/src/renderer/components/AIModels/panels/ClaudeCodePanel.tsx`
  - Installation manager: `packages/electron/src/renderer/components/AIModels/services/CLIInstaller.ts`
  - Requires separate installation of `@anthropic-ai/claude-agent-sdk` package
  - Dynamically loads SDK from user's installation

#### Provider Factory
- Location: `packages/runtime/src/ai/server/ProviderFactory.ts`
- Creates and manages provider instances based on type
- Provider types: `claude`, `claude-code`, `openai`, `openai-codex`, `lmstudio`
- Each provider is cached per session for efficiency

### Custom Tool Widgets

Custom widgets can replace the generic tool call display for specific MCP tools. See [CUSTOM_TOOL_WIDGETS.md](docs/CUSTOM_TOOL_WIDGETS.md) for implementation details.

## Data Persistence

The Nimbalyst app uses **PGLite** (PostgreSQL in WebAssembly) for all data storage, providing a robust database system that works both in development and packaged builds.

**CRITICAL: Never use localStorage in the renderer process.** All persistent state must be stored via IPC to the main process using either:
- **app-settings store** (`packages/electron/src/main/utils/store.ts`) for global app settings
- **workspace-settings store** for per-project state
- **PGLite database** for complex data like AI sessions and document history

localStorage is not reliable in Electron and data can be lost. Use the existing store infrastructure instead.

### Database System
- **Technology**: PGLite (PostgreSQL in WebAssembly) running in Node.js worker thread
- **Storage**: Persistent file-based database with ACID compliance
- **Worker architecture**: Isolated worker thread prevents module conflicts
- **Bundling**: PGLite is fully bundled in packaged apps for reliable distribution

### Database Tables
- **ai\_sessions**: AI chat conversations with full message history, document context, and provider configurations
- **app\_settings**: Global application settings (theme, providers, shortcuts, etc.)
- **project\_state**: Per-project state including window bounds, UI layout, open tabs, file tree, and editor settings
- **session\_state**: Global session restoration data for windows and focus order
- **document\_history**: Compressed document edit history with binary content storage

### Data Locations
- **Database**: `~/Library/Application Support/@nimbalyst/electron/pglite-db/` (macOS)
- **Logs**: `~/Library/Application Support/@nimbalyst/electron/logs/` - Application logs
- **Debug log**: `~/Library/Application Support/@nimbalyst/electron/nimbalyst-debug.log` - Debug console output
- **Legacy files**: `~/Library/Application Support/@nimbalyst/electron/history/` - Preserved file-based history (migrated to database)

### Migration System
- **Automatic migration**: File-based data automatically migrates to database on first startup
- **History preservation**: Original history files preserved after migration (not deleted)
- **Legacy app migration**: Automatically migrates from old Stravu Editor data paths
- **Version tracking**: Database includes migration timestamps and version information

### Database Features
- **Compression**: Document history stored as compressed binary data (BYTEA)
- **JSON support**: Rich JSON fields for complex data structures (JSONB columns)
- **Indexing**: Optimized indexes for fast queries on projects, timestamps, and file paths
- **Protocol server**: Optional PostgreSQL protocol server for external database access

### CRITICAL: Date/Timestamp Handling

**Problem:** PostgreSQL TIMESTAMP columns store UTC time, but PGlite returns Date objects that JavaScript interprets as LOCAL time, creating a timezone mismatch.

**Example of the bug:**
```javascript
// PostgreSQL stores: "2025-11-19 04:25:00" (UTC)
// PGlite returns: Date object parsed as "2025-11-19 04:25:00 EST" (local)
// This is WRONG - should be "2025-11-18 23:25:00 EST"
```

**Solution implemented:**
- The `toMillis()` function in `PGLiteSessionStore.ts` handles timezone conversion
- It extracts Date components and treats them as UTC using `Date.UTC()`
- JavaScript's `toLocaleString()` then correctly displays in the user's timezone

**Rules when working with database timestamps:**

1. ✅ **DO**: Use `CURRENT_TIMESTAMP` for database inserts/updates
```sql
   UPDATE ai_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = $1
```

2. ❌ **DON'T**: Use `Date.now()` with `to_timestamp()` - causes double conversion
```sql
   -- WRONG - Don't do this!
   UPDATE ai_sessions SET updated_at = to_timestamp($1 / 1000.0) WHERE id = $1
```

3. ✅ **DO**: Retrieve timestamps through `toMillis()` function
```typescript
   const createdAt = toMillis(row.created_at);  // Converts UTC to proper epoch ms
```

4. ✅ **DO**: Display with `toLocaleString()` for user's local timezone
```typescript
   new Date(timestamp).toLocaleString(undefined, {
     month: 'short', day: 'numeric', year: 'numeric',
     hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
   });
```

**Related files:**
- `packages/electron/src/main/database/worker.js` - Database schema and comments
- `packages/electron/src/main/services/PGLiteSessionStore.ts` - toMillis() implementation
- `packages/electron/src/main/services/PGLiteAgentMessagesStore.ts` - Uses CURRENT_TIMESTAMP
- `packages/electron/src/renderer/components/AgenticCoding/SessionListItem.tsx` - Displays timestamps

## File Operations

### Project Sidebar
- **Drag and drop**: Move files and folders via drag and drop
- **Copy on drag**: Hold Option/Alt while dragging to copy instead of move
- **Visual feedback**: Drop targets are highlighted during drag operations
- **Automatic renaming**: Copied files get unique names to avoid conflicts

### File Tree Features
- **Context menus**: Right-click files for rename, delete, open in new window
- **File watching**: Automatic updates when files change on disk
- **Recent files**: Quick access to recently opened files in projects

## Adding Analytics Events
See @docs/ANALYTICS_GUIDE.md for details on how to add anonymous usage analytics to track feature use.

**IMPORTANT**: When adding, modifying, or removing PostHog events, you MUST update @docs/POSTHOG_EVENTS.md with the event name, file location, trigger, and properties. This document serves as the canonical reference for all analytics events in the codebase.

## Agentic Planning System

The repository uses a structured markdown-based planning system for agent-led development workstreams. Plans are stored as markdown files with YAML frontmatter metadata.

### Plan Document Location
- **Directory**: All plans are stored in the `plans/` folder at the repository root
- **File naming**: Use descriptive kebab-case names (e.g., `agentic-markdown-planning-system.md`)
- **Single source of truth**: Plans serve as the authoritative record for features, bugs, and development tasks

### Plan Metadata Structure
Every plan document MUST include YAML frontmatter with the following fields:

```yaml
---
planStatus:
  planId: plan-[unique-identifier]  # Unique identifier for the plan
  title: [Plan Title]                # Human-readable title
  status: [status]                   # Current status (see values below)
  planType: [type]                   # Type of plan (see values below)
  priority: [priority]               # Priority level: low | medium | high | critical
  owner: [username]                  # Primary owner/assignee
  stakeholders:                      # List of stakeholders
    - [stakeholder1]
    - [stakeholder2]
  tags:                              # Relevant tags for categorization
    - [tag1]
    - [tag2]
  created: "YYYY-MM-DD"             # Creation date
  updated: "YYYY-MM-DDTHH:MM:SS.sssZ"  # Last update timestamp
  progress: [0-100]                  # Completion percentage
  startDate: "YYYY-MM-DD"            # Start date (optional)
---
```

### Status Values
- `draft`: Initial planning phase
- `ready-for-development`: Approved and ready for implementation
- `in-development`: Currently being worked on
- `in-review`: Implementation complete, pending review
- `completed`: Successfully completed
- `rejected`: Plan has been rejected or cancelled
- `blocked`: Progress blocked by dependencies

### Plan Types
- `feature`: New feature development
- `bug-fix`: Bug fix or issue resolution
- `refactor`: Code refactoring/improvement
- `system-design`: Architecture/design work
- `research`: Research/investigation task

### Plan Document Structure
After the frontmatter, plans should include:
1. **Title**
```
   # Plan Title
```
2. **Goals** section outlining objectives
3. **System Overview** or problem description
4. **Implementation details** as needed
5. **Acceptance criteria** when applicable

### Working with Plans
- **Creating plans**: Always include complete frontmatter when creating new plans
- **Updating plans**: Preserve user edits, append updates rather than overwriting
- **Status tracking**: Update `status`, `progress`, and `updated` fields as work progresses
- **Collaboration**: Plans support both human and agent contributors
- Never use emojis
- stop putting code in plan docs!
- For playwrite - write one playwright test case and get it working before writing more and see @docs/PLAYWRIGHT.md
- if your editor is scrolling on load when it shouldn't you probably are missing this from an editor.update - { tag: SKIP_SCROLL_INTO_VIEW_TAG }
- Markdown import and export should use our enhance conversion system $convertFromEnhancedMarkdownString and $convertToEnhancedMarkdownString

## Error Handling and Defensive Coding

**CRITICAL: Fail fast, fail loud. Never hide failures.**

### Required Error Handling Patterns

1. **Never log-and-continue for required parameters**
```typescript
   // BAD: Logs but continues with broken state
   if (!workspacePath) {
     this.log.error('Missing workspacePath');
     return;
   }

   // GOOD: Throws immediately
   if (!workspacePath) {
     throw new Error('workspacePath is required');
   }
```

2. **Never fall back to default values that mask routing issues**
```typescript
   // BAD: Silently uses wrong window
   const window = this.findWindowByWorkspace(path) || windows[0];

   // GOOD: Fails if routing is broken
   const window = this.findWindowByWorkspace(path);
   if (!window) {
     throw new Error(`No window found for workspace: ${path}`);
   }
```

3. **Always use stable identifiers for routing**
  - Use workspace paths (stable) not window IDs (transient)
  - Use canonical file paths not relative paths
  - Document which IDs are stable vs transient

4. **Validate at boundaries**
  - All IPC handlers MUST validate required parameters
  - All service methods MUST validate required parameters
  - Throw on missing required fields, don't provide defaults

5. **Single path for state updates**
  - State updates go through IPC handlers (main ↔ renderer)
  - Services call IPC handlers, never update state directly
  - No bypassing the canonical update path

### When Defensive Coding Is Wrong

Defensive coding that masks failures is worse than crashing:
- Better to crash immediately at the root cause
- Better to show "cannot route to window" than silently route to wrong window
- Better to throw "missing workspacePath" than to guess

**Rule of thumb:** If you're adding code to "handle" missing required data, you're probably hiding a bug. Throw instead.
- nimbalyst always preserves newlines and spacing in markdown

Put react components that might be used by the mobile app version in the runtime package, not electron
we use linear mcp with the "NIM" project
