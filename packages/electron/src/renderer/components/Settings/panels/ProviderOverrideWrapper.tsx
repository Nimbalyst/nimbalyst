/**
 * Provider Override Wrapper
 *
 * Wraps provider settings panels to enable per-workspace overrides.
 * Uses Jotai atom family for workspace-scoped state.
 */

import React, { ReactNode, useEffect, useMemo } from 'react';
import { useAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import {
  workspaceAISettingsAtomFamily,
  loadWorkspaceAISettings,
  saveWorkspaceAISettings,
  type AIProviderOverrides,
} from '../../../store/atoms/appSettings';
import './ProviderOverrideWrapper.css';

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
  // Get the atom for this workspace
  const settingsAtom = useMemo(
    () => workspaceAISettingsAtomFamily(workspacePath),
    [workspacePath]
  );
  const [settings, setSettings] = useAtom(settingsAtom);

  // Load settings on mount or workspace change
  useEffect(() => {
    let mounted = true;
    loadWorkspaceAISettings(workspacePath).then((state) => {
      if (mounted) {
        setSettings(state);
      }
    });
    return () => {
      mounted = false;
    };
  }, [workspacePath, setSettings]);

  const { overrides, loading } = settings;
  const isOverriding = overrides.providers?.[providerId] !== undefined;

  const handleOverrideToggle = async (override: boolean) => {
    const newOverrides: AIProviderOverrides = { ...overrides };
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

    // Update atom state
    setSettings({ ...settings, overrides: newOverrides });

    // Persist to IPC
    try {
      await saveWorkspaceAISettings(workspacePath, newOverrides);
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
