---
planStatus:
  planId: plan-alpha-feature-ui-tags
  title: Alpha Feature UI Tags
  status: in-review
  planType: feature
  priority: medium
  owner: greg
  stakeholders: []
  tags:
    - ui
    - design
    - alpha
    - settings
  created: "2026-04-25"
  startDate: "2026-04-25"
  updated: "2026-04-25T18:35:00.000Z"
  progress: 100
---

# Alpha Feature UI Tags

## Implementation Progress

- [x] Create `AlphaBadge` component (`components/common/AlphaBadge.tsx`)
- [x] Settings sidebar: add `alphaTag` field on `CategoryItem`, render badge for gated rows (voice, opencode, copilot, team, trackers)
- [x] Settings panel headers: VoiceModePanel
- [x] Settings panel headers: TeamPanel (both header instances)
- [x] Settings panel headers: TrackerConfigPanel
- [x] Settings panel headers: OpenCodePanel
- [x] Settings panel headers: CopilotCLIPanel
- [x] NavigationGutter: corner badge on collab mode button
- [x] UserMenuPopover: inline badge on Team Settings entry
- [x] AgentMode: inline badge on Blitz control (in SessionHistory new-session dropdown)
- [x] AgentMode / session creation: inline badge on opencode + copilot-cli provider rows (ModelSelector)
- [x] SessionHistory: badges on Super Loops, Meta Agent, Card Mode toggle
- [x] TrackerMainView: inline badge on kanban view toggle (TrackerSidebar)
- [x] Extension gutter buttons: corner dot on extensions whose manifest requires the alpha channel (covers `com.nimbalyst.git`)
- [x] Run typecheck, verify clean build

## Goal

Surface a small, subtle "alpha" tag in the UI next to features whose visibility is gated by `useAlphaFeature(...)`. Visible places include:

- **Settings sidebar rows** (e.g., Voice Mode, OpenCode, GitHub Copilot, Team, Trackers).
- **Settings panel headers** for those same panels.
- (Open question) **Non-settings surfaces** that gate alpha behavior — Navigation Gutter "Collab" mode button, Super Loops / Blitz controls in Agent Mode, etc.

The tag should be quiet and informational, not promotional. Users in the alpha channel already opted in; the tag is a reminder that the feature is subject to change.

## Existing Infrastructure (no new flag plumbing needed)

Already in the codebase — this work is purely presentational:

- **Registry**: `packages/electron/src/shared/alphaFeatures.ts` exports `ALPHA_FEATURES` with `tag`, `name`, `description`, `icon`. Current tags: `voice-mode`, `card-mode`, `super-loops`, `blitz`, `collaboration`, `tracker-kanban`, `opencode`, `meta-agent`, `copilot-cli`.
- **Hooks**: `packages/electron/src/renderer/hooks/useAlphaFeature.ts` — `useAlphaFeature(tag)` and `useAlphaFeatures(tags[])`.
- **Settings sidebar**: `packages/electron/src/renderer/components/Settings/SettingsSidebar.tsx` already gates `voice-mode`, `opencode`, `copilot-cli`, and the entire `Collaboration` group (`team`, `tracker-config`) behind alpha flags via `hidden: !alphaFeatures[tag]`.

## Design

### 1. New component: `AlphaBadge`

Location: `packages/electron/src/renderer/components/common/AlphaBadge.tsx`

A single small subtle pill rendering the lowercase word `alpha`. Rendered in two sizes: `xs` (sidebar rows, gutter, inline controls) and `sm` (panel headers).

```tsx
interface AlphaBadgeProps {
  size?: 'xs' | 'sm';
  className?: string;
  /** Optional override for the tooltip; defaults to a generic alpha message. */
  tooltip?: string;
}
```

Visual style (subtle, theme-aware, no animation, no saturated color, lowercase):

```tsx
// xs: sidebar rows, dropdown items, inline toggles
className="inline-flex items-center px-1.5 py-px rounded-sm text-[10px] font-medium lowercase
  bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-faint)] border border-[var(--nim-border)]"

// sm: panel headers
className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium lowercase
  bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)] border border-[var(--nim-border)] align-middle"
```

Tooltip on hover: short, generic — "Alpha feature — may change or be removed." Use the existing `title` attribute as a baseline; if a richer hover is wanted later, swap to the `@floating-ui/react` pattern (per `.claude/rules/floating-ui.md`). Add `data-testid="alpha-badge"` for E2E.

### 2. Settings sidebar — add alpha badge to each gated row

`SettingsSidebar.tsx` already has a `badge?: string | number` slot on `CategoryItem` (line 42, rendered at lines 291–295) but it's used for counts and uses bg-tertiary styling. To avoid coupling, add a new explicit field:

```ts
interface CategoryItem {
  id: SettingsCategory;
  name: string;
  icon: React.ReactNode;
  badge?: string | number;      // existing — counts
  alphaTag?: AlphaFeatureTag;   // NEW — renders <AlphaBadge size="xs" /> when present
  statusDot?: 'success' | 'warning' | 'error';
  hidden?: boolean;
}
```

Set `alphaTag` on the gated rows we already define:

| Row | Tag |
| --- | --- |
| Voice Mode | `voice-mode` |
| OpenCode | `opencode` |
| GitHub Copilot | `copilot-cli` |
| Team | `collaboration` |
| Trackers | `collaboration` |

Render the badge between the row name and the status dot:

```tsx
<span className="settings-sidebar-item-name flex-1 truncate">{item.name}</span>
{item.alphaTag && <AlphaBadge size="xs" />}
{item.badge && <span className="...existing badge styles...">{item.badge}</span>}
{item.statusDot && <span className="...existing dot styles..." />}
```

### 3. Settings panel headers — add alpha badge inline with the title

All settings panels follow the same `provider-panel-header` / `<h3 class="provider-panel-title">` pattern. Wrap the title text in a flex container so the badge sits next to it:

```tsx
<h3 className="provider-panel-title text-xl font-semibold leading-tight mb-2 text-[var(--nim-text)] flex items-center gap-2">
  Voice Mode
  <AlphaBadge size="sm" />
</h3>
```

Panels to update:

- `Settings/VoiceModePanel.tsx`
- `Settings/panels/TeamPanel.tsx` (two header instances at lines 1089, 1120)
- `Settings/panels/TrackerConfigPanel.tsx`
- `GlobalSettings/panels/OpenCodePanel.tsx`
- `GlobalSettings/panels/CopilotCLIPanel.tsx`

### 4. Non-settings surfaces (in scope this pass)

Tag every UI surface that is currently gated by `useAlphaFeature(...)` or `alphaFeatureEnabledAtom(...)`:

| Surface | Tag | File | Treatment |
| --- | --- | --- | --- |
| NavigationGutter "Collab" mode button | `collaboration` | `components/NavigationGutter/NavigationGutter.tsx` | Square icon button — render the `xs` badge as a small corner overlay (absolute-positioned, top-right) instead of inline, since the button has no text. |
| User menu "Team Settings" entry | `collaboration` | `components/NavigationGutter/UserMenuPopover.tsx` | Inline `xs` badge after the entry label. |
| Agent Mode "Blitz" trigger | `blitz` | `components/AgentMode/AgentMode.tsx` (around line 121) | Inline `xs` badge next to the control label. |
| Session History "Super Loop" group / new-loop trigger | `super-loops` | `components/AgenticCoding/SessionHistory.tsx` (around line 341) | Inline `xs` badge on the group header / trigger label. |
| Session History "Meta Agent" trigger | `meta-agent` | `components/AgenticCoding/SessionHistory.tsx` (around line 343) | Inline `xs` badge on the trigger label. |
| Session list card view toggle | `card-mode` | `components/AgenticCoding/SessionHistory.tsx` (around line 428) | Inline `xs` badge next to the toggle. |
| Tracker kanban view toggle | `tracker-kanban` | `components/TrackerMode/TrackerMainView.tsx` | Inline `xs` badge on the kanban toggle button label/tooltip area. |
| Agent provider selectors (OpenCode, GitHub Copilot rows) | `opencode`, `copilot-cli` | wherever the agent provider dropdown is rendered | Trailing `xs` badge on those two items only. (Locate during implementation — likely in `AgentMode/AgentMode.tsx` or a session-creation dropdown.) |
| Extension panel buttons (gutter sidebar / fullscreen / bottom) | manifest's `requiredReleaseChannel === 'alpha'` | `components/NavigationGutter/NavigationGutter.tsx` via `useExtensionGutterButtons` / `useExtensionBottomPanelButtons` | `dot` corner overlay on the icon button. Driven by the extension manifest, not a feature-flag tag, so any future alpha-only extension picks it up automatically. (e.g. `com.nimbalyst.git`) |

