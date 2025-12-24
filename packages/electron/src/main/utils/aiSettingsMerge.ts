/**
 * AI Settings Merge Utility
 *
 * Merges global AI settings with project-level overrides.
 * Project settings take precedence over global settings.
 * undefined/null in project settings means "inherit from global".
 */

import { AIProviderOverrides, ProviderOverride, getAIProviderOverrides } from './store';

/**
 * Global AI settings structure (from ai-settings electron-store)
 */
export interface GlobalAISettings {
  defaultProvider: string;
  apiKeys: Record<string, string>;
  providerSettings: Record<string, ProviderSettings>;
  showToolCalls: boolean;
  aiDebugLogging: boolean;
}

/**
 * Per-provider settings from global config
 */
export interface ProviderSettings {
  enabled?: boolean;
  models?: string[];
  defaultModel?: string;
  baseUrl?: string;
  apiKey?: string;
  authMethod?: string;
}

/**
 * Effective (merged) settings for a provider
 */
export interface EffectiveProviderSettings extends ProviderSettings {
  /** Indicates if this value came from project override */
  isOverridden?: boolean;
}

/**
 * Effective (merged) AI settings for a project
 */
export interface EffectiveAISettings {
  defaultProvider: string;
  apiKeys: Record<string, string>;
  providerSettings: Record<string, EffectiveProviderSettings>;
  showToolCalls: boolean;
  aiDebugLogging: boolean;
  /** Which settings are overridden at project level */
  overrides: {
    defaultProvider: boolean;
    providers: Record<string, { enabled?: boolean; models?: boolean; defaultModel?: boolean; apiKey?: boolean }>;
  };
}

/**
 * Merge a single provider's settings with its override
 */
function mergeProviderSettings(
  global: ProviderSettings | undefined,
  override: ProviderOverride | undefined
): EffectiveProviderSettings & { overrideInfo: { enabled?: boolean; models?: boolean; defaultModel?: boolean; apiKey?: boolean } } {
  const base: ProviderSettings = global || {};
  const result: EffectiveProviderSettings = { ...base };
  const overrideInfo: { enabled?: boolean; models?: boolean; defaultModel?: boolean; apiKey?: boolean } = {};

  if (!override) {
    return { ...result, overrideInfo };
  }

  // Override enabled state if explicitly set
  if (override.enabled !== undefined) {
    result.enabled = override.enabled;
    overrideInfo.enabled = true;
  }

  // Override models if provided
  if (override.models !== undefined) {
    result.models = override.models;
    overrideInfo.models = true;
  }

  // Override default model if provided
  if (override.defaultModel !== undefined) {
    result.defaultModel = override.defaultModel;
    overrideInfo.defaultModel = true;
  }

  // Override API key if provided (project-specific key)
  if (override.apiKey !== undefined) {
    result.apiKey = override.apiKey;
    overrideInfo.apiKey = true;
  }

  return { ...result, overrideInfo };
}

/**
 * Merge global AI settings with project-level overrides.
 *
 * @param globalSettings - The global AI settings from ai-settings store
 * @param workspacePath - The workspace path to get overrides for (optional)
 * @returns Effective settings with project overrides applied
 */
export function mergeAISettings(
  globalSettings: GlobalAISettings,
  workspacePath?: string
): EffectiveAISettings {
  // If no workspace path, return global settings as-is
  if (!workspacePath) {
    return {
      ...globalSettings,
      overrides: {
        defaultProvider: false,
        providers: {},
      },
    };
  }

  // Get project-level overrides
  const projectOverrides = getAIProviderOverrides(workspacePath);

  // If no overrides, return global settings
  if (!projectOverrides) {
    return {
      ...globalSettings,
      overrides: {
        defaultProvider: false,
        providers: {},
      },
    };
  }

  // Start with global settings
  const effective: EffectiveAISettings = {
    defaultProvider: globalSettings.defaultProvider,
    apiKeys: { ...globalSettings.apiKeys },
    providerSettings: {},
    showToolCalls: globalSettings.showToolCalls,
    aiDebugLogging: globalSettings.aiDebugLogging,
    overrides: {
      defaultProvider: false,
      providers: {},
    },
  };

  // Override default provider if set
  if (projectOverrides.defaultProvider !== undefined) {
    effective.defaultProvider = projectOverrides.defaultProvider;
    effective.overrides.defaultProvider = true;
  }

  // Get all provider IDs (union of global and override)
  const allProviderIds = new Set([
    ...Object.keys(globalSettings.providerSettings || {}),
    ...Object.keys(projectOverrides.providers || {}),
  ]);

  // Merge each provider's settings
  for (const providerId of allProviderIds) {
    const globalProvider = globalSettings.providerSettings?.[providerId];
    const overrideProvider = projectOverrides.providers?.[providerId];

    const { overrideInfo, ...mergedSettings } = mergeProviderSettings(globalProvider, overrideProvider);

    effective.providerSettings[providerId] = mergedSettings;
    effective.overrides.providers[providerId] = overrideInfo;

    // If provider has a project-specific API key, add it to apiKeys
    if (overrideProvider?.apiKey) {
      // Store under provider-specific key to allow per-project keys
      effective.apiKeys[`${providerId}_project`] = overrideProvider.apiKey;
    }
  }

  return effective;
}

/**
 * Check if a provider is effectively enabled for a workspace
 *
 * @param globalSettings - The global AI settings
 * @param providerId - The provider ID to check
 * @param workspacePath - The workspace path (optional)
 * @returns true if the provider is enabled for this context
 */
export function isProviderEnabled(
  globalSettings: GlobalAISettings,
  providerId: string,
  workspacePath?: string
): boolean {
  const effective = mergeAISettings(globalSettings, workspacePath);
  return effective.providerSettings[providerId]?.enabled ?? false;
}

/**
 * Get the effective API key for a provider in a workspace context
 *
 * @param globalSettings - The global AI settings
 * @param providerId - The provider ID
 * @param workspacePath - The workspace path (optional)
 * @returns The API key to use (project-specific if set, otherwise global)
 */
export function getEffectiveApiKey(
  globalSettings: GlobalAISettings,
  providerId: string,
  workspacePath?: string
): string | undefined {
  const effective = mergeAISettings(globalSettings, workspacePath);

  // Check for project-specific key first
  const projectKey = effective.apiKeys[`${providerId}_project`];
  if (projectKey) {
    return projectKey;
  }

  // Fall back to global key
  // Handle anthropic being shared by claude and claude-code
  if (providerId === 'claude' || providerId === 'claude-code') {
    return effective.apiKeys['anthropic'];
  }

  return effective.apiKeys[providerId];
}

/**
 * Get the effective model for a provider in a workspace context
 *
 * @param globalSettings - The global AI settings
 * @param providerId - The provider ID
 * @param workspacePath - The workspace path (optional)
 * @returns The default model to use
 */
export function getEffectiveModel(
  globalSettings: GlobalAISettings,
  providerId: string,
  workspacePath?: string
): string | undefined {
  const effective = mergeAISettings(globalSettings, workspacePath);
  return effective.providerSettings[providerId]?.defaultModel;
}

/**
 * Get list of enabled providers for a workspace
 *
 * @param globalSettings - The global AI settings
 * @param workspacePath - The workspace path (optional)
 * @returns Array of enabled provider IDs
 */
export function getEnabledProviders(
  globalSettings: GlobalAISettings,
  workspacePath?: string
): string[] {
  const effective = mergeAISettings(globalSettings, workspacePath);
  return Object.entries(effective.providerSettings)
    .filter(([_, settings]) => settings.enabled)
    .map(([id]) => id);
}
