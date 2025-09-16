import { getDB } from '../pglite';

export interface ProviderConfigSettings {
  enabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
  selectedModels?: string[];
  defaultModel?: string;
}

export interface AISettings {
  // Legacy flat fields (for backward compatibility)
  provider?: 'anthropic' | 'openai' | 'lmstudio';
  model?: string;
  endpoint?: string;
  baseUrl?: string;
  apiKey?: string;
  // New structured provider config
  providers?: {
    anthropic?: ProviderConfigSettings;
    openai?: ProviderConfigSettings;
    lmstudio?: ProviderConfigSettings;
  };
  defaultProvider?: 'anthropic' | 'openai' | 'lmstudio';
  lastSessionId?: string;
}

export const SettingsRepository = {
  async get(): Promise<{ theme: string; ai: AISettings }> {
    const db = getDB();
    const { rows } = await db.query<{ theme: string; ai_settings: any }>(
      'SELECT theme, ai_settings FROM settings WHERE id=$1 LIMIT 1',
      ['default']
    );
    const row = rows[0] || { theme: 'auto', ai_settings: {} };
    const ai = (row as any).ai_settings || {};
    // Normalize legacy flat fields into providers structure when possible
    if (!ai.providers) {
      ai.providers = {};
      if (ai.baseUrl || ai.provider === 'lmstudio') {
        ai.providers.lmstudio = {
          enabled: ai.provider === 'lmstudio',
          baseUrl: ai.baseUrl,
          defaultModel: ai.model,
        };
      }
      if (ai.apiKey && ai.provider === 'openai') {
        ai.providers.openai = {
          enabled: true,
          apiKey: ai.apiKey,
          defaultModel: ai.model,
        };
      }
      if (ai.apiKey && ai.provider === 'anthropic') {
        ai.providers.anthropic = {
          enabled: true,
          apiKey: ai.apiKey,
          defaultModel: ai.model,
        };
      }
      ai.defaultProvider = ai.provider || ai.defaultProvider;
    }
    return { theme: row.theme, ai };
  },
  async saveAI(ai: AISettings): Promise<void> {
    const db = getDB();
    await db.query('UPDATE settings SET ai_settings=$2, updated_at=$3 WHERE id=$1', [
      'default',
      JSON.stringify(ai),
      Date.now(),
    ]);
  },
  async updateAI(patch: Partial<AISettings>): Promise<void> {
    const current = await this.get();
    const ai = current.ai || {};
    const merged: AISettings = {
      ...ai,
      ...patch,
      providers: {
        ...(ai.providers || {}),
        ...(patch.providers || {}),
        anthropic: { ...(ai.providers?.anthropic || {}), ...(patch.providers?.anthropic || {}) },
        openai: { ...(ai.providers?.openai || {}), ...(patch.providers?.openai || {}) },
        lmstudio: { ...(ai.providers?.lmstudio || {}), ...(patch.providers?.lmstudio || {}) },
      }
    } as any;
    await this.saveAI(merged);
  }
};
