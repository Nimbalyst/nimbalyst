/**
 * Factory for creating AI provider instances
 */

import { AIProvider } from './AIProvider';
import { ClaudeProvider } from './providers/ClaudeProvider';
import { ClaudeCodeProvider } from './providers/ClaudeCodeProvider';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { OpenAICodexProvider } from './providers/OpenAICodexProvider';
import { LMStudioProvider } from './providers/LMStudioProvider';
import { OpenCodeProvider } from './providers/OpenCodeProvider';
import { ProviderConfig, AIProviderType, assertExhaustiveProvider } from './types';

export class ProviderFactory {
  private static providers: Map<string, AIProvider> = new Map();

  /**
   * Get an existing AI provider instance
   * Returns null if provider doesn't exist
   */
  static getProvider(
    type: AIProviderType,
    sessionId: string
  ): AIProvider | null {
    const key = `${type}-${sessionId}`;
    const provider = this.providers.get(key) || null;
    // console.log(`[ProviderFactory] getProvider(${key}): ${provider ? 'found' : 'not found'}, map size: ${this.providers.size}`);
    // if (provider && type === 'claude-code') {
    //   const instanceId = (provider as any)._instanceId;
    //   const hasAbortController = !!(provider as any).abortController;
    //   console.log(`[ProviderFactory] claude-code provider state: instanceId=${instanceId}, hasAbortController=${hasAbortController}`);
    // }
    return provider;
  }
  
  /**
   * Create a new AI provider instance
   * Always creates a new provider, doesn't check cache
   */
  static createProvider(
    type: AIProviderType,
    sessionId: string
  ): AIProvider {
    const startTime = Date.now();
    const key = `${type}-${sessionId}`;
    // console.log(`[ProviderFactory] Creating new ${type} provider for session ${sessionId}`);

    // Create new provider based on type
    let provider: AIProvider;
    switch (type) {
      case 'claude':
        provider = new ClaudeProvider();
        break;
      case 'claude-code':
        // Use SDK version with dynamic loading
        provider = new ClaudeCodeProvider();
        break;
      case 'openai':
        provider = new OpenAIProvider();
        break;
      case 'openai-codex':
        provider = new OpenAICodexProvider();
        break;
      case 'opencode':
        provider = new OpenCodeProvider();
        break;
      case 'lmstudio':
        provider = new LMStudioProvider();
        break;
      default:
        assertExhaustiveProvider(type);
    }
    
    // Cache the provider
    this.providers.set(key, provider);
    // console.log(`[ProviderFactory] Created ${type} provider in ${Date.now() - startTime}ms`);

    return provider;
  }

  /**
   * Clean up a provider instance
   */
  static destroyProvider(sessionId: string, type?: AIProviderType): void {
    if (type) {
      const key = `${type}-${sessionId}`;
      const provider = this.providers.get(key);
      if (provider) {
        provider.destroy();
        this.providers.delete(key);
      }
    } else {
      // Destroy all providers for this session
      for (const [key, provider] of this.providers.entries()) {
        if (key.endsWith(`-${sessionId}`)) {
          provider.destroy();
          this.providers.delete(key);
        }
      }
    }
  }

  /**
   * Clean up all provider instances
   */
  static destroyAll(): void {
    // console.log(`[ProviderFactory] Destroying ${this.providers.size} providers`);

    // Try to destroy each provider individually with error handling
    for (const [key, provider] of this.providers.entries()) {
      try {
        // console.log(`[ProviderFactory] Destroying provider: ${key}`);
        provider.destroy();
      } catch (error) {
        console.error(`[ProviderFactory] Error destroying provider ${key}:`, error);
        // Continue destroying other providers
      }
    }
    
    // Clear the map even if some providers failed to destroy
    try {
      this.providers.clear();
    } catch (error) {
      console.error('[ProviderFactory] Error clearing providers map:', error);
    }
  }
}