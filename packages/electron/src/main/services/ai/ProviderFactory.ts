/**
 * Factory for creating AI provider instances
 */

import { AIProvider } from './AIProvider';
import { ClaudeProvider } from './providers/ClaudeProvider';
import { ClaudeCodeProvider } from './providers/ClaudeCodeProvider';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { LMStudioProvider } from './providers/LMStudioProvider';
import { ProviderConfig, AIProviderType } from './types';

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
    return this.providers.get(key) || null;
  }
  
  /**
   * Create a new AI provider instance
   * Always creates a new provider, doesn't check cache
   */
  static createProvider(
    type: AIProviderType,
    sessionId: string
  ): AIProvider {
    const key = `${type}-${sessionId}`;
    
    // Create new provider based on type
    let provider: AIProvider;
    switch (type) {
      case 'claude':
        provider = new ClaudeProvider();
        break;
      case 'claude-code':
        provider = new ClaudeCodeProvider();
        break;
      case 'openai':
        provider = new OpenAIProvider();
        break;
      case 'lmstudio':
        provider = new LMStudioProvider();
        break;
      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
    
    // Cache the provider
    this.providers.set(key, provider);
    
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
    for (const provider of this.providers.values()) {
      provider.destroy();
    }
    this.providers.clear();
  }
}