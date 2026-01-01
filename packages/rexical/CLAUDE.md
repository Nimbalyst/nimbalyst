# Rexical Package

This package contains the Lexical-based rich text editor that powers Nimbalyst. Originally based on the Lexical playground, it's been adapted with comprehensive features including rich text editing, tables, collaboration, code highlighting, and various plugins.

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

## Plugin Architecture

The editor uses a comprehensive plugin system where each feature is implemented as a separate plugin in `src/plugins/`. Plugins handle everything from basic functionality (AutoLink, CodeHighlight) to complex features (Tables, Collaboration, DragDrop).

### Plugin File Pattern
Plugin files follow `src/plugins/[PluginName]Plugin/index.tsx`

## Node System

Custom nodes extend Lexical's base functionality:
- ImageNode/InlineImageNode for image handling
- EquationNode for KaTeX math equations
- EmojiNode, MentionNode, KeywordNode for special text
- Layout nodes for column layouts
- ExcalidrawNode for drawings

### Node File Pattern
Node files in `src/nodes/[NodeName].tsx`

## Styling and Themes

- CSS modules and regular CSS files for component styling
- Theme system in `src/themes/` for consistent editor appearance
- Responsive design with mobile considerations

### UI Components
UI components in `src/ui/[Component].tsx` with accompanying CSS
Themes in `src/themes/[ThemeName].ts` and `.css`

## CSS Variables Reference

**CRITICAL: NEVER MAKE UP CSS VARIABLE NAMES!**

When writing CSS, you MUST use the correct CSS variables from `src/themes/PlaygroundEditorTheme.css`. Do NOT invent variable names.

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
1. **ALWAYS reference** `src/themes/PlaygroundEditorTheme.css` when writing CSS
2. **NEVER hardcode** theme-specific styles (no `[data-theme="dark"]` selectors)
3. **NEVER invent** CSS variable names - only use variables that exist in PlaygroundEditorTheme.css
4. **CSS variables handle theming** - they automatically adapt to light/dark/crystal-dark themes

## Floating Element Positioning (CRITICAL)

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

## State Management Patterns

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

## Dependencies

Built with modern React, TypeScript, and Vite. Uses extensive Lexical packages (@lexical/*) for editor functionality, plus supporting libraries like KaTeX for equations, Prettier for code formatting, and Excalidraw for drawings.

## Important Editor Behaviors

### Scroll Prevention
If your editor is scrolling on load when it shouldn't, you probably are missing this from an editor.update:
```typescript
{ tag: SKIP_SCROLL_INTO_VIEW_TAG }
```

### Markdown Conversion
Markdown import and export should use our enhanced conversion system:
- `$convertFromEnhancedMarkdownString` for importing
- `$convertToEnhancedMarkdownString` for exporting

Nimbalyst always preserves newlines and spacing in markdown.
