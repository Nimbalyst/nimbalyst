# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Codebase Overview

This is Nimbalyst - a rich text editor built with Meta's Lexical framework. It's a monorepo containing multiple packages including the Electron desktop app, the core editor (Rexical), runtime services, and mobile support via Capacitor.

## Monorepo Structure

### Workspaces
```
packages/
  electron/       # Desktop app (Electron)
  rexical/        # Lexical-based editor
  runtime/        # Cross-platform runtime services (AI, sync)
  capacitor/      # Mobile app (iOS/Android)
  core/           # Shared utilities
  collabv3/       # Collaboration server
  extension-sdk/  # Extension development kit
  extensions/     # Built-in extensions
```

### Package Management
- **Install dependencies**: `npm install` at repository root
- **Uses npm workspaces** (not pnpm)
- Packages can reference each other via workspace protocol

### Package-Specific Documentation
For detailed information about specific packages, see their CLAUDE.md files:
- `/packages/electron/CLAUDE.md` - Electron desktop app specifics
- `/packages/runtime/CLAUDE.md` - AI providers and runtime services
- `/packages/rexical/CLAUDE.md` - Lexical editor architecture
- `/packages/capacitor/CLAUDE.md` - Mobile app (iOS/iPadOS)
- `/packages/collabv3/CLAUDE.md` - Sync server (Cloudflare Workers)

## Development Commands

### Electron App
- **Start dev server**: `cd packages/electron && npm run dev`
- **Build for Mac**: `cd packages/electron && npm run build:mac:local`
- **Build for Mac (notarized)**: `cd packages/electron && npm run build:mac:notarized`
- **Main process log file**: `~/Library/Application Support/@nimbalyst/electron/logs/main.log`

### Testing
- **Unit tests**: `npm run test:unit` - Uses vitest
- **Test UI**: `npm run test:unit:ui`
- **Run specific E2E test file**: `npx playwright test e2e/monaco/file-watcher-updates.spec.ts`
- **Run E2E tests in a directory**: `npx playwright test e2e/monaco/`
- **Run all E2E tests**: `npx playwright test`

**IMPORTANT**: Always use `npx playwright test` directly for E2E tests. Never use parallel execution as it corrupts PGLite.

See `/docs/PLAYWRIGHT.md` for comprehensive E2E testing documentation.

### Running E2E Tests in Dev Containers

When running e2e tests, run in a dev container if any of the following are true:
1. You are in a git worktree
2. You are in a CI environment
3. You are specifically asked to

If none of the above are true, run e2e tests normally.

ALWAYS use the /e2e-devcontainer command when running e2e tests in a dev container.

### Other Packages
- **Capacitor (mobile)**: `npm run cap:dev`, `npm run cap:ios`, `npm run cap:android`
- **Collaboration server**: `npm run collabv2:dev`, `npm run collabv2:deploy`

## Releases

For detailed release instructions, see [RELEASING.md](./RELEASING.md).

**Quick reference:**
- Use the `/release [patch|minor|major]` command
- All release notes go in the `[Unreleased]` section of `CHANGELOG.md`
- The release script automatically creates versioned entries and annotated git tags

## Cross-Cutting Patterns

### Error Handling Philosophy

**CRITICAL: Fail fast, fail loud. Never hide failures.**

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

**Rule of thumb:** If you're adding code to "handle" missing required data, you're probably hiding a bug. Throw instead.

### React State Architecture

**CRITICAL: Do NOT "lift state up" for complex applications.**

The "lift state up" pattern is appropriate for simple React apps but becomes an anti-pattern in IDE-like applications. This codebase explicitly rejects that pattern for editor state.

#### State Ownership Principles

1. **Editors own their content state**
   - Custom editors (Monaco, RevoGrid, Lexical) own their document content
   - Parent only knows "tab X uses editor Y for file Z" - NOT the file contents
   - Editor content is NEVER stored in a Map/object in a parent component

2. **Use Jotai atoms for cross-cutting state**
   - Theme, preferences (global atoms)
   - Tab metadata - dirty, processing (atom families by tab ID)
   - Session state - unread, processing (atom families by session ID)
   - File tree git status (atom per file/directory)

