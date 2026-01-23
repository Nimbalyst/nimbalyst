# Unified Onboarding Implementation

This document describes the implementation of the unified 3-step onboarding flow that combines the previous OnboardingDialog and FeatureWalkthrough components.

## Overview

The new `UnifiedOnboarding` component replaces two separate onboarding flows with a single, cohesive 3-step experience:

1. **Step 1: User Background** - Collect role, referral source, and email
2. **Step 2: Mode Selection** - Choose between Developer Mode and Standard Mode
3. **Step 3: Feature Walkthrough** - Interactive slides showcasing key features

## Changes Made

### New Components

**Created:**
- `packages/electron/src/renderer/components/UnifiedOnboarding/UnifiedOnboarding.tsx`
- `packages/electron/src/renderer/components/UnifiedOnboarding/UnifiedOnboarding.css`

### Store Schema Updates

**Modified: `packages/electron/src/main/utils/store.ts`**

Added to `AppStoreSchema`:
```typescript
referralSource?: string; // Where user heard about Nimbalyst
```

Added to `WorkspaceState`:
```typescript
developerMode?: boolean; // Developer mode preference (enables worktrees and terminal)
```

### App Integration

**Modified: `packages/electron/src/renderer/App.tsx`**

- Replaced `OnboardingDialog` and `FeatureWalkthrough` imports with `UnifiedOnboarding`
- Consolidated state management:
  - `isOnboardingOpen` + `isFeatureWalkthroughOpen` → `isUnifiedOnboardingOpen`
- Merged handlers into:
  - `handleUnifiedOnboardingComplete()` - Stores data in both app and workspace settings
  - `handleUnifiedOnboardingSkip()` - Marks onboarding as completed
- Updated IPC event listeners:
  - `show-onboarding-dialog` + `show-feature-walkthrough` → `show-unified-onboarding`

### Menu Updates

**Modified: `packages/electron/src/main/menu/ApplicationMenu.ts`**

- Combined "Show Onboarding" and "Show Collection Form" menu items into single "Show Unified Onboarding" item
- Updated to send `show-unified-onboarding` IPC event

### Analytics Updates

**Modified: `docs/POSTHOG_EVENTS.md`**

New events:
- `unified_onboarding_completed` - Captures all onboarding data including new fields:
  - `user_role`, `custom_role_provided`, `custom_role_text`
  - `referral_source` (NEW)
  - `email_provided`
  - `developer_mode` (NEW)
- `unified_onboarding_skipped` - Replaces `onboarding_skipped`

Modified events:
- `feature_walkthrough_completed` - Now sent from step 3 of unified flow

Deprecated events:
- `onboarding_completed` (replaced by `unified_onboarding_completed`)
- `onboarding_skipped` (replaced by `unified_onboarding_skipped`)
- `onboarding_deferred` (removed - no longer supported)

### Removed Components

**Deleted:**
- `packages/electron/src/renderer/components/OnboardingDialog/` (entire directory)
- `packages/electron/src/renderer/components/FeatureWalkthrough/` (entire directory)

## Component Details

### Step 1: User Background

Collects:
- **Role**: Engineer, Tech Professional, or Other (with custom input)
- **Referral Source**: Dropdown with options (Search Engine, Social Media, Friend/Colleague, etc.)
- **Email**: Optional, with validation

### Step 2: Mode Selection

Two modes:
- **Developer Mode**: Full development environment with git worktrees, terminal access, and advanced AI coding features
- **Standard Mode**: Simplified interface focused on writing, editing, and AI assistance without developer tools

Stored in workspace settings as `developerMode: boolean`

### Step 3: Feature Walkthrough

Reuses the existing 3 slides:
1. View and Approve AI Changes in WYSIWYG Markdown Editor
2. AI-Powered HTML Mockups
3. Agent-First Environment Linked to Your Files

Tracks time spent on each slide and sends `feature_walkthrough_completed` event with timing data.

## Data Flow

### On Completion

1. **App Settings** (global):
   - `userRole` - The selected or custom role
   - `userEmail` - Optional email
   - `referralSource` - Where user heard about Nimbalyst
   - `onboardingCompleted: true`

2. **Workspace Settings** (per-project):
   - `developerMode` - Boolean preference

3. **PostHog**:
   - People property: `email` (if provided)
   - Event: `unified_onboarding_completed` with all properties
   - Event: `feature_walkthrough_completed` with timing data (from step 3)

### On Skip

1. **App Settings**:
   - `onboardingCompleted: true` (prevents re-showing)

2. **PostHog**:
   - Event: `unified_onboarding_skipped`
   - Event: `feature_walkthrough_completed` with `skipped: true` (if skipped during step 3)

## Developer Testing

To force the unified onboarding to display for testing:

1. Open `packages/electron/src/renderer/App.tsx`
2. Set `FORCE_UNIFIED_ONBOARDING = true` (line ~363)
3. Restart the dev server

Or use the Developer menu:
- Developer → Show Dialogs → Show Unified Onboarding

## Migration Notes

- Existing users who completed the old onboarding won't see the unified flow
- The `onboardingCompleted` flag is reused to prevent re-showing
- No data migration needed - old fields remain in store but are unused
- New analytics events coexist with deprecated ones for backward compatibility

## Future Enhancements

Possible improvements:
- Add more referral source options based on user feedback
- Add A/B testing for different mode descriptions
- Add tooltips or help text for mode selection
- Collect more detailed user background information
- Add skip/back functionality between steps
