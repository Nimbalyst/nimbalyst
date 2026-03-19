---
planStatus:
  planId: plan-contextual-tips-system
  title: "Contextual Tips System"
  status: in-review
  startDate: "2026-03-19"
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders: []
  tags: [ux, help-system, electron]
  created: "2026-03-19"
  updated: "2026-03-19T19:06:47.000Z"
  progress: 90
---

# Contextual Tips System

A third pillar of the help content system alongside **tooltips** (hover-based, via HelpContent registry) and **walkthroughs** (multi-step guided tours anchored to UI elements). Tips are small, dismissible compact cards that appear in the bottom-left corner based on user state and behavior -- proactive suggestions rather than feature discovery.

## Motivation

Some features are hard to discover through walkthroughs because they depend on specific user states (e.g., having a mobile device paired) rather than being on a particular screen. Tips bridge this gap by surfacing contextual advice when conditions are met.

**First tip**: Users who have paired a mobile device but haven't enabled keep-awake should be nudged to turn it on, since their computer going to sleep breaks remote prompting.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Persistence | Share walkthrough infrastructure | Reuse `walkthroughs:*` IPC channels and `store.ts` functions. Tips are just another "kind" of help content. Less new code. |
| Display count | One at a time | Less visual noise, simpler state management. |
| Visual style | Compact card | Small rounded card with icon, title, body, and action button. macOS notification-like. |
| Cooldown | Session-based | At most one tip per app launch. Non-intrusive. |
| Position | Bottom-left, fixed | Out of the way of the main content area and AI panel. |

## Architecture

### Tip Definition

Each tip is a declarative object similar to walkthrough definitions:

```typescript
interface TipDefinition {
  /** Unique identifier (prefixed with 'tip-' to avoid collision with walkthrough IDs) */
  id: string;
  /** Human-readable name for analytics */
  name: string;
  /** Version number - bump to re-show to users who dismissed an older version */
  version?: number;
  /** Trigger conditions */
  trigger: TipTrigger;
  /** Tip content */
  content: TipContent;
}

interface TipTrigger {
  /** Screen/mode that must be active, or '*' for any */
  screen?: ContentMode | '*';
  /** Custom predicate - return true when tip should show */
  condition: () => boolean;
  /** Delay (ms) after conditions are met before showing. Default: 2000 */
  delay?: number;
  /** Priority for deconfliction. Higher = higher priority. Default: 0 */
  priority?: number;
}

interface TipContent {
  /** Icon name or emoji for the tip card header */
  icon?: string;
  /** Short title */
  title: string;
  /** Body text (supports basic markdown: **bold**, bullet lists) */
  body: string;
  /** Primary action button */
  action?: TipAction;
  /** Secondary link/navigation action */
  secondaryAction?: TipAction;
}

interface TipAction {
  /** Button label */
  label: string;
  /** What happens on click */
  onClick: () => void;
  /** Style variant */
  variant?: 'primary' | 'secondary' | 'link';
}
```

### File Structure

```
packages/electron/src/renderer/tips/
  types.ts              # TipDefinition, TipTrigger, TipContent, TipAction
  atoms.ts              # activeTipIdAtom, tipShownThisSessionAtom
  TipService.ts         # shouldShowTip(), IPC wrappers (reuses walkthroughs:* channels)
  TipCard.tsx           # The compact card component
  TipProvider.tsx        # Context provider, trigger evaluation, session cooldown
  definitions/
    index.ts            # Export array of all tip definitions
    mobile-keep-awake.ts # First tip definition
```

### Persistence (Shared with Walkthroughs)

Tips share the walkthrough persistence layer by using the same `walkthroughs` store key. Since tip IDs are prefixed with `tip-`, there's no collision risk.

**Reused store functions:**
- `getWalkthroughState()` -- check `completed` and `dismissed` arrays for tip IDs
- `markWalkthroughDismissed(tipId, version)` -- when user dismisses a tip
- `markWalkthroughCompleted(tipId, version)` -- when user clicks the primary action
- `recordWalkthroughShown(tipId, version)` -- for analytics

**No new IPC channels needed.** All persistence goes through existing `walkthroughs:*` handlers.

### Session Cooldown

A simple in-memory flag (`tipShownThisSessionAtom`) prevents more than one tip per app launch. This atom is NOT persisted -- it resets on every app restart, which is the desired behavior.

### Trigger Evaluation

`TipProvider` evaluates tips on a timer (every 5 seconds after a 15-second startup delay) rather than on mode changes like walkthroughs. This is because tip conditions depend on runtime state (sync connected, devices paired) that can change at any time.

**Evaluation flow:**
1. Skip if `tipShownThisSessionAtom` is true
2. Skip if walkthroughs are globally disabled (`state.enabled === false`)
3. Skip if a walkthrough is currently active
4. Skip if any dialog/overlay is visible
5. Filter tips by: not dismissed, not completed (unless version bumped), screen match, condition()
6. Sort by priority, pick highest
7. Wait for `delay` ms, re-check condition, then show

