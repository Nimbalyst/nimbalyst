import React from 'react';
import { MaterialSymbol } from '../MaterialSymbol';
import './NavigationGutter.css';

export type NavigationMode = 'planning' | 'coding';

interface NavigationGutterProps {
  currentMode: NavigationMode;
  onModeChange: (mode: NavigationMode) => void;
  onOpenPlans?: () => void;
  onOpenBugs?: () => void;
  onOpenHistory?: () => void;
  onOpenSettings?: () => void;
}

interface NavButton {
  id: string;
  icon: string;
  label: string;
  mode?: NavigationMode;
  onClick?: () => void;
  badge?: number;
}

export const NavigationGutter: React.FC<NavigationGutterProps> = ({
  currentMode,
  onModeChange,
  onOpenPlans,
  onOpenBugs,
  onOpenHistory,
  onOpenSettings,
}) => {
  const navButtons: NavButton[] = [
    {
      id: 'planning',
      icon: 'edit_note',
      label: 'Planning Mode',
      mode: 'planning',
    },
    {
      id: 'coding',
      icon: 'code',
      label: 'Coding Mode',
      mode: 'coding',
    },
  ];

  const quickAccessButtons: NavButton[] = [
    {
      id: 'plans',
      icon: 'description',
      label: 'Plans',
      onClick: onOpenPlans,
    },
    {
      id: 'bugs',
      icon: 'bug_report',
      label: 'Bugs',
      onClick: onOpenBugs,
    },
    {
      id: 'history',
      icon: 'history',
      label: 'Session History',
      onClick: onOpenHistory,
    },
  ];

  const settingsButton: NavButton = {
    id: 'settings',
    icon: 'settings',
    label: 'Settings',
    onClick: onOpenSettings,
  };

  const handleButtonClick = (button: NavButton) => {
    if (button.mode) {
      onModeChange(button.mode);
    } else if (button.onClick) {
      button.onClick();
    }
  };

  return (
    <div className="navigation-gutter">
      {/* Mode Switcher */}
      <div className="nav-section nav-modes">
        {navButtons.map((button) => (
          <button
            key={button.id}
            className={`nav-button ${currentMode === button.mode ? 'active' : ''}`}
            onClick={() => handleButtonClick(button)}
            title={button.label}
            aria-label={button.label}
            aria-pressed={currentMode === button.mode}
          >
            <MaterialSymbol
              icon={button.icon}
              size={20}
              fill={currentMode === button.mode}
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
          <MaterialSymbol icon={settingsButton.icon} size={20} />
        </button>
      </div>
    </div>
  );
};
