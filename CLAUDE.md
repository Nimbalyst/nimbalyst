# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Codebase Overview

Nimbalyst is an extensible, AI-native workspace that supports multiple editor types through a unified extension system. While it originated as a Lexical-based markdown editor, the architecture is evolving toward a fully pluggable model where **all editors** - including the core Lexical editor, Monaco code editor, spreadsheets, diagrams, and custom visual editors - are provided through extensions.

This is a monorepo containing multiple packages including the Electron desktop app, the core editor (Rexical), runtime services, extension SDK, and mobile support via Capacitor.

## Extension Architecture (Core Vision)

**The extension system is the foundation for all future development.** Every editor type and file handler will ultimately be provided through extensions, creating a cohesive, pluggable lifecycle for all content types.

### What Extensions Provide

Extensions can contribute:
- **Custom Editors**: Full editor implementations for specific file types (Monaco for code, RevoGrid for CSV/spreadsheets, Excalidraw for diagrams, DataModelLM for visual data modeling, mockup editors, etc.)
- **File Type Handlers**: Associate file extensions with specific editors
- **AI Tools via MCP**: Expose functionality to AI agents through the Model Context Protocol
- **Custom UI Components**: Panels, widgets, and tool call renderers

### Current Editor Types

Nimbalyst supports diverse editor types beyond traditional text:
- **Lexical** (`.md`, `.txt`): Rich text markdown editing with tables, images, code blocks
- **Monaco** (`.ts`, `.js`, `.json`, etc.): Full VS Code-style code editing with syntax highlighting, intellisense
- **RevoGrid** (`.csv`): Spreadsheet-style editing with formulas, sorting, filtering
- **Excalidraw** (`.excalidraw`): Whiteboard-style diagrams and drawings
- **DataModelLM** (`.datamodel`): Visual Prisma schema editor
- **Mockup Editor** (`.mockup.html`): Visual HTML mockup creation

### EditorHost Contract

All editors (including built-in ones) communicate through the `EditorHost` interface, ensuring consistent lifecycle management:

```typescript
interface EditorHost {
  loadContent(): Promise<string>;      // Load file content on mount
  saveContent(content: string): void;  // Save when user saves
  setDirty(dirty: boolean): void;      // Track unsaved changes
  onFileChanged(callback): void;       // Handle external file changes
}
```

This contract ensures that extensions integrate seamlessly with tabs, dirty indicators, file watching, and AI edit streaming regardless of the underlying editor technology.

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

### Workspace State Persistence

**CRITICAL: Use deep merge for all nested workspace state updates.**

The `workspace:update-state` IPC handler uses a **deep merge** function (not shallow `Object.assign`), which recursively merges nested objects. This allows multiple modules to safely update different fields in nested structures without overwriting each other.

**Pattern for workspace state updates:**
```typescript
// GOOD: Deep merge preserves other fields automatically
await window.electronAPI.invoke('workspace:update-state', workspacePath, {
  agenticCodingWindowState: {
    sessionHistoryLayout: { width: 300 }  // Other fields preserved
  }
});

// NO NEED for manual read-modify-write - deep merge handles it
```

**Backend implementation** (`WorkspaceHandlers.ts`):
```typescript
safeHandle('workspace:update-state', async (event, workspacePath: string, updates: any) => {
    return updateWorkspaceState(workspacePath, (state) => {
        deepMerge(state, updates);  // Recursively merges nested objects
    });
});
```

**When to use:**
- Updating any nested workspace state structure
- Multiple modules writing to the same parent object (e.g., `agenticCodingWindowState`)
- Adding new fields to existing state without knowing what else is there

**Benefits:**
- No manual read-modify-write needed
- Can't forget to merge and lose data
- Single source of truth for merge logic
- Works for arbitrarily nested structures

### State Persistence Migration Safety

**CRITICAL: Persisted state may be missing fields added after it was saved.**

When loading state from disk (electron-store, workspace state, etc.), old persisted data may be missing fields that were added to interfaces later. This causes runtime errors like `Cannot read properties of undefined` when code assumes fields exist.

#### The Problem

```typescript
// BAD: Assumes field exists - crashes on old persisted data
const config = await loadConfig();
const trimmed = config.newField.trim();  // TypeError if newField undefined

// BAD: Spread-only merge loses default for missing fields
const config = { ...loadedConfig };  // newField is undefined if not in persisted data
```

#### The Solution: Always Merge with Defaults

Every persisted state interface needs:
1. A `createDefault*()` function with all field defaults
2. An `init*()` function that merges loaded data with defaults

