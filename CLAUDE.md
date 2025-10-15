# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Codebase Overview

This is Preditor - a rich text editor built with Meta's Lexical framework. Originally based on the Lexical playground, it's been adapted as the foundation for a new editor project with comprehensive features including rich text editing, tables, collaboration, code highlighting, and various plugins.

## Development Commands

### Electron App
- **Start dev server**: `cd packages/electron && npm run dev` - Runs Electron app with hot reload
- **Build for Mac**: `cd packages/electron && npm run build:mac:local` - Creates local Mac build
- **Build for Mac (notarized)**: `cd packages/electron && npm run build:mac:notarized` - Creates notarized Mac build

### Monorepo Setup
- **Install dependencies**: `npm install --legacy-peer-deps` - Install all dependencies
- **Package management**: Uses npm workspaces (not pnpm)

## Releases

When the user requests "prepare a [patch|minor|major] release", follow this workflow:

### Release Preparation Process
1. **Get commits since last release**:
  - Find the last git tag: `git describe --tags --abbrev=0`
  - Get commits since that tag: `git log [last-tag]..HEAD --oneline`

2. **Generate release notes**:
  - Create concise bullet-point release notes summarizing the most important changes
  - Focus on user-facing changes (features, fixes, improvements)
  - Filter out trivial changes (chore, docs, minor refactors)
  - Keep it brief - internal notes only
  - Follow commit message conventions (feat:, fix:, refactor:)

3. **Save release notes**:
  - Write notes to `packages/electron/RELEASE_NOTES.md`
  - Show the user the notes for approval

4. **Execute release** (after user approval):
  - Run `./scripts/release.sh [patch|minor|major]`
  - The script will:
    - Bump version in `packages/electron/package.json`
    - Update package-lock.json
    - Create commit with release notes
    - Create git tag with version number
    - Display next steps for pushing to trigger CI

### Release Script
- **Location**: `./scripts/release.sh`
- **Usage**: `./scripts/release.sh [patch|minor|major]`
- **What it does**: Automates version bumping, committing, and tagging
- **Trigger**: Manual push of tag triggers GitHub Actions to build and publish

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

- **Signing configuration**: Uses Developer ID Application certificate
- **Build scripts**: `npm run build:mac:notarized`&#32;for notarized build, `build:mac:local` for local testing
- **Binary handling**: Properly signs ripgrep and other bundled tools
- **JAR exclusion**: Automatically removes JAR files that can't be notarized
- **Entitlements**: Configured for hardened runtime with necessary exceptions

## Electron App Debug Logging

The Electron app (`packages/electron/`) includes a debug logging feature that captures all browser console messages in development mode. This is useful for debugging renderer-side issues and browser load problems.

- **Log file location**: `~/Library/Application Support/@preditor/electron/preditor-debug.log` (macOS)
- **What's logged**: All browser console messages, main process logs, timestamps, source locations, and log levels
- **When active**: Only in development mode (`NODE_ENV !== 'production'`)
- **Implementation**: See `packages/electron/src/main/index.ts` - uses `webContents.on('console-message')` event

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

# Agent Instructions for Preditor Integration

This document provides concise instructions for AI agents working with projects that use Preditor's structured planning and tracking systems.

## Plan Documents

### Location and Naming
- **Directory**: All plans must be stored in the `plans/` folder at the repository root
- **File naming**: Use descriptive kebab-case names (e.g., `agentic-markdown-planning-system.md`)
- **Single source of truth**: Plans serve as the authoritative record for features, bugs, and development tasks

### Required Frontmatter
Every plan document MUST include YAML frontmatter with complete metadata:

```yaml
---
planStatus:
  planId: plan-[unique-id]        # Unique identifier for the plan
  title: [Plan Title]             # Human-readable title
  status: [status]                # See status values below
  planType: [type]                # See plan types below
  priority: low | medium | high | critical
  owner: [username]               # Primary owner/assignee
  tags:                           # Relevant tags for categorization (optional)
    - [tag1]
    - [tag2]
  created: "YYYY-MM-DD"
  updated: "YYYY-MM-DDTHH:MM:SS.sssZ"
  progress: [0-100]               # Completion percentage
  dueDate: "YYYY-MM-DD"           # Due date (optional)
  startDate: "YYYY-MM-DD"         # Start date (optional)
---
```

### Status Values
- `draft` - Initial planning phase
- `ready-for-development` - Approved and ready for implementation
- `in-development` - Currently being worked on
- `in-review` - Implementation complete, pending review
- `completed` - Successfully completed
- `rejected` - Plan has been rejected or cancelled
- `blocked` - Progress blocked by dependencies

### Plan Types
- `feature` - New feature development
- `bug-fix` - Bug fix or issue resolution
- `refactor` - Code refactoring/improvement
- `system-design` - Architecture/design work
- `research` - Research/investigation task

### Document Structure
After the frontmatter, plans should include:
1. **Title** with `<!-- plan-status -->` comment immediately after
2. **Goals** section outlining objectives
3. **System Overview** or problem description
4. **Implementation details** as needed
5. **Acceptance criteria** when applicable

### Working with Plans
- **Creating plans**: Always include complete frontmatter when creating new plans
- **Updating plans**: Preserve user edits, append updates rather than overwriting
- **Status tracking**: Update `status`, `progress`, and `updated` fields as work progresses
- **Collaboration**: Plans support both human and agent contributors

## Inline Tracker Items

Track bugs, tasks, and ideas directly in any markdown file using inline syntax:

```markdown
- Fix login bug @bug[id:bug_abc123 status:in-progress priority:high owner:alice]
- Add dark mode @task[id:tsk_xyz789 status:to-do priority:medium]
- Research API design @idea[id:ida_def456 status:to-do]
```

Metadata attributes: `id`, `status`, `priority`, `owner`, `tags`, `due_date`
