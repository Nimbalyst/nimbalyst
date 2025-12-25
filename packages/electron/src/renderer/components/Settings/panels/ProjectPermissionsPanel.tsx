import React, { useState, useEffect, useCallback } from 'react';
import { usePostHog } from 'posthog-js/react';

interface PatternRule {
  pattern: string;
  displayName: string;
  addedAt: number;
}

interface AdditionalDirectory {
  path: string;
  addedAt: number;
}

interface AllowedUrlPattern {
  pattern: string;
  description: string;
  addedAt: number;
}

type PermissionMode = 'ask' | 'allow-all' | 'bypass-all';

interface PermissionsState {
  trustedAt?: number;
  permissionMode: PermissionMode | null;
  allowedPatterns: PatternRule[];
  additionalDirectories: AdditionalDirectory[];
  allowedUrlPatterns: AllowedUrlPattern[];
}

interface ProjectPermissionsPanelProps {
  workspacePath: string;
  workspaceName: string;
}

export const ProjectPermissionsPanel: React.FC<ProjectPermissionsPanelProps> = ({
  workspacePath,
  workspaceName,
}) => {
  const posthog = usePostHog();
  const [permissions, setPermissions] = useState<PermissionsState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isAddingDirectory, setIsAddingDirectory] = useState(false);
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [newUrlPattern, setNewUrlPattern] = useState('');
  const [newUrlDescription, setNewUrlDescription] = useState('');

  // Load permissions on mount
  const loadPermissions = useCallback(async () => {
    if (!workspacePath) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.invoke('permissions:getWorkspacePermissions', workspacePath);
      setPermissions(result);
    } catch (err) {
      console.error('Failed to load permissions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load permissions');
    } finally {
      setIsLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  // Track screen open
  useEffect(() => {
    if (permissions) {
      posthog?.capture('agent_permissions_opened', {
        isTrusted: permissions.permissionMode !== null,
        permissionMode: permissions.permissionMode,
        allowedPatternsCount: permissions.allowedPatterns.length,
        additionalDirectoriesCount: permissions.additionalDirectories.length,
      });
    }
  }, [permissions, posthog]);

  const handleTrustWorkspace = async () => {
    try {
      await window.electronAPI.invoke('permissions:trustWorkspace', workspacePath);
      await loadPermissions();
      setSuccess('Workspace trusted for agent operations');
      posthog?.capture('workspace_trusted', { workspacePath: 'redacted' });
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to trust workspace:', err);
      setError(err instanceof Error ? err.message : 'Failed to trust workspace');
    }
  };

  const handleRevokeWorkspaceTrust = async () => {
    try {
      await window.electronAPI.invoke('permissions:revokeWorkspaceTrust', workspacePath);
      await loadPermissions();
      setSuccess('Workspace trust revoked');
      posthog?.capture('workspace_trust_revoked', { workspacePath: 'redacted' });
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to revoke workspace trust:', err);
      setError(err instanceof Error ? err.message : 'Failed to revoke workspace trust');
    }
  };

  const handlePermissionModeChange = async (mode: PermissionMode) => {
    try {
      await window.electronAPI.invoke('permissions:setPermissionMode', workspacePath, mode);
      await loadPermissions();
      posthog?.capture('permission_mode_changed', { mode });
    } catch (err) {
      console.error('Failed to set permission mode:', err);
      setError(err instanceof Error ? err.message : 'Failed to set permission mode');
    }
  };

  const handleRemovePattern = async (pattern: string, type: 'allowed' | 'denied') => {
    try {
      await window.electronAPI.invoke('permissions:removePattern', workspacePath, pattern);
      await loadPermissions();
      setSuccess(`Pattern removed`);
      posthog?.capture('permission_pattern_removed', { type });
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to remove pattern:', err);
      setError(err instanceof Error ? err.message : 'Failed to remove pattern');
    }
  };

  const handleResetToDefaults = async () => {
    try {
      await window.electronAPI.invoke('permissions:resetToDefaults', workspacePath);
      await loadPermissions();
      setSuccess('Permissions reset to defaults');
      posthog?.capture('permission_patterns_reset');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to reset permissions:', err);
      setError(err instanceof Error ? err.message : 'Failed to reset permissions');
    }
  };

  const handleAddDirectory = async () => {
    setIsAddingDirectory(true);
    try {
      // Use Electron's dialog to select a directory
      const result = await window.electronAPI.invoke('dialog:openDirectory', {
        title: 'Select Additional Directory',
        buttonLabel: 'Add Directory',
      });

      if (result && result.filePaths && result.filePaths.length > 0) {
        const dirPath = result.filePaths[0];
        await window.electronAPI.invoke('permissions:addAdditionalDirectory', workspacePath, dirPath, false);
        await loadPermissions();
        setSuccess('Directory added');
        posthog?.capture('additional_directory_added');
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err) {
      console.error('Failed to add directory:', err);
      setError(err instanceof Error ? err.message : 'Failed to add directory');
    } finally {
      setIsAddingDirectory(false);
    }
  };

  const handleRemoveDirectory = async (dirPath: string) => {
    try {
      await window.electronAPI.invoke('permissions:removeAdditionalDirectory', workspacePath, dirPath);
      await loadPermissions();
      setSuccess('Directory removed');
      posthog?.capture('additional_directory_removed');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to remove directory:', err);
      setError(err instanceof Error ? err.message : 'Failed to remove directory');
    }
  };

  const handleAddUrlPattern = async () => {
    if (!newUrlPattern.trim()) return;

    try {
      await window.electronAPI.invoke(
        'permissions:addAllowedUrlPattern',
        workspacePath,
        newUrlPattern.trim(),
        newUrlDescription.trim()
      );
      await loadPermissions();
      setNewUrlPattern('');
      setNewUrlDescription('');
      setIsAddingUrl(false);
      setSuccess('URL pattern added');
      posthog?.capture('url_pattern_added');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to add URL pattern:', err);
      setError(err instanceof Error ? err.message : 'Failed to add URL pattern');
    }
  };

  const handleRemoveUrlPattern = async (pattern: string) => {
    try {
      await window.electronAPI.invoke('permissions:removeAllowedUrlPattern', workspacePath, pattern);
      await loadPermissions();
      setSuccess('URL pattern removed');
      posthog?.capture('url_pattern_removed');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to remove URL pattern:', err);
      setError(err instanceof Error ? err.message : 'Failed to remove URL pattern');
    }
  };

  if (!workspacePath) {
    return (
      <div className="settings-panel-content">
        <div className="settings-panel-empty">
          <p>Open a workspace to configure agent permissions.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="settings-panel-content">
        <div className="settings-panel-loading">Loading permissions...</div>
      </div>
    );
  }

  return (
    <div className="settings-panel-content">
      <div className="settings-panel-header">
        <h2>Agent Permissions</h2>
        <p>
          Manage which commands the AI agent can run in this project.
          Approved patterns are saved to <code>.claude/settings.local.json</code> and shared with Claude Code CLI.
        </p>
      </div>

      {error && (
        <div className="settings-message error">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="settings-message success">
          <span className="material-symbols-outlined">check_circle</span>
          <span>{success}</span>
        </div>
      )}

      {/* Workspace Trust Section */}
      <div className="permissions-section">
        <div className="permissions-section-header">
          <span>Workspace Trust</span>
        </div>
        <div className="permissions-trust-card">
          <div className="permissions-trust-info">
            <div className="permissions-trust-status">
              {permissions?.permissionMode !== null ? (
                <>
                  <span className="material-symbols-outlined permissions-trust-icon trusted">verified</span>
                  <span className="permissions-trust-label">This workspace is trusted</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined permissions-trust-icon untrusted">gpp_maybe</span>
                  <span className="permissions-trust-label">This workspace is not trusted</span>
                </>
              )}
            </div>
            <p className="permissions-trust-description">
              {permissions?.permissionMode !== null
                ? 'The AI agent can run commands in this workspace.'
                : 'Trust this workspace to allow the AI agent to run commands.'}
            </p>
            {permissions?.trustedAt && (
              <p className="permissions-trust-date">
                Trusted on {new Date(permissions.trustedAt).toLocaleDateString()}
              </p>
            )}
          </div>
          <div className="permissions-trust-action">
            {permissions?.permissionMode !== null ? (
              <button
                className="btn-secondary"
                onClick={handleRevokeWorkspaceTrust}
              >
                Revoke Trust
              </button>
            ) : (
              <button
                className="btn-primary"
                onClick={handleTrustWorkspace}
              >
                Trust Workspace
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Permission Mode Section - Only show when trusted */}
      {permissions?.permissionMode !== null && (
        <div className="permissions-section">
          <div className="permissions-section-header">
            <span>Permission Mode</span>
          </div>
          <div className="permissions-mode-options">
            <label className={`permissions-mode-option ${permissions.permissionMode === 'ask' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="permissionMode"
                value="ask"
                checked={permissions.permissionMode === 'ask'}
                onChange={() => handlePermissionModeChange('ask')}
              />
              <div className="permissions-mode-option-content">
                <span className="material-symbols-outlined">verified_user</span>
                <div className="permissions-mode-option-text">
                  <span className="permissions-mode-option-title">Ask</span>
                  <span className="permissions-mode-option-description">
                    Agent asks before running commands. Approvals saved to .claude/settings.local.json.
                  </span>
                </div>
              </div>
            </label>
            <label className={`permissions-mode-option ${permissions.permissionMode === 'allow-all' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="permissionMode"
                value="allow-all"
                checked={permissions.permissionMode === 'allow-all'}
                onChange={() => handlePermissionModeChange('allow-all')}
              />
              <div className="permissions-mode-option-content">
                <span className="material-symbols-outlined">check_circle</span>
                <div className="permissions-mode-option-text">
                  <span className="permissions-mode-option-title">Allow All Edits</span>
                  <span className="permissions-mode-option-description">
                    File operations auto-approved. Bash and web requests follow Claude Code settings.
                  </span>
                </div>
              </div>
            </label>
            <label className={`permissions-mode-option dangerous ${permissions.permissionMode === 'bypass-all' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="permissionMode"
                value="bypass-all"
                checked={permissions.permissionMode === 'bypass-all'}
                onChange={() => handlePermissionModeChange('bypass-all')}
              />
              <div className="permissions-mode-option-content">
                <span className="material-symbols-outlined">warning</span>
                <div className="permissions-mode-option-text">
                  <span className="permissions-mode-option-title">Bypass All Checks</span>
                  <span className="permissions-mode-option-description">
                    All operations auto-approved without any prompts. Use at your own risk.
                  </span>
                </div>
              </div>
            </label>
          </div>
        </div>
      )}

      {/* Additional Directories Section - Only show when trusted */}
      {permissions?.permissionMode !== null && (
        <div className="permissions-section">
          <div className="permissions-section-header">
            <span>Additional Directories</span>
            <span className="permissions-section-count">{permissions?.additionalDirectories.length || 0}</span>
          </div>
          <p className="permissions-section-description">
            Allow the agent to access directories outside this project.
          </p>
          {permissions?.additionalDirectories.length === 0 ? (
            <div className="permissions-empty-state">
              No additional directories. The agent can only access files within this project.
            </div>
          ) : (
            <div className="permissions-directory-list">
              {permissions?.additionalDirectories.map((dir) => (
                <div key={dir.path} className="permissions-directory-item">
                  <div className="permissions-directory-path">
                    <span className="material-symbols-outlined">folder</span>
                    <span className="permissions-directory-path-text" title={dir.path}>{dir.path}</span>
                  </div>
                  <button
                    className="permissions-directory-remove"
                    onClick={() => handleRemoveDirectory(dir.path)}
                    title="Remove directory"
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M2 4h12M6 4V2.5A1.5 1.5 0 017.5 1h1A1.5 1.5 0 0110 2.5V4M5 7v5M8 7v5M11 7v5M3 4v9.5A1.5 1.5 0 004.5 15h7a1.5 1.5 0 001.5-1.5V4"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            className="btn-secondary permissions-add-directory-btn"
            onClick={handleAddDirectory}
            disabled={isAddingDirectory}
          >
            <span className="material-symbols-outlined">add</span>
            Add Directory
          </button>
        </div>
      )}

      {/* Allowed URL Patterns Section - Only show when trusted */}
      {permissions?.permissionMode !== null && (
        <div className="permissions-section">
          <div className="permissions-section-header">
            <span>Allowed URL Patterns</span>
            <span className="permissions-section-count">{permissions?.allowedUrlPatterns?.length || 0}</span>
          </div>
          <p className="permissions-section-description">
            Allow the agent to fetch or curl specific domains.
            Use wildcards like <code>*.github.com</code> or <code>https://api.example.com/*</code>
          </p>
          {(permissions?.allowedUrlPatterns?.length || 0) === 0 && !isAddingUrl ? (
            <div className="permissions-empty-state">
              No URL patterns allowed yet. The agent will ask before making web requests.
            </div>
          ) : (
            <div className="permissions-url-list">
              {permissions?.allowedUrlPatterns?.map((urlPattern) => (
                <div key={urlPattern.pattern} className="permissions-url-item">
                  <div className="permissions-url-info">
                    <span className="permissions-url-pattern">{urlPattern.pattern}</span>
                    {urlPattern.description && (
                      <span className="permissions-url-description">{urlPattern.description}</span>
                    )}
                  </div>
                  <button
                    className="permissions-url-remove"
                    onClick={() => handleRemoveUrlPattern(urlPattern.pattern)}
                    title="Remove URL pattern"
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M2 4h12M6 4V2.5A1.5 1.5 0 017.5 1h1A1.5 1.5 0 0110 2.5V4M5 7v5M8 7v5M11 7v5M3 4v9.5A1.5 1.5 0 004.5 15h7a1.5 1.5 0 001.5-1.5V4"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          {isAddingUrl ? (
            <div className="permissions-add-url-form">
              <input
                type="text"
                className="permissions-url-input"
                placeholder="URL pattern (e.g., *.github.com)"
                value={newUrlPattern}
                onChange={(e) => setNewUrlPattern(e.target.value)}
                autoFocus
              />
              <input
                type="text"
                className="permissions-url-input"
                placeholder="Description (optional)"
                value={newUrlDescription}
                onChange={(e) => setNewUrlDescription(e.target.value)}
              />
              <div className="permissions-add-url-actions">
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setIsAddingUrl(false);
                    setNewUrlPattern('');
                    setNewUrlDescription('');
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  onClick={handleAddUrlPattern}
                  disabled={!newUrlPattern.trim()}
                >
                  Add
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn-secondary permissions-add-url-btn"
              onClick={() => setIsAddingUrl(true)}
            >
              <span className="material-symbols-outlined">add</span>
              Add URL Pattern
            </button>
          )}
        </div>
      )}

      {/* Allowed Patterns Section - Only show when trusted */}
      {permissions?.permissionMode !== null && (
        <div className="permissions-section">
          <div className="permissions-section-header">
            <span>Allowed Patterns</span>
            <span className="permissions-section-count">{permissions?.allowedPatterns.length || 0}</span>
          </div>
          {permissions?.allowedPatterns.length === 0 ? (
            <div className="permissions-empty-state">
              No patterns allowed yet. When you approve a command, its pattern will appear here.
            </div>
          ) : (
            <div className="permissions-pattern-list">
              {permissions?.allowedPatterns.map((rule) => (
                <div key={rule.pattern} className="permissions-pattern-item">
                  <span className="permissions-pattern-name">{rule.displayName}</span>
                  <button
                    className="permissions-pattern-remove"
                    onClick={() => handleRemovePattern(rule.pattern, 'allowed')}
                    title="Remove pattern"
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M2 4h12M6 4V2.5A1.5 1.5 0 017.5 1h1A1.5 1.5 0 0110 2.5V4M5 7v5M8 7v5M11 7v5M3 4v9.5A1.5 1.5 0 004.5 15h7a1.5 1.5 0 001.5-1.5V4"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}


      {/* Footer */}
      {permissions?.permissionMode !== null && (
        permissions?.allowedPatterns.length ||
        permissions?.allowedUrlPatterns?.length ||
        permissions?.additionalDirectories?.length
      ) ? (
        <div className="permissions-footer">
          <button
            className="btn-secondary"
            onClick={handleResetToDefaults}
          >
            Reset to Defaults
          </button>
        </div>
      ) : null}
    </div>
  );
};
