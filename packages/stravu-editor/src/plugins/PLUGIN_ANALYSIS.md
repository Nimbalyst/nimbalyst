# Plugin Analysis for Markdown-Native Support

## Overview
This document analyzes the current plugin architecture and identifies which plugins should be removed, reworked, or refactored to support a markdown-native approach with proper roundtrip conversion.

## Core Principles
- **Markdown-Native**: All content should be representable in markdown
- **Roundtrip Support**: Content should convert losslessly between markdown and editor format
- **Clean Architecture**: Plugins should be properly packaged and isolated

## Plugin Categories

### ✅ Keep - Markdown Compatible
These plugins work well with markdown or enhance the editing experience without breaking markdown compatibility:

1. **AutoLinkPlugin** - Auto-detects and creates links from URLs (standard markdown links)
2. **CodeHighlightPlugin** - Syntax highlighting for code blocks (markdown code blocks)
3. **LinkPlugin** - Basic link support (markdown links)
4. **MarkdownShortcutPlugin** - Keyboard shortcuts for markdown formatting
5. **ImagesPlugin** - Image support (markdown images)
6. **ShortcutsPlugin** - General keyboard shortcuts
7. **TabFocusPlugin** - Tab key navigation
8. **SearchReplacePlugin** - Find and replace functionality
9. **ToolbarPlugin** - UI toolbar (includes MarkdownToggle.tsx)

### ⚠️ Rework Needed - Partial Markdown Support
These plugins need modifications to properly support markdown roundtrip:

1. **TablePlugin** + **TableActionMenuPlugin** + **TableCellResizer** + **TableHoverActionsPlugin**
- Tables are markdown-compatible but need proper transformer implementation
- Should consolidate into single table package

2. **CollapsiblePlugin** ✅ UPDATED
- Now uses standard HTML `<details>`/`<summary>` syntax
- Fully markdown-compatible with native browser support

3. **PageBreakPlugin**
- Needs markdown representation (e.g., `---` or custom syntax)

4. **EmojisPlugin**
- Should use standard emoji Unicode or :emoji: notation in markdown

### ❌ Remove - Not Markdown Compatible
These plugins don't fit the markdown-native approach or are unnecessary:

1. **CommentPlugin** - Comments don't have standard markdown representation
2. **ExcalidrawPlugin** - Drawings can't be represented in markdown text
3. **StickyPlugin** - Sticky notes aren't markdown-native
4. **AutoEmbedPlugin** - Embeds aren't pure markdown (could be links instead)
5. **LayoutPlugin** - Multi-column layouts aren't standard markdown
6. **SpeechToTextPlugin** - Input method, not content type
7. **TestRecorderPlugin** - Development tool, not for production
8. **TypingPerfPlugin** - Performance monitoring tool
9. **TreeViewPlugin** - Debug/development tool
10. **SpecialTextPlugin** - Custom bracket syntax conflicts with markdown links (REMOVED)

### 🔧 Utility/UI Plugins - Keep but Review
These provide UI/UX features that don't affect markdown content:

1. **DragDropPastePlugin** - File handling utility
2. **DraggableBlockPlugin** - UI enhancement for block reordering
3. **FloatingLinkEditorPlugin** - UI for editing links
4. **FloatingTextFormatToolbarPlugin** - UI for text formatting
5. **ComponentPickerPlugin** - UI for inserting components
6. **EmojiPickerPlugin** - UI for emoji selection
7. **CodeActionMenuPlugin** - UI for code block actions
8. **MaxLengthPlugin** - Content validation
9. **TableOfContentsPlugin** - Navigation UI (generated from headings)

## Refactoring Requirements

### 1. MarkdownTransformers Module ✅ COMPLETED
**Status**: Refactoring completed

**What was done**:
- Created new `src/markdown/` directory for core markdown infrastructure
- Moved transformers to their respective plugin packages:
- TABLE\_TRANSFORMER → `TablePlugin/TableTransformer.ts`
- IMAGE\_TRANSFORMER → `ImagesPlugin/ImageTransformer.ts`
- EMOJI\_TRANSFORMER → `EmojisPlugin/EmojiTransformer.ts`
- HR\_TRANSFORMER → `markdown/HorizontalRuleTransformer.ts`
- Created central aggregation in `src/markdown/index.ts` as STRAVU\_TRANSFORMERS
- Updated all imports throughout the codebase

### 2. Plugin Packaging Architecture
**Current Issue**: Plugins are loosely organized with varying structures

**Proposed Structure**:
```javascript
src/plugins/[PluginName]/
  ├── index.ts           // Plugin export
  ├── nodes/             // Plugin-specific nodes
  ├── commands/          // Plugin commands
  ├── transformers/      // Markdown transformers
  ├── components/        // React components
  └── styles/            // CSS modules
```

### 3. Plugin Registry Updates
- Update PluginManager.tsx to handle new plugin structure
- Add markdown compatibility metadata to PluginRegistry.ts
- Create plugin configuration for markdown-only mode

## Implementation Priority

### Phase 1: Core Refactoring
1. Extract and refactor MarkdownTransformers
2. Update plugin packaging structure for core plugins
3. Implement plugin metadata system

### Phase 2: Remove Incompatible Plugins
1. Remove CommentPlugin
2. Remove ExcalidrawPlugin
3. Remove StickyPlugin
4. Remove other non-markdown plugins

### Phase 3: Rework Existing Plugins
1. Consolidate table-related plugins
2. Update CollapsiblePlugin transformer
3. Add markdown transformers for remaining plugins

### Phase 4: Testing & Documentation
1. Add roundtrip tests for each markdown-compatible plugin
2. Document markdown syntax for each plugin
3. Create migration guide for removed features

## Notes

- Some removed plugins (like ExcalidrawPlugin) could be maintained as optional extensions for non-markdown workflows
- Consider creating a "markdown-strict" mode that only loads markdown-compatible plugins
- UI/utility plugins should be clearly separated from content plugins in the architecture