# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## CRITICAL: No Dynamic Imports in Electron Main Process

**NEVER convert static imports to dynamic `await import()` unless absolutely necessary** (confirmed circular reference) AND the user has approved it.

Dynamic imports in the Electron main process cause `__ELECTRON_LOG__` double-registration crashes and other side-effect timing issues. All MCP servers and services in `index.ts` use **static top-level imports** - follow this pattern.

- `httpServer`, `SessionNamingService`, `sessionContextServer` - all use static top-level imports
- Dynamic `await import('./mcp/sessionContextServer')` caused server startup failure - fixed by switching to static import

## CRITICAL: Database Access Rules

**NEVER directly open or query the PGLite database files using Node.js or command-line tools.**

The database at `~/Library/Application Support/@nimbalyst/electron/pglite-db` uses PID-based locking and **can only be safely accessed by one process at a time**. Opening it from a second process (like a Node.js script) will:
- Corrupt the database
- Require database recovery
- Potentially lose data

**ALWAYS use the MCP database query tool instead:**
- ✅ Use `mcp__nimbalyst-extension-dev__database_query` for all database queries
- ❌ NEVER use `node -e "const { PGlite } = require(...)"` or similar approaches
- ❌ NEVER use sqlite CLI or any direct file access

The MCP tool safely queries the database through the running Nimbalyst process, which already has the exclusive lock.

## Codebase Overview

Nimbalyst is an extensible, AI-native workspace that supports multiple editor types through a unified extension system. While it originated as a Lexical-based markdown editor, the architecture is evolving toward a fully pluggable model where **all editors** - including the core Lexical editor, Monaco code editor, spreadsheets, diagrams, and custom visual editors - are provided through extensions.

This is a monorepo containing multiple packages including the Electron desktop app, the core editor (Rexical), runtime services, extension SDK, native iOS app, and mobile support via Capacitor (for Android).

## Extension Architecture

Nimbalyst's extension system allows third-party and built-in extensions to provide custom editors, file handlers, and UI components. Extensions are self-contained packages that declare their capabilities via a manifest and communicate with the host application through a well-defined contract.

**Key concepts:**
- **EditorHost**: The interface editors use to communicate with Nimbalyst (loading/saving content, marking dirty state, handling external file changes)
- **File type registration**: Extensions declare which file extensions they handle (e.g., `.excalidraw`, `.mockup.html`, `.datamodel`)
- **Editor types**: Monaco (code), Lexical (rich text), and custom React components for specialized editing experiences

See [EXTENSION_ARCHITECTURE.md](./docs/EXTENSION_ARCHITECTURE.md) for the EditorHost contract, supported editor types, and extension development guidelines.

## Monorepo Structure

### Workspaces
```
packages/
  electron/       # Desktop app (Electron)
  rexical/        # Lexical-based editor
  runtime/        # Cross-platform runtime services (AI, sync)
  ios/            # Native iOS app (SwiftUI)
  capacitor/      # Mobile web app (Capacitor, for Android) - NOT in active development
  core/           # Shared utilities
  collabv3/       # Collaboration server
  extension-sdk/  # Extension development kit
  extensions/     # Built-in extensions
```

### Package Management
- **Install dependencies**: `npm install` at repository root
- **Uses npm workspaces** (not pnpm)
- Packages can reference each other via workspace protocol
- **IMPORTANT: Preserve \****`peer: true`**\*\* flags in package-lock.json** - The lock file contains `peer: true` flags for optional native dependencies (like esbuild platform binaries). Running `npm install` with certain npm versions or configurations can strip these flags, breaking CI. If you see `peer: true` flags disappearing from package-lock.json diffs, investigate before committing.

### Package-Specific Documentation
For detailed information about specific packages, see their CLAUDE.md files:
- `/packages/electron/CLAUDE.md` - Electron desktop app specifics
- `/packages/runtime/CLAUDE.md` - AI providers and runtime services
- `/packages/rexical/CLAUDE.md` - Lexical editor architecture
- `/packages/ios/CLAUDE.md` - Native iOS app (SwiftUI)
- `/packages/capacitor/CLAUDE.md` - Capacitor mobile app (Android) - not in active development
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
- **E2E tests**: See [E2E_TESTING.md](./docs/E2E_TESTING.md) for comprehensive documentation

