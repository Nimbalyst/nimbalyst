# Markdown Transformer Architecture

## Overview

The markdown system in Stravu Editor is designed to support both core markdown functionality and plugin-specific extensions. The architecture separates transformers into two categories to prepare for future plugin-based configuration.

## Structure

### Core Transformers (`core-transformers.ts`)
These transformers are always included and handle standard markdown syntax:
- **Horizontal Rules** (`---`, `***`, `___`)
- **Headings** (via Lexical's ELEMENT_TRANSFORMERS)
- **Lists** (ordered and unordered)
- **Blockquotes**
- **Code blocks** and inline code
- **Text formatting** (bold, italic, strikethrough)
- **Links** (standard markdown links)
- **Check lists** (`- [ ]` and `- [x]`)

### Plugin Transformers
These transformers require specific plugins to be loaded:
- **TABLE_TRANSFORMER** - Markdown tables (requires TablePlugin)
- **IMAGE_TRANSFORMER** - Image syntax (requires ImagesPlugin)
- **EMOJI_TRANSFORMER** - `:emoji:` syntax (requires EmojisPlugin)
- **COLLAPSIBLE_TRANSFORMER** - Collapsible sections (requires CollapsiblePlugin)
- **ExcalidrawTransform** - Diagrams (requires ExcalidrawPlugin)

## Current Usage

Currently, all transformers are loaded together:

```typescript
import { STRAVU_TRANSFORMERS } from '@/markdown';

// Use in markdown conversion
$convertFromEnhancedMarkdownString(content, STRAVU_TRANSFORMERS);
$convertToEnhancedMarkdownString(STRAVU_TRANSFORMERS);
```

## Future Plugin-Based Architecture

In the future, transformers will be dynamically loaded based on configuration:

```typescript
// Example future usage
const config = {
  plugins: [TablePlugin, ImagesPlugin], // User-specified plugins
};

// Transformers would be collected from enabled plugins
const transformers = createTransformers(
  config.plugins.flatMap(p => p.transformers)
);
```

## Migration Path

The current architecture prepares for this transition by:

1. **Separating core from plugin transformers** - Core transformers are in `core-transformers.ts`
2. **Exposing both sets** - `CORE_TRANSFORMERS` and `PLUGIN_TRANSFORMERS` exports
3. **Providing `createTransformers` function** - Preview of future API
4. **Moving transformers to plugins** - Each plugin owns its transformer

## Adding New Transformers

### For Core Markdown Features
Add to `core-transformers.ts` if the feature is:
- Part of standard markdown spec
- Essential for basic editing
- Doesn't require a plugin

### For Plugin Features
1. Create transformer in the plugin directory: `plugins/[PluginName]/[Name]Transformer.ts`
2. Export from plugin's index file
3. Currently: Add to `PLUGIN_TRANSFORMERS` in `markdown/index.ts`
4. Future: Will be auto-registered by plugin system

## Transformer Order

Order matters! More specific transformers should come before general ones:
1. Plugin transformers (more specific)
2. Core transformers (general markdown)

This ensures plugin-specific syntax takes precedence over generic markdown patterns.
