/**
 * useAlphaFeature Hook
 *
 * Convenience hook for checking if an alpha feature is enabled.
 * This is the recommended way to check feature availability in components.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const isSyncEnabled = useAlphaFeature('sync');
 *
 *   if (!isSyncEnabled) {
 *     return <div>Feature not available</div>;
 *   }
 *
 *   return <SyncPanel />;
 * }
 * ```
 */

import { useAtomValue } from 'jotai';
import { alphaFeatureEnabledAtom } from '../store/atoms/appSettings';
import type { AlphaFeatureTag } from '../../../shared/alphaFeatures';

/**
 * Check if an alpha feature is enabled.
 *
 * @param tag - The feature tag to check (must be registered in alphaFeatures.ts)
 * @returns true if the feature is enabled, false otherwise
 *
 * @throws TypeError in development if the tag is not registered
 */
export function useAlphaFeature(tag: AlphaFeatureTag): boolean {
  const enabledAtom = alphaFeatureEnabledAtom(tag);
  return useAtomValue(enabledAtom);
}

/**
 * Check if multiple alpha features are enabled.
 *
 * @example
 * ```tsx
 * const features = useAlphaFeatures(['sync', 'voice-mode']);
 * if (features.sync) {
 *   // sync is enabled
 * }
 * if (features['voice-mode']) {
 *   // voice-mode is enabled
 * }
 * ```
 */
export function useAlphaFeatures(tags: AlphaFeatureTag[]): Record<AlphaFeatureTag, boolean> {
  return tags.reduce((acc, tag) => {
    acc[tag] = useAlphaFeature(tag);
    return acc;
  }, {} as Record<AlphaFeatureTag, boolean>);
}
