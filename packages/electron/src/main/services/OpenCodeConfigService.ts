import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { OpenCodeFileConfig, OpenCodeFileProvider } from '@nimbalyst/runtime/ai/server';
import { logger } from '../utils/logger';

const CONFIG_REL_PATH = ['.config', 'opencode', 'opencode.json'];
const CONFIG_SCHEMA_URL = 'https://opencode.ai/config.json';
const LMSTUDIO_PROVIDER_KEY = 'lmstudio';
const LMSTUDIO_NPM_PACKAGE = '@ai-sdk/openai-compatible';

export interface LMStudioBridgeOptions {
  /** LM Studio server base URL as configured in Nimbalyst (e.g. http://127.0.0.1:1234). */
  baseUrl: string;
  /** Model ids discovered from LM Studio's /v1/models response. */
  modelIds: string[];
  /** Optional human-readable display name for the provider entry. */
  displayName?: string;
}

/**
 * Service that owns the user-level `~/.config/opencode/opencode.json` file.
 *
 * Reads return the parsed config (or null if the file is missing). Writes
 * deep-merge a partial patch into the existing file so we never clobber
 * fields the user authored manually -- OpenCode's schema is broader than
 * what we surface in the panel.
 */
export class OpenCodeConfigService {
  private readonly configPath: string;

  constructor() {
    this.configPath = path.join(os.homedir(), ...CONFIG_REL_PATH);
  }

  getConfigPath(): string {
    return this.configPath;
  }

  async readConfig(): Promise<OpenCodeFileConfig | null> {
    try {
      const raw = await fs.readFile(this.configPath, 'utf8');
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed as OpenCodeFileConfig : null;
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null;
      logger.ai.error('[OpenCode] Failed to read config:', error);
      throw error;
    }
  }

  /**
   * Deep-merge a patch into the existing opencode.json. Object values are
   * merged recursively; arrays and primitives are replaced. Removing a key
   * requires passing `null` -- patches with `undefined` are ignored so callers
   * can spread partial updates without erasing untouched fields.
   */
  async mergeConfig(patch: Partial<OpenCodeFileConfig>): Promise<OpenCodeFileConfig> {
    const current = (await this.readConfig()) ?? {};
    const merged = deepMerge(current, patch) as OpenCodeFileConfig;
    if (!merged.$schema) {
      merged.$schema = CONFIG_SCHEMA_URL;
    }
    await this.writeConfigRaw(merged);
    return merged;
  }

  /** Replace the file's contents wholesale. Caller is responsible for the full document. */
  async writeConfig(config: OpenCodeFileConfig): Promise<void> {
    await this.writeConfigRaw(config);
  }

  /**
   * Add or update an OpenCode provider block that bridges to a local LM Studio server.
   * Existing entries under `provider.lmstudio` are preserved -- new model ids are
   * appended, and the baseURL is updated to match the user's current LM Studio config.
   */
  async upsertLMStudioBridge(options: LMStudioBridgeOptions): Promise<OpenCodeFileConfig> {
    const baseURL = normalizeOpenAICompatibleBaseUrl(options.baseUrl);
    const current = (await this.readConfig()) ?? {};
    const provider = { ...(current.provider ?? {}) };
    const existing: OpenCodeFileProvider = provider[LMSTUDIO_PROVIDER_KEY] ?? {};
    const existingModels = existing.models ?? {};

    const models: Record<string, { name?: string }> = { ...existingModels };
    for (const modelId of options.modelIds) {
      if (!modelId) continue;
      if (!models[modelId]) {
        models[modelId] = { name: modelId };
      }
    }

    provider[LMSTUDIO_PROVIDER_KEY] = {
      ...existing,
      name: options.displayName ?? existing.name ?? 'LM Studio (local)',
      npm: existing.npm ?? LMSTUDIO_NPM_PACKAGE,
      options: { ...(existing.options ?? {}), baseURL },
      models,
    };

    return this.mergeConfig({ provider });
  }

  /** Remove the `provider.lmstudio` block entirely. */
  async removeLMStudioBridge(): Promise<OpenCodeFileConfig | null> {
    const current = await this.readConfig();
    if (!current?.provider?.[LMSTUDIO_PROVIDER_KEY]) return current;
    const { [LMSTUDIO_PROVIDER_KEY]: _omit, ...rest } = current.provider;
    const next: OpenCodeFileConfig = { ...current, provider: rest };
    await this.writeConfigRaw(next);
    return next;
  }

  private async writeConfigRaw(config: OpenCodeFileConfig): Promise<void> {
    const dir = path.dirname(this.configPath);
    await fs.mkdir(dir, { recursive: true });
    const serialized = JSON.stringify(config, null, 2) + '\n';
    await fs.writeFile(this.configPath, serialized, 'utf8');
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) {
      delete out[key];
      continue;
    }
    const existing = out[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      out[key] = deepMerge(existing, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * LM Studio's OpenAI-compatible endpoint lives at `/v1`. Nimbalyst stores the
 * server root (e.g. `http://127.0.0.1:1234`), so we append `/v1` if it's missing.
 */
function normalizeOpenAICompatibleBaseUrl(input: string): string {
  const trimmed = input.replace(/\/+$/, '');
  if (/\/v\d+$/.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}
