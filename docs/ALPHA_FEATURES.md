# Alpha Features System

This document describes how to work with the alpha features system in Nimbalyst.

## Overview

Alpha features are individually toggleable experimental features that are available when the alpha release channel is enabled. This system ensures that:

1. All alpha features are **explicitly registered** in a central location
2. Features can be toggled **independently** without code changes
3. Type safety prevents typos when checking feature availability
4. New features are automatically added to the settings UI

## Adding a New Alpha Feature

To add a new alpha feature to the system:

### 1. Register the Feature

Add your feature to `/packages/electron/src/shared/alphaFeatures.ts`:

```typescript
export const ALPHA_FEATURES: readonly AlphaFeatureDefinition[] = [
  // ... existing features ...
  {
    tag: 'my-new-feature',           // Unique identifier (kebab-case)
    name: 'My New Feature',          // Display name in settings
    description: 'Description of what this feature does.',
    icon: 'star',                    // Optional Material Symbol icon name
  },
] as const;
```

**Important:** The `tag` is the unique identifier that will be used throughout the codebase. Use kebab-case (e.g., `'my-feature'`, not `'myFeature'` or `'MyFeature'`).

### 2. Use the Feature in Your Code

#### Option A: Using the `useAlphaFeature` Hook (Recommended for Components)

```tsx
import { useAlphaFeature } from '../../hooks/useAlphaFeature';

function MyComponent() {
  const isEnabled = useAlphaFeature('my-new-feature');

  if (!isEnabled) {
    return null; // or show fallback UI
  }

  return <MyExperimentalFeature />;
}
```

#### Option B: Using the Atom Directly

```tsx
import { alphaFeatureEnabledAtom } from '../../store/atoms/appSettings';
import { useAtomValue } from 'jotai';

function MyComponent() {
  const isEnabledAtom = alphaFeatureEnabledAtom('my-new-feature');
  const isEnabled = useAtomValue(isEnabledAtom);

  if (!isEnabled) {
    return null;
  }

  return <MyExperimentalFeature />;
}
```

#### Option C: Async Check (Outside React Components)

```typescript
import { window } from 'electron';
import type { AlphaFeatureTag } from '@nimbalyst/shared/alphaFeatures';

async function checkFeature(tag: AlphaFeatureTag): Promise<boolean> {
  const features = await window.electronAPI.invoke('alpha-features:get');
  return features[tag] ?? false;
}

// Usage
const isEnabled = await checkFeature('my-new-feature');
```

## Feature Registry

The feature registry is located at `/packages/electron/src/shared/alphaFeatures.ts` and contains all available alpha features.

### Current Features

| Tag | Name | Description |
|-----|------|-------------|
| `sync` | Account & Sync | Enable account sign-in and session synchronization across devices. |
| `voice-mode` | Voice Mode | Enable voice interaction mode for hands-free coding with AI. |
| `claude-plugins` | Claude Plugins | Enable Claude Agent plugins and extensions management. |

## How It Works

### Storage

Alpha feature flags are stored in the electron-store as:

```typescript
{
  alphaFeatures: {
    'sync': true,
    'voice-mode': false,
    'claude-plugins': true,
    'my-new-feature': false,
  }
}
```

### Type Safety

The `AlphaFeatureTag` type is automatically derived from the registry, so TypeScript will prevent typos:

```typescript
// ✅ Correct
const enabled = useAlphaFeature('sync');

// ❌ Type error - 'syncx' is not a valid feature tag
const enabled = useAlphaFeature('syncx');

// ❌ Type error - wrong case
const enabled = useAlphaFeature('Sync');
```

### Dynamic Registration

When new features are added to the registry, they automatically appear in the settings UI under Advanced Settings → Release Channel → Alpha (if selected). No manual UI updates needed.

## Best Practices

1. **Use kebab-case for tags**: `'my-feature'` not `'myFeature'`
2. **Provide clear descriptions**: Users should understand what the feature does
3. **Keep tags short and descriptive**: `'voice-mode'` is better than `'enable-voice-interaction-mode'`
4. **Test with feature disabled**: Ensure your code handles the case where the feature is disabled
5. **Use the hook**: Prefer `useAlphaFeature` over direct atom access for better readability

## Migration Guide

If you have existing code that checks `releaseChannel === 'alpha'`, migrate it to use the feature flag system:

### Before

```tsx
const releaseChannel = useAtomValue(releaseChannelAtom);

if (releaseChannel === 'alpha') {
  return <SyncPanel />;
}
```

### After

```tsx
const syncEnabled = useAlphaFeature('sync');

if (syncEnabled) {
  return <SyncPanel />;
}
```

## Validation

The system includes validation to catch unregistered feature tags during development:

```typescript
import { validateAlphaFeatureTags } from '@nimbalyst/shared/alphaFeatures';

const result = validateAlphaFeatureTags(['sync', 'voice-mode', 'unknown-tag']);
if (!result.valid) {
  console.warn('Unknown feature tags:', result.unknown);
  // Output: Unknown feature tags: ['unknown-tag']
}
```
