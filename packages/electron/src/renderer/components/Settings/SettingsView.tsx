import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { usePostHog } from 'posthog-js/react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { SettingsSidebar, type SettingsCategory } from './SettingsSidebar';
import './SettingsView.css';

// Import provider panels from GlobalSettings
import { ClaudePanel } from '../GlobalSettings/panels/ClaudePanel';
import { ClaudeCodePanel } from '../GlobalSettings/panels/ClaudeCodePanel';
import { OpenAIPanel } from '../GlobalSettings/panels/OpenAIPanel';
import { OpenAICodexPanel } from '../GlobalSettings/panels/OpenAICodexPanel';
import { LMStudioPanel } from '../GlobalSettings/panels/LMStudioPanel';
import { AdvancedPanel } from '../GlobalSettings/panels/AdvancedPanel';
import { NotificationsPanel } from '../GlobalSettings/panels/NotificationsPanel';
import { VoiceModePanel } from './VoiceModePanel';
import { MCPServersPanel } from '../GlobalSettings/panels/MCPServersPanel';
import { ClaudeCodePluginsPanel } from '../GlobalSettings/panels/ClaudeCodePluginsPanel';
import { SyncPanel } from '../GlobalSettings/panels/SyncPanel';
import { ToolPackagesPanel } from './panels/ToolPackagesPanel';
import { ProjectPermissionsPanel } from './panels/ProjectPermissionsPanel';
import { ProviderOverrideWrapper } from './panels/ProviderOverrideWrapper';
import { InstalledExtensionsPanel } from './panels/InstalledExtensionsPanel';
import { walkthroughs } from '../../walkthroughs';
import {
  aiProviderSettingsAtom,
  setAIProviderSettingsAtom,
  setProviderConfigAtom,
  setApiKeyAtom,
  setAvailableModelsAtom,
  releaseChannelAtom,
  type ProviderConfig,
  type AIModel,
} from '../../store/atoms/appSettings';

// Re-export ProviderConfig for backward compatibility
export type { ProviderConfig } from '../../store/atoms/appSettings';

// Keep Model interface here since it may differ slightly from AIModel
export interface Model {
  id: string;
  name: string;
  provider: string;
}

// Note: The ProviderConfig interface has been moved to appSettings.ts

export type SettingsScope = 'user' | 'project';

interface SettingsViewProps {
  workspacePath?: string | null;
  workspaceName?: string | null;
  onClose: () => void;
  initialCategory?: SettingsCategory;
  initialScope?: SettingsScope;
}

