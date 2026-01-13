---
planStatus:
  planId: plan-claude-code-plugin-marketplace-gui
  title: Claude Code Plugin Marketplace GUI
  status: draft
  planType: feature
  priority: medium
  owner: claude
  stakeholders:
    - jordanbentley
  tags:
    - gui
    - plugins
    - marketplace
    - claude-code
  created: "2026-01-12"
  updated: "2026-01-12T00:00:00.000Z"
  progress: 0
---

# Claude Code Plugin Marketplace GUI

## Overview

Build a GUI for browsing and installing Claude Code plugins from the official Anthropic marketplace. The design will be similar to the existing MCP Servers panel but tailored for plugin discovery and installation.

## Data Source

The official Claude Code plugin marketplace is hosted at:
- **Repository**: `github.com/anthropics/claude-plugins-official`
- **Registry JSON**: `https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json`

The marketplace contains 50+ plugins organized into categories like Development, Productivity, Database, Testing, Security, Learning, Design, Monitoring, and Deployment.

## Implementation Plan

### Phase 1: Create Plugin Marketplace Panel Component

**File**: `packages/electron/src/renderer/components/GlobalSettings/panels/ClaudeCodePluginsPanel.tsx`

Create a new panel component with the following structure:
- **Three views**: Plugin list (installed), Template gallery (discover), Plugin details
- **Fetch marketplace data** from the GitHub raw URL
- **Display categories**: Development, Productivity, Database, Testing, etc.
- **Plugin cards** showing name, description, author, and install status
- **Search/filter** functionality

Key features:
- Fetch and cache marketplace.json from GitHub
- Display plugins in categorized sections (similar to MCP templates)
- Show installed vs available status
- Install button that invokes Claude Code's `/plugin install` command

### Phase 2: Add IPC Handlers for Plugin Management

**Files**:
- `packages/electron/src/main/ipc/ClaudeCodePluginHandlers.ts` (new)
- `packages/electron/src/preload/preload.ts` (add methods)

IPC channels needed:
- `claude-plugin:fetch-marketplace` - Fetch marketplace.json from GitHub
- `claude-plugin:list-installed` - Get list of installed plugins
- `claude-plugin:install` - Install a plugin by name/URL
- `claude-plugin:uninstall` - Remove an installed plugin
- `claude-plugin:get-details` - Get plugin metadata

These handlers will interface with the Claude Code CLI to manage plugins.

### Phase 3: Integrate into Settings View

**Files**:
- `packages/electron/src/renderer/components/Settings/SettingsSidebar.tsx` - Add "Plugins" category
- `packages/electron/src/renderer/components/Settings/SettingsView.tsx` - Import and render panel

Add a new sidebar category under "Extensions" group:
```typescript
{
  id: 'claude-plugins',
  name: 'Claude Plugins',
  icon: <MaterialSymbol icon="extension" size={16} />,
}
```

### Phase 4: Styling

**File**: `packages/electron/src/renderer/components/GlobalSettings/panels/ClaudeCodePluginsPanel.css`

Reuse patterns from `MCPServersPanel.css`:
- Card-based plugin display
- Category collapsible sections
- Search bar styling
- Install/status badges
- Loading states

## Component Design

### ClaudeCodePluginsPanel Structure

```
ClaudeCodePluginsPanel
├── Header (title + search)
├── View Switcher (Installed | Discover)
│
├── [If Discover View]
│   ├── CategorySection (Development)
│   │   └── PluginCard[]
│   ├── CategorySection (Productivity)
│   │   └── PluginCard[]
│   └── ... more categories
│
├── [If Installed View]
│   └── InstalledPluginList
│       └── PluginCard[]
│
└── [If Plugin Selected]
    └── PluginDetails
        ├── Name, Author, Description
        ├── Homepage link
        ├── Install/Uninstall button
        └── Configuration options (if any)
```

### Plugin Data Model

Based on the marketplace.json schema:
```typescript
interface MarketplacePlugin {
  name: string;
  description: string;
  author: string;
  homepage?: string;
  source: string; // GitHub URL or path
  category: string;
}

interface InstalledPlugin {
  name: string;
  version?: string;
  path: string;
  enabled: boolean;
}
```

## Technical Considerations

1. **Caching**: Cache marketplace.json locally with a TTL (e.g., 1 hour) to avoid repeated GitHub requests

2. **Error Handling**: Handle network failures gracefully, show offline state

3. **CLI Integration**: The install/uninstall operations will invoke Claude Code's CLI commands. Need to handle:
   - Claude Code not installed
   - Permission issues
   - Network failures during install

4. **Progress Feedback**: Show installation progress (some plugins download npm packages)

## Files to Create/Modify

### New Files
- `packages/electron/src/renderer/components/GlobalSettings/panels/ClaudeCodePluginsPanel.tsx`
- `packages/electron/src/renderer/components/GlobalSettings/panels/ClaudeCodePluginsPanel.css`
- `packages/electron/src/main/ipc/ClaudeCodePluginHandlers.ts`

### Modified Files
- `packages/electron/src/renderer/components/Settings/SettingsSidebar.tsx` - Add category
- `packages/electron/src/renderer/components/Settings/SettingsView.tsx` - Import and render panel
- `packages/electron/src/preload/preload.ts` - Add IPC methods
- `packages/electron/src/main/index.ts` - Register IPC handlers

## Success Criteria

1. Users can browse the official Claude Code plugin marketplace from within Nimbalyst
2. Plugins are displayed with clear categories, descriptions, and install status
3. Users can install plugins with a single click
4. Installed plugins are displayed separately with options to uninstall
5. The UI matches the existing MCP Servers panel style

## Sources

- [Claude Code Plugin Marketplace Documentation](https://code.claude.com/docs/en/plugin-marketplaces)
- [Official Plugin Directory](https://github.com/anthropics/claude-plugins-official)
- [DeepWiki Plugin Marketplace Reference](https://deepwiki.com/anthropics/claude-plugins-official/4-plugin-marketplace)
- [Claude Code Plugin Guide](https://www.petegypps.uk/blog/claude-code-official-plugin-marketplace-complete-guide-36-plugins-december-2025)
