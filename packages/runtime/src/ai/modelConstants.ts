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
    id: 'gpt-5',
    displayName: 'GPT-5',
    shortName: 'GPT-5',
    maxTokens: 128000,
    contextWindow: 128000,
  },
  {
    id: 'gpt-5-turbo',
    displayName: 'GPT-5 Turbo',
    shortName: 'GPT-5T',
    maxTokens: 128000,
    contextWindow: 128000,
  },
  {
    id: 'gpt-4o',
    displayName: 'GPT-4o',
    shortName: 'GPT-4o',
    maxTokens: 128000,
    contextWindow: 128000,
  },
  {
    id: 'gpt-4-turbo',
    displayName: 'GPT-4 Turbo',
    shortName: 'GPT-4T',
    maxTokens: 128000,
    contextWindow: 128000,
  },
];

export const DEFAULT_MODELS = {
  claude: 'claude:claude-sonnet-4-5-20250929',
  openai: 'openai:gpt-5',
  'claude-code': 'claude-code:sonnet',
  'openai-codex': 'openai-codex:gpt-5',
  lmstudio: 'lmstudio:local-model',
};
