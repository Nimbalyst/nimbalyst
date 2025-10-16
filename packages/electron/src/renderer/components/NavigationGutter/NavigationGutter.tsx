import React from 'react';
import { MaterialSymbol } from '../MaterialSymbol';
import './NavigationGutter.css';

export type NavigationMode = 'planning' | 'coding';
export type SidebarView = 'files' | 'plans' | 'settings';

interface NavigationGutterProps {
  currentMode: NavigationMode;
  onModeChange: (mode: NavigationMode) => void;
  sidebarView: SidebarView;
  onSidebarViewChange: (view: SidebarView) => void;
  onOpenBugs?: () => void;
  onOpenHistory?: () => void;
  onOpenSettings?: () => void;
}

interface NavButton {
  id: string;
  icon: string;
  label: string;
  mode?: NavigationMode;
  sidebarView?: SidebarView;
  onClick?: () => void;
  badge?: number;
}

export const NavigationGutter: React.FC<NavigationGutterProps> = ({
  currentMode,
  onModeChange,
  sidebarView,
  onSidebarViewChange,
  onOpenBugs,
  onOpenHistory,
  onOpenSettings,
}) => {
  const sidebarViewButtons: NavButton[] = [
    {
      id: 'files',
      icon: 'account_tree',
      label: 'Files',
      sidebarView: 'files',
    },
    {
      id: 'plans',
      icon: 'edit_note',
      label: 'Plans',
      sidebarView: 'plans',
    },
  ];

  const quickAccessButtons: NavButton[] = [
    {
      id: 'coding',
      icon: 'code',
      label: 'Coding Mode',
      onClick: () => onModeChange('coding'),
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
    sidebarView: 'settings',
  };

  const handleButtonClick = (button: NavButton) => {
    if (button.mode) {
      onModeChange(button.mode);
    } else if (button.sidebarView) {
      onSidebarViewChange(button.sidebarView);
    } else if (button.onClick) {
      button.onClick();
    }
  };

  return (
    <div className="navigation-gutter">
      {/* Sidebar View Switcher */}
      <div className="nav-section nav-sidebar-views">
        {sidebarViewButtons.map((button) => (
          <button
            key={button.id}
            className={`nav-button ${sidebarView === button.sidebarView ? 'active' : ''}`}
            onClick={() => handleButtonClick(button)}
            title={button.label}
            aria-label={button.label}
            aria-pressed={sidebarView === button.sidebarView}
          >
            <MaterialSymbol
              icon={button.icon}
              size={20}
              fill={sidebarView === button.sidebarView}
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
          className={`nav-button ${sidebarView === 'settings' ? 'active' : ''}`}
          onClick={() => handleButtonClick(settingsButton)}
          title={settingsButton.label}
          aria-label={settingsButton.label}
          aria-pressed={sidebarView === 'settings'}
        >
          <MaterialSymbol
            icon={settingsButton.icon}
            size={20}
            fill={sidebarView === 'settings'}
          />
        </button>
      </div>
    </div>
  );
};
