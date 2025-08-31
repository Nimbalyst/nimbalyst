/**
 * Registry of available AI models with dynamic fetching
 */

import { AIModel, AIProviderType } from './types';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

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
          models = await this.fetchAnthropicModels(apiKey);
          break;
        case 'claude-code':
          // Claude Code is exposed as a special "model" option
          models = [{
            id: 'claude-code',  // Special model ID - no suffix needed
            name: 'Claude Code',
            provider: 'claude-code',
            maxTokens: 8192,
            contextWindow: 200000
          }];
          break;
        case 'openai':
          models = await this.fetchOpenAIModels(apiKey);
          break;
        case 'lmstudio':
          models = await this.fetchLMStudioModels(baseUrl || 'http://127.0.0.1:8234');
          break;
      }

      // Update cache
      this.cachedModels.set(provider, models);
      this.lastFetch.set(provider, Date.now());

    } catch (error) {
      console.error(`Failed to fetch models for ${provider}:`, error);
      // Return fallback models
      models = this.getFallbackModels(provider);
    }

    return models;
  }

  /**
   * Fetch available models from Anthropic API
   */
  private static async fetchAnthropicModels(apiKey?: string): Promise<AIModel[]> {
    console.log('[ModelRegistry] Fetching Anthropic models from API');

    try {
      // Try without API key first - the models endpoint might be public
      const headers: Record<string, string> = {
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      };

      // Only add API key if provided
      if (apiKey) {
        headers['x-api-key'] = apiKey;
      }

      // Call the Anthropic models API directly
      const response = await fetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        throw new Error(`Anthropic API returned ${response.status}`);
      }

      const data = await response.json();

      console.log('[ModelRegistry] Anthropic API returned models:', data.data?.map((m: any) => ({ id: m.id, name: m.display_name })));

      // Map the response to our format with provider:model ID format
      const models = data.data.map((model: any) => ({
        id: `claude:${model.id}`,
        name: model.display_name || this.formatModelName(model.id),
        provider: 'claude' as AIProviderType,
        maxTokens: this.getAnthropicMaxTokens(model.id),
        contextWindow: 200000 // Anthropic models generally have 200k context
      }));

      console.log('[ModelRegistry] Mapped Anthropic models:', models);
      return models;
    } catch (error) {
      console.error('Failed to fetch Anthropic models:', error);
      // Fall back to known models if API fails
      return this.getFallbackModels('claude');
    }
  }

  /**
   * Get max tokens for Anthropic model
   */
  private static getAnthropicMaxTokens(modelId: string): number {
    // Newer models support 8192, older ones 4096
    if (modelId.includes('3-5') || modelId.includes('3.5')) {
      return 8192;
    }
    return 4096;
  }

  /**
   * Fetch available models from OpenAI API
   */
  private static async fetchOpenAIModels(apiKey?: string): Promise<AIModel[]> {
    if (!apiKey) {
      return this.getFallbackModels('openai');
    }

    try {
      const openai = new OpenAI({ apiKey });
      const response = await openai.models.list();

      console.log('[ModelRegistry] Raw OpenAI models from API:', response.data.map(m => m.id));

      // Priority order - find the FIRST available model from each group
      const modelPriority = [
        // GPT-5 family - pick first available
        ['gpt-5-turbo', 'gpt-5'],
        // GPT-4.5 family
        ['gpt-4.5-turbo', 'gpt-4.5'],  
        // GPT-4.1 family
        ['gpt-4.1-turbo', 'gpt-4.1'],
        // GPT-4o family
        ['gpt-4o', 'chatgpt-4o-latest'],
        // GPT-4o-mini
        ['gpt-4o-mini'],
        // o1 preview
        ['o1-preview'],
        // o1 mini
        ['o1-mini'],
        // GPT-4 turbo
        ['gpt-4-turbo'],
        // GPT-3.5 turbo
        ['gpt-3.5-turbo']
      ];

      const selectedModels: any[] = [];
      const availableIds = new Set(response.data.map(m => m.id));
      
      for (const options of modelPriority) {
        // Find the first available model from this priority group
        const found = options.find(id => availableIds.has(id));
        if (found) {
          const model = response.data.find(m => m.id === found);
          if (model) {
            selectedModels.push(model);
            console.log(`[ModelRegistry] Selected ${found}`);
          }
        }
      }

      const chatModels = selectedModels
        .map(model => ({
          id: `openai:${model.id}`,
          name: model.id,
          provider: 'openai' as AIProviderType,
          maxTokens: 128000,
          contextWindow: 128000
        }));

      console.log('[ModelRegistry] Selected exactly', chatModels.length, 'OpenAI models:', chatModels.map(m => m.id));

      // Sort by our preferred order
      return chatModels.sort((a, b) => {
        // Define the exact order we want
        const getOrder = (id: string): number => {
          if (id.includes('gpt-5')) return 0;
          if (id.includes('gpt-4.5')) return 1;
          if (id.includes('gpt-4.1')) return 2;
          if (id.includes('chatgpt-4o-latest')) return 3;
          if (id.includes('gpt-4o-2024')) return 4;
          if (id.includes('gpt-4o-mini')) return 5;
          if (id.includes('gpt-4o')) return 6;
          if (id.includes('o1-preview')) return 7;
          if (id.includes('o1-mini')) return 8;
          if (id.includes('o1')) return 9;
          if (id.includes('gpt-4-turbo')) return 10;
          if (id.includes('gpt-3.5-turbo')) return 11;
          return 12;
        };

        const aOrder = getOrder(a.id);
        const bOrder = getOrder(b.id);

        if (aOrder !== bOrder) return aOrder - bOrder;

        // Within same family, newer dates first
        return b.id.localeCompare(a.id);
      });

    } catch (error) {
      console.error('Failed to fetch OpenAI models:', error);
      return this.getFallbackModels('openai');
    }
  }

  /**
   * Fetch available models from LMStudio local server
   */
  private static async fetchLMStudioModels(baseUrl: string): Promise<AIModel[]> {
    try {
      // LMStudio implements OpenAI-compatible API
      const response = await fetch(`${baseUrl}/v1/models`);

      if (!response.ok) {
        throw new Error(`LMStudio returned ${response.status}`);
      }

      const data = await response.json();

      // Map LMStudio models to our format with provider:model ID format
      return data.data.map((model: any) => ({
        id: `lmstudio:${model.id}`,
        name: this.formatLocalModelName(model.id),
        provider: 'lmstudio' as AIProviderType,
        maxTokens: model.max_tokens || 4096,
        contextWindow: model.context_length || 4096
      }));

    } catch (error) {
      console.error('Failed to fetch LMStudio models:', error);
      // Return a generic local model option
      return [{
        id: 'lmstudio:local-model',
        name: 'Local Model (LMStudio)',
        provider: 'lmstudio',
        maxTokens: 4096,
        contextWindow: 4096
      }];
    }
  }

  /**
   * Helper to format OpenAI model names for display
   */
  private static formatModelName(modelId: string): string {
    // Just return the model ID as-is - OpenAI knows what they're called
    return modelId;
  }

  /**
   * Helper to format local model names
   */
  private static formatLocalModelName(modelId: string): string {
    // Clean up common local model naming patterns
    return modelId
      .replace(/-GGUF$/i, '')
      .replace(/-Q[0-9]_K_[A-Z]/i, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  }

  /**
   * Get max tokens for OpenAI models
   */
  private static getOpenAIMaxTokens(modelId: string): number {
    // We don't know - let the API tell us when we use it
    return 128000;
  }

  /**
   * Get context window for OpenAI models
   */
  private static getOpenAIContextWindow(modelId: string): number {
    // We don't know - let the API tell us when we use it
    return 128000;
  }

  /**
   * Get fallback models when API fetch fails
   */
  private static getFallbackModels(provider: AIProviderType): AIModel[] {
    switch (provider) {
      case 'claude':
        return [
          {
            id: 'claude:claude-3-5-sonnet-20241022',
            name: 'Claude 3.5 Sonnet (Latest)',
            provider: 'claude',
            maxTokens: 8192,
            contextWindow: 200000
          },
          {
            id: 'claude:claude-3-5-sonnet-20240620',
            name: 'Claude 3.5 Sonnet (June)',
            provider: 'claude',
            maxTokens: 8192,
            contextWindow: 200000
          },
          {
            id: 'claude:claude-3-opus-20240229',
            name: 'Claude 3 Opus',
            provider: 'claude',
            maxTokens: 4096,
            contextWindow: 200000
          },
          {
            id: 'claude:claude-3-sonnet-20240229',
            name: 'Claude 3 Sonnet',
            provider: 'claude',
            maxTokens: 4096,
            contextWindow: 200000
          },
          {
            id: 'claude:claude-3-haiku-20240307',
            name: 'Claude 3 Haiku',
            provider: 'claude',
            maxTokens: 4096,
            contextWindow: 200000
          },
          {
            id: 'claude:claude-3-5-haiku-20241022',
            name: 'Claude 3.5 Haiku',
            provider: 'claude',
            maxTokens: 8192,
            contextWindow: 200000
          }
        ];
      case 'openai':
        // Just return empty - if the API fails, we can't know what models exist
        return [];
      case 'lmstudio':
        return [{
          id: 'lmstudio:local-model',
          name: 'Local Model',
          provider: 'lmstudio',
          maxTokens: 4096,
          contextWindow: 4096
        }];
      default:
        return [];
    }
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
  static getDefaultModel(provider: AIProviderType): AIModel | undefined {
    // Don't hardcode models - let each provider handle its own defaults
    // This just returns undefined so providers use their own logic
    return undefined;
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
}
