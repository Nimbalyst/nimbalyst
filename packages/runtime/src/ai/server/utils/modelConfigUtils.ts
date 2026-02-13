/**
 * Utility functions for normalizing AI provider model configurations.
 *
 * OpenAI Codex provider uses dynamic model discovery instead of user-configured
 * model selections. This utility removes the `models` field from Codex configs
 * to prevent stale model lists from being persisted or transmitted.
 */

/**
 * Removes the `models` field from an object, returning a new object without it.
 * TypeScript will correctly infer the return type as `Omit<T, 'models'>`.
 */
export function omitModelsField<T extends { models?: any }>(
  config: T
): Omit<T, 'models'> {
  if (!config || typeof config !== 'object') {
    return config as Omit<T, 'models'>;
  }

  const { models: _removed, ...rest } = config;
  return rest;
}

/**
 * Normalizes provider configurations by removing the `models` field from
 * the 'openai-codex' provider if present.
 */
export function normalizeCodexProviderConfig<T extends Record<string, any>>(
  providers: T
): T {
  if (!providers || typeof providers !== 'object') {
    return providers;
  }

  const codexConfig = providers['openai-codex'];
  if (!codexConfig || typeof codexConfig !== 'object' || !('models' in codexConfig)) {
    return providers;
  }

  return {
    ...providers,
    'openai-codex': omitModelsField(codexConfig),
  } as T;
}