### TipCard Component

A portal-rendered card in the bottom-left corner:

![Contextual tip card mockup](contextual-tip-card.png){mockup:nimbalyst-local/mockups/contextual-tip-card.mockup.html}

**Key interactions:**
- **X button**: Dismisses tip (persisted, won't show again for this version)
- **Primary action button**: Executes action + marks as completed
- **Secondary link**: Executes action without dismissing (optional)
- **Click outside**: Does nothing (card stays -- it's non-modal)
- **Escape**: Dismisses tip

### Integration with App.tsx

`TipProvider` wraps alongside `WalkthroughProvider` in `App.tsx`. It reads from the same `walkthroughStateAtom` for persistence state.

```tsx
<WalkthroughProvider currentMode={activeMode}>
  <TipProvider currentMode={activeMode}>
    {children}
  </TipProvider>
</WalkthroughProvider>
```

## First Tip: Mobile Keep-Awake

### Condition
```typescript
condition: () => {
  // User has sync enabled AND preventSleepMode is 'off'
  // The sync being enabled implies they've paired a device
  const syncConfig = store.get(syncConfigAtom);
  return syncConfig.enabled && (syncConfig.preventSleepMode === 'off' || !syncConfig.preventSleepMode);
}
```

### Content
- **Icon**: A sleep/power icon (SVG)
- **Title**: "Keep your Mac awake for mobile prompts"
- **Body**: "Your computer going to sleep will disconnect mobile sync. Enable keep-awake to prevent this while sync is active."
- **Primary action**: "Enable Keep-Awake" -- sets `preventSleepMode` to `'always'` via existing `sync:set-prevent-sleep` IPC
- **Secondary**: "Open Sync Settings" -- navigates to Settings > Sync panel

### Definition File

```typescript
// definitions/mobile-keep-awake.ts
import { store } from '../../store';
import { syncConfigAtom } from '../../store/atoms/appSettings';

export const mobileKeepAwakeTip: TipDefinition = {
  id: 'tip-mobile-keep-awake',
  name: 'Mobile Keep-Awake Suggestion',
  version: 1,
  trigger: {
    screen: '*',
    condition: () => {
      const syncConfig = store.get(syncConfigAtom);
      return syncConfig.enabled &&
        (syncConfig.preventSleepMode === 'off' || !syncConfig.preventSleepMode);
    },
    delay: 3000,
    priority: 10,
  },
  content: {
    icon: 'power',
    title: 'Keep your Mac awake for mobile prompts',
    body: 'Your computer going to sleep will disconnect mobile sync. Enable keep-awake to prevent this while sync is active.',
    action: {
      label: 'Enable Keep-Awake',
      onClick: () => {
        window.electronAPI.invoke('sync:set-prevent-sleep', 'always');
      },
      variant: 'primary',
    },
    secondaryAction: {
      label: 'Sync Settings',
      onClick: () => {
        // Navigate to settings > sync panel
        window.electronAPI.send('open-settings', 'sync');
      },
      variant: 'link',
    },
  },
};
```

## Implementation Steps

### Phase 1: Core Infrastructure
- [x] Create `tips/types.ts` with type definitions
- [x] Create `tips/atoms.ts` with `activeTipIdAtom` and `tipShownThisSessionAtom`
- [x] Create `tips/TipService.ts` reusing walkthrough IPC calls
- [x] Create `tips/TipCard.tsx` component
- [x] Create `tips/TipProvider.tsx` with trigger evaluation loop
- [x] Create `tips/definitions/index.ts` with empty array

### Phase 2: First Tip
- [x] Create `tips/definitions/mobile-keep-awake.tsx`
- [x] Verify sync config atom access pattern works from tip condition
- [x] Verify `sync:set-prevent-sleep` IPC works from tip action

### Phase 3: Integration
- [x] Add `TipProvider` to `App.tsx` alongside `WalkthroughProvider`
- [x] Add PostHog events: `tip_shown`, `tip_dismissed`, `tip_action_clicked`
- [ ] Test with sync enabled + keep-awake off

### Phase 4: Polish
- [x] Animation: slide-in from left + fade
- [x] Respect reduced motion preference (`motion-safe:` prefix on animation)
- [x] Disable in Playwright tests (same pattern as walkthroughs)
- [x] Add dev helpers (`window.__tipHelpers`) for testing

## Resolved Questions

1. **Tips share the walkthrough enabled toggle.** If user turns off walkthroughs, tips also stop. One master switch for all proactive help.
2. **X = dismiss forever** (for this version). Simple and clear. The primary action button also marks as completed (permanent).
3. **Enabled from day one** in production. Session cooldown keeps them non-intrusive enough to ship immediately.

## Future Considerations

- Tip categories (performance, feature, setup) as the library grows
- Analytics dashboard for tip engagement rates
- More tips: first-time extension install, large file performance, keyboard shortcut suggestions