### Other Packages
- **iOS (native)**: `npm run ios:test:swift`, `npm run ios:build:transcript`
- **Capacitor (Android)** *(not in active development - focused on native iOS app)*: `npm run cap:dev`, `npm run cap:android`
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

1. **Never log-and-continue for required parameters** - throw immediately instead
2. **Never fall back to default values that mask routing issues** - fail if routing is broken
3. **Always use stable identifiers for routing** - workspace paths (stable) not window IDs (transient)
4. **Validate at boundaries** - All IPC handlers and service methods MUST validate required parameters

**Rule of thumb:** If you're adding code to "handle" missing required data, you're probably hiding a bug. Throw instead.

### Workspace State Persistence

**CRITICAL: Use deep merge for all nested workspace state updates.**

The `workspace:update-state` IPC handler uses a **deep merge** function (not shallow `Object.assign`). This allows multiple modules to safely update different fields in nested structures without overwriting each other. No manual read-modify-write needed.

### Naming Conventions

**Use camelCase everywhere except SQL column names and file system paths.**

- **TypeScript/Swift interfaces, fields, variables**: `camelCase` always
- **Wire protocol (WebSocket/HTTP JSON)**: `camelCase` - no snake_case in JSON payloads
- **Message type discriminators**: `camelCase` (e.g., `'syncRequest'`, `'appendMessage'`, NOT `'sync_request'`, `'append_message'`)
- **SQL column names**: `snake_case` (standard SQL convention, stays internal to the database layer)
- **Row-to-wire mappers**: When reading from SQL, map `snake_case` columns to `camelCase` fields at the boundary (e.g., `{ sessionId: row.session_id }`)

This applies to all packages: collabv3 server, runtime sync client, Electron SyncManager, and iOS SyncProtocol. Never introduce snake_case into wire-format JSON even if it "looks more API-like" - this is a private protocol consumed only by our own TypeScript and Swift clients.

## Documentation Reference

**You MUST read the relevant documentation files when working on or investigating issues in the corresponding areas.**

Read the file **in its entirety** before making changes. These documents contain critical patterns, anti-patterns, and architectural decisions that must be followed. Treat them as authoritative instructions equivalent to anything in this CLAUDE.md file.

