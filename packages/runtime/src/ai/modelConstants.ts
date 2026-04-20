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
    id: 'claude-opus-4-7',
    displayName: 'Claude Opus 4.7 (1M)',
    shortName: 'Opus 4.7',
    maxTokens: 8192,
    // Opus 4.7 uses the 1M context window natively — no beta header required
    // (unlike Opus 4.6 which needed `context-1m-2025-08-07`).
    contextWindow: 1000000,
  },
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

/**
 * Claude Code variant display metadata — single source of truth.
 *
 * Both the runtime (`ClaudeCodeProvider` — builds the model catalog that the
 * SDK consumes) and the renderer (`modelUtils.ts` — renders the session-chrome
 * label that shows which variant is active) must agree on these values.
 * Duplicating the table in both places caused the renderer indicator to
 * display a stale "Opus 4.6" after the runtime was bumped to 4.7.
 *
 * Two kinds of variants:
 * - Canonical variants (`opus`, `sonnet`, `haiku`) — the SDK resolves these
 *   to the latest underlying model. The version field is for display only.
 * - Pinned variants (`opus-4-6`, ...) — always resolve to a specific
 *   Anthropic model ID via `CLAUDE_CODE_PINNED_SDK_MODELS`. Used to keep
 *   the previous-generation Opus selectable after bumping the canonical
 *   `opus` to the next version.
 */
export type ClaudeCodeVariant = 'opus' | 'sonnet' | 'haiku' | 'opus-4-6';

export const CLAUDE_CODE_VARIANT_VERSIONS: Record<ClaudeCodeVariant, string> = {
  opus: '4.7',
  sonnet: '4.6',
  haiku: '4.5',
  'opus-4-6': '4.6',
};

export const CLAUDE_CODE_MODEL_LABELS: Record<ClaudeCodeVariant, string> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
  'opus-4-6': 'Opus',
};

/**
 * For pinned variants, the SDK needs the full Anthropic model ID instead of
 * the short alias — the short aliases always resolve to "latest". An empty
 * string (or missing entry) means "pass the variant name straight through".
 */
export const CLAUDE_CODE_PINNED_SDK_MODELS: Partial<Record<ClaudeCodeVariant, string>> = {
  'opus-4-6': 'claude-opus-4-6',
};

/** Variants that support a 1M-context extended picker row. */
export const CLAUDE_CODE_VARIANTS_WITH_1M: readonly ClaudeCodeVariant[] = [
  'opus',
  'sonnet',
  'opus-4-6',
];

export const DEFAULT_MODELS = {
  claude: 'claude:claude-opus-4-7',
  openai: 'openai:gpt-5.4',
  'claude-code': 'claude-code:opus-1m',
  'openai-codex': 'openai-codex:gpt-5.4',
  lmstudio: 'lmstudio:local-model',
  opencode: 'opencode:default',
};