```typescript
// GOOD: Define defaults for all fields
const defaultConfig: Config = {
  existingField: 'value',
  newField: '',           // Added later - needs default
  optionalArray: [],      // Arrays need explicit defaults too
};

// GOOD: Merge with defaults on load
async function initConfig(): Promise<Config> {
  const loaded = await loadFromDisk();
  if (loaded) {
    return {
      existingField: loaded.existingField ?? defaultConfig.existingField,
      newField: loaded.newField ?? defaultConfig.newField,
      optionalArray: loaded.optionalArray ?? defaultConfig.optionalArray,
    };
  }
  return defaultConfig;
}
```

#### Pattern Examples in Codebase

**Workspace State** (`store.ts`):
- Uses `normalizeWorkspaceState()` which deep-merges with `createDefaultWorkspaceState()`
- New fields automatically get defaults if added to `createDefaultWorkspaceState()`

**Workstream State** (`workstreamState.ts`):
- Uses `deepMergeWorkstreamState()` to merge persisted data with `createDefaultState()`
- Auto-merges any field present in source, preserving defaults for missing fields

**App Settings** (`appSettings.ts`):
- Each settings domain has explicit `??` defaults in its `init*()` function
- Example: `enabled: loaded.enabled ?? defaultConfig.enabled`

#### Checklist When Adding New Persisted Fields

1. Add the field to the interface
2. Add a default value in the `createDefault*()` or `default*` constant
3. Ensure the `init*()` function uses `??` to provide the default
4. If using deep merge, verify it handles the new field automatically
5. Consider: what happens if a user with old data loads this new code?

#### Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `loaded.field` without default | Crashes on old data | Use `loaded.field ?? default` |
| `{ ...loaded }` without merge | Missing fields are undefined | Merge with full default object |
| Manual field enumeration | Forget to add new fields | Use automatic deep merge |
| Optional fields without `[]` | Array methods fail on undefined | Default to `[]` |

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

### Jotai Atom Patterns for Settings

App-level settings use Jotai atoms in `packages/electron/src/renderer/store/atoms/appSettings.ts`. Each settings domain follows a "blob atom" pattern:

1. **Main atom**: Single source of truth for a settings group (e.g., `notificationSettingsAtom`)
2. **Derived atoms**: Read-only slices for individual values (e.g., `completionSoundEnabledAtom`)
3. **Setter atom**: Partial updates with debounced IPC persistence (e.g., `setNotificationSettingsAtom`)
4. **Init function**: Loads from IPC at app startup (e.g., `initNotificationSettings()`)

Components subscribe directly to atoms - no props needed. Panels are self-contained.

#### When to Use Atoms vs Props

| Use Jotai Atoms | Use Props |
| --- | --- |
| Settings that affect multiple components | Component-specific config |
| Cross-window state sync needed | Parent controls child behavior |
| Avoid prop drilling (3+ levels) | Simple parent-child relationship |
| State persisted to electron-store | Transient UI state |

**Never pass settings through multiple component layers** - panels should subscribe directly to atoms internally.

**Preserve abstraction boundaries**: Parent components (like SettingsView) should NOT know the internal state of child panels. If a parent has `useState` for 15 different settings domains, that's a sign of broken abstraction. Each panel owns its domain and subscribes to its own atoms.

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

#### CSS Variables: Canonical Naming Reference

**CRITICAL: Always use the correct `--nim-*` variable names. These are the ONLY valid names:**

| Category | Variable Name | Usage | Tailwind Class |
|----------|---------------|-------|----------------|
| **Backgrounds** | | | |
| Main background | `--nim-bg` | Primary content areas | `bg-nim` |
| Secondary background | `--nim-bg-secondary` | Sidebars, panels | `bg-nim-secondary` |
| Tertiary background | `--nim-bg-tertiary` | Nested panels | `bg-nim-tertiary` |
| Hover state | `--nim-bg-hover` | Interactive element hover | `bg-nim-hover` |
| Selected state | `--nim-bg-selected` | Selected items | `bg-nim-selected` |
| Active state | `--nim-bg-active` | Active/pressed state | `bg-nim-active` |
| **Text Colors** | | | |
| Main text | `--nim-text` | Primary text content | `text-nim` |
| Muted text | `--nim-text-muted` | Secondary text | `text-nim-muted` |
| Faint text | `--nim-text-faint` | Tertiary/hint text | `text-nim-faint` |
| Disabled text | `--nim-text-disabled` | Disabled state | `text-nim-disabled` |
| **Borders** | | | |
| Default border | `--nim-border` | Standard borders | `border-nim` |
| Focus border | `--nim-border-focus` | Focus states | `border-nim-focus` |
| **Primary/Brand** | | | |
| Primary color | `--nim-primary` | Buttons, actions | `bg-nim-primary` |
| Primary hover | `--nim-primary-hover` | Button hover | `bg-nim-primary-hover` |
| **Links** | | | |
| Link color | `--nim-link` | Hyperlinks | `text-nim-link` |
| Link hover | `--nim-link-hover` | Link hover state | `text-nim-link-hover` |
| **Status** | | | |
| Success | `--nim-success` | Success states | `text-nim-success` |
| Warning | `--nim-warning` | Warning states | `text-nim-warning` |
| Error | `--nim-error` | Error states | `text-nim-error` |
| Info | `--nim-info` | Info states | `text-nim-info` |

**INCORRECT names that should NEVER be used:**
- ❌ `--nim-bg-primary` (use `--nim-bg`)
- ❌ `--nim-text-primary` (use `--nim-text`)
- ❌ `--nim-text-secondary` (use `--nim-text-muted`)
- ❌ `--nim-text-tertiary` (use `--nim-text-faint`)
- ❌ `--nim-accent` (use `--nim-primary`)
- ❌ `--nim-bg-surface` (use `--nim-bg-secondary`)

**Usage examples:**
```css
/* CSS */
.my-component {
  background-color: var(--nim-bg);
  color: var(--nim-text);
  border: 1px solid var(--nim-border);
}

.my-component:hover {
  background-color: var(--nim-bg-hover);
}
```

```tsx
/* Tailwind in TSX */
<div className="bg-nim text-nim border border-nim">
  <button className="bg-nim-primary text-white hover:bg-nim-primary-hover">
    Action
  </button>
</div>

/* Arbitrary values in TSX (when Tailwind class doesn't exist) */
<div className="bg-[var(--nim-bg)] text-[var(--nim-text)]">
```

#### Tailwind Conditional Classes Pattern

**CRITICAL: Tailwind does NOT override based on class order in className string.**

When using conditional classes for states like active/selected, you MUST use a ternary that applies mutually exclusive class sets:

```tsx
// WRONG: Both bg-transparent and bg-nim-primary will be applied,
// and Tailwind's CSS order in the stylesheet determines which wins
<button className={`bg-transparent text-nim-muted hover:bg-nim-hover ${isActive ? 'bg-nim-primary text-white' : ''}`}>

// CORRECT: Use ternary to apply one set or the other
<button className={`cursor-pointer transition-all ${isActive ? 'bg-nim-primary text-white hover:bg-nim-primary-hover' : 'bg-transparent text-nim-muted hover:bg-nim-hover'}`}>
```

This pattern is essential for:
- Navigation buttons (active/inactive states)
- Toggle buttons (on/off states)
- Selection states (selected/unselected)
- Any component with mutually exclusive visual states

#### Common Tailwind Class Misuse

| Wrong | Right | Reason |
|-------|-------|--------|
| `bg-nim-primary` for containers | `bg-nim` | Primary is for buttons/actions, not backgrounds |
| `text-nim-primary` for text | `text-nim` | Primary is the brand color, nim is for text |
| `bg-nim-primary` for panels | `bg-nim-secondary` | Use background hierarchy for panels |
| `w-[90%] h-[80%]` for modals | `w-[90vw] h-[80vh]` | Use viewport units for fixed-position modals |

## AI Features

### AI Provider Types

The application supports two categories of AI providers. See [AI_PROVIDER_TYPES.md](./docs/AI_PROVIDER_TYPES.md) for detailed documentation.

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
- **Internal MCP Servers**: See [INTERNAL_MCP_SERVERS.md](./docs/INTERNAL_MCP_SERVERS.md) for how to implement and add new MCP servers

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

### Custom Tool Widgets

Custom widgets can replace the generic tool call display for specific MCP tools. See [CUSTOM_TOOL_WIDGETS.md](./docs/CUSTOM_TOOL_WIDGETS.md) for implementation details.

### Git Worktree Integration

Nimbalyst supports creating git worktrees for isolated AI coding sessions. See [WORKTREES.md](./docs/WORKTREES.md) for comprehensive documentation.

**Quick overview:**
- Create worktrees directly from the agent mode UI via "New Worktree" button
- Each worktree runs on its own branch in a separate directory
- Claude Code sessions execute in the worktree directory context
- One worktree can have multiple sessions (one-to-many relationship)
- Visual distinction: Worktree sessions display with a badge overlay on the AI icon