Excluded:

- **Settings > Advanced > Release Channel** dropdown — already labels itself "Alpha (Internal Testing)" with surrounding copy. No badge needed.
- **Beta Features panel** — separate concept, out of scope.

### 5. Distinct from Beta Features

`BetaFeaturesPanel` (`packages/electron/src/renderer/components/GlobalSettings/panels/BetaFeaturesPanel.tsx`) covers a separate concept: user-discoverable beta toggles, always visible. This plan does not change beta UI and does not introduce a beta badge. If a similar pattern is wanted there later, the same `AlphaBadge` component generalizes to a `<FeatureBadge variant="alpha" | "beta" />` cheaply.

## Files Touched

New:

- `packages/electron/src/renderer/components/common/AlphaBadge.tsx`

Modified — Settings:

- `packages/electron/src/renderer/components/Settings/SettingsSidebar.tsx` — add `alphaTag` field, render badge.
- `packages/electron/src/renderer/components/Settings/VoiceModePanel.tsx`
- `packages/electron/src/renderer/components/Settings/panels/TeamPanel.tsx`
- `packages/electron/src/renderer/components/Settings/panels/TrackerConfigPanel.tsx`
- `packages/electron/src/renderer/components/GlobalSettings/panels/OpenCodePanel.tsx`
- `packages/electron/src/renderer/components/GlobalSettings/panels/CopilotCLIPanel.tsx`

Modified — non-settings surfaces:

- `packages/electron/src/renderer/components/NavigationGutter/NavigationGutter.tsx` — corner badge on collab mode button + on extension panel buttons whose manifest requires the alpha channel (covers the git extension).
- `packages/electron/src/renderer/components/NavigationGutter/UserMenuPopover.tsx` — inline badge on Team Settings entry.
- `packages/electron/src/renderer/components/UnifiedAI/ModelSelector.tsx` — inline badge on opencode and copilot-cli provider headers in the model dropdown.
- `packages/electron/src/renderer/components/AgenticCoding/SessionHistory.tsx` — inline badges on New Blitz / New Super Loop / New Meta Agent dropdown items, corner dot on Card Mode toggle.
- `packages/electron/src/renderer/components/TrackerMode/TrackerSidebar.tsx` — corner dot on kanban view toggle.
- `packages/electron/src/renderer/extensions/panels/PanelRegistry.ts` — thread `requiredReleaseChannel` from extension manifest into `RegisteredPanel`.
- `packages/electron/src/renderer/extensions/panels/usePanels.ts` — expose `isAlpha` on `useExtensionGutterButtons` / `useExtensionBottomPanelButtons` results.

## Test Plan

- E2E (`packages/electron/e2e/`): verify badge appears for `voice-mode` row only when alpha enabled (already covered by hidden gate; add a single assertion that the `data-testid="alpha-badge"` is present in the row when the row is visible).
- Manual (dev): toggle release channel between stable and alpha, confirm sidebar rows and panel headers show/hide both the row and badge consistently.
- Theme check: confirm badge renders cleanly on light, dark, and crystal-dark themes (subtle contrast, not hot).

## Out of Scope

- Adding new alpha features to the registry.
- Beta feature badges.
- A generalized `FeatureBadge` with variants — keep `AlphaBadge` single-purpose for now.
- Marketplace / public release notes filtering.
