/**
 * Model display utilities for renderer components
 */

import { CLAUDE_MODELS, OPENAI_MODELS } from '@nimbalyst/runtime/ai/modelConstants';

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
  opus: '4.5',
  sonnet: '4.5',
  haiku: '3.5'
};

function extractClaudeCodeVariant(modelId?: string): ClaudeCodeVariant | null {
  if (!modelId) return null;
  const raw = modelId.includes(':') ? modelId.split(':').pop()! : modelId;
  const normalized = raw.toLowerCase();
  if (normalized === 'opus' || normalized === 'sonnet' || normalized === 'haiku') {
    return normalized;
  }
  // Legacy case: 'claude-code' without variant defaults to sonnet (what it was before)
  if (normalized === 'claude-code') {
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
  if (!variant) return 'Claude Code (Sonnet 4.5)';
  const version = CLAUDE_CODE_VARIANT_VERSIONS[variant];
  return `Claude Code (${formatVariantLabel(variant)} ${version})`;
}

export function getClaudeCodeModelShortLabel(modelId?: string): string {
  const variant = extractClaudeCodeVariant(modelId);
  // If no variant detected (shouldn't happen with legacy handling), default to Sonnet
  if (!variant) return 'Sonnet 4.5';
  const version = CLAUDE_CODE_VARIANT_VERSIONS[variant];
  return `${formatVariantLabel(variant)} ${version}`;
}

/**
 * Parse and format model information for display
 */
export function parseModelInfo(modelId?: string): ModelInfo | null {
  if (!modelId) return null;

  // Special case for Claude Code
  if (modelId.startsWith('claude-code')) {
    const modelName = getClaudeCodeModelShortLabel(modelId);
    return {
      providerId: 'claude-code',
      providerName: 'Claude Code',
      modelName,
      shortModelName: modelName
    };
  }

  // Parse provider:model format
  const [provider, ...modelParts] = modelId.split(':');
  const model = modelParts.join(':');

  // Get provider display name
  const providerName = getProviderDisplayName(provider);
  
  // Get model display names
  const modelName = getModelDisplayName(provider, model);
  const shortModelName = getModelShortName(provider, model);

  return { 
    providerId: provider, 
    providerName, 
    modelName,
    shortModelName
  };
}

/**
 * Get provider display name
 */
export function getProviderDisplayName(provider: string): string {
  switch (provider) {
    case 'claude': return 'Claude';
    case 'claude-code': return 'Claude Code';
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
    case 'claude': return 'SDK';
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