| File | Description | Read when... |
| --- | --- | --- |
| [EXTENSION_ARCHITECTURE.md](./docs/EXTENSION_ARCHITECTURE.md) | Documents the EditorHost contract that all editors must implement, supported editor types (Monaco, Lexical, custom), and how extensions register capabilities. Includes the extension manifest format and lifecycle hooks. | Working on extensions, creating custom editors, modifying how editors communicate with the host, or adding new editor types to the system. |
| [IPC_LISTENERS.md](./docs/IPC_LISTENERS.md) | Explains the centralized IPC listener architecture where components NEVER subscribe to IPC events directly. Central listeners in `store/listeners/` update Jotai atoms, and components read from atoms. Includes debouncing patterns. | Adding new IPC events, debugging why events aren't reaching components, fixing race conditions or stale closures in event handling, or seeing MaxListenersExceededWarning errors. |
| [IPC_GUIDE.md](./docs/IPC_GUIDE.md) | Covers IPC patterns for main/renderer communication including `safeHandle`, `safeOn`, error handling, and how to structure IPC channels. Documents the preload API and type safety patterns. | Writing new IPC handlers in the main process, creating new electronAPI methods, or debugging IPC communication issues between main and renderer. |
| [EDITOR_STATE.md](./docs/EDITOR_STATE.md) | Explains why "lift state up" is an anti-pattern for editors in this codebase. Editors own their content state via EditorHost, not parent components. Covers Jotai atom families for tab metadata (dirty, processing). | Working on editor components, TabEditor infrastructure, understanding why editor state is structured this way, or fixing state management issues in editors. |
| [JOTAI.md](./docs/JOTAI.md) | Covers derived atoms for session state, atom families for per-entity state, and persistence patterns. Documents critical anti-patterns like dynamic imports in atoms and async derived atoms that cause state divergence. | Working with Jotai atoms, debugging state divergence between UI and actual state, adding new atoms, or understanding why state updates aren't reflecting in components. |
| [STATE_PERSISTENCE.md](./docs/STATE_PERSISTENCE.md) | Documents migration safety patterns for persisted state that may be missing fields added after it was saved. Covers `createDefault*()` functions, `??` operator merging, and the checklist for adding new persisted fields. | Adding new fields to any persisted state interface (workspace state, app settings, workstream state), or debugging "Cannot read properties of undefined" errors on app load. |
| [UI_PATTERNS.md](./docs/UI_PATTERNS.md) | Covers the canonical `--nim-*` CSS variable names and their Tailwind equivalents, container queries (not media queries), Tailwind conditional class patterns using ternaries, and text selection opt-in rules. | Writing UI components, styling with CSS or Tailwind, fixing styling inconsistencies, or adding responsive behavior to panels and components. |
| [AI_PROVIDER_TYPES.md](./docs/AI_PROVIDER_TYPES.md) | Distinguishes Agent providers (Claude Code with MCP support, file system access) from Chat providers (Claude Chat, OpenAI, LM Studio with direct API calls). Documents model selection rules and provider-specific behaviors. | Working on AI integration, adding new AI providers, modifying how models are selected, or debugging provider-specific issues. |
| [CONTEXT_WINDOW_USAGE_TRACKING.md](./docs/CONTEXT_WINDOW_USAGE_TRACKING.md) | Explains how context window fill percentage is extracted from Claude Agent SDK streaming chunks (per-step vs cumulative usage), compaction handling, and subagent isolation. | Working on context usage display, token tracking, ClaudeCodeProvider streaming, or debugging why context percentage is wrong. |
| [INTERNAL_MCP_SERVERS.md](./docs/INTERNAL_MCP_SERVERS.md) | Documents how to implement MCP servers that run inside Nimbalyst, including the server lifecycle, tool registration, and how to expose functionality to Claude Code sessions. | Adding new MCP server functionality, creating new tools for AI agents, or understanding how existing MCP servers work. |
| [CUSTOM_TOOL_WIDGETS.md](./docs/CUSTOM_TOOL_WIDGETS.md) | Explains how to create custom React widgets that replace the generic tool call display for specific MCP tools. Covers the widget registry, props interface, and rendering lifecycle. | Creating visual displays for MCP tool results, customizing how specific tools appear in the chat transcript, or debugging widget rendering issues. |
| [INTERACTIVE_PROMPTS.md](./docs/INTERACTIVE_PROMPTS.md) | Documents the durable prompts architecture for AskUserQuestion, ExitPlanMode, GitCommitProposal, and ToolPermission widgets. These prompts persist across page reloads and have special handling for user responses. | Working on interactive prompt widgets, adding new durable prompt types, or debugging why prompts aren't persisting or responding correctly. |
| [WORKTREES.md](./docs/WORKTREES.md) | Covers git worktree integration for isolated AI coding sessions. Documents the database schema, IPC channels, branch naming conventions, and how worktrees relate to sessions (one-to-many). | Working on worktree features, session isolation, or understanding how AI sessions connect to git worktrees. |
| [HELP_WALKTHROUGHS.md](./docs/HELP_WALKTHROUGHS.md) | Documents the HelpContent registry keyed by `data-testid`, HelpTooltip wrapper component, and walkthrough definitions for multi-step guides. Covers both hover tooltips and inline help icons. | Adding help tooltips to UI elements, creating new walkthrough guides, or modifying existing help content. |
| [WALKTHROUGHS.md](./docs/WALKTHROUGHS.md) | Additional documentation on the walkthrough system including step definitions, positioning, and triggering conditions for multi-step floating guides. | Creating complex multi-step walkthroughs or debugging walkthrough flow issues. |
| [E2E_TESTING.md](./docs/E2E_TESTING.md) | Covers E2E testing patterns including test structure, selectors, waiting strategies, and common pitfalls. Documents the test utilities and how to handle async operations in tests. Also includes AI agent guidelines for when to run tests in dev containers and how to run targeted tests. | Writing new E2E tests, debugging flaky tests, understanding why tests are failing, or running E2E tests as an AI agent (especially in git worktrees). |
| [DIALOGS.md](./docs/DIALOGS.md) | Documents the DialogProvider system for modal dialogs including the dialog registry, opening/closing patterns, and how dialogs receive props and return results. | Adding new modal dialogs, modifying existing dialog behavior, or debugging dialog state issues. |
| [AGENT_PERMISSIONS.md](./docs/AGENT_PERMISSIONS.md) | Covers the tool permission system for AI agents including permission levels, approval flows, and how permissions are persisted and checked at runtime. | Working on agent permissions, adding new permission types, or debugging why tools are being blocked or auto-approved. |
| [ANALYTICS_GUIDE.md](./docs/ANALYTICS_GUIDE.md) | Documents how to add PostHog analytics events including event naming conventions, property schemas, and best practices. Required reading before using PostHog MCP tools. | Adding new analytics events, modifying existing events, or using the PostHog MCP tools for querying analytics. |
| [POSTHOG_EVENTS.md](./docs/POSTHOG_EVENTS.md) | Canonical reference listing all PostHog events with their names, file locations, triggers, and properties. Must be kept in sync when adding, modifying, or removing events. | Adding, modifying, or removing any PostHog analytics event. Update this file whenever you change events. |
| [POSTHOG_MCP_INTEGRATION.md](./docs/POSTHOG_MCP_INTEGRATION.md) | Documents the PostHog MCP server architecture, available tools, and how to query analytics data programmatically from AI sessions. | Using PostHog MCP tools to query analytics, debugging MCP integration issues, or extending PostHog functionality. |
| [THEMING.md](./packages/electron/docs/THEMING.md) | Documents the theming system including theme definition format, color variables, and how themes are applied across the application. | Working on themes, adding new color schemes, or debugging theme-related styling issues. |
| [RELEASING.md](./RELEASING.md) | Documents the release process including version bumping, changelog management, git tagging, and the `/release` command. Covers both local and notarized builds. | Preparing a release, understanding the release workflow, or debugging release script issues. |
| [MARKETING_SCREENSHOTS.md](./docs/MARKETING_SCREENSHOTS.md) | Documents the Playwright-based marketing screenshot and video capture system. Covers the fixture workspace, helper utilities, DOM cursor for video, output file inventory, and how to add new screenshots or video choreography. | Adding new marketing screenshots, modifying video choreography, updating the fixture workspace data, or importing output files into the marketing website. |
| [FILE_WATCHING_AND_CHANGE_TRACKING.md](./docs/FILE_WATCHING_AND_CHANGE_TRACKING.md) | Documents the file watching infrastructure (ChokidarFileWatcher, OptimizedWorkspaceWatcher, GitRefWatcher, SessionFileWatcher), AI change tracking pipeline (SessionFileTracker, HistoryManager, ToolCallMatcher), IPC event flow, Jotai atoms for file state, and the red/green diff display system (DiffPreview, TextDiffViewer, MonacoDiffViewer, DiffPreviewEditor). | Working on file watchers, AI change detection, diff display, pending review flow, snapshot storage, file change conflict handling, or the FilesEditedSidebar. |

