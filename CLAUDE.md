# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Codebase Overview

This is Preditor - a rich text editor built with Meta's Lexical framework. Originally based on the Lexical playground, it's been adapted as the foundation for a new editor project with comprehensive features including rich text editing, tables, collaboration, code highlighting, and various plugins.

## Development Commands

### Electron App
- **__Start dev server__**: `cd packages/electron && npm run dev` - Runs Electron app with hot reload
- **__Build for Mac__**: `cd packages/electron && npm run build:mac:local` - Creates local Mac build
- **__Build for Mac (notarized)__**: `cd packages/electron && npm run build:mac:notarized` - Creates notarized Mac build

### Monorepo Setup
- **__Install dependencies__**: `npm install --legacy-peer-deps` - Install all dependencies 
- **__Package management__**: Uses npm workspaces (not pnpm)

## Testing

The project uses multiple testing approaches:

- **__Unit tests__**: Located in `__tests__/unit/` using vitest
- **__E2E tests__**: Located in `__tests__/e2e/` using Playwright 
- **__Regression tests__**: Located in `__tests__/regression/` using Playwright

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
- **__PlaygroundNodes.ts__**: Registers all custom node types
- **__Editor.tsx__**: Orchestrates all plugins and editor functionality
- **__Context providers__**: Settings, History, Toolbar, and FlashMessage contexts
- **__Plugin system__**: Modular features like AutoComplete, DragDrop, FloatingToolbar

### Plugin Architecture
The editor uses a comprehensive plugin system where each feature is implemented as a separate plugin in `src/plugins/`. Plugins handle everything from basic functionality (AutoLink, CodeHighlight) to complex features (Tables, Collaboration, DragDrop).

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

## Important File Patterns

- Plugin files follow `src/plugins/[PluginName]Plugin/index.tsx`
- Node files in `src/nodes/[NodeName].tsx`
- UI components in `src/ui/[Component].tsx` with accompanying CSS
- Themes in `src/themes/[ThemeName].ts` and `.css`

## Dependencies

