import React from 'react';
import { MaterialSymbol, getProviderIcon } from '@nimbalyst/runtime';

export type SettingsCategory =
  | 'tool-packages'
  | 'claude-code'
  | 'claude'
  | 'openai'
  | 'openai-codex'
  | 'lmstudio'
  | 'notifications'
  | 'sync'
  | 'advanced'
  | 'mcp-servers'
  | 'marketplace'
  | 'installed';

interface CategoryGroup {
  title: string;
  items: CategoryItem[];
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
      title: 'AI Providers',
      items: [
        {
          id: 'claude-code',
          name: 'Claude Agent',
          icon: getProviderIcon('claude-code', { size: 16 }),
          statusDot: getStatusDot('claude-code'),
        },
        {
          id: 'claude',
          name: 'Claude API',
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
          id: 'openai-codex',
          name: 'OpenAI Codex',
          icon: getProviderIcon('openai', { size: 16 }),
          statusDot: getStatusDot('openai-codex'),
          hidden: isProduction,
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
      ],
    },
    {
      title: 'Extensions',
      items: [
        {
          id: 'mcp-servers',
          name: 'MCP Servers',
          icon: <MaterialSymbol icon="dns" size={16} />,
        },
      ],
    },
  ];

  // Filter groups based on scope
  // Project scope: Show Project group, AI Providers (for overrides), Extensions
  // User scope: Show AI Providers, Application, Extensions (not Project)
  const filteredGroups = scope === 'project'
    ? [
        categoryGroups.find(g => g.title === 'Project')!,
        categoryGroups.find(g => g.title === 'AI Providers')!,
        categoryGroups.find(g => g.title === 'Extensions')!,
      ].filter(Boolean)
    : categoryGroups.filter(g => g.title !== 'Project');

  return (
    <div className="settings-sidebar">
      {filteredGroups.map((group) => (
        <div key={group.title} className="settings-sidebar-group">
          <div className="settings-sidebar-group-title">{group.title}</div>
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
  );
};
