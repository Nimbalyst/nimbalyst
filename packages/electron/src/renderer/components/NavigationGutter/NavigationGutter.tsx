import React from 'react';
import { MaterialSymbol } from '../MaterialSymbol';
import './NavigationGutter.css';
import type { ContentMode } from '../../types/WindowModeTypes';

export type NavigationMode = 'planning' | 'coding';
export type SidebarView = 'files' | 'plans' | 'settings';

interface NavigationGutterProps {
  contentMode: ContentMode;
  onContentModeChange: (mode: ContentMode) => void;
  onOpenBugs?: () => void;
  onOpenHistory?: () => void;
  onOpenSettings?: () => void;
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
  onOpenBugs,
  onOpenHistory,
}) => {
  // Content mode buttons - primary navigation (top)
  const contentModeButtonsTop: NavButton[] = [
    {
      id: 'files',
      icon: 'account_tree',
      label: 'Files (Cmd+E)',
      contentMode: 'files',
    },
    {
      id: 'plan',
      icon: 'edit_note',
      label: 'Plans (Cmd+L)',
      contentMode: 'plan',
    },
  ];

  // Content mode buttons - agent section (after spacer)
  const contentModeButtonsAgent: NavButton[] = [
    {
      id: 'agent',
      icon: 'code',
      label: 'Agent (Cmd+K)',
      contentMode: 'agent',
    },
    {
      id: 'tracker',
      icon: 'fact_check',
      label: 'Tracker',
      contentMode: 'tracker',
    },
  ];

  // Quick access buttons - secondary actions (middle)
  const quickAccessButtons: NavButton[] = [
    // Session History removed - use Cmd+Y for file history instead
  ];

  // Settings button - always at bottom
  const settingsButton: NavButton = {
    id: 'settings',
    icon: 'settings',
    label: 'Settings',
    contentMode: 'settings',
  };

  const handleButtonClick = (button: NavButton) => {
    if (button.contentMode) {
      onContentModeChange(button.contentMode);
    } else if (button.onClick) {
      button.onClick();
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
      <div className="nav-spacer" />

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

      {/* Settings (bottom) */}
      <div className="nav-section nav-settings">
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