3. **Communication via EditorHost, not props**
   ```typescript
   // BAD: Controlled editor
   <Editor content={content} onChange={setContent} />

   // GOOD: Editor owns state, uses host for I/O
   <Editor host={editorHost} />
   // Editor calls host.loadContent() on mount
   // Editor calls host.saveContent() when saving
   // Editor calls host.setDirty() on changes
   ```

4. **Stateful editors cannot be re-rendered**
   - RevoGrid, Monaco, Lexical manage internal state
   - Parent re-renders will break them
   - Changes flow through callbacks, not props

#### Anti-Pattern Recognition

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `Map<string, Content>` in parent | All children re-render on any change | Each editor owns its content |
| `Map<string, Status>` as prop | Reference changes trigger re-render | Use Jotai atom family |
| Polling in render (`hasPendingDiffs()`) | O(n) on every render | Subscribe to atom updates |
| 15 refs to avoid re-renders | Fighting the architecture | Fix state ownership |
| `useState` for cross-component state | Prop drilling or context re-renders | Use Jotai atoms |

#### Extension Contract

Extensions receive `EditorHost` and must:
- Call `loadContent()` on mount (not expect content prop)
- Own all internal state
- Call `saveContent()` when save requested
- Handle `onFileChanged()` for external edits
- NEVER depend on parent re-rendering them

### Shared UI Patterns

These patterns apply across all packages (electron, capacitor, runtime) that contain UI code.

#### Responsive CSS: Use Container Queries

**Use \****`@container`***\* queries, not \****`@media`**\*\* queries** for responsive layouts. Since panels are resizable, viewport-based media queries don't respond to actual container width.

```css
.my-component {
  container-type: inline-size;
  container-name: my-component;
}

@container my-component (max-width: 500px) {
  .my-component-child {
    /* Styles when container is narrow */
  }
}
```

Container queries respond to the actual container width, making them work correctly with resizable panels and split views on both desktop and mobile.

### Main Process Initialization

The Electron main process has specific initialization constraints that must be respected:

#### Bootstrap and Dynamic Import

`bootstrap.ts` is the entry point and uses a dynamic import for `index.ts`:
```typescript
import('./index.js');  // Dynamic, not static!
```

**Why dynamic import is required:**
1. `NODE_PATH` must be set before `node-pty` can be resolved in packaged builds
2. Static imports are resolved before any code runs
3. Dynamic import defers loading until after `NODE_PATH` is configured

**Never change this to a static import** - it will break packaged builds.

#### Lazy Initialization Pattern

Singletons that read `app.getPath()` must use lazy initialization:

```typescript
// BAD: Reads userData path at module load time
const store = new Store({ name: 'settings' });

// GOOD: Defers until first access
let _store: Store | null = null;
function getStore() {
  if (!_store) {
    _store = new Store({ name: 'settings' });
  }
  return _store;
}
```

This ensures `app.setPath('userData')` in bootstrap.ts takes effect.

#### IPC Handler Registration

Use `safeHandle`/`safeOn` from `ipcRegistry.ts` instead of `ipcMain.handle`/`ipcMain.on`:

```typescript
// BAD: Crashes if handler already registered
ipcMain.handle('my-channel', handler);

// GOOD: Safe for duplicate registration
safeHandle('my-channel', handler);
```

This prevents "second handler" errors from module duplication across chunk boundaries.

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

### AI Provider Types

The application supports two categories of AI providers. See [AI_PROVIDER_TYPES.md](docs/AI_PROVIDER_TYPES.md) for detailed documentation.

- **Agent Providers** (Claude Agent, OpenAI Codex): Full MCP support, file system access via tools, multi-file operations, session persistence
- **Chat Providers** (Claude Chat, OpenAI, LM Studio): Direct API calls, files attached as context, faster responses, local model support

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

### Git Worktree Integration

Nimbalyst supports creating git worktrees for isolated AI coding sessions. See [WORKTREES.md](docs/WORKTREES.md) for comprehensive documentation.

**Quick overview:**
- Create worktrees directly from the agent mode UI via "New Worktree" button
- Each worktree runs on its own branch in a separate directory
- Claude Code sessions execute in the worktree directory context
- One worktree can have multiple sessions (one-to-many relationship)
- Visual distinction: Worktree sessions display with a badge overlay on the AI icon

**Database schema:**
- `worktrees` table: Stores worktree metadata (id, workspace_id, name, path, branch, base_branch)
- `ai_sessions.worktree_id`: Foreign key linking sessions to worktrees (nullable)

