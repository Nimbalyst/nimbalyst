import React, { useState, useEffect, useCallback, useRef } from 'react';
import './ProjectTrustToast.css';

interface ProjectTrustToastProps {
  workspacePath: string | null;
  onOpenSettings?: () => void;
}

type TrustChoice = 'ask' | 'allow-all';

/**
 * One-time toast that appears when an untrusted project is opened.
 * The user must choose a permission mode before the agent can operate.
 */
export const ProjectTrustToast: React.FC<ProjectTrustToastProps> = ({
  workspacePath,
  onOpenSettings,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const toastRef = useRef<HTMLDivElement>(null);

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
        // Show toast if workspace is not trusted yet
        if (!status.isTrusted) {
          setIsVisible(true);
        }
      } catch (error) {
        console.error('[ProjectTrustToast] Failed to check trust status:', error);
      }
    };

    checkTrustStatus();
  }, [workspacePath]);

  // Listen for external trust changes (e.g., from settings or TrustIndicator)
  useEffect(() => {
    const handlePermissionChange = async () => {
      if (!workspacePath) return;

      try {
        const status = await window.electronAPI.invoke('permissions:getWorkspacePermissions', workspacePath);
        // Show toast if workspace is NOT trusted (e.g., user clicked "Change Mode")
        if (!status.isTrusted) {
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

  // Handle escape key to dismiss without changing settings
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setIsVisible(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isVisible]);

  // Handle click outside to dismiss without changing settings
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    // Only dismiss if clicking directly on the overlay, not the toast content
    if (e.target === e.currentTarget) {
      setIsVisible(false);
    }
  }, []);

  const handleChoice = useCallback(async (choice: TrustChoice) => {
    if (!workspacePath || isSubmitting) return;

    setIsSubmitting(true);

    try {
      // Trust the workspace with the selected permission mode
      await window.electronAPI.invoke('permissions:trustWorkspace', workspacePath);
      await window.electronAPI.invoke('permissions:setPermissionMode', workspacePath, choice);
      setIsVisible(false);
    } catch (error) {
      console.error('[ProjectTrustToast] Failed to set trust:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [workspacePath, isSubmitting]);

  const handleOpenSettings = useCallback(() => {
    setIsVisible(false);
    onOpenSettings?.();
  }, [onOpenSettings]);

  if (!isVisible || !workspacePath) {
    return null;
  }

  // Get project name from path
  const projectName = workspacePath.split('/').pop() || 'this project';

  return (
    <div className="project-trust-toast-overlay" onClick={handleOverlayClick}>
      <div className="project-trust-toast" ref={toastRef}>
        {/* Header */}
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

        {/* Options */}
        <div className="project-trust-toast-options">
          <button
            className="project-trust-toast-option project-trust-toast-option--primary"
            onClick={() => handleChoice('ask')}
            disabled={isSubmitting}
          >
            <div className="project-trust-toast-option-header">
              <span className="project-trust-toast-option-label">Smart Permissions</span>
              <span className="project-trust-toast-option-badge">Recommended</span>
            </div>
            <span className="project-trust-toast-option-desc">
              Safe operations auto-approved. New patterns remembered when you approve them.
            </span>
          </button>

          <button
            className="project-trust-toast-option project-trust-toast-option--danger"
            onClick={() => handleChoice('allow-all')}
            disabled={isSubmitting}
          >
            <div className="project-trust-toast-option-header">
              <span className="project-trust-toast-option-label">Always Allow</span>
              <span className="project-trust-toast-option-badge project-trust-toast-option-badge--danger">Risky</span>
            </div>
            <span className="project-trust-toast-option-desc">
              Agent runs all tools without asking
            </span>
          </button>
        </div>

        {/* Features highlight */}
        <div className="project-trust-toast-features">
          <div className="project-trust-toast-features-header">
            With Smart Permissions, you can:
          </div>
          <ul className="project-trust-toast-features-list">
            <li>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M13.5 4.5l-7 7-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span><strong>Permanently allow</strong> specific tool patterns (not just for this session)</span>
            </li>
            <li>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M13.5 4.5l-7 7-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span><strong>Fine-grained bash control</strong> - allow "npm test" but block "rm -rf"</span>
            </li>
            <li>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M13.5 4.5l-7 7-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span><strong>Additional directories</strong> - grant access to folders outside the project</span>
            </li>
            <li>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M13.5 4.5l-7 7-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span><strong>URL patterns</strong> - control which domains the agent can fetch</span>
            </li>
          </ul>
        </div>

        {/* Footer */}
        <div className="project-trust-toast-footer">
          <button
            className="project-trust-toast-settings-link"
            onClick={handleOpenSettings}
          >
            Advanced settings
          </button>
        </div>
      </div>
    </div>
  );
};
