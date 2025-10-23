import React from 'react';
import { MaterialSymbol } from '../MaterialSymbol';
import './NavigationGutter.css';
import type { ContentMode } from '../../types/WindowModeTypes';
import { KeyboardShortcuts, getShortcutDisplay } from '../../../shared/KeyboardShortcuts';
import { ThemeToggleButton } from '../ThemeToggleButton/ThemeToggleButton';

export type NavigationMode = 'planning' | 'coding';
export type SidebarView = 'files' | 'plans' | 'settings';

export type TrackerBottomPanelType = 'plan' | 'bug' | 'task' | 'idea' | 'decision';

interface NavigationGutterProps {
  contentMode: ContentMode;
  onContentModeChange: (mode: ContentMode) => void;
  onOpenHistory?: () => void;
  onOpenSettings?: () => void;
  onTogglePlansPanel?: () => void;
  onToggleBugsPanel?: () => void;
  onToggleTasksPanel?: () => void;
  onToggleIdeasPanel?: () => void;
  bottomPanel?: TrackerBottomPanelType | null;
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
  onTogglePlansPanel,
  onToggleBugsPanel,
  onToggleTasksPanel,
  onToggleIdeasPanel,
  bottomPanel,
}) => {
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

  const handleButtonClick = (button: NavButton) => {
    // console.log('[NavigationGutter] Button clicked:', button.id, {
    //   hasOnClick: !!button.onClick,
    //   hasContentMode: !!button.contentMode,
    //   currentContentMode: contentMode,
    //   targetContentMode: button.contentMode
    // });

    if (button.contentMode) {
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
      {/* Content Mode Switcher - Top Group (Files, Plans) */}
      <div className="nav-section nav-content-modes">
        {contentModeButtonsTop.map((button) => (
          <button
            key={button.id}
            className={`nav-button ${contentMode === button.contentMode ? 'active' : ''}`}
            onClick={() => handleButtonClick(button)}
            title={button.label}
            aria-label={button.label}
            aria-pressed={contentMode === button.contentMode}
          >
            <MaterialSymbol
              icon={button.icon}
              size={20}
              fill={contentMode === button.contentMode}
            />
            {button.badge !== undefined && button.badge > 0 && (
              <span className="nav-badge">{button.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Spacer */}
      {/*<div className="nav-spacer" />*/}

      {/* Content Mode Switcher - Agent Group (Agent, Tracker) */}
      <div className="nav-section nav-content-modes">
        {contentModeButtonsAgent.map((button) => (
          <button
            key={button.id}
            className={`nav-button ${contentMode === button.contentMode ? 'active' : ''}`}
            onClick={() => handleButtonClick(button)}
            title={button.label}
            aria-label={button.label}
            aria-pressed={contentMode === button.contentMode}
          >
            <MaterialSymbol
              icon={button.icon}
              size={20}
              fill={contentMode === button.contentMode}
            />
            {button.badge !== undefined && button.badge > 0 && (
              <span className="nav-badge">{button.badge}</span>
            )}
          </button>
        ))}
      </div>

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

      {/* Bottom Panel Toggles - Above Settings */}
      <div className="nav-section nav-bottom-panels">
        {bottomPanelButtons.map((button) => (
          <button
            key={button.id}
            className={`nav-button ${bottomPanel === button.id ? 'active' : ''}`}
            onClick={() => handleButtonClick(button)}
            title={button.label}
            aria-label={button.label}
          >
            <MaterialSymbol icon={button.icon} size={20} fill={bottomPanel === button.id} />
          </button>
        ))}
      </div>



      {/* Settings (bottom) */}
      <div className="nav-section nav-settings">

        {/* Theme Toggle - Above Settings */}
        <div className="nav-section nav-theme">
          <ThemeToggleButton />
        </div>

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
