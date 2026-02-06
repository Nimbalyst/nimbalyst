/**
 * Model display utilities for renderer components
 */

import { CLAUDE_MODELS, OPENAI_MODELS } from '@nimbalyst/runtime/ai/modelConstants';
import { ModelIdentifier } from '@nimbalyst/runtime/ai/server/types';

export { type EffortLevel, EFFORT_LEVELS, DEFAULT_EFFORT_LEVEL, parseEffortLevel } from '@nimbalyst/runtime/ai/server/effortLevels';

interface ModelInfo {
  providerId: string;
  providerName: string;
  modelName: string;
  shortModelName: string;
}

type ClaudeCodeVariant = 'opus' | 'sonnet' | 'haiku';

// Map Claude Code variants to their current version numbers
// These correspond to the underlying Claude models used by Claude Code
const CLAUDE_CODE_VARIANT_VERSIONS: Record<ClaudeCodeVariant, string> = {
  opus: '4.6',
  sonnet: '4.5',
  haiku: '3.5'
};

/**
 * Extract Claude Code variant from a model ID using ModelIdentifier.
 * Returns the base variant (without suffix) or null if not a valid Claude Code model.
 */
export function extractClaudeCodeVariant(modelId?: string): ClaudeCodeVariant | null {
  if (!modelId) return null;

  // Try parsing with ModelIdentifier
  const parsed = ModelIdentifier.tryParse(modelId);
  if (parsed && parsed.provider === 'claude-code') {
    // baseVariant strips suffixes like -1m
    const variant = parsed.baseVariant as ClaudeCodeVariant;
    if (variant === 'opus' || variant === 'sonnet' || variant === 'haiku') {
      return variant;
    }
  }

  // Legacy case: bare 'claude-code' without variant defaults to sonnet
  if (modelId.toLowerCase() === 'claude-code') {
    return 'sonnet';
  }

  return null;
}

function formatVariantLabel(variant: ClaudeCodeVariant): string {
  return variant.charAt(0).toUpperCase() + variant.slice(1);
}

export function getClaudeCodeModelLabel(modelId?: string): string {
  const variant = extractClaudeCodeVariant(modelId);
  // If no variant detected (shouldn't happen with legacy handling), default to Sonnet
  if (!variant) return 'Claude Agent (Sonnet 4.5)';
  const version = CLAUDE_CODE_VARIANT_VERSIONS[variant];

  // Check for extended context (1M) variant
  const parsed = modelId ? ModelIdentifier.tryParse(modelId) : null;
  const suffix = parsed?.isExtendedContext ? ' (1M)' : '';

  return `Claude Agent (${formatVariantLabel(variant)} ${version}${suffix})`;
}

export function getClaudeCodeModelShortLabel(modelId?: string): string {
  const variant = extractClaudeCodeVariant(modelId);
  // If no variant detected (shouldn't happen with legacy handling), default to Sonnet
  if (!variant) return 'Sonnet 4.5';
  const version = CLAUDE_CODE_VARIANT_VERSIONS[variant];

  // Check for extended context (1M) variant
  const parsed = modelId ? ModelIdentifier.tryParse(modelId) : null;
  const suffix = parsed?.isExtendedContext ? ' (1M)' : '';

  return `${formatVariantLabel(variant)} ${version}${suffix}`;
}

/**
 * Parse and format model information for display
 */
export function parseModelInfo(modelId?: string): ModelInfo | null {
  if (!modelId) return null;

  // Try parsing with ModelIdentifier
  const parsed = ModelIdentifier.tryParse(modelId);
  if (parsed) {
    // Special case for Claude Code
    if (parsed.provider === 'claude-code') {
      const modelName = getClaudeCodeModelShortLabel(modelId);
      return {
        providerId: 'claude-code',
        providerName: 'Claude Agent',
        modelName,
        shortModelName: modelName
      };
    }

    // Get provider display name
    const providerName = getProviderDisplayName(parsed.provider);

    // Get model display names
    const modelName = getModelDisplayName(parsed.provider, parsed.model);
    const shortModelName = getModelShortName(parsed.provider, parsed.model);

    return {
      providerId: parsed.provider,
      providerName,
      modelName,
      shortModelName
    };
  }

  // Fallback for legacy/non-standard formats
  // Try to parse as provider:model format manually
  if (modelId.includes(':')) {
    const [provider, ...modelParts] = modelId.split(':');
    const model = modelParts.join(':');
    const providerName = getProviderDisplayName(provider);
    const modelName = getModelDisplayName(provider, model);
    const shortModelName = getModelShortName(provider, model);

    return {
      providerId: provider,
      providerName,
      modelName,
      shortModelName
    };
  }

  // If no colon, treat the whole string as a provider name (fallback display)
  return {
    providerId: modelId,
    providerName: getProviderDisplayName(modelId),
    modelName: modelId,
    shortModelName: modelId
  };
}

/**
 * Get provider display name
 */
export function getProviderDisplayName(provider: string): string {
  switch (provider) {
    case 'claude': return 'Claude';
    case 'claude-code': return 'Claude Agent';
    case 'openai': return 'OpenAI';
    case 'lmstudio': return 'LMStudio';
    default: return provider;
  }
}

/**
 * Get provider short label for dropdowns
 */
export function getProviderLabel(provider: string): string {
  switch (provider) {
    case 'claude': return 'Chat';
    case 'claude-code': return 'CODE';
    case 'openai': return 'GPT';
    case 'lmstudio': return 'LOCAL';
    default: return provider.toUpperCase();
  }
}

/**
 * Get model display name based on provider knowledge
 */
export function getModelDisplayName(provider: string, modelId: string): string {
  if (provider === 'claude') {
    const model = CLAUDE_MODELS.find(m => m.id === modelId);
    if (model) return model.displayName;
    // Fallback for unknown models
    return modelId.replace('claude-', '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }
  
  if (provider === 'openai') {
    const model = OPENAI_MODELS.find(m => m.id === modelId);
    if (model) return model.displayName;
    // Fallback
    return modelId.toUpperCase().replace(/-/g, ' ');
  }

  if (provider === 'lmstudio') {
    // Format local model names
    return modelId
      .replace(/-GGUF$/i, '')
      .replace(/-Q[0-9]_K_[A-Z]/i, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  }

  return modelId;
}

/**
 * Get short model name for compact displays
 */
export function getModelShortName(provider: string, modelId: string): string {
  if (provider === 'claude') {
    const model = CLAUDE_MODELS.find(m => m.id === modelId);
    if (model) return model.shortName;
    return modelId.replace('claude-', '');
  }
  
  if (provider === 'openai') {
    const model = OPENAI_MODELS.find(m => m.id === modelId);
    if (model) return model.shortName;
    return modelId;
  }

  if (provider === 'lmstudio') {
    // Truncate long local model names
    const clean = modelId.replace(/-GGUF$/i, '').replace(/-Q[0-9]_K_[A-Z]/i, '');
    if (clean.length > 15) return clean.substring(0, 12) + '...';
    return clean;
  }

  // Default truncation for unknown providers
  if (modelId.length > 15) return modelId.substring(0, 12) + '...';
  return modelId;
}

/**
 * Check if a model supports effort level configuration (Opus 4.6 only).
 */
export function supportsEffortLevel(modelId?: string): boolean {
  return extractClaudeCodeVariant(modelId) === 'opus';
}
