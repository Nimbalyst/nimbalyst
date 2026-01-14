/**
 * Registry of available AI models with dynamic fetching
 */

import { AIModel, AIProviderType } from './types';

export class ModelRegistry {
  private static cachedModels: Map<AIProviderType, AIModel[]> = new Map();
  private static lastFetch: Map<AIProviderType, number> = new Map();
  private static CACHE_DURATION = 60 * 60 * 1000; // 1 hour cache

  /**
   * Get models for a specific provider (with caching)
   */
  static async getModelsForProvider(
    provider: AIProviderType,
    apiKey?: string,
    baseUrl?: string
  ): Promise<AIModel[]> {
    // console.log('[ModelRegistry] getModelsForProvider called:', {
    //   provider,
    //   hasApiKey: !!apiKey,
    //   baseUrl
    // });

    // SKIP CACHE FOR NOW - always fetch fresh
    // const lastFetchTime = this.lastFetch.get(provider) || 0;
    // const cached = this.cachedModels.get(provider);

    // if (cached && Date.now() - lastFetchTime < this.CACHE_DURATION) {
    //   return cached;
    // }

    // Fetch fresh models
    let models: AIModel[] = [];

    try {
      switch (provider) {
        case 'claude':
          const { ClaudeProvider } = await import('./providers/ClaudeProvider');
          models = this.filterLatestClaudeModels(ClaudeProvider.getModels());
          // console.log('[ModelRegistry] Claude models:', models);
          break;
        case 'claude-code':
          // Use SDK version with dynamic loading
          // console.log('[ModelRegistry] Fetching claude-code models via ClaudeCodeProvider.getModels()');
          const { ClaudeCodeProvider } = await import('./providers/ClaudeCodeProvider');
          models = await ClaudeCodeProvider.getModels();
          // console.log('[ModelRegistry] Claude Code models retrieved:', models.map(m => ({ id: m.id, name: m.name })));
          break;
        case 'openai':
          const { OpenAIProvider } = await import('./providers/OpenAIProvider');
          models = await OpenAIProvider.getModels(apiKey);
          break;
        case 'openai-codex':
          const { OpenAICodexProvider } = await import('./providers/OpenAICodexProvider');
          models = OpenAICodexProvider.getModels();
          break;
        case 'lmstudio':
          // Try to fetch models from LMStudio
          // The provider will return empty array if LMStudio is not running
          const { LMStudioProvider } = await import('./providers/LMStudioProvider');
          models = await LMStudioProvider.getModels(baseUrl || 'http://127.0.0.1:1234');
          break;
      }

      // Update cache
      this.cachedModels.set(provider, models);
      this.lastFetch.set(provider, Date.now());

    } catch (error) {
      console.error(`Failed to fetch models for ${provider}:`, error);
      // Return empty array on error
      models = [];
    }

    return models;
  }

  /**
   * Get all available models across all providers
   */
  static async getAllModels(apiKeys: Record<string, string>): Promise<AIModel[]> {
    const allModels: AIModel[] = [];

    // Fetch from each provider in parallel
    const promises = [
      this.getModelsForProvider('claude', apiKeys['anthropic']),
      this.getModelsForProvider('claude-code', apiKeys['anthropic']),
      this.getModelsForProvider('openai', apiKeys['openai']),
      this.getModelsForProvider('openai-codex', apiKeys['openai']),
      this.getModelsForProvider('lmstudio', undefined, apiKeys['lmstudio_url'])
    ];

    const results = await Promise.allSettled(promises);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allModels.push(...result.value);
      }
    }

    return allModels;
  }

  /**
   * Get the default model for a provider
   */
  static async getDefaultModel(provider: AIProviderType): Promise<string> {
    switch (provider) {
      case 'claude':
        const { ClaudeProvider } = await import('./providers/ClaudeProvider');
        return ClaudeProvider.getDefaultModel();
      case 'openai':
        const { OpenAIProvider } = await import('./providers/OpenAIProvider');
        return OpenAIProvider.getDefaultModel();
      case 'claude-code':
        const { ClaudeCodeProvider } = await import('./providers/ClaudeCodeProvider');
        return ClaudeCodeProvider.getDefaultModel();
      case 'openai-codex':
        const { OpenAICodexProvider } = await import('./providers/OpenAICodexProvider');
        return OpenAICodexProvider.getDefaultModel();
      case 'lmstudio':
        const { LMStudioProvider } = await import('./providers/LMStudioProvider');
        return LMStudioProvider.getDefaultModel();
      default:
        return '';
    }
  }

  /**
   * Clear the cache to force fresh fetch
   */
  static clearCache(provider?: AIProviderType): void {
    if (provider) {
      this.cachedModels.delete(provider);
      this.lastFetch.delete(provider);
    } else {
      this.cachedModels.clear();
      this.lastFetch.clear();
    }
  }

  private static filterLatestClaudeModels(models: AIModel[]): AIModel[] {
    const latestByVariant = new Map<string, { model: AIModel; releaseDate: number }>();
    let parseFailed = false;

    for (const model of models) {
      const metadata = this.extractClaudeModelMetadata(model);
      if (!metadata) {
        parseFailed = true;
        break;
      }

      const existing = latestByVariant.get(metadata.variant);
      if (!existing || metadata.releaseDate > existing.releaseDate) {
        latestByVariant.set(metadata.variant, { model, releaseDate: metadata.releaseDate });
      }
    }

    if (parseFailed) {
      console.warn('[ModelRegistry] Failed to parse Claude model metadata - returning full list');
      return models;
    }

    return Array.from(latestByVariant.values()).map(entry => entry.model);
  }

  private static extractClaudeModelMetadata(model: AIModel): { variant: string; releaseDate: number } | null {
    const idPart = model.id.includes(':') ? model.id.split(':').pop()! : model.id;
    const normalized = idPart.toLowerCase();
    const variantMatch = normalized.match(/(opus|sonnet|haiku)/);
    const dateMatch = normalized.match(/(\d{8})$/);

    if (!variantMatch || !dateMatch) {
      return null;
    }

    return {
      variant: variantMatch[1],
      releaseDate: Number.parseInt(dateMatch[1], 10)
    };
  }
}
