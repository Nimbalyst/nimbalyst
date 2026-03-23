---
planStatus:
  planId: plan-mockuplm-enhancement-suite
  title: MockupLM Enhancement Suite
  status: in-development
  planType: feature
  priority: high
  owner: ghinkle
  stakeholders:
    - ghinkle
  tags:
    - mockuplm
    - design-tools
    - prototyping
    - extensions
  created: "2026-01-30"
  updated: "2026-03-19T00:00:00.000Z"
  startDate: "2026-03-18"
  progress: 85
---
# MockupLM Enhancement Suite

Transform MockupLM from a single-file mockup editor into a comprehensive AI-native design and prototyping system, inspired by [Figma Make](https://www.figma.com/make/).

## Figma Make Feature Comparison

| Figma Make Feature | MockupLM Status | Notes |
| --- | --- | --- |
| **Prompt-to-prototype** | DONE | AI generates `.mockup.html` via SKILL.md with theme variable enforcement |
| **Design system integration** | DONE | `--mockup-*` CSS variables, component library, AI instructions enforce usage |
| **Direct editing of AI output** | DONE | Source mode toggle to Monaco; PropertyPanel for visual editing |
| **Code Layers** (interactive elements) | DONE | Full JS interaction engine via `new Function()` scoped to state |
| **Connectors** (external context) | Partial | MCP connectors documented in SKILL.md; `.mockuprules` not yet implemented |
| **Project canvas** | DONE | React Flow canvas with `.mockupproject` files, focus mode, screen navigation |
| **Multi-theme preview** (light/dark) | DONE | Theme toggle in toolbar, runtime CSS variable injection |
| **Interactive prototyping** | DONE | State management, event handlers, two-way binding, `:for` loops, `:if` conditionals |
| **Design-to-code export** | N/A | Not needed: AI agent generates code on demand from mockups |
| **Shareable prototypes** | Partial | Share bundler implemented; uploader/public URL not yet |
| **Responsive preview** | DONE | ViewportSelector with preset sizes |

### What We Do NOT Need to Copy

- **Figma Sites / hosting**: We are a workspace tool, not a website builder
- **Backend/database integration**: Mockups are for planning, not production apps
- **Full React code editing inside mockups**: Our "source mode" toggle to Monaco is sufficient
- **Vectorize / image-to-vector**: Not relevant to our use case

## Architecture Overview

### Key Decisions (Updated)

| Area | Decision | Rationale |
| --- | --- | --- |
| Components | Built-in `nim-*` web components injected into iframes | Generic primitives always available; theme-aware via CSS vars |
| Interaction Engine | Full JavaScript via `new Function()` scoped to state vars | User correctly identified that a hand-rolled safe-eval was absurd. Real JS is simpler (~50 lines vs ~400) and far more capable. Content is author-controlled, not untrusted input. |
| Theming | `--mockup-*` CSS variables, dark and light only | Injected at runtime into iframes via `themeEngine.ts`. Crystal-dark removed -- just dark and light. |
| Canvas Focus Mode | Full-screen overlay within canvas component | Double-click node to expand; connected screens sidebar for navigation; Esc to return |
| State Management | Zustand per-editor-instance (DataModelLM pattern) | `createMockupProjectStore()` factory, dirty tracking, initial load guard |
| File Operations | `ExtensionFileSystemService` API | `readFile`, `writeFile`, `findFiles` with glob patterns; no direct Node fs |

### File Structure (Implemented)

```
packages/extensions/mockuplm/src/
├── types/
│   └── project.ts                 # MockupProject, MockupReference, Connection types
├── store/
│   └── projectStore.ts            # Zustand store (DataModelLM pattern)
├── components/
│   ├── MockupProjectCanvas.tsx    # React Flow canvas + FocusOverlay + ConnectedScreensSidebar
│   ├── MockupProjectEditor.tsx    # Wrapper with toolbar (theme toggle, import)
│   ├── MockupNode.tsx             # Node with live iframe preview + theme injection
│   ├── MockupEditor.tsx           # Single-file mockup editor
│   ├── ConnectionEdge.tsx         # Arrow edge between mockups
│   ├── PropertyPanel.tsx          # Element property editor
│   ├── ViewportSelector.tsx       # Responsive viewport presets
│   └── MockupProjectCanvas.tsx    # Canvas with inline rename, context menu, focus mode
├── components-lib/
│   ├── index.ts                   # Component registry + injection
│   ├── nim-button.ts              # Button (variant, size, disabled)
│   ├── nim-input.ts               # Text input (placeholder, type, disabled)
│   ├── nim-card.ts                # Container card (title, subtitle)
│   ├── nim-tabs.ts                # Tab navigation (active, @change event)
│   ├── nim-dialog.ts              # Modal dialog (open, title)
│   ├── nim-list.ts                # Data list with items
│   ├── nim-icon.ts                # Icon display (name, size)
│   ├── nim-select.ts              # Dropdown select (@change event, value attr)
│   ├── nim-toggle.ts              # Toggle switch (@change event, checked)
│   ├── nim-avatar.ts              # User avatar (name, size)
│   ├── nim-accordion.ts           # Collapsible sections (data-title, data-open)
│   ├── nim-dropdown.ts            # Click-to-open menu (@select event)
│   ├── nim-tree.ts                # Collapsible tree view (@select event)
│   ├── nim-badge.ts               # Status badges (variant, size, pill)
│   └── nim-tooltip.ts             # Hover tooltip (position)
└── utils/
    ├── interactionEngine.ts       # Full JS interaction engine (new Function)
    ├── themeEngine.ts             # Theme CSS variable injection (dark/light)
    ├── componentInjector.ts       # Inject components into iframe
    ├── cssPropertyExtractor.ts    # Read computed styles from selected element
    ├── expressionEvaluator.ts     # (Legacy - replaced by interactionEngine)
    ├── stateParser.ts             # Parse <script type="mockup/state">
    ├── shareBundler.ts            # Bundle project for sharing
    └── exportFlowDoc.ts           # Export canvas as Markdown/Mermaid
```

## 1. Project Canvas View -- DONE

### What Was Built

- `.mockupproject` JSON file format with version, name, mockups array, connections array, viewport
- React Flow canvas with custom MockupNode (live iframe preview at 40% scale) and ConnectionEdge (smooth step paths with labels)
- Zustand store per editor instance: `loadFromFile()`, `toFileData()`, dirty tracking, `hasCompletedInitialLoad`
- Drag-to-connect UI (source/target handles on nodes)
- Context menu with: Open in Editor, Focus View, Rename (inline input), Delete Screen
- Inline rename replaces `window.prompt()` (doesn't work in Electron)
- "Add Screen" creates new `.mockup.html` files via ExtensionFileSystemService
- "Import Existing" scans directory for `.mockup.html` files using `filesystem.findFiles()`
- Auto-layout algorithm (grid arrangement, sqrt cols, 500px x 400px gaps)

### Focus Mode

- Double-click a node to enter focus mode (full-screen interactive overlay)
- ConnectedScreensSidebar shows outgoing, incoming, and all screens for navigation
- Breadcrumb navigation (clickable project name) + "Esc to go back" hint
- Interactive mode activated in focus view (interaction engine injected)

### Remaining Work

- [ ] Thumbnail strategy: PNG at rest, live iframe on hover (currently always live iframe)
- [ ] Drag from file tree to add mockups to canvas
- [ ] Resizable nodes (currently fixed size)
- [ ] Clickable prototype navigation through connections within iframe content (connections shown in sidebar but clicking elements within mockup doesn't navigate)
- [ ] AI can screenshot/see the project canvas for context

## 2. Theming System -- DONE

### What Was Built

- `--mockup-*` CSS variable set with dark and light presets in `themeEngine.ts`
- Theme toggle dropdown in both MockupEditor and MockupProjectEditor toolbars
- `injectTheme()` function prepends theme stylesheet into iframe `<head>`
- `MockupTheme = 'light' | 'dark'` (crystal-dark removed)
- Theme passed through to MockupNode for canvas preview rendering

### AI Enforcement

- SKILL.md has CRITICAL section with WRONG/RIGHT examples showing hardcoded colors vs `var(--mockup-*)` usage
- `mockup.md` command also reinforces theme variable requirement

### Remaining Work

- [ ] Side-by-side theme comparison view (light + dark simultaneously)

## 3. Component Library -- DONE

### What Was Built

15 built-in `nim-*` web components, all theme-aware via `--mockup-*` CSS variables:

| Component | Key Features |
| --- | --- |
| `nim-button` | variant (primary/secondary/ghost/danger), size, disabled |
| `nim-input` | placeholder, type, disabled |
| `nim-card` | title, subtitle |
| `nim-tabs` | active tab, **clickable tabs with @change event** |
| `nim-dialog` | open, title, modal overlay |
| `nim-list` | items display |
| `nim-icon` | name (Lucide-compatible), size |
| `nim-select` | options, **@change event, value attribute** |
| `nim-toggle` | **clickable with @change event**, checked state |
| `nim-avatar` | name, size (sm/md/lg), generates initials |
| `nim-accordion` | collapsible sections, data-title, data-open |
| `nim-dropdown` | click-to-open menu, @select event, dividers |
| `nim-tree` | collapsible tree, slot="node"/slot="leaf", @select event |
| `nim-badge` | variant (primary/success/warning/error/secondary/ghost), size, pill |
| `nim-tooltip` | hover tooltip, position (top/bottom/left/right) |

Components are injected as script strings into iframe documents via `componentInjector.ts`.

### Remaining Work

- [ ] Repo-level component library (`.nimbalyst/mockup-components/` with manifest.json)
- [ ] AI tooling to scaffold repo component library from existing codebase

## 4. Interactive Mode -- DONE

### What Was Built

The interaction engine (`interactionEngine.ts`) uses **real JavaScript execution** via `new Function()`:

- **`evalExpr(expr)`**: State vars as function params, returns expression result
- **`execStmt(code, extraScope)`**: Preamble/postamble pattern reads state vars into locals, executes code, writes back
- **`evalExprScoped(expr, extra)`**: For `:for` loop variable scoping

Supported bindings:
- `:attr="expr"` -- reactive attribute bindings
- `:class="{ active: isActive, 'nav-item': true }"` -- object syntax class binding
- `:style="{ opacity: loading ? '0.6' : '1' }"` -- object syntax style binding
- `:if="expr"` -- conditional visibility (DOM insertion/removal with placeholder comments)
- `:for="item in list"` / `:for="item, index in list"` -- list rendering with clone + scope
- `:value="varName"` -- two-way binding on inputs (auto `input`/`change` listeners)
- `:checked="varName"` -- two-way binding on checkboxes
- `@event="code"` -- full JavaScript event handlers
- `{{ expr }}` -- text interpolation

State defined via `<script type="mockup/state">{ JSON }</script>`.

### Example: Working Dashboard with Navigation

The `samples/dashboard.mockup.html` demonstrates:
- Left nav with 3 entries (Overview, Projects, Settings) that switch pages via `@click="page = 'overview'"`
- Active nav highlighting via `:class="{ active: page === 'overview', 'nav-item': true }"`
- Conditional page rendering via `:if="page === 'overview'"`
- Dynamic title via `{{ page === 'overview' ? 'Overview' : ... }}`
- Project cards rendered with `:for="p in projects"` from state array
- Working toggle switches via `@click="darkMode = !darkMode"` with `:class="{ on: darkMode, off: !darkMode }"`

### Remaining Work

- [ ] CSS transition support via `data-*` attributes
- [ ] Canvas integration: connection source elements clickable in interactive mode to navigate between mockups

## 5. AI Context & Generation -- PARTIAL

### What Was Built

- SKILL.md updated with full component library reference and all binding syntax
- mockup.md command gathers context before generation
- Instructions for AI to use MCP connectors (Linear, etc.) for external context
- Theme variable enforcement with CRITICAL WRONG/RIGHT examples

### Remaining Work

- [ ] Design `.mockuprules` YAML format
- [ ] Implement rules parser utility
- [ ] Test end-to-end: prompt with Linear issue reference generates context-aware mockup

## 6. Visual Editing -- PARTIAL

### What Was Built

- PropertyPanel component
- cssPropertyExtractor
- ViewportSelector with responsive presets

### Remaining Work

- [ ] Implement htmlMutator (applies property changes back to HTML source)
- [ ] Wire property changes through EditorHost dirty tracking

## 7. Sharing & Export -- PARTIAL

### What Was Built

- Share bundler (bundles project + mockups + components into standalone package)
- Export canvas flow as Markdown documentation with Mermaid diagram

### Remaining Work

- [ ] Build share uploader (upload to sharing service, return public URL)
- [ ] Build ShareDialog component (URL copy, QR code, expiry settings)
- [ ] Shared view: read-only project canvas with interactive prototype mode

## Samples

### `samples/app-example.mockupproject`

Example project demonstrating the full system:
- **Login screen** (`login.mockup.html`): Email/password form with validation, error display, loading state, social login buttons. All interactive via the state engine.
- **Dashboard** (`dashboard.mockup.html`): Full app layout with working left nav (Overview, Projects, Settings), stat cards, bar chart, project cards with `:for` rendering, toggle settings. Three pages switch via nav clicks.
- Connected via "Sign In" flow arrow on the canvas.

### `samples/demo.mockupproject` / `samples/demo.mockup.html`

Original static dashboard demo (no interactivity).

## Open Questions

1. **Repo component library**: What's the right format for `.nimbalyst/mockup-components/manifest.json`? How do we version components?

2. **Sharing backend**: Cloudflare Pages/Workers (like collabv3)? Or simpler static hosting?

3. **Canvas screenshots for AI**: The AI can't currently see the project canvas layout. Should we add a screenshot tool for it?

4. **Collaboration**: How should mockup projects integrate with git/version control for team collaboration?

## Technical Notes

### Interaction Engine Architecture

The engine was initially built as a hand-rolled safe expression evaluator (~400 lines) with restricted parsing. This was replaced with `new Function()` (~50 lines) after recognizing that:
- Mockup content is author-controlled, not untrusted user input
- We're already running in a web browser with full JS capabilities
- The restricted parser couldn't support real prototyping needs (loops, conditionals, complex logic)
- The preamble/postamble pattern safely scopes state mutations

### React Flow Integration

Following DataModelLM's pattern:
- `@xyflow/react` ^12.9.0
- Zustand store factory per editor instance
- Custom node types (MockupNode with live iframe) and edge types (ConnectionEdge with labels)
- `hasCompletedInitialLoad` flag prevents false dirty from fitView

### Iframe Sandboxing

- `sandbox="allow-same-origin"` for component functionality
- Theme and component scripts injected after iframe load
- Interaction engine injected and activated in focus mode
- 3-second polling for external file changes (AI edits)
