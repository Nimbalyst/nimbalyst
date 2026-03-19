---
planStatus:
  planId: plan-feature-usage-tracking
  title: Feature Usage Tracking System
  status: draft
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders: []
  tags: [electron, analytics, ux]
  created: "2026-03-19"
  updated: "2026-03-19T00:00:00.000Z"
  progress: 0
---

# Feature Usage Tracking System

## Problem

We want to drive contextual UX (tips, walkthroughs, onboarding nudges) based on how much a user has used specific features. For example: "show a tip after you've created at least 5 sessions" or "suggest keyboard shortcuts after 10 manual toolbar clicks."

Currently we have fragmented tracking:
- `FeatureTrackingService` -- tracks first-use only (boolean + timestamp), 8 hardcoded features
- `completedSessionCount` / `completedSessionsWithTools` -- ad-hoc counters in the app store
- `launchCount` -- another ad-hoc counter in the app store
- `editorFirstOpens` -- yet another first-use tracker in the app store

None of these support the query "how many times has the user done X?" with first/most-recent timestamps.

## Proposal

Extend the existing `FeatureTrackingService` (or replace it with a new service) that stores per-feature usage records:

```typescript
interface FeatureUsageRecord {
  count: number;
  firstUsed: string;   // ISO timestamp
  lastUsed: string;    // ISO timestamp
}
```

### Storage

A new `electron-store` instance (file: `feature-usage.json`) with schema:

```typescript
interface FeatureUsageStore {
  installDate: string;
  features: Record<string, FeatureUsageRecord>;
}
```

Using a string key (not a union type) so features can be added freely without changing the type definition. The feature names would be documented constants.

### API

```typescript
class FeatureUsageService {
  // Record a usage event -- increments count, updates lastUsed, sets firstUsed if needed
  recordUsage(feature: string): FeatureUsageRecord;

  // Query
  getUsage(feature: string): FeatureUsageRecord | undefined;
  getCount(feature: string): number;
  hasBeenUsed(feature: string): boolean;
  hasReachedCount(feature: string, threshold: number): boolean;

  // Bulk
  getAllUsage(): Record<string, FeatureUsageRecord>;
}
```

### IPC Bridge

Expose to renderer via IPC so that UI components can both record usage and query counts:

```
feature-usage:record    (feature: string) => FeatureUsageRecord
feature-usage:get       (feature: string) => FeatureUsageRecord | undefined
feature-usage:get-count (feature: string) => number
feature-usage:get-all   () => Record<string, FeatureUsageRecord>
```

### Renderer Hook

```typescript
function useFeatureUsage(feature: string) {
  // Returns { count, firstUsed, lastUsed, record }
  // Queries on mount, provides recordUsage() callback
}
```

### Migration

- Absorb `FeatureTrackingService` data: migrate existing first-use timestamps as records with count=1
- Absorb `completedSessionCount`, `completedSessionsWithTools`, `launchCount` as feature records
- Keep backward compat: `FeatureTrackingService` can become a thin wrapper or be deprecated

### Feature Name Constants

Document a set of well-known feature keys as constants (not a union type):

```typescript
export const FEATURES = {
  SESSION_CREATED: 'session_created',
  SESSION_COMPLETED_WITH_TOOLS: 'session_completed_with_tools',
  APP_LAUNCH: 'app_launch',
  AI_CHAT: 'ai_chat',
  EXCALIDRAW_OPEN: 'excalidraw_open',
  TRACKER_USED: 'tracker_used',
  THEME_CHANGED: 'theme_changed',
  KEYBOARD_SHORTCUT: 'keyboard_shortcut',
  // ... extensible
} as const;
```

## Usage Examples

```typescript
// In session completion handler
FeatureUsageService.getInstance().recordUsage(FEATURES.SESSION_CREATED);

// In a component deciding whether to show a tip
const { count } = useFeatureUsage(FEATURES.SESSION_CREATED);
if (count >= 5 && count < 10) {
  showTip('Try keyboard shortcuts for faster workflow');
}

// In walkthrough trigger logic
const usage = FeatureUsageService.getInstance().getUsage(FEATURES.AI_CHAT);
if (!usage) {
  // User has never used AI chat -- show walkthrough
}
```

## Implementation Steps

1. Create `FeatureUsageService` with electron-store backend
2. Add IPC handlers in a new `FeatureUsageHandlers.ts`
3. Add preload API methods
4. Create `useFeatureUsage` renderer hook
5. Migrate existing counters and `FeatureTrackingService` data
6. Wire up initial recording points (session creation, app launch, etc.)

## Decisions

1. **Separate store** -- New `feature-usage.json` electron-store, own service. Clean isolation from the app store.

2. **No PostHog integration** -- This system is purely for local UX decisions (tips, walkthroughs, onboarding). PostHog analytics stays independent.

3. **Specific action granularity** -- Track specific actions (`session_created`, `session_completed`, `message_sent`) rather than broad categories. More useful for triggering contextual tips.

4. **Leave existing trackers alone** -- `FeatureTrackingService` and the ad-hoc counters in the app store stay as-is. New system lives alongside them. No migration needed.