Built with modern React, TypeScript, and Vite. Uses extensive Lexical packages (@lexical/*) for editor functionality, plus supporting libraries like KaTeX for equations, Prettier for code formatting, and Excalidraw for drawings.

## macOS Code Signing & Notarization

The Electron app supports notarized distribution for macOS:

- **__Signing configuration__**: Uses Developer ID Application certificate
- **__Build scripts__**: `npm run build:mac:notarized`&#32;for notarized build, `build:mac:local` for local testing
- **__Binary handling__**: Properly signs ripgrep and other bundled tools
- **__JAR exclusion__**: Automatically removes JAR files that can't be notarized
- **__Entitlements__**: Configured for hardened runtime with necessary exceptions

## Electron App Debug Logging

The Electron app (`packages/electron/`) includes a debug logging feature that captures all browser console messages in development mode. This is useful for debugging renderer-side issues and browser load problems.

- **__Log file location__**: `~/Library/Application Support/@preditor/electron/preditor-debug.log` (macOS)
- **__What's logged__**: All browser console messages, main process logs, timestamps, source locations, and log levels
- **__When active__**: Only in development mode (`NODE_ENV !== 'production'`)
- **__Implementation__**: See `packages/electron/src/main/index.ts` - uses `webContents.on('console-message')` event

## Theme Support

The editor supports multiple themes:
- **__Light__**: Clean, bright theme for daytime use
- **__Dark__**: Standard dark theme with warm gray colors (#2d2d2d, #1a1a1a, #3a3a3a)
- **__Crystal Dark__**: A premium dark theme with Tailwind gray scale colors (#0f172a, #020617, #1e293b)
- **__Auto__**: Follows system preference

The Electron app includes a Window > Theme menu to switch between all themes. The selected theme is persisted and applied to all windows.

### CRITICAL THEMING RULES
- **__NEVER hardcode colors in CSS files__** - Always use CSS variables
- **__Single source of truth__**: `/packages/electron/src/renderer/index.css` is the ONLY place where theme colors are defined
- **__Always set both__**: When applying themes, set both `data-theme` attribute AND CSS class on root element
- **__See THEMING.md__**: Comprehensive theming documentation at `/packages/electron/THEMING.md`

## Window State Persistence

The Electron app includes comprehensive window state persistence:

### Session State
- **__Global session state__**: Restores all windows when the app restarts
- **__Window position and size__**: Each window's bounds are saved and restored
- **__Focus order__**: Windows are restored in the correct stacking order
- **__Developer tools state__**: Dev tools are reopened if they were open when the window was closed

### Project-Specific State
- **__Per-project window state__**: Each project remembers its own window configuration
- **__Persistent across sessions__**: Opening a project restores its last window position, size, and dev tools state
- **__File state__**: Remembers which file was open in each project window

### AI Chat Integration
- **__Panel width persistence__**: The AI Chat panel width is saved per-window
- **__Collapsed state__**: Whether the AI Chat panel is visible or hidden is remembered
- **__Draft input persistence__**: Unsent messages in the chat input are saved with the session
- **__Session continuity__**: Chat sessions persist across app restarts

## IPC Communication

The Electron app uses IPC (Inter-Process Communication) between main and renderer processes:

### Preload API
- **__Location__**: `/packages/electron/src/preload/index.ts`
- **__Exposed as__**: `window.electronAPI` (NOT `window.api` - this is important!)
- **__Generic IPC methods__**: The electronAPI includes generic `invoke`, `send`, `on`, and `off` methods for flexible service communication
- **__Service pattern__**: Renderer services use these generic methods to communicate with main process services

### Document Service
- **__Main process__**: `ElectronDocumentService` handles file scanning, metadata extraction, and caching
- **__Renderer process__**: `RendererDocumentService` acts as a facade, using IPC via `window.electronAPI` to communicate with main process
- **__Metadata API__**: Supports frontmatter extraction and caching for all markdown documents with bounded file reads (4KB)
- **__IPC channels__**: `document-service:*` for all document-related operations including metadata

### Common IPC Issues
- **__window.api undefined__**: The preload exposes `window.electronAPI`, not `window.api`. Ensure renderer services use the correct reference.
- **__Empty responses__**: If IPC calls return empty data, check that the window state is properly set to workspace mode with a valid workspace path.
- **__Service resolution__**: The main process resolves services based on the window's workspace path. No workspace = no service.

## AI Features

### AI Providers

The application supports multiple AI providers, including two distinct ways to access Claude:

#### Claude (Anthropic API)
- **__Direct API integration__**: Uses the official Anthropic SDK (`@anthropic-ai/sdk`)
- **__Provider ID__**: `claude`
- **__Location__**: `packages/runtime/src/ai/server/providers/ClaudeProvider.ts`
- **__Features__**: 
  - Standard Claude models (Opus 4.1, Opus 4, Sonnet 4, Sonnet 3.7)
  - Streaming responses with tool use support
  - Direct API key authentication
  - Full control over model selection
- **__When to use__**: For standard AI chat and code assistance using Claude models directly

#### Claude Code (MCP Integration)
- **__MCP Protocol__**: Uses Model Context Protocol for enhanced code-aware features
- **__Provider ID__**: `claude-code`
- **__Implementation__**: `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts`
  - Dynamically loads `@anthropic-ai/claude-code` SDK from user's installation
  - Requires local installation via npm
  - Provides MCP features through SDK
- **__Features__**:
  - Enhanced code understanding through MCP
  - File system awareness and manipulation
  - Advanced code editing capabilities
  - Manages its own model selection internally (do not pass model IDs)
- **__Installation__**: Requires `npm install -g @anthropic-ai/claude-code` or local installation
- **__When to use__**: For advanced code editing tasks that benefit from MCP's context protocol

#### Other Providers
- **__OpenAI__**: GPT-4 and GPT-3.5 models via OpenAI API
- **__LM Studio__**: Local model support for privacy-focused usage
- **__Multiple provider support__**: Extensible architecture for adding new AI providers

### AI Chat Panel
- **__Multi-provider support__**: Works with Claude, OpenAI, LM Studio, and Claude Code
- **__Document-aware__**: Sends current document context with messages when a document is open
- **__No-document handling__**: Clear messaging when no document is open, prevents edit attempts
- **__Session management__**: Multiple chat sessions per project
- **__Edit streaming__**: Real-time streaming of code edits directly to the editor
- **__Dynamic UI__**: Provider-specific icons and names throughout the interface
- **__Keyboard shortcut__**: Cmd+Shift+A to toggle the AI Chat panel

### Session Manager
- **__Global session view__**: Access all AI chat sessions across all projects (Cmd+Alt+S)
- **__Session search__**: Filter sessions by content, project, or date
- **__Session details__**: View full conversation history for any session
- **__Session actions__**: Open, export, or delete sessions
- **__Left navigation design__**: Clean interface with session list on left, details on right

### AI Model Configuration
- **__Dynamic model selection__**: Models are fetched from provider APIs when available
- **__No hardcoded models__**: Providers manage their own model defaults
- **__Claude Code specifics__**: Never pass model IDs to claude-code provider - it manages its own model selection
- **__LM Studio detection__**: Automatically detects local models running in LM Studio
- **__Model management__**: Select/deselect all buttons for bulk model configuration
- **__Smart defaults__**: Doesn't auto-select all models when enabling a provider

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
  - Requires separate installation of `@anthropic-ai/claude-code` package
  - Dynamically loads SDK from user's installation

#### Provider Factory
- Location: `packages/runtime/src/ai/server/ProviderFactory.ts`
- Creates and manages provider instances based on type
- Provider types: `claude`, `claude-code`, `openai`, `openai-codex`, `lmstudio`
- Each provider is cached per session for efficiency

## Data Persistence

The Preditor app uses **__PGLite__** (PostgreSQL in WebAssembly) for all data storage, providing a robust database system that works both in development and packaged builds.

### Database System
- **__Technology__**: PGLite (PostgreSQL in WebAssembly) running in Node.js worker thread
- **__Storage__**: Persistent file-based database with ACID compliance
- **__Worker architecture__**: Isolated worker thread prevents module conflicts
- **__Bundling__**: PGLite is fully bundled in packaged apps for reliable distribution

### Database Tables
- **__ai\_sessions__**: AI chat conversations with full message history, document context, and provider configurations
- **__app\_settings__**: Global application settings (theme, providers, shortcuts, etc.)
- **__project\_state__**: Per-project state including window bounds, UI layout, open tabs, file tree, and editor settings
- **__session\_state__**: Global session restoration data for windows and focus order
- **__document\_history__**: Compressed document edit history with binary content storage

### Data Locations
- **__Database__**: `~/Library/Application Support/@preditor/electron/pglite-db/` (macOS)
- **__Logs__**: `~/Library/Application Support/@preditor/electron/logs/` - Application logs
- **__Debug log__**: `~/Library/Application Support/@preditor/electron/preditor-debug.log` - Debug console output
- **__Legacy files__**: `~/Library/Application Support/@preditor/electron/history/` - Preserved file-based history (migrated to database)

### Migration System
- **__Automatic migration__**: File-based data automatically migrates to database on first startup
- **__History preservation__**: Original history files preserved after migration (not deleted)
- **__Legacy app migration__**: Automatically migrates from old Stravu Editor data paths
- **__Version tracking__**: Database includes migration timestamps and version information

### Database Features
- **__Compression__**: Document history stored as compressed binary data (BYTEA)
- **__JSON support__**: Rich JSON fields for complex data structures (JSONB columns)
- **__Indexing__**: Optimized indexes for fast queries on projects, timestamps, and file paths
- **__Protocol server__**: Optional PostgreSQL protocol server for external database access

## File Operations

### Project Sidebar
- **__Drag and drop__**: Move files and folders via drag and drop
- **__Copy on drag__**: Hold Option/Alt while dragging to copy instead of move
- **__Visual feedback__**: Drop targets are highlighted during drag operations
- **__Automatic renaming__**: Copied files get unique names to avoid conflicts

### File Tree Features
- **__Context menus__**: Right-click files for rename, delete, open in new window
- **__File watching__**: Automatic updates when files change on disk
- **__Recent files__**: Quick access to recently opened files in projects

## Agentic Planning System

The repository uses a structured markdown-based planning system for agent-led development workstreams. Plans are stored as markdown files with YAML frontmatter metadata.

### Plan Document Location
- **__Directory__**: All plans are stored in the `plans/` folder at the repository root
- **__File naming__**: Use descriptive kebab-case names (e.g., `agentic-markdown-planning-system.md`)
- **__Single source of truth__**: Plans serve as the authoritative record for features, bugs, and development tasks

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
  dueDate: "YYYY-MM-DD"              # Due date (optional)
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
1. **__Title__** with plan status indicator comment: `<!-- plan-status -->`
2. **__Goals__** section outlining objectives
3. **__System Overview__** or problem description
4. **__Implementation details__** as needed
5. **__Acceptance criteria__** when applicable

### Working with Plans
- **__Creating plans__**: Always include complete frontmatter when creating new plans
- **__Updating plans__**: Preserve user edits, append updates rather than overwriting
- **__Status tracking__**: Update `status`, `progress`, and `updated` fields as work progresses
- **__Collaboration__**: Plans support both human and agent contributors
