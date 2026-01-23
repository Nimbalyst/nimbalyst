import React from 'react';
import { usePostHog } from 'posthog-js/react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import './NavigationGutter.css';
import type { ContentMode } from '../../types/WindowModeTypes';
import { KeyboardShortcuts, getShortcutDisplay } from '../../../shared/KeyboardShortcuts';
import { ThemeToggleButton } from '../ThemeToggleButton/ThemeToggleButton';
import { SyncStatusButton } from '../SyncStatusButton/SyncStatusButton';
import { TrustIndicator } from '../TrustIndicator';
import { ExtensionDevIndicator } from '../ExtensionDevIndicator';
import { useExtensionGutterButtons } from '../../extensions/panels/usePanels';

export type NavigationMode = 'planning' | 'coding';
export type SidebarView = 'files' | 'settings';

export type TrackerBottomPanelType = 'plan' | 'bug' | 'task' | 'idea' | 'decision';

/**
 * Extension panel info for gutter buttons.
 */
export interface ExtensionPanelButton {
  id: string;
  icon: string;
  label: string;
  placement: 'sidebar' | 'fullscreen';
}

interface NavigationGutterProps {
  contentMode: ContentMode;
  onContentModeChange: (mode: ContentMode) => void;
  onOpenHistory?: () => void;
  onOpenSettings?: () => void;
  onOpenPermissions?: () => void;
  onOpenFeedback?: () => void;
  onChangeTrustMode?: () => void;
  onTogglePlansPanel?: () => void;
  onToggleBugsPanel?: () => void;
  onToggleTasksPanel?: () => void;
  onToggleIdeasPanel?: () => void;
  onToggleTerminalPanel?: () => void;
  bottomPanel?: TrackerBottomPanelType | null;
  terminalPanelVisible?: boolean;
  workspacePath?: string | null;
  /** Currently active extension panel ID */
  activeExtensionPanel?: string | null;
  /** Callback when an extension panel is activated */
  onExtensionPanelChange?: (panelId: string | null) => void;
}

interface NavButton {
  id: string;
  icon: string;
  label: string;
  contentMode?: ContentMode;
  onClick?: () => void;
  badge?: number;
}

export const NavigationGutter: React.FC<NavigationGutterProps> = ({
  contentMode,
  onContentModeChange,
  onOpenHistory,
  onOpenSettings,
  onOpenPermissions,
  onOpenFeedback,
  onChangeTrustMode,
  onTogglePlansPanel,
  onToggleBugsPanel,
  onToggleTasksPanel,
  onToggleIdeasPanel,
  onToggleTerminalPanel,
  bottomPanel,
  terminalPanelVisible,
  workspacePath,
  activeExtensionPanel,
  onExtensionPanelChange,
}) => {
  const posthog = usePostHog();

  // Get extension panel buttons from the panel registry
  const extensionPanelButtons = useExtensionGutterButtons();
  // Content mode buttons - primary navigation (top)
  const contentModeButtonsTop: NavButton[] = [
    {
      id: 'files',
      icon: 'account_tree',
      label: `Files (${getShortcutDisplay(KeyboardShortcuts.view.filesMode)})`,
      contentMode: 'files',
    },
  ];

  // Content mode buttons - agent section (after spacer)
  const contentModeButtonsAgent: NavButton[] = [
    {
      id: 'agent',
      icon: 'code',
      label: `Agent (${getShortcutDisplay(KeyboardShortcuts.view.agentMode)})`,
      contentMode: 'agent',
    },
  ];

  // Quick access buttons - secondary actions (middle)
  const quickAccessButtons: NavButton[] = [
    // Session History removed - use Cmd+Y for file history instead
  ];

  // Bottom panel buttons - positioned above settings
  const bottomPanelButtons: NavButton[] = [
    {
      id: 'terminal',
      icon: 'terminal',
      label: 'Terminal (Ctrl+`)',
      onClick: onToggleTerminalPanel,
    },
    {
      id: 'plan',
      icon: 'edit_note',
      label: 'Plans (Cmd+Shift+P)',
      onClick: onTogglePlansPanel,
    }
  ];

  // Settings button - always at bottom
  const settingsButton: NavButton = {
    id: 'settings',
    icon: 'settings',
    label: 'Settings',
    contentMode: 'settings',
  };

  // Feedback button
  const feedbackButton: NavButton = {
    id: 'feedback',
    icon: 'feedback',
    label: 'Send Feedback',
  };

  const handleButtonClick = (button: NavButton) => {
    // console.log('[NavigationGutter] Button clicked:', button.id, {
    //   hasOnClick: !!button.onClick,
    //   hasContentMode: !!button.contentMode,
    //   currentContentMode: contentMode,
    //   targetContentMode: button.contentMode
    // });

    if (button.contentMode) {
      // Track mode switch analytics
      if (button.contentMode !== contentMode) {
        posthog?.capture('content_mode_switched', {
          fromMode: contentMode,
          toMode: button.contentMode,
        });
      }
      // console.log('[NavigationGutter] Changing content mode from', contentMode, 'to', button.contentMode);
      onContentModeChange(button.contentMode);
    } else if (button.onClick) {
      // console.log('[NavigationGutter] Calling onClick for:', button.id);
      button.onClick();
    } else {
      console.warn('[NavigationGutter] No action defined for button:', button.id);
    }
  };

  return (
    <div className="navigation-gutter">
      {/* Content Mode Switcher - Top Group (Files) */}
      <div className="nav-section nav-content-modes">
        {contentModeButtonsTop.map((button) => (
          <button
            key={button.id}
            className={`nav-button ${contentMode === button.contentMode && !activeExtensionPanel ? 'active' : ''}`}
            onClick={() => {
              // Clear any active fullscreen extension panel when switching to a content mode
              onExtensionPanelChange?.(null);
              handleButtonClick(button);
            }}
            title={button.label}
            aria-label={button.label}
            aria-pressed={contentMode === button.contentMode && !activeExtensionPanel}
            data-mode={button.contentMode || button.id}
            data-testid={`${button.id}-mode-button`}
          >
            <MaterialSymbol
              icon={button.icon}
              size={20}
              fill={contentMode === button.contentMode && !activeExtensionPanel}
            />
            {button.badge !== undefined && button.badge > 0 && (
              <span className="nav-badge">{button.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content Mode Switcher - Agent Group (Agent) */}
      <div className="nav-section nav-content-modes">
        {contentModeButtonsAgent.map((button) => (
          <button
            key={button.id}
            className={`nav-button ${contentMode === button.contentMode && !activeExtensionPanel ? 'active' : ''}`}
            onClick={() => {
              // Clear any active fullscreen extension panel when switching to a content mode
              onExtensionPanelChange?.(null);
              handleButtonClick(button);
            }}
            title={button.label}
            aria-label={button.label}
            aria-pressed={contentMode === button.contentMode && !activeExtensionPanel}
            data-mode={button.contentMode || button.id}
            data-testid={`${button.id}-mode-button`}
          >
            <MaterialSymbol
              icon={button.icon}
              size={20}
              fill={contentMode === button.contentMode && !activeExtensionPanel}
            />
            {button.badge !== undefined && button.badge > 0 && (
              <span className="nav-badge">{button.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Fullscreen Extension Panels - appear below Agent as additional modes */}
      {extensionPanelButtons.filter(p => p.placement === 'fullscreen').length > 0 && (
        <div className="nav-section nav-extension-modes">
          {extensionPanelButtons
            .filter(panel => panel.placement === 'fullscreen')
            .map((panel) => (
              <button
                key={panel.id}
                className={`nav-button ${activeExtensionPanel === panel.id ? 'active' : ''}`}
                onClick={() => {
                  const newPanelId = activeExtensionPanel === panel.id ? null : panel.id;
                  onExtensionPanelChange?.(newPanelId);
                  posthog?.capture('extension_panel_toggled', {
                    panelId: panel.id,
                    placement: panel.placement,
                    action: newPanelId ? 'activated' : 'deactivated',
                  });
                }}
                title={panel.label}
                aria-label={panel.label}
                aria-pressed={activeExtensionPanel === panel.id}
                data-panel-id={panel.id}
              >
                <MaterialSymbol
                  icon={panel.icon}
                  size={20}
                  fill={activeExtensionPanel === panel.id}
                />
              </button>
            ))}
        </div>
      )}

      {/* Quick Access */}
      <div className="nav-section nav-quick-access">
        {quickAccessButtons.map((button) => (
          <button
            key={button.id}
            className="nav-button"
            onClick={() => handleButtonClick(button)}
            title={button.label}
            aria-label={button.label}
          >
            <MaterialSymbol icon={button.icon} size={20} />
            {button.badge !== undefined && button.badge > 0 && (
              <span className="nav-badge">{button.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Extension Panels - Sidebar panels only (fullscreen panels are in top modes section) */}
      {extensionPanelButtons.filter(p => p.placement === 'sidebar').length > 0 && (
        <div className="nav-section nav-extension-panels">
          {extensionPanelButtons
            .filter(panel => panel.placement === 'sidebar')
            .map((panel) => (
              <button
                key={panel.id}
                className={`nav-button ${activeExtensionPanel === panel.id ? 'active' : ''}`}
                onClick={() => {
                  // Toggle panel: if clicking active panel, deactivate it
                  const newPanelId = activeExtensionPanel === panel.id ? null : panel.id;
                  onExtensionPanelChange?.(newPanelId);
                  // Sidebar panels work alongside files mode
                  if (newPanelId && contentMode !== 'files') {
                    onContentModeChange('files');
                  }
                  posthog?.capture('extension_panel_toggled', {
                    panelId: panel.id,
                    placement: panel.placement,
                    action: newPanelId ? 'activated' : 'deactivated',
                  });
                }}
                title={panel.label}
                aria-label={panel.label}
                data-panel-id={panel.id}
              >
                <MaterialSymbol
                  icon={panel.icon}
                  size={20}
                  fill={activeExtensionPanel === panel.id}
                />
              </button>
            ))}
        </div>
      )}

      {/* Bottom Panel Toggles - Above Settings */}
      <div className="nav-section nav-bottom-panels">
        {bottomPanelButtons.map((button) => {
          const isActive = button.id === 'terminal'
            ? terminalPanelVisible
            : bottomPanel === button.id;
          return (
            <button
              key={button.id}
              className={`nav-button ${isActive ? 'active' : ''}`}
              onClick={() => handleButtonClick(button)}
              title={button.label}
              aria-label={button.label}
              data-testid={`${button.id}-panel-button`}
            >
              <MaterialSymbol icon={button.icon} size={20} fill={isActive} />
            </button>
          );
        })}
      </div>



      {/* Settings (bottom) */}
      <div className="nav-section nav-settings">

        {/* Extension Dev Indicator - Shows when extension dev tools are enabled */}
        <ExtensionDevIndicator
          onOpenSettings={onOpenSettings}
        />

        {/* Trust Indicator - Shows agent trust status */}
        <TrustIndicator
          workspacePath={workspacePath}
          onOpenSettings={onOpenPermissions || (() => {})}
          onChangeMode={onChangeTrustMode}
        />

        {/* Sync Status - Above Theme Toggle */}
        <SyncStatusButton
          workspacePath={workspacePath || undefined}
          onOpenSettings={onOpenSettings}
        />

        {/* Theme Toggle - Above Settings */}
        <div className="nav-section nav-theme">
          <ThemeToggleButton />
        </div>

        <button
          className="nimbalyst-feedback-button nav-button"
          onClick={() => {
            console.log('[NavigationGutter] Feedback button clicked');
            onOpenFeedback?.();
          }}
          title={feedbackButton.label}
          aria-label={feedbackButton.label}
        >
          <MaterialSymbol
            icon={feedbackButton.icon}
            size={20}
          />
        </button>

        <button
          className="nav-button"
          onClick={() => handleButtonClick(settingsButton)}
          title={settingsButton.label}
          aria-label={settingsButton.label}
        >
          <MaterialSymbol
            icon={settingsButton.icon}
            size={20}
          />
        </button>
      </div>
    </div>
  );
};