## AI Features

- **AI Chat Panel**: Multi-provider support (Claude, OpenAI, LM Studio, Claude Code), document-aware, Cmd+Shift+A to toggle
- **Session Manager**: Global session view (Cmd+Alt+S), search, export, delete
- **Model Configuration**: Dynamic model selection from provider APIs, no hardcoded models
- **Git Worktrees**: Isolated AI coding sessions on separate branches via "New Worktree" button

## Data Persistence

The Nimbalyst app uses **PGLite** (PostgreSQL in WebAssembly) for all data storage.

**CRITICAL: Never use localStorage in the renderer process.** Use instead:
- **app-settings store** for global app settings
- **workspace-settings store** for per-project state
- **PGLite database** for complex data like AI sessions and document history

**CRITICAL: All database timestamps must use \****`TIMESTAMPTZ`**\*\*.** Never create `TIMESTAMP` (without timezone) columns. If legacy tables exist, add a migration to convert those columns to `TIMESTAMPTZ`.

For implementation details, see `/packages/electron/CLAUDE.md`.

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

**Keyboard Shortcuts**: When adding or modifying keyboard shortcuts, update `KeyboardShortcutsDialog.tsx` to keep the Help > Keyboard Shortcuts dialog in sync.

## Verifying Development Mode

**IMPORTANT**: Before making code changes to the Nimbalyst codebase, use `mcp__nimbalyst-extension-dev__get_environment_info` to verify that Nimbalyst is running in development mode. If the user is running a packaged build, your code changes will NOT take effect and you should inform them to start the dev server (`npm run dev`).

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

## Support

User support documentation is located in the `support/` folder:
- **force-restore-database-backup.md**: Instructions for manually restoring the database from backup
