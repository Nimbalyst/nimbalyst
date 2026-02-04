---
planStatus:
  planId: plan-auto-update-posthog-tracking
  title: Auto-Update PostHog Tracking
  status: completed
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders: []
  tags:
    - analytics
    - auto-updater
    - posthog
  created: "2026-02-04"
  updated: "2026-02-04T00:00:00.000Z"
  progress: 100
---

# Auto-Update PostHog Tracking

## Problem Statement

The auto-update system currently has no PostHog tracking, making it impossible to measure:
- How many users are seeing update notifications
- Conversion rate from notification to download to install
- How often users dismiss or defer updates
- Error rates during the update process
- Which release channels (stable vs alpha) are being used

## Goals

Add minimal, focused PostHog tracking to the auto-update system to understand:
1. Update funnel: notification shown -> downloaded -> installed
2. User behavior: dismissed, deferred, or completed
3. Error conditions that block updates
4. Release channel distribution

## Proposed Events

### 1. `update_toast_shown`
**Trigger**: When the update available toast is displayed to the user

**Properties**:
- `release_channel`: `stable` | `alpha`
- `new_version`: string

### 2. `update_toast_action`
**Trigger**: When user interacts with the update toast

**Properties**:
- `action`: `download_clicked` | `release_notes_clicked` | `remind_later_clicked`
- `new_version`: string

### 3. `update_download_started`
**Trigger**: When the user initiates an update download

**Properties**:
- `release_channel`: `stable` | `alpha`
- `new_version`: string

### 4. `update_download_completed`
**Trigger**: When an update download finishes successfully

**Properties**:
- `release_channel`: `stable` | `alpha`
- `new_version`: string
- `duration_category`: `fast` (<30s) | `medium` (30s-2min) | `slow` (>2min)

### 5. `update_install_initiated`
**Trigger**: When user clicks "Relaunch" to install the downloaded update

**Properties**:
- `new_version`: string

### 6. `update_error`
**Trigger**: When an error occurs during check, download, or install

**Properties**:
- `stage`: `check` | `download` | `install`
- `error_type`: `network` | `permission` | `disk_space` | `signature` | `unknown`
- `release_channel`: `stable` | `alpha`

## Implementation Details

### File Changes

**`packages/electron/src/main/services/autoUpdater.ts`**:
- Import `AnalyticsService`
- Add tracking calls at appropriate points in the update flow

### Event Placement

| Event | Location in Code |
| --- | --- |
| `update_toast_shown` | In `sendToFrontmostWindow('update-toast:show-available', ...)` |
| `update_toast_action` | New IPC handlers for toast button clicks |
| `update_download_started` | `update-toast:download` handler |
| `update_download_completed` | `update-downloaded` handler |
| `update_install_initiated` | `update-toast:install` handler |
| `update_error` | `error` handler |

### Tracking Pattern

Follow existing patterns from the codebase:

```typescript
import { AnalyticsService } from './analytics/AnalyticsService';

// Inside event handler:
AnalyticsService.getInstance().sendEvent('update_toast_shown', {
  release_channel: getReleaseChannel(),
  new_version: info.version
});
```

### Duration Categorization

For download duration, use a helper function:

```typescript
function getDurationCategory(durationMs: number): string {
  if (durationMs < 30000) return 'fast';
  if (durationMs < 120000) return 'medium';
  return 'slow';
}
```

### Error Type Classification

Classify errors based on error message patterns:

```typescript
function classifyUpdateError(error: Error): string {
  const message = error.message.toLowerCase();
  if (message.includes('network') || message.includes('enotfound') || message.includes('timeout')) {
    return 'network';
  }
  if (message.includes('permission') || message.includes('eacces')) {
    return 'permission';
  }
  if (message.includes('disk') || message.includes('space') || message.includes('enospc')) {
    return 'disk_space';
  }
  if (message.includes('signature') || message.includes('verify')) {
    return 'signature';
  }
  return 'unknown';
}
```

## Privacy Considerations

All events follow existing analytics guidelines:
- No file paths or user-identifiable information
- Version numbers are safe to include (they're public knowledge)
- Error messages are classified, not included verbatim
- Duration is categorized, not exact

## Testing Strategy

1. Manual testing in development mode (verify events are logged)
2. Verify events appear correctly in PostHog
3. Test all toast interaction paths
4. Test error classification with various failure scenarios

## Documentation Updates

After implementation, update `/docs/POSTHOG_EVENTS.md` with new events in an "Auto-Update" section:

| Event Name | File(s) | Trigger | Properties | First Added (Public) | Significant Changes |
| --- | --- | --- | --- | --- | --- |
| `update_toast_shown` | `autoUpdater.ts` | Toast displayed | `release_channel`, `new_version` | (pending release) | |
| `update_toast_action` | `autoUpdater.ts` | User clicks toast button | `action`, `new_version` | (pending release) | |
| `update_download_started` | `autoUpdater.ts` | Download begins | `release_channel`, `new_version` | (pending release) | |
| `update_download_completed` | `autoUpdater.ts` | Download finishes | `release_channel`, `new_version`, `duration_category` | (pending release) | |
| `update_install_initiated` | `autoUpdater.ts` | User clicks relaunch | `new_version` | (pending release) | |
| `update_error` | `autoUpdater.ts` | Error during update | `stage`, `error_type`, `release_channel` | (pending release) | |

## Acceptance Criteria

1. All 6 events are tracked at appropriate points in the update flow
2. Events follow existing naming conventions and property guidelines
3. Privacy requirements are met (no PII, categorical values where appropriate)
4. `POSTHOG_EVENTS.md` is updated with new events
5. Events can be observed in PostHog dashboard
