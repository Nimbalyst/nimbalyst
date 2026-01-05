import React, { useState, useEffect, useCallback, useRef } from 'react';
import { usePostHog } from 'posthog-js/react';
import './ProjectTrustToast.css';

interface ProjectTrustToastProps {
  workspacePath: string | null;
  onOpenSettings?: () => void;
  /** Force the toast to show (e.g., when user wants to change permission mode) */
  forceShow?: boolean;
  /** Callback when toast is dismissed without making a choice */
  onDismiss?: () => void;
}

type TrustChoice = 'ask' | 'allow-all' | 'bypass-all';

/**
 * One-time toast that appears when an untrusted project is opened.
 * The user must choose a permission mode before the agent can operate.
 */
export const ProjectTrustToast: React.FC<ProjectTrustToastProps> = ({
  workspacePath,
  onOpenSettings,
  forceShow = false,
  onDismiss,
}) => {
  const posthog = usePostHog();
  const [isVisible, setIsVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isChangingMode, setIsChangingMode] = useState(false);
  const [selectedMode, setSelectedMode] = useState<TrustChoice>('allow-all');
  const toastRef = useRef<HTMLDivElement>(null);
  const justSavedRef = useRef(false);

  // Handle forceShow prop - show toast when parent wants to change mode
  useEffect(() => {
    if (forceShow && workspacePath) {
      setIsChangingMode(true);
      setIsVisible(true);
      // Fetch current permission mode to pre-select it
      window.electronAPI.invoke('permissions:getWorkspacePermissions', workspacePath)
        .then((status) => {
          if (status.permissionMode) {
            setSelectedMode(status.permissionMode as TrustChoice);
          }
        })
        .catch((error) => {
          console.error('[ProjectTrustToast] Failed to fetch current permission mode:', error);
        });
    }
  }, [forceShow, workspacePath]);

  // Check trust status when workspace changes
  useEffect(() => {
    if (!workspacePath) {
      setIsVisible(false);
      return;
    }

    const checkTrustStatus = async () => {
      try {
        const status = await window.electronAPI.invoke('permissions:getWorkspacePermissions', workspacePath);
        console.log('[ProjectTrustToast] Trust status for', workspacePath, ':', status);
        // Show toast if workspace is not trusted yet (but not if we're in change mode)
        // Trusted = permissionMode is not null
        if (status.permissionMode === null && !isChangingMode) {
          setIsVisible(true);
        }
      } catch (error) {
        console.error('[ProjectTrustToast] Failed to check trust status:', error);
      }
    };

    checkTrustStatus();
  }, [workspacePath, isChangingMode]);

  // Listen for external trust changes (e.g., from settings or TrustIndicator)
  // But ignore changes if we just saved to avoid race conditions
  useEffect(() => {
    const handlePermissionChange = async () => {
      if (!workspacePath) return;

      // Ignore permission changes right after we saved
      if (justSavedRef.current) {
        return;
      }

      try {
        const status = await window.electronAPI.invoke('permissions:getWorkspacePermissions', workspacePath);
        // Show toast if workspace is NOT trusted (e.g., user clicked "Change Mode")
        // Trusted = permissionMode is not null
        if (status.permissionMode === null) {
          setIsVisible(true);
        } else {
          setIsVisible(false);
        }
      } catch (error) {
        console.error('[ProjectTrustToast] Failed to check trust status on change:', error);
      }
    };

    const cleanup = window.electronAPI.on('permissions:changed', handlePermissionChange);
    return () => {
      cleanup?.();
    };
  }, [workspacePath]);

  // Handle dismissing the toast without making a choice
  const handleDismiss = useCallback(() => {
    setIsVisible(false);
    setIsChangingMode(false);
    onDismiss?.();
  }, [onDismiss]);

  // Handle escape key to dismiss without changing settings
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleDismiss();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isVisible, handleDismiss]);


  const handleSave = useCallback(async () => {
    if (!workspacePath || isSubmitting) return;

    setIsSubmitting(true);
    // Mark that we just saved to prevent race conditions with permission change listener
    justSavedRef.current = true;

    try {
      // Set the permission mode directly - this also trusts the workspace
      // (any non-null mode means trusted)
      await window.electronAPI.invoke('permissions:setPermissionMode', workspacePath, selectedMode);

      // Track trust dialog completion
      posthog?.capture('trust_dialog_saved', {
        permissionMode: selectedMode,
        isChangingMode,
      });

      setIsVisible(false);
      setIsChangingMode(false);
      // Reset parent's forceShow state
      onDismiss?.();
    } catch (error) {
      console.error('[ProjectTrustToast] Failed to set trust:', error);
      // Only reset justSavedRef on error so we can try again
      justSavedRef.current = false;
    } finally {
      setIsSubmitting(false);
    }
  }, [workspacePath, isSubmitting, selectedMode, onDismiss, posthog, isChangingMode]);

  const handleDontTrust = useCallback(() => {
    // Just dismiss without trusting - the project remains untrusted
    setIsVisible(false);
    setIsChangingMode(false);
    onDismiss?.();
  }, [onDismiss]);

  const handleOpenSettings = useCallback(() => {
    setIsVisible(false);
    setIsChangingMode(false);
    onDismiss?.();
    onOpenSettings?.();
  }, [onOpenSettings, onDismiss]);

  if (!isVisible || !workspacePath) {
    return null;
  }

  // Get project name from path
  const projectName = workspacePath.split('/').pop() || 'this project';

  return (
    <div className="project-trust-toast-overlay">
      <div className="project-trust-toast" ref={toastRef}>
        {/* Header with Don't Trust button */}
        <div className="project-trust-toast-header">
          <span className="project-trust-toast-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
          <div className="project-trust-toast-header-text">
            <h2 className="project-trust-toast-title">Trust "{projectName}"?</h2>
            <p className="project-trust-toast-subtitle">
              This project wants to use the AI agent
            </p>
          </div>
          <button
            className="project-trust-toast-dont-trust"
            onClick={handleDontTrust}
            disabled={isSubmitting}
          >
            Don't Trust
          </button>
        </div>

        {/* Warning */}
        <div className="project-trust-toast-warning">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 5.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
          <span>
            Untrusted projects can contain malicious code. Only trust projects from sources you know.
          </span>
        </div>

        {/* Description */}
        <p className="project-trust-toast-description">
          Choose how the agent handles tool calls in this project:
        </p>

        {/* Mode Toggle Buttons */}
        <div className="project-trust-toast-mode-toggle">
          <button
            className={`project-trust-toast-mode-btn ${selectedMode === 'ask' ? 'project-trust-toast-mode-btn--selected' : ''}`}
            onClick={() => setSelectedMode('ask')}
            disabled={isSubmitting}
          >
            <span className="project-trust-toast-mode-label">Ask</span>
          </button>
          <button
            className={`project-trust-toast-mode-btn ${selectedMode === 'allow-all' ? 'project-trust-toast-mode-btn--selected' : ''}`}
            onClick={() => setSelectedMode('allow-all')}
            disabled={isSubmitting}
          >
            <span className="project-trust-toast-mode-label">Allow Edits</span>
            <span className="project-trust-toast-mode-badge">Recommended</span>
          </button>
          <button
            className={`project-trust-toast-mode-btn ${selectedMode === 'bypass-all' ? 'project-trust-toast-mode-btn--selected' : ''}`}
            onClick={() => setSelectedMode('bypass-all')}
            disabled={isSubmitting}
          >
            <span className="project-trust-toast-mode-label">Allow All</span>
          </button>
        </div>

        {/* Mode Details */}
        <div className="project-trust-toast-mode-details">
          {selectedMode === 'ask' ? (
            <>
              <p className="project-trust-toast-mode-summary">
                The agent will ask for permission before running commands. When you approve, your choices are saved to <code>.claude/settings.local.json</code> for future sessions.
              </p>
              <ul className="project-trust-toast-features-list">
                <li>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M13.5 4.5l-7 7-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span><strong>Approve once</strong> or <strong>always</strong> for each tool pattern</span>
                </li>
                <li>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M13.5 4.5l-7 7-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span><strong>Fine-grained control</strong> - allow "npm test" but block "rm -rf"</span>
                </li>
                <li>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M13.5 4.5l-7 7-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span><strong>Permissions shared</strong> with Claude Code CLI in this project</span>
                </li>
              </ul>
            </>
          ) : selectedMode === 'allow-all' ? (
            <>
              <p className="project-trust-toast-mode-summary project-trust-toast-mode-summary--warning">
                The agent will run all file and edit operations without asking. Shell commands and web requests may still require approval.
              </p>
              <ul className="project-trust-toast-features-list project-trust-toast-features-list--warning">
                <li>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M8 5.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <path d="M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  <span>All file read/write/edit operations are automatically approved</span>
                </li>
                <li>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M8 5.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <path d="M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  <span>Bash commands and web fetches follow Claude Code's settings</span>
                </li>
                <li>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M8 5.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <path d="M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  <span>Only use with projects you fully trust</span>
                </li>
              </ul>
            </>
          ) : (
            <>
              <p className="project-trust-toast-mode-summary project-trust-toast-mode-summary--warning">
                The agent will run all operations without permission prompts, including shell commands, file operations, and web requests.
              </p>
              <ul className="project-trust-toast-features-list project-trust-toast-features-list--warning">
                <li>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M8 5.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <path d="M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  <span>All tool calls are automatically approved</span>
                </li>
                <li>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M8 5.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <path d="M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  <span>Uses Nimbalyst permissions instead of Claude Code settings</span>
                </li>
                <li>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M8 5.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <path d="M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  <span>Best for development and testing workflows</span>
                </li>
              </ul>
            </>
          )}
        </div>

        {/* Footer with Save/Cancel buttons */}
        <div className="project-trust-toast-footer">
          <button
            className="project-trust-toast-settings-link"
            onClick={handleOpenSettings}
          >
            Advanced settings
          </button>
          <div className="project-trust-toast-actions">
            <button
              className="project-trust-toast-cancel"
              onClick={handleDismiss}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              className="project-trust-toast-save"
              onClick={handleSave}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
