/**
 * Shared AI model constants available across hosts.
 */

export interface ModelDefinition {
  id: string;
  displayName: string;
  shortName: string;
  maxTokens: number;
  contextWindow: number;
}

export const CLAUDE_MODELS: ModelDefinition[] = [
  {
    id: 'claude-opus-4-6',
    displayName: 'Claude Opus 4.6',
    shortName: 'Opus 4.6',
    maxTokens: 8192,
    contextWindow: 200000,
  },
  {
    id: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    shortName: 'Sonnet 4.6',
    maxTokens: 8192,
    contextWindow: 200000,
  },
  {
    id: 'claude-opus-4-5-20251101',
    displayName: 'Claude Opus 4.5',
    shortName: 'Opus 4.5',
    maxTokens: 8192,
    contextWindow: 200000,
  },
  {
    id: 'claude-opus-4-1-20250805',
    displayName: 'Claude Opus 4.1',
    shortName: 'Opus 4.1',
    maxTokens: 8192,
    contextWindow: 200000,
  },
  {
    id: 'claude-opus-4-20250514',
    displayName: 'Claude Opus 4',
    shortName: 'Opus 4',
    maxTokens: 8192,
    contextWindow: 200000,
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    displayName: 'Claude Sonnet 4.5',
    shortName: 'Sonnet 4.5',
    maxTokens: 8192,
    contextWindow: 200000,
  },
  {
    id: 'claude-sonnet-4-20250514',
    displayName: 'Claude Sonnet 4',
    shortName: 'Sonnet 4',
    maxTokens: 8192,
    contextWindow: 200000,
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    displayName: 'Claude Sonnet 3.7',
    shortName: 'Sonnet 3.7',
    maxTokens: 8192,
    contextWindow: 200000,
  },
];

export const OPENAI_MODELS: ModelDefinition[] = [
  {
    id: 'gpt-5.4',
    displayName: 'GPT-5.4',
    shortName: '5.4',
    maxTokens: 128000,
    contextWindow: 400000,
  },
  {
    id: 'gpt-5.3-chat-latest',
    displayName: 'GPT-5.3 Chat',
    shortName: '5.3 Chat',
    maxTokens: 128000,
    contextWindow: 400000,
  },
  {
    id: 'gpt-5.2',
    displayName: 'GPT-5.2',
    shortName: '5.2',
    maxTokens: 128000,
    contextWindow: 400000,
  },
  {
    id: 'gpt-5.1',
    displayName: 'GPT-5.1',
    shortName: '5.1',
    maxTokens: 128000,
    contextWindow: 400000,
  },
  {
    id: 'gpt-5',
    displayName: 'GPT-5',
    shortName: '5.0',
    maxTokens: 128000,
    contextWindow: 400000,
  },
  {
    id: 'gpt-5-mini',
    displayName: 'GPT-5 Mini',
    shortName: '5 Mini',
    maxTokens: 128000,
    contextWindow: 400000,
  },
  {
    id: 'gpt-5-nano',
    displayName: 'GPT-5 Nano',
    shortName: '5 Nano',
    maxTokens: 128000,
    contextWindow: 400000,
  },
  {
    id: 'gpt-4.1',
    displayName: 'GPT-4.1',
    shortName: '4.1',
    maxTokens: 32768,
    contextWindow: 1047576,
  },
  {
    id: 'gpt-4.1-mini',
    displayName: 'GPT-4.1 Mini',
    shortName: '4.1 Mini',
    maxTokens: 32768,
    contextWindow: 1047576,
  },
  {
    id: 'gpt-4.1-nano',
    displayName: 'GPT-4.1 Nano',
    shortName: '4.1 Nano',
    maxTokens: 32768,
    contextWindow: 1047576,
  },
  {
    id: 'gpt-4o',
    displayName: 'GPT-4o',
    shortName: '4o',
    maxTokens: 16384,
    contextWindow: 128000,
  },
  {
    id: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini',
    shortName: '4o Mini',
    maxTokens: 16384,
    contextWindow: 128000,
  },
];

export const DEFAULT_MODELS = {
  claude: 'claude:claude-sonnet-4-6',
  openai: 'openai:gpt-5.4',
  'claude-code': 'claude-code:sonnet',
  'openai-codex': 'openai-codex:gpt-5.4',
  lmstudio: 'lmstudio:local-model',
};
