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

- **ANALYTICS\_GUIDE.md**: How to add PostHog analytics events
- **POSTHOG\_EVENTS.md**: Canonical reference for all analytics events
- **PLAYWRIGHT.md**: E2E testing patterns and best practices
- **AI\_PROVIDER\_TYPES.md**: AI provider architecture
- **CUSTOM\_TOOL\_WIDGETS.md**: Custom MCP tool widget implementation
- **INTERNAL\_MCP\_SERVERS.md**: How to implement internal MCP servers
- **THEMING.md**: Theming system documentation (in electron package)
- **RELEASING.md**: Release process