export function SettingsView({ workspacePath, workspaceName, onClose, initialCategory, initialScope }: SettingsViewProps) {
  const posthog = usePostHog();

  const [selectedCategory, setSelectedCategory] = useState<SettingsCategory>(initialCategory || 'claude-code');
  const [scope, setScope] = useState<SettingsScope>(initialScope || 'user');

  // AI Provider settings - using Jotai atoms (Phase 5b)
  const [aiProviderSettings] = useAtom(aiProviderSettingsAtom);
  const [, updateAIProviderSettings] = useAtom(setAIProviderSettingsAtom);
  const [, updateProviderConfig] = useAtom(setProviderConfigAtom);
  const [, updateApiKey] = useAtom(setApiKeyAtom);
  const [, updateAvailableModels] = useAtom(setAvailableModelsAtom);

  // Release channel from atom (Phase 3)
  const releaseChannel = useAtomValue(releaseChannelAtom);

  // Destructure for easier access (these update when atom updates)
  const { providers, apiKeys, availableModels } = aiProviderSettings;

  // Local setters that wrap atom updates for backward compatibility
  const setProviders = useCallback((updater: Record<string, ProviderConfig> | ((prev: Record<string, ProviderConfig>) => Record<string, ProviderConfig>)) => {
    if (typeof updater === 'function') {
      const newProviders = updater(providers);
      updateAIProviderSettings({ providers: newProviders });
    } else {
      updateAIProviderSettings({ providers: updater });
    }
  }, [providers, updateAIProviderSettings]);

  const setApiKeys = useCallback((updater: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => {
    if (typeof updater === 'function') {
      const newApiKeys = updater(apiKeys);
      updateAIProviderSettings({ apiKeys: newApiKeys });
    } else {
      updateAIProviderSettings({ apiKeys: updater });
    }
  }, [apiKeys, updateAIProviderSettings]);

  const setAvailableModels = useCallback((updater: Record<string, Model[]> | ((prev: Record<string, Model[]>) => Record<string, Model[]>)) => {
    if (typeof updater === 'function') {
      const newModels = updater(availableModels);
      updateAIProviderSettings({ availableModels: newModels });
    } else {
      updateAIProviderSettings({ availableModels: updater });
    }
  }, [availableModels, updateAIProviderSettings]);

  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Ref to track if we need to save (for debounce)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSaveRef = useRef(false);
  const performSaveRef = useRef<() => Promise<void>>();
  // NOTE: Notification settings (Phase 2), Advanced settings (Phase 3), Sync settings (Phase 4),
  // AI debug settings (Phase 5), AI provider settings (Phase 5b), and Voice mode settings (Phase 7)
  // have been moved to Jotai atoms in appSettings.ts
  // Panels now subscribe directly to atoms - settings are auto-persisted via atom setters

  // Package counts for sidebar badge
  const [installedPackageCount, setInstalledPackageCount] = useState(0);
  const [totalPackageCount, setTotalPackageCount] = useState(0);

  // Valid categories for each scope
  const projectCategories: SettingsCategory[] = ['tool-packages', 'agent-permissions', 'installed-extensions', 'claude-plugins', 'mcp-servers', 'claude-code', 'claude', 'openai', 'openai-codex', 'lmstudio'];
  const userCategories: SettingsCategory[] = ['claude-code', 'claude', 'openai', 'openai-codex', 'lmstudio', 'sync', 'notifications', 'voice-mode', 'advanced', 'installed-extensions', 'claude-plugins', 'mcp-servers'];

  // When initialCategory/initialScope props change, update state (for deep linking)
  useEffect(() => {
    if (initialCategory) {
      setSelectedCategory(initialCategory);
    }
    if (initialScope) {
      setScope(initialScope);
    }
  }, [initialCategory, initialScope]);

  // When scope changes, ensure selected category is valid for that scope
  useEffect(() => {
    const validCategories = scope === 'project' ? projectCategories : userCategories;
    if (!validCategories.includes(selectedCategory)) {
      // Default to first valid category for the scope
      setSelectedCategory(scope === 'project' ? 'tool-packages' : 'claude-code');
    }
  }, [scope]);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    // NOTE: Most settings are now loaded via Jotai atoms initialized in index.tsx:
    // - AI provider settings (providers, apiKeys) - Phase 5b
    // - AI debug settings (showToolCalls, aiDebugLogging) - Phase 5
    // - Notification settings - Phase 2
    // - Advanced settings (including release channel) - Phase 3
    // - Sync config - Phase 4
    // - Voice mode settings - Phase 7

    // Set default category for alpha users (using atom value)
    if (releaseChannel === 'alpha' && !initialCategory) {
      setSelectedCategory('sync');
    }

    // Fetch available models - cached in atom but not persisted
    try {
      const response = await window.electronAPI.aiGetAllModels();
      if (response.success && response.grouped) {
        setAvailableModels(response.grouped);
      }
    } catch (error) {
      console.error('Failed to fetch initial models:', error);
    }
  };

  const handleProviderToggle = async (provider: string, enabled: boolean) => {
    if (enabled && (provider === 'claude-code' || provider === 'openai-codex')) {
      await fetchModels(provider);
    }

    setProviders(prev => {
      let models = prev[provider]?.models || [];

      if (enabled && (provider === 'claude-code' || provider === 'openai-codex')) {
        const providerModels = availableModels[provider] || [];
        if (providerModels.length > 0 && models.length === 0) {
          models = [providerModels[0].id];
        }
      }

      posthog?.capture('ai_provider_configured', {
        provider,
        modelCount: models.length,
        action: enabled ? 'enabled' : 'disabled'
      });

      return {
        ...prev,
        [provider]: {
          ...prev[provider],
          enabled,
          models
        }
      };
    });
    debouncedSave();

    if (enabled && provider !== 'claude-code' && provider !== 'openai-codex') {
      fetchModels(provider);
    }
  };

  const handleApiKeyChange = (key: string, value: string) => {
    setApiKeys(prev => ({ ...prev, [key]: value }));
    debouncedSave();
  };

  const fetchModels = async (provider: string) => {
    setLoading(prev => ({ ...prev, [provider]: true }));

    try {
      const response = await window.electronAPI.aiGetAllModels();
      if (response.success && response.grouped) {
        setAvailableModels(response.grouped);
      }
    } catch (error) {
      console.error(`Failed to fetch models for ${provider}:`, error);
    } finally {
      setLoading(prev => ({ ...prev, [provider]: false }));
    }
  };

  // Perform the actual save
  // NOTE: Most settings are now auto-saved via Jotai atom setters.
  // This function now primarily handles model cache clearing and feedback.
  const performSave = useCallback(async () => {
    if (!pendingSaveRef.current) return;
    pendingSaveRef.current = false;

    try {
      setSaveStatus('saving');

      // NOTE: AI provider settings (providers, apiKeys) are saved automatically via Jotai atoms (Phase 5b)
      // Notification settings (Phase 2), Advanced settings (Phase 3), Sync settings (Phase 4),
      // AI debug settings (Phase 5), and Voice mode settings are all saved via atom setters

      // Clear the model cache to force refresh with new API keys
      await window.electronAPI.aiClearModelCache?.();

      setSaveStatus('saved');

      // Reset status after a delay
      setTimeout(() => setSaveStatus('idle'), 2000);

      // Refresh models for all enabled providers in the background
      Promise.all(
        Object.entries(providers)
          .filter(([_, config]) => config.enabled)
          .map(([provider, _]) => fetchModels(provider))
      ).catch(error => {
        console.error('Failed to refresh models in background:', error);
      });
    } catch (error) {
      console.error('Failed to save settings:', error);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }, [providers]);

  // Keep the ref in sync with performSave so debounced calls use the latest version
  performSaveRef.current = performSave;

  // Debounced save - call this when settings change
  // Uses a ref to avoid stale closure issues with the timeout
  const debouncedSave = useCallback(() => {
    pendingSaveRef.current = true;

    // Clear any existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set new timeout - 500ms debounce
    // Use ref to always call the latest performSave
    saveTimeoutRef.current = setTimeout(() => {
      performSaveRef.current?.();
    }, 500);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        // Save immediately on unmount if there are pending changes
        if (pendingSaveRef.current) {
          performSaveRef.current?.();
        }
      }
    };
  }, []);

  // Build provider status for sidebar
  const providerStatus = Object.fromEntries(
    Object.entries(providers).map(([id, config]) => [
      id,
      { enabled: config.enabled, testStatus: config.testStatus }
    ])
  );

  const renderPanel = () => {
    // Project panels
    if (selectedCategory === 'tool-packages' && workspacePath) {
      return (
        <ToolPackagesPanel
          workspacePath={workspacePath}
          workspaceName={workspaceName || 'Project'}
          onPackagesChange={(installed, total) => {
            setInstalledPackageCount(installed);
            setTotalPackageCount(total);
          }}
        />
      );
    }

    if (selectedCategory === 'agent-permissions' && workspacePath) {
      return (
        <ProjectPermissionsPanel
          workspacePath={workspacePath}
          workspaceName={workspaceName || 'Project'}
        />
      );
    }

    // Provider panels
    const commonProps = {
      config: providers[selectedCategory] || { enabled: false, testStatus: 'idle' },
      apiKeys,
      availableModels: availableModels[selectedCategory] || [],
      loading: loading[selectedCategory] || false,
      onToggle: (enabled: boolean) => handleProviderToggle(selectedCategory, enabled),
      onApiKeyChange: handleApiKeyChange,
      onModelToggle: (modelId: string, enabled: boolean) => {
        setProviders(prev => {
          const models = prev[selectedCategory]?.models || [];
          const updated = enabled
            ? [...models, modelId]
            : models.filter(m => m !== modelId);

          if (enabled) {
            const modelName = modelId.includes(':') ? modelId.split(':')[1] : modelId;
            posthog?.capture('ai_model_selected', {
              provider: selectedCategory,
              modelName
            });
          }

          return {
            ...prev,
            [selectedCategory]: { ...prev[selectedCategory], models: updated }
          };
        });
        debouncedSave();
      },
      onSelectAllModels: (selectAll: boolean) => {
        if (selectAll) {
          const models = availableModels[selectedCategory] || [];
          setProviders(prev => ({
            ...prev,
            [selectedCategory]: { ...prev[selectedCategory], models: models.map(m => m.id) }
          }));
        } else {
          setProviders(prev => ({
            ...prev,
            [selectedCategory]: { ...prev[selectedCategory], models: [] }
          }));
        }
        debouncedSave();
      },
      onTestConnection: async () => {
        setProviders(prev => ({
          ...prev,
          [selectedCategory]: { ...prev[selectedCategory], testStatus: 'testing', testMessage: undefined }
        }));

        const settings = {
          apiKeys,
          providerSettings: providers
        };
        await window.electronAPI.aiSaveSettings(settings);

        try {
          const result = await window.electronAPI.aiTestConnection(selectedCategory);

          setProviders(prev => ({
            ...prev,
            [selectedCategory]: {
              ...prev[selectedCategory],
              testStatus: result.success ? 'success' : 'error',
              testMessage: result.success ? 'Connected' : result.error
            }
          }));

          if (result.success) {
            await window.electronAPI.aiClearModelCache?.();
            await fetchModels(selectedCategory);
          }
        } catch (error) {
          setProviders(prev => ({
            ...prev,
            [selectedCategory]: {
              ...prev[selectedCategory],
              testStatus: 'error',
              testMessage: 'Connection failed'
            }
          }));
        }
      },
      onConfigChange: (updates: Partial<ProviderConfig>) => {
        setProviders(prev => ({
          ...prev,
          [selectedCategory]: { ...prev[selectedCategory], ...updates }
        }));
        debouncedSave();
      }
    };

    // Helper to wrap provider panels with override wrapper when in project scope
    const wrapWithOverride = (providerId: string, providerName: string, panel: React.ReactNode) => {
      if (scope === 'project' && workspacePath) {
        return (
          <ProviderOverrideWrapper
            providerId={providerId}
            providerName={providerName}
            workspacePath={workspacePath}
            workspaceName={workspaceName || 'Project'}
            globalEnabled={providers[providerId]?.enabled ?? false}
            onOverrideChange={() => loadSettings()}
          >
            {panel}
          </ProviderOverrideWrapper>
        );
      }
      return panel;
    };

    switch (selectedCategory) {
      case 'claude':
        return wrapWithOverride('claude', 'Claude', <ClaudePanel {...commonProps} />);
      case 'claude-code':
        return wrapWithOverride('claude-code', 'Claude Agent', <ClaudeCodePanel {...commonProps} />);
      case 'openai':
        return wrapWithOverride('openai', 'OpenAI', <OpenAIPanel {...commonProps} />);
      case 'openai-codex':
        return wrapWithOverride('openai-codex', 'OpenAI Codex', <OpenAICodexPanel {...commonProps} />);
      case 'lmstudio':
        return wrapWithOverride('lmstudio', 'LM Studio', <LMStudioPanel {...commonProps} />);
      case 'advanced':
        // AdvancedPanel is now self-contained - uses Jotai atoms directly
        return <AdvancedPanel />;
      case 'notifications':
        // NotificationsPanel is now self-contained - uses Jotai atoms directly
        return <NotificationsPanel />;
      case 'voice-mode':
        // VoiceModePanel is now self-contained - uses Jotai atoms directly
        return <VoiceModePanel workspacePath={workspacePath ?? undefined} />;
      case 'installed-extensions':
        return (
          <InstalledExtensionsPanel
            scope={scope}
            workspacePath={workspacePath ?? undefined}
          />
        );
      case 'mcp-servers':
        return (
          <MCPServersPanel
            scope={scope === 'project' ? 'workspace' : 'user'}
            workspacePath={scope === 'project' ? workspacePath ?? undefined : undefined}
          />
        );
      case 'claude-plugins':
        return (
          <ClaudeCodePluginsPanel
            scope={scope === 'project' ? 'workspace' : 'user'}
            workspacePath={scope === 'project' ? workspacePath ?? undefined : undefined}
          />
        );
      case 'sync':
        return <SyncPanel />;
      default:
        return null;
    }
  };

  // Categories that are only available in project scope
  const projectOnlyCategories: SettingsCategory[] = ['tool-packages', 'agent-permissions'];

  // Handle scope changes - preserve selected category when possible
  const handleScopeChange = (newScope: SettingsScope) => {
    setScope(newScope);
    // Only change category if current one is not available in the new scope
    if (newScope === 'user' && projectOnlyCategories.includes(selectedCategory)) {
      // Switching to user scope from a project-only category
      setSelectedCategory('claude-code');
    }
    // When switching to project scope, keep the current category (all user categories are available in project scope)
  };

  return (
    <div className="settings-view">
      {/* Settings Header */}
      <header className="settings-view-header">
        <span className="settings-view-title">Settings</span>



        <div className="settings-scope-container">
          <div className="settings-scope-tabs">
            <button
              className={`settings-scope-tab ${scope === 'user' ? 'active' : ''}`}
              onClick={() => handleScopeChange('user')}
            >
              User
            </button>
            <button
              className={`settings-scope-tab ${scope === 'project' ? 'active' : ''}`}
              onClick={() => handleScopeChange('project')}
              disabled={!workspacePath}
              title={!workspacePath ? 'Open a project to access project settings' : undefined}
            >
              Project
            </button>
          </div>
          <span className="settings-scope-hint">
            {scope === 'user'
              ? 'These settings apply to all projects'
              : `These settings apply only for ${workspaceName || 'this project'}`}
          </span>
        </div>


        <span className={`settings-save-status ${saveStatus}`}>
          {saveStatus === 'saving' && 'Saving...'}
          {saveStatus === 'saved' && 'Saved'}
          {saveStatus === 'error' && 'Error saving'}
        </span>
      </header>

      <div className="settings-view-body">
        <SettingsSidebar
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          providerStatus={providerStatus}
          installedPackageCount={installedPackageCount}
          totalPackageCount={totalPackageCount}
          scope={scope}
          // releaseChannel now comes from Jotai atom in SettingsSidebar
        />

        <main className="settings-view-main">
          {renderPanel()}
        </main>
      </div>
    </div>
  );
}
