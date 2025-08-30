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
    // Check cache first
    const lastFetchTime = this.lastFetch.get(provider) || 0;
    const cached = this.cachedModels.get(provider);
    
    if (cached && Date.now() - lastFetchTime < this.CACHE_DURATION) {
      return cached;
    }

    // Fetch fresh models
    let models: AIModel[] = [];
    
    try {
      switch (provider) {
        case 'claude':
          models = await this.fetchAnthropicModels(apiKey);
          break;
        case 'claude-code':
          // Claude Code uses MCP, single option
          models = [{
            id: 'claude-code',
            name: 'Claude Code (MCP)',
            provider: 'claude-code',
            maxTokens: 4096,
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
      
      // Map the response to our format
      const models = data.data.map((model: any) => ({
        id: model.id,
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
      
      // Filter for chat models and map to our format
      const chatModels = response.data
        .filter(model => 
          model.id.includes('gpt') && 
          !model.id.includes('instruct') &&
          !model.id.includes('vision')
        )
        .map(model => ({
          id: model.id,
          name: this.formatModelName(model.id),
          provider: 'openai' as AIProviderType,
          maxTokens: this.getOpenAIMaxTokens(model.id),
          contextWindow: this.getOpenAIContextWindow(model.id)
        }));
      
      // Sort by capability (newest/best first)
      return chatModels.sort((a, b) => {
        const order = ['gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'];
        const aIndex = order.findIndex(o => a.id.includes(o));
        const bIndex = order.findIndex(o => b.id.includes(o));
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
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
      
      // Map LMStudio models to our format
      return data.data.map((model: any) => ({
        id: model.id,
        name: this.formatLocalModelName(model.id),
        provider: 'lmstudio' as AIProviderType,
        maxTokens: model.max_tokens || 4096,
        contextWindow: model.context_length || 4096
      }));
      
    } catch (error) {
      console.error('Failed to fetch LMStudio models:', error);
      // Return a generic local model option
      return [{
        id: 'local-model',
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
    const nameMap: Record<string, string> = {
      'gpt-4-turbo-preview': 'GPT-4 Turbo',
      'gpt-4-turbo': 'GPT-4 Turbo',
      'gpt-4': 'GPT-4',
      'gpt-4-32k': 'GPT-4 32K',
      'gpt-3.5-turbo': 'GPT-3.5 Turbo',
      'gpt-3.5-turbo-16k': 'GPT-3.5 Turbo 16K'
    };
    
    return nameMap[modelId] || modelId
      .replace(/-/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
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
    if (modelId.includes('gpt-4-turbo')) return 4096;
    if (modelId.includes('gpt-4-32k')) return 32768;
    if (modelId.includes('gpt-4')) return 8192;
    if (modelId.includes('gpt-3.5-turbo-16k')) return 16384;
    if (modelId.includes('gpt-3.5-turbo')) return 4096;
    return 4096;
  }

  /**
   * Get context window for OpenAI models
   */
  private static getOpenAIContextWindow(modelId: string): number {
    if (modelId.includes('gpt-4-turbo')) return 128000;
    if (modelId.includes('gpt-4-32k')) return 32768;
    if (modelId.includes('gpt-4')) return 8192;
    if (modelId.includes('gpt-3.5-turbo-16k')) return 16384;
    if (modelId.includes('gpt-3.5-turbo')) return 16384;
    return 4096;
  }

  /**
   * Get fallback models when API fetch fails
   */
  private static getFallbackModels(provider: AIProviderType): AIModel[] {
    switch (provider) {
      case 'claude':
        return [
          {
            id: 'claude-3-5-sonnet-20241022',
            name: 'Claude 3.5 Sonnet (Latest)',
            provider: 'claude',
            maxTokens: 8192,
            contextWindow: 200000
          },
          {
            id: 'claude-3-5-sonnet-20240620',
            name: 'Claude 3.5 Sonnet (June)',
            provider: 'claude',
            maxTokens: 8192,
            contextWindow: 200000
          },
          {
            id: 'claude-3-opus-20240229',
            name: 'Claude 3 Opus',
            provider: 'claude',
            maxTokens: 4096,
            contextWindow: 200000
          },
          {
            id: 'claude-3-sonnet-20240229',
            name: 'Claude 3 Sonnet',
            provider: 'claude',
            maxTokens: 4096,
            contextWindow: 200000
          },
          {
            id: 'claude-3-haiku-20240307',
            name: 'Claude 3 Haiku',
            provider: 'claude',
            maxTokens: 4096,
            contextWindow: 200000
          },
          {
            id: 'claude-3-5-haiku-20241022',
            name: 'Claude 3.5 Haiku',
            provider: 'claude',
            maxTokens: 8192,
            contextWindow: 200000
          }
        ];
      case 'openai':
        return [
          {
            id: 'gpt-4-turbo-preview',
            name: 'GPT-4 Turbo',
            provider: 'openai',
            maxTokens: 4096,
            contextWindow: 128000
          },
          {
            id: 'gpt-3.5-turbo',
            name: 'GPT-3.5 Turbo',
            provider: 'openai',
            maxTokens: 4096,
            contextWindow: 16384
          }
        ];
      case 'lmstudio':
        return [{
          id: 'local-model',
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