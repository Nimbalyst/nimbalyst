import React from 'react';
import { usePostHog } from 'posthog-js/react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { ContentMode } from '../../types/WindowModeTypes';
import { KeyboardShortcuts, getShortcutDisplay } from '../../../shared/KeyboardShortcuts';
import { ThemeToggleButton } from '../ThemeToggleButton/ThemeToggleButton';
import { SyncStatusButton } from '../SyncStatusButton/SyncStatusButton';
import { TrustIndicator } from '../TrustIndicator';
import { ExtensionDevIndicator } from '../ExtensionDevIndicator';
import { ClaudeUsageIndicator } from '../ClaudeUsageIndicator';
import { CodexUsageIndicator } from '../CodexUsageIndicator';
import { VoiceModeButton } from '../UnifiedAI/VoiceModeButton';
import { useExtensionGutterButtons } from '../../extensions/panels/usePanels';
import { HelpTooltip } from '../../help';
import { terminalFeatureAvailableAtom } from '../../store/atoms/appSettings';
import {
  activeTrackerTypeAtom,
  toggleTrackerPanelAtom,
  closeTrackerPanelAtom,
} from '../../store/atoms/trackers';

export type NavigationMode = 'planning' | 'coding';
export type SidebarView = 'files' | 'settings';

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
  onToggleTerminalPanel?: () => void;
  terminalPanelVisible?: boolean;
  workspacePath?: string | null;
  /** Currently active extension panel ID */
  activeExtensionPanel?: string | null;
  /** Callback when an extension panel is activated */
  onExtensionPanelChange?: (panelId: string | null) => void;
  /** Callback to toggle Files mode sidebar collapsed state */
  onToggleFilesCollapsed?: () => void;
  /** Callback to toggle Agent mode session history collapsed state */
  onToggleAgentCollapsed?: () => void;
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
  onToggleTerminalPanel,
  terminalPanelVisible,
  workspacePath,
  activeExtensionPanel,
  onExtensionPanelChange,
  onToggleFilesCollapsed,
  onToggleAgentCollapsed,
}) => {
  const posthog = usePostHog();

  // Tracker panel state from atoms
  const activeTrackerType = useAtomValue(activeTrackerTypeAtom);
  const toggleTrackerPanel = useSetAtom(toggleTrackerPanelAtom);
  const closeTrackerPanel = useSetAtom(closeTrackerPanelAtom);

  // Check if terminal feature is available (developer mode + feature enabled)
  const isTerminalAvailable = useAtomValue(terminalFeatureAvailableAtom);

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
  // Terminal button is only shown if the terminal feature is available (developer mode + feature enabled)
  const bottomPanelButtons: NavButton[] = [
    // Only include terminal button if the feature is available
    ...(isTerminalAvailable ? [{
      id: 'terminal',
      icon: 'terminal',
      label: 'Terminal (Ctrl+`)',
      onClick: onToggleTerminalPanel,
    }] : []),
    {
      id: 'tracker',
      icon: 'edit_note',
      label: 'Trackers (Cmd+T)',
      onClick: () => {
        toggleTrackerPanel();
      },
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
    <div className="navigation-gutter w-12 h-screen bg-nim-secondary border-r border-nim flex flex-col items-center py-2 shrink-0">
      {/* Content Mode Switcher - Top Group (Files) */}
      <div className="nav-section nav-content-modes flex flex-col items-center gap-1 w-full px-1.5 py-1">
        {contentModeButtonsTop.map((button) => {
          const testId = `${button.id}-mode-button`;
          return (
            <HelpTooltip key={button.id} testId={testId}>
              <button
                className={`nav-button relative w-9 h-9 flex items-center justify-center border-none rounded-md cursor-pointer transition-all duration-150 p-0 active:scale-95 focus-visible:outline-2 focus-visible:outline-[var(--nim-primary)] focus-visible:outline-offset-2 ${contentMode === button.contentMode && !activeExtensionPanel ? 'active bg-nim-primary text-white hover:bg-nim-primary-hover' : 'bg-transparent text-nim-muted hover:bg-nim-tertiary hover:text-nim'}`}
                onClick={() => {
                  // Clear any active fullscreen extension panel when switching to a content mode
                  onExtensionPanelChange?.(null);
                  if (contentMode === button.contentMode && !activeExtensionPanel) {
                    // Already on this mode - toggle collapse
                    if (button.contentMode === 'files') {
                      onToggleFilesCollapsed?.();
                    }
                  } else {
                    // Switch modes
                    handleButtonClick(button);
                  }
                }}
                aria-label={button.label}
                aria-pressed={contentMode === button.contentMode && !activeExtensionPanel}
                data-mode={button.contentMode || button.id}
                data-testid={testId}
              >
                <MaterialSymbol
                  icon={button.icon}
                  size={20}
                  fill={contentMode === button.contentMode && !activeExtensionPanel}
                />
                {button.badge !== undefined && button.badge > 0 && (
                  <span className="nav-badge absolute top-0.5 right-0.5 min-w-4 h-4 px-1 bg-nim-error text-white rounded-full text-[10px] font-semibold flex items-center justify-center leading-none pointer-events-none">{button.badge}</span>
                )}
              </button>
            </HelpTooltip>
          );
        })}
      </div>

      {/* Content Mode Switcher - Agent Group (Agent) */}
      <div className="nav-section nav-content-modes flex flex-col items-center gap-1 w-full px-1.5 py-1">
        {contentModeButtonsAgent.map((button) => {
          const testId = `${button.id}-mode-button`;
          return (
            <HelpTooltip key={button.id} testId={testId}>
              <button
                className={`nav-button relative w-9 h-9 flex items-center justify-center border-none rounded-md cursor-pointer transition-all duration-150 p-0 active:scale-95 focus-visible:outline-2 focus-visible:outline-[var(--nim-primary)] focus-visible:outline-offset-2 ${contentMode === button.contentMode && !activeExtensionPanel ? 'active bg-nim-primary text-white hover:bg-nim-primary-hover' : 'bg-transparent text-nim-muted hover:bg-nim-tertiary hover:text-nim'}`}
                onClick={() => {
                  // Clear any active fullscreen extension panel when switching to a content mode
                  onExtensionPanelChange?.(null);
                  if (contentMode === button.contentMode && !activeExtensionPanel) {
                    // Already on this mode - toggle collapse
                    if (button.contentMode === 'agent') {
                      onToggleAgentCollapsed?.();
                    }
                  } else {
                    // Switch modes
                    handleButtonClick(button);
                  }
                }}
                aria-pressed={contentMode === button.contentMode && !activeExtensionPanel}
                data-mode={button.contentMode || button.id}
                data-testid={testId}
              >
                <MaterialSymbol
                  icon={button.icon}
                  size={20}
                  fill={contentMode === button.contentMode && !activeExtensionPanel}
                />
                {button.badge !== undefined && button.badge > 0 && (
                  <span className="nav-badge absolute top-0.5 right-0.5 min-w-4 h-4 px-1 bg-nim-error text-white rounded-full text-[10px] font-semibold flex items-center justify-center leading-none pointer-events-none">{button.badge}</span>
                )}
              </button>
            </HelpTooltip>
          );
        })}
      </div>

      {/* Fullscreen Extension Panels - appear below Agent as additional modes */}
      {extensionPanelButtons.filter(p => p.placement === 'fullscreen').length > 0 && (
        <div className="nav-section nav-extension-modes flex flex-col items-center gap-1 w-full px-1.5 py-1 pt-2 mt-1 border-t border-nim">
          {extensionPanelButtons
            .filter(panel => panel.placement === 'fullscreen')
            .map((panel) => (
              <button
                key={panel.id}
                className={`nav-button relative w-9 h-9 flex items-center justify-center border-none rounded-md cursor-pointer transition-all duration-150 p-0 active:scale-95 focus-visible:outline-2 focus-visible:outline-[var(--nim-primary)] focus-visible:outline-offset-2 ${activeExtensionPanel === panel.id ? 'active bg-nim-primary text-white hover:bg-nim-primary-hover' : 'bg-transparent text-nim-muted hover:bg-nim-tertiary hover:text-nim'}`}
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
      <div className="nav-section nav-quick-access flex flex-col items-center gap-1 w-full px-1.5 py-1 flex-1 pt-2">
        {quickAccessButtons.map((button) => (
          <button
            key={button.id}
            className="nav-button relative w-9 h-9 flex items-center justify-center bg-transparent border-none rounded-md text-nim-muted cursor-pointer transition-all duration-150 p-0 hover:bg-nim-tertiary hover:text-nim active:scale-95 focus-visible:outline-2 focus-visible:outline-[var(--nim-primary)] focus-visible:outline-offset-2"
            onClick={() => handleButtonClick(button)}
            title={button.label}
            aria-label={button.label}
          >
            <MaterialSymbol icon={button.icon} size={20} />
            {button.badge !== undefined && button.badge > 0 && (
              <span className="nav-badge absolute top-0.5 right-0.5 min-w-4 h-4 px-1 bg-nim-error text-white rounded-full text-[10px] font-semibold flex items-center justify-center leading-none pointer-events-none">{button.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Extension Panels - Sidebar panels only (fullscreen panels are in top modes section) */}
      {extensionPanelButtons.filter(p => p.placement === 'sidebar').length > 0 && (
        <div className="nav-section nav-extension-panels flex flex-col items-center gap-1 w-full px-1.5 py-1">
          {extensionPanelButtons
            .filter(panel => panel.placement === 'sidebar')
            .map((panel) => (
              <button
                key={panel.id}
                className={`nav-button relative w-9 h-9 flex items-center justify-center border-none rounded-md cursor-pointer transition-all duration-150 p-0 active:scale-95 focus-visible:outline-2 focus-visible:outline-[var(--nim-primary)] focus-visible:outline-offset-2 ${activeExtensionPanel === panel.id ? 'active bg-nim-primary text-white hover:bg-nim-primary-hover' : 'bg-transparent text-nim-muted hover:bg-nim-tertiary hover:text-nim'}`}
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

      {/* Voice Mode - persistent button with integrated context ring */}
      <div className="nav-section nav-voice-mode flex flex-col items-center gap-1 w-full px-1.5 py-1">
        <VoiceModeButton workspacePath={workspacePath} />
      </div>

      {/* Bottom Panel Toggles - Above Settings */}
      <div className="nav-section nav-bottom-panels flex flex-col items-center gap-1 w-full px-1.5 py-1">
        {bottomPanelButtons.map((button) => {
          const isActive = button.id === 'terminal'
            ? terminalPanelVisible
            : button.id === 'tracker' && activeTrackerType !== null;
          const testId = `${button.id}-panel-button`;
          return (
            <HelpTooltip key={button.id} testId={testId}>
              <button
                className={`nav-button relative w-9 h-9 flex items-center justify-center border-none rounded-md cursor-pointer transition-all duration-150 p-0 active:scale-95 focus-visible:outline-2 focus-visible:outline-[var(--nim-primary)] focus-visible:outline-offset-2 ${isActive ? 'active bg-nim-primary text-white hover:bg-nim-primary-hover' : 'bg-transparent text-nim-muted hover:bg-nim-tertiary hover:text-nim'}`}
                onClick={() => handleButtonClick(button)}
                aria-label={button.label}
                data-testid={testId}
              >
                <MaterialSymbol icon={button.icon} size={20} fill={isActive} />
              </button>
            </HelpTooltip>
          );
        })}
      </div>



      {/* Settings (bottom) */}
      <div className="nav-section nav-settings flex flex-col items-center gap-1 w-full px-1.5 py-1 mt-auto pt-2 border-t border-nim">

        {/* Claude Usage Indicator - Shows API usage limits */}
        <ClaudeUsageIndicator />

        {/* Codex Usage Indicator - Shows Codex subscription usage limits */}
        <CodexUsageIndicator />

        {/* Extension Dev Indicator - Shows when extension dev tools are enabled */}
        <ExtensionDevIndicator onOpenSettings={onOpenSettings} />

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
        <div className="nav-section nav-theme flex flex-col items-center gap-1 w-full px-1.5 py-1">
          <ThemeToggleButton />
        </div>

        <HelpTooltip testId="gutter-feedback-button">
          <button
            className="nimbalyst-feedback-button nav-button relative w-9 h-9 flex items-center justify-center bg-transparent border-none rounded-md text-nim-muted cursor-pointer transition-all duration-150 p-0 hover:bg-nim-tertiary hover:text-nim active:scale-95 focus-visible:outline-2 focus-visible:outline-[var(--nim-primary)] focus-visible:outline-offset-2"
            onClick={() => {
              console.log('[NavigationGutter] Feedback button clicked');
              onOpenFeedback?.();
            }}
            aria-label={feedbackButton.label}
            data-testid="gutter-feedback-button"
          >
            <MaterialSymbol
              icon={feedbackButton.icon}
              size={20}
            />
          </button>
        </HelpTooltip>

        <HelpTooltip testId="gutter-settings-button">
          <button
            className="nav-button relative w-9 h-9 flex items-center justify-center bg-transparent border-none rounded-md text-nim-muted cursor-pointer transition-all duration-150 p-0 hover:bg-nim-tertiary hover:text-nim active:scale-95 focus-visible:outline-2 focus-visible:outline-[var(--nim-primary)] focus-visible:outline-offset-2"
            onClick={() => handleButtonClick(settingsButton)}
            aria-label={settingsButton.label}
            data-testid="gutter-settings-button"
          >
            <MaterialSymbol
              icon={settingsButton.icon}
              size={20}
            />
          </button>
        </HelpTooltip>
      </div>
    </div>
  );
};