For implementation details (database schema, IPC channels), see `/packages/electron/CLAUDE.md`.

## Data Persistence

The Nimbalyst app uses **PGLite** (PostgreSQL in WebAssembly) for all data storage.

**CRITICAL: Never use localStorage in the renderer process.** All persistent state must be stored via IPC to the main process using either:
- **app-settings store** for global app settings
- **workspace-settings store** for per-project state
- **PGLite database** for complex data like AI sessions and document history

localStorage is not reliable in Electron and data can be lost. Use the existing store infrastructure instead.

For implementation details (database schema, data locations, timestamp handling), see `/packages/electron/CLAUDE.md`.

## Analytics

Nimbalyst uses PostHog for anonymous usage analytics. See the following documentation:

- **ANALYTICS\_GUIDE.md**: How to do analytics in Posthog. **You must read this before calling Posthog MCP**
- **POSTHOG\_EVENTS.md**: Canonical reference for all analytics events (must be kept in sync)
- **POSTHOG\_MCP\_INTEGRATION.md**: PostHog MCP integration architecture and usage

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

## Debugging with Log Access Tools

Agents have access to comprehensive logging tools. **Never ask users to copy-paste logs** - use these tools instead:

1. **get\_main\_process\_logs** - Main process log file (file system, IPC, AI providers)
2. **get\_renderer\_debug\_logs** - Renderer debug log file (UI errors, React components, console output)

**Debugging workflow:**
1. Check recent renderer logs: `get_renderer_debug_logs(lastLines: 100, logLevel: "error")`
2. Check main process: `get_main_process_logs(component: "FILE_WATCHER", logLevel: "error")`
3. Search for specific errors: `get_renderer_debug_logs(searchTerm: "TypeError", lastLines: 200)`
4. Investigate previous session crash: `get_renderer_debug_logs(session: 1, logLevel: "error")`

**When to use each tool:**
- **get\_main\_process\_logs**: File watcher issues, IPC errors, AI provider failures, database errors (persisted log file)
- **get\_renderer\_debug\_logs**: UI errors, React component issues, console output, crash investigation (dev mode only, persists across restarts)

## Testing Guidelines

- When implementing tests, create one test first before building the full suite
- Temporary test files must be created in a `temptests` folder
- For Playwright tests, write one test case and get it working before writing more
- See `/docs/PLAYWRIGHT.md` for comprehensive testing patterns

## Walkthrough Guides & Help Content

The application includes a walkthrough guide system for feature discovery and contextual help. See [WALKTHROUGHS.md](./docs/WALKTHROUGHS.md) for complete documentation.

### Key Concepts

- **HelpContent**: Centralized registry of help text in `packages/electron/src/renderer/help/HelpContent.ts`, keyed by `data-testid`
- **HelpTooltip**: Wrapper component that shows help on hover for any element with a `data-testid`
- **Walkthroughs**: Multi-step floating guides defined in `packages/electron/src/renderer/walkthroughs/definitions/`

### Adding Help Content

1. Add entry to `HelpContent.ts` with title, body, and optional keyboard shortcut
2. Add `data-testid` attribute to the target UI element
3. Wrap element with `<HelpTooltip testId="...">` for hover tooltip
4. Create a walkthrough definition if a multi-step guide is needed

### Two Display Patterns

1. **HelpTooltip wrapper** - For elements without existing tooltips
2. **Inline help icon** - For elements that already have their own popup (like context indicator)

## Documentation

- **AGENT\_PERMISSIONS.md**: Agent tool permission system and approval flow
- **ANALYTICS\_GUIDE.md**: How to add PostHog analytics events
- **POSTHOG\_EVENTS.md**: Canonical reference for all analytics events
- **POSTHOG\_MCP\_INTEGRATION.md**: PostHog MCP integration architecture
- **PLAYWRIGHT.md**: E2E testing patterns and best practices
- **AI\_PROVIDER\_TYPES.md**: AI provider architecture
- **CUSTOM\_TOOL\_WIDGETS.md**: Custom MCP tool widget implementation
- **INTERNAL\_MCP\_SERVERS.md**: How to implement internal MCP servers
- **WALKTHROUGHS.md**: Walkthrough guide system and help content
- **WORKTREES.md**: Git worktree integration for isolated AI coding sessions
- **THEMING.md**: Theming system documentation (in electron package)
- **RELEASING.md**: Release process

## Support

User support documentation is located in the `support/` folder:
- **force-restore-database-backup.md**: Instructions for manually restoring the database from backup
