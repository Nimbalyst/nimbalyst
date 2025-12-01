import React, { useState, useEffect, ReactNode } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import './ProviderOverrideWrapper.css';

interface ProviderOverride {
  enabled?: boolean;
  models?: string[];
  defaultModel?: string;
  apiKey?: string;
}

interface AIProviderOverrides {
  defaultProvider?: string;
  providers?: Record<string, ProviderOverride>;
}

interface ProviderOverrideWrapperProps {
  providerId: string;
  providerName: string;
  workspacePath: string;
  workspaceName: string;
  globalEnabled: boolean;
  children: ReactNode;
  /** Callback when override state changes - parent should reload/update */
  onOverrideChange?: () => void;
}

export function ProviderOverrideWrapper({
  providerId,
  providerName,
  workspacePath,
  workspaceName,
  globalEnabled,
  children,
  onOverrideChange,
}: ProviderOverrideWrapperProps) {
  const [projectOverrides, setProjectOverrides] = useState<AIProviderOverrides>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProjectOverrides();
  }, [workspacePath]);

  const loadProjectOverrides = async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.invoke('ai:getProjectSettings', workspacePath);
      if (result.success && result.overrides) {
        setProjectOverrides(result.overrides);
      } else {
        setProjectOverrides({});
      }
    } catch (error) {
      console.error('Failed to load project overrides:', error);
    } finally {
      setLoading(false);
    }
  };

  const isOverriding = projectOverrides.providers?.[providerId] !== undefined;

  const handleOverrideToggle = async (override: boolean) => {
    const newOverrides = { ...projectOverrides };
    if (!newOverrides.providers) {
      newOverrides.providers = {};
    }

    if (override) {
      // Initialize override - copy global enabled state
      newOverrides.providers[providerId] = {
        enabled: globalEnabled,
      };
    } else {
      // Remove override
      delete newOverrides.providers[providerId];
      if (Object.keys(newOverrides.providers).length === 0) {
        delete newOverrides.providers;
      }
    }

    setProjectOverrides(newOverrides);

    try {
      await window.electronAPI.invoke('ai:saveProjectSettings', workspacePath, newOverrides);
      onOverrideChange?.();
    } catch (error) {
      console.error('Failed to save project overrides:', error);
    }
  };

  if (loading) {
    return <div className="provider-override-wrapper loading">Loading...</div>;
  }

  return (
    <div className="provider-override-wrapper">
      {/* Override Banner */}
      <div className={`override-banner ${isOverriding ? 'active' : ''}`}>
        <div className="override-info">
          <div className="override-status">
            {isOverriding ? (
              <>
                <MaterialSymbol icon="tune" size={16} />
                <span>Project override active for <strong>{workspaceName}</strong></span>
              </>
            ) : (
              <>
                <MaterialSymbol icon="info" size={16} />
                <span>Using global {providerName} settings</span>
              </>
            )}
          </div>
        </div>
        <label className="override-toggle">
          <input
            type="checkbox"
            checked={isOverriding}
            onChange={(e) => handleOverrideToggle(e.target.checked)}
          />
          <span className="toggle-slider"></span>
          <span className="toggle-label">
            {isOverriding ? 'Override' : 'Override'}
          </span>
        </label>
      </div>

      {/* Provider Panel Content */}
      <div className={`override-content ${isOverriding ? 'overriding' : ''}`}>
        {children}
      </div>

      {!isOverriding && (
        <div className="override-hint">
          Enable override to customize {providerName} settings for this project only.
          Changes will not affect your global settings.
        </div>
      )}
    </div>
  );
}