**IPC channels:**
- `worktree:create` - Create new worktree
- `worktree:get-status` - Get git status (ahead/behind, uncommitted changes)
- `worktree:delete` - Delete worktree
- `worktree:list` - List all worktrees for workspace
- `worktree:get` - Get single worktree by ID

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
- **worktrees**: Git worktree metadata for isolated AI coding sessions (see [WORKTREES.md](docs/WORKTREES.md))
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

1. **DO**: Use `CURRENT_TIMESTAMP` for database inserts/updates
```sql
   UPDATE ai_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = $1
```

2. **DON'T**: Use `Date.now()` with `to_timestamp()` - causes double conversion
```sql
   -- WRONG - Don't do this!
   UPDATE ai_sessions SET updated_at = to_timestamp($1 / 1000.0) WHERE id = $1
```

3. **DO**: Retrieve timestamps through `toMillis()` function
```typescript
   // This correctly converts PGlite Date objects to Unix milliseconds
   const createdAt = toMillis(row.created_at);
```

## Analytics

See `/docs/ANALYTICS_GUIDE.md` for details on adding anonymous usage analytics.

**IMPORTANT**: When adding, modifying, or removing PostHog events, you MUST update `/docs/POSTHOG_EVENTS.md` with the event name, file location, trigger, and properties.

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

### Working with Plans
- **Creating plans**: Always include complete frontmatter when creating new plans
- **Updating plans**: Preserve user edits, append updates rather than overwriting
- **Status tracking**: Update `status`, `progress`, and `updated` fields as work progresses
- **Never use emojis** in plans or code
- **Don't put code in plan docs** - keep them focused on design and requirements

## General Development Guidelines

- **Never use emojis** - Not in commits, code, or documentation unless explicitly requested
- **Never use overly enthusiastic phrases** like "Perfect!", "Terrific!", etc.
- **Never commit changes unless explicitly asked**
- **Never provide time or effort estimates**
- **Don't disable tests without asking first**
- **Don't run \****`npm run dev`**\*\* yourself** - User always does that
- **Never release without being explicitly instructed**
- **Don't git reset or git add -A without asking**
- **Don't add Co-Authored-By lines to commit messages**
- **Never restart Nimbalyst without explicit permission** - Always ask before using `restart_nimbalyst`

## Verifying Development Mode

**IMPORTANT**: Before making code changes to the Nimbalyst codebase, use `mcp__nimbalyst-extension-dev__get_environment_info` to verify that Nimbalyst is running in development mode. If the user is running a packaged build, your code changes will NOT take effect and you should inform them to start the dev server (`npm run dev`).

## Extension Development

When working on extensions in `packages/extensions/`:
- Use `mcp__nimbalyst-extension-dev__extension_reload` to rebuild and reload extensions
- Use `mcp__nimbalyst-extension-dev__extension_get_logs` to check for errors
- Use `mcp__nimbalyst-extension-dev__extension_get_status` to verify extension state
- **Never use manual \****`npm run build`** - always use the MCP tools for extension builds

## Testing Guidelines

- When implementing tests, create one test first before building the full suite
- Temporary test files must be created in a `temptests` folder
- For Playwright tests, write one test case and get it working before writing more
- See `/docs/PLAYWRIGHT.md` for comprehensive testing patterns

## Documentation

- **AGENT\_PERMISSIONS.md**: Agent tool permission system and approval flow
- **ANALYTICS\_GUIDE.md**: How to add PostHog analytics events
- **POSTHOG\_EVENTS.md**: Canonical reference for all analytics events
- **PLAYWRIGHT.md**: E2E testing patterns and best practices
- **AI\_PROVIDER\_TYPES.md**: AI provider architecture
- **CUSTOM\_TOOL\_WIDGETS.md**: Custom MCP tool widget implementation
- **INTERNAL\_MCP\_SERVERS.md**: How to implement internal MCP servers
- **WORKTREES.md**: Git worktree integration for isolated AI coding sessions
- **THEMING.md**: Theming system documentation (in electron package)
- **RELEASING.md**: Release process

## Support

User support documentation is located in the `support/` folder:
- **force-restore-database-backup.md**: Instructions for manually restoring the database from backup
