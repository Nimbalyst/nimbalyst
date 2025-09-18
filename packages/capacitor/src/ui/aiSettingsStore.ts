export interface ProviderConfigSettings {
  enabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
  selectedModels?: string[];
  defaultModel?: string;
}

export interface AISettings {
  provider?: 'anthropic' | 'openai' | 'lmstudio';
  model?: string;
  endpoint?: string;
  baseUrl?: string;
  apiKey?: string;
  providers?: {
    anthropic?: ProviderConfigSettings;
    openai?: ProviderConfigSettings;
    lmstudio?: ProviderConfigSettings;
  };
  defaultProvider?: 'anthropic' | 'openai' | 'lmstudio';
  lastSessionId?: string;
}

interface StoredSettings {
  theme: string;
  ai: AISettings;
}

const STORAGE_KEY = 'capacitor-ai-settings-v1';

function readFromStorage(): StoredSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredSettings;
  } catch {
    return null;
  }
}

function writeToStorage(data: StoredSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore storage errors
  }
}

export async function getSettings(): Promise<StoredSettings> {
  const stored = readFromStorage();
  if (stored) {
    return normalizeSettings(stored);
  }
  const defaults: StoredSettings = {
    theme: 'system',
    ai: {
      defaultProvider: 'lmstudio',
      providers: {}
    }
  };
  writeToStorage(defaults);
  return defaults;
}

export async function saveAISettings(ai: AISettings): Promise<void> {
  const { theme } = await getSettings();
  writeToStorage({ theme, ai: normalizeAI(ai) });
}

export async function updateAISettings(patch: Partial<AISettings>): Promise<void> {
  const current = await getSettings();
  const merged: AISettings = {
    ...current.ai,
    ...patch,
    providers: mergeProviders(current.ai.providers, patch.providers),
  };
  writeToStorage({ theme: current.theme, ai: normalizeAI(merged) });
}

function mergeProviders(
  base: AISettings['providers'],
  patch?: AISettings['providers']
): AISettings['providers'] {
  return {
    ...(base || {}),
    ...(patch || {}),
    anthropic: { ...(base?.anthropic || {}), ...(patch?.anthropic || {}) },
    openai: { ...(base?.openai || {}), ...(patch?.openai || {}) },
    lmstudio: { ...(base?.lmstudio || {}), ...(patch?.lmstudio || {}) },
  };
}

function normalizeSettings(settings: StoredSettings): StoredSettings {
  return {
    theme: settings.theme || 'system',
    ai: normalizeAI(settings.ai || {}),
  };
}

function normalizeAI(ai: AISettings): AISettings {
  const normalized: AISettings = {
    ...ai,
    providers: ai.providers ? mergeProviders({}, ai.providers) : {},
  };
  return normalized;
}
