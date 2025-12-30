import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol, getProviderIcon } from '@nimbalyst/runtime';

export type SettingsCategory =
  | 'tool-packages'
  | 'agent-permissions'
  | 'claude-code'
  | 'claude'
  | 'openai'
  | 'openai-codex'
  | 'lmstudio'
  | 'notifications'
  | 'sync'
  | 'advanced'
  | 'mcp-servers'
  | 'installed-extensions'
  | 'marketplace'
  | 'installed';

interface CategoryGroup {
  title: string;
  items: CategoryItem[];
  infoTooltip?: string;
}

interface CategoryItem {
  id: SettingsCategory;
  name: string;
  icon: React.ReactNode;
  badge?: string | number;
  statusDot?: 'success' | 'warning' | 'error';
  hidden?: boolean;
}

export type SettingsScope = 'user' | 'project';

interface SettingsSidebarProps {
  selectedCategory: SettingsCategory;
  onSelectCategory: (category: SettingsCategory) => void;
  providerStatus?: Record<string, { enabled: boolean; testStatus?: string }>;
  installedPackageCount?: number;
  totalPackageCount?: number;
  isProduction?: boolean;
  scope?: SettingsScope;
  releaseChannel?: 'stable' | 'alpha';
}

export const SettingsSidebar: React.FC<SettingsSidebarProps> = ({
  selectedCategory,
  onSelectCategory,
  providerStatus = {},
  installedPackageCount = 0,
  totalPackageCount = 0,
  isProduction = import.meta.env.PROD,
  scope = 'user',
  releaseChannel = 'stable',
}) => {
  const getStatusDot = (providerId: string): 'success' | 'warning' | 'error' | undefined => {
    const status = providerStatus[providerId];
    if (!status) return undefined;
    if (status.enabled && status.testStatus === 'success') return 'success';
    if (status.enabled && status.testStatus === 'error') return 'error';
    return undefined;
  };

  const categoryGroups: CategoryGroup[] = [
    {
      title: 'Application',
      items: [
        {
          id: 'sync',
          name: 'Account & Sync',
          icon: <MaterialSymbol icon="account_circle" size={16} />,
          hidden: releaseChannel !== 'alpha', // Only visible to alpha users
        },
        {
          id: 'notifications',
          name: 'Notifications',
          icon: <MaterialSymbol icon="notifications" size={16} />,
        },
        {
          id: 'advanced',
          name: 'Advanced',
          icon: <MaterialSymbol icon="settings" size={16} />,
        },
      ],
    },
    {
      title: 'Agent Providers',
      infoTooltip: `Agent mode uses the Claude Code SDK with a few extensions for added functionality in Nimbalyst.

Has full MCP support with file system access, multi-file operations, and session persistence. Can use a Claude Code monthly plan from Anthropic.

Best for complex coding tasks.`,
      items: [
        {
          id: 'claude-code',
          name: 'Claude Agent',
          icon: getProviderIcon('claude-code', { size: 16 }),
          statusDot: getStatusDot('claude-code'),
        },
        {
          id: 'openai-codex',
          name: 'OpenAI Codex',
          icon: getProviderIcon('openai', { size: 16 }),
          statusDot: getStatusDot('openai-codex'),
          hidden: isProduction,
        },
      ],
    },
    {
      title: 'Chat Providers',
      infoTooltip: `Chat mode is a quicker, more focused tool that is limited to reading and writing your currently open file.

Uses direct API calls with files attached as context. Faster responses, simpler behavior. Includes local model support via LM Studio.

Best for quick edits and tasks that do not require multi-file operations.`,
      items: [
        {
          id: 'claude',
          name: 'Claude Chat',
          icon: getProviderIcon('claude', { size: 16 }),
          statusDot: getStatusDot('claude'),
        },
        {
          id: 'openai',
          name: 'OpenAI',
          icon: getProviderIcon('openai', { size: 16 }),
          statusDot: getStatusDot('openai'),
        },
        {
          id: 'lmstudio',
          name: 'LM Studio',
          icon: getProviderIcon('lmstudio', { size: 16 }),
          statusDot: getStatusDot('lmstudio'),
        },
      ],
    },
    {
      title: 'Project',
      items: [
        {
          id: 'tool-packages',
          name: 'Tool Packages',
          icon: <MaterialSymbol icon="package_2" size={16} />,
          badge: totalPackageCount > 0 ? `${installedPackageCount}/${totalPackageCount}` : undefined,
        },
        {
          id: 'agent-permissions',
          name: 'Agent Permissions',
          icon: <MaterialSymbol icon="shield" size={16} />,
        },
      ],
    },
    {
      title: 'Extensions',
      items: [
        {
          id: 'installed-extensions',
          name: 'Installed',
          icon: <MaterialSymbol icon="extension" size={16} />,
        },
        {
          id: 'mcp-servers',
          name: 'MCP Servers',
          icon: <MaterialSymbol icon="dns" size={16} />,
        },
      ],
    },
  ];

  // Filter groups based on scope
  // Project scope: Show Project group, Agent/Chat Providers (for overrides), Extensions
  // User scope: Show Agent/Chat Providers, Application, Extensions (not Project)
  const filteredGroups = scope === 'project'
    ? [
        categoryGroups.find(g => g.title === 'Project')!,
        categoryGroups.find(g => g.title === 'Agent Providers')!,
        categoryGroups.find(g => g.title === 'Chat Providers')!,
        categoryGroups.find(g => g.title === 'Extensions')!,
      ].filter(Boolean)
    : categoryGroups.filter(g => g.title !== 'Project');

  const [tooltip, setTooltip] = useState<{ text: string; top: number; left: number } | null>(null);

  const handleTooltipEnter = (event: React.MouseEvent<HTMLSpanElement>, text: string) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setTooltip({
      text,
      top: rect.top + rect.height / 2,
      left: rect.right + 12,
    });
  };

  const handleTooltipLeave = () => {
    setTooltip(null);
  };

  return (
    <div className="settings-sidebar">
      <div className="settings-sidebar-content">
        {filteredGroups.map((group) => (
          <div key={group.title} className="settings-sidebar-group">
            <div className="settings-sidebar-group-title">
              {group.title}
              {group.infoTooltip && (
                <span
                  className="settings-sidebar-group-info"
                  onMouseEnter={(event) => handleTooltipEnter(event, group.infoTooltip!)}
                  onMouseLeave={handleTooltipLeave}
                >
                  <MaterialSymbol icon="info" size={14} />
                </span>
              )}
            </div>
            {group.items
              .filter((item) => !item.hidden)
              .map((item) => (
                <div
                  key={item.id}
                  className={`settings-sidebar-item ${selectedCategory === item.id ? 'active' : ''}`}
                  onClick={() => onSelectCategory(item.id)}
                >
                  <span className="settings-sidebar-item-icon">{item.icon}</span>
                  <span className="settings-sidebar-item-name">{item.name}</span>
                  {item.badge && <span className="settings-sidebar-item-badge">{item.badge}</span>}
                  {item.statusDot && <span className={`settings-sidebar-item-status ${item.statusDot}`} />}
                </div>
              ))}
          </div>
        ))}
      </div>
      {tooltip &&
        createPortal(
          <div
            className="settings-sidebar-tooltip"
            style={{ top: `${tooltip.top}px`, left: `${tooltip.left}px` }}
          >
            {tooltip.text}
          </div>,
          document.body
        )}
    </div>
  );
};
