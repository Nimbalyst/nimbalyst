/**
 * Alpha Feature Registry
 *
 * Central registry for all alpha/beta features that can be individually toggled.
 * This ensures new features are properly tracked and discoverable.
 *
 * To add a new alpha feature:
 * 1. Add an entry to ALPHA_FEATURES with a unique tag, display name, and description
 * 2. Use isAlphaFeatureEnabled('your-tag') to check if the feature is available
 */

export interface AlphaFeatureDefinition {
  /** Unique identifier for this feature (used in storage and checks) */
  tag: string;
  /** Human-readable display name */
  name: string;
  /** Description of what this feature does */
  description: string;
  /** Icon name for the settings UI */
  icon?: string;
}

/**
 * Complete registry of alpha features.
 * ALL alpha features must be registered here.
 */
export const ALPHA_FEATURES: readonly AlphaFeatureDefinition[] = [
  {
    tag: 'voice-mode',
    name: 'Voice Mode',
    description: 'Enable voice interaction mode for hands-free coding with AI.',
    icon: 'mic',
  },
  {
    tag: 'claude-plugins',
    name: 'Claude Plugins',
    description: 'Enable Claude Agent plugins and extensions management.',
    icon: 'widgets',
  },
  {
    tag: 'card-mode',
    name: 'Card View Mode',
    description: 'Enable card view mode for agent sessions panel.',
    icon: 'grid_view',
  },
  {
    tag: 'super-loops',
    name: 'Super Loops',
    description: 'Enable Super Loops for iterative agent workflows in dedicated worktrees.',
    icon: 'sync',
  },
  {
    tag: 'blitz',
    name: 'Blitz',
    description: 'Run the same prompt on multiple isolated worktrees to make more than one attempt at a task.',
    icon: 'bolt',
  },
  {
    tag: 'collaboration',
    name: 'Collaboration',
    description: 'Enable team collaboration features including shared trackers and team management.',
    icon: 'group',
  },
  {
    tag: 'tracker-kanban',
    name: 'Tracker Kanban View',
    description: 'Enable kanban board view in tracker mode.',
    icon: 'view_kanban',
  },
] as const;

/**
 * Type-safe feature tags derived from the registry.
 */
export type AlphaFeatureTag = typeof ALPHA_FEATURES[number]['tag'];

/**
 * Get the default enabled state for all alpha features (all disabled).
 */
export function getDefaultAlphaFeatures(): Record<AlphaFeatureTag, boolean> {
  return ALPHA_FEATURES.reduce((acc, feature) => {
    acc[feature.tag] = false;
    return acc;
  }, {} as Record<AlphaFeatureTag, boolean>);
}

/**
 * Check if all alpha features are enabled.
 */
export function areAllAlphaFeaturesEnabled(features: Record<AlphaFeatureTag, boolean>): boolean {
  return ALPHA_FEATURES.every(feature => features[feature.tag] === true);
}

/**
 * Enable all alpha features.
 */
export function enableAllAlphaFeatures(): Record<AlphaFeatureTag, boolean> {
  return ALPHA_FEATURES.reduce((acc, feature) => {
    acc[feature.tag] = true;
    return acc;
  }, {} as Record<AlphaFeatureTag, boolean>);
}

/**
 * Disable all alpha features.
 */
export function disableAllAlphaFeatures(): Record<AlphaFeatureTag, boolean> {
  return getDefaultAlphaFeatures();
}

/**
 * Get feature definition by tag.
 * Throws if tag is not found in registry (enforces explicit registration).
 */
export function getAlphaFeatureDefinition(tag: string): AlphaFeatureDefinition | undefined {
  return ALPHA_FEATURES.find(f => f.tag === tag);
}

/**
 * Validate that all provided feature tags are registered.
 * Useful for catching typos or unregistered features during development.
 */
export function validateAlphaFeatureTags(tags: string[]): { valid: boolean; unknown: string[] } {
  const knownTags = new Set(ALPHA_FEATURES.map(f => f.tag));
  const unknown = tags.filter(tag => !knownTags.has(tag));
  return {
    valid: unknown.length === 0,
    unknown,
  };
}
