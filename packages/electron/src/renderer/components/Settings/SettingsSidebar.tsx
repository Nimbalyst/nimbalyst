import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAtomValue } from 'jotai';
import { MaterialSymbol, getProviderIcon } from '@nimbalyst/runtime';
import { releaseChannelAtom } from '../../store/atoms/appSettings';
import { useAlphaFeatures } from '../../hooks/useAlphaFeature';
import { useBetaFeature } from '../../hooks/useBetaFeature';

export type SettingsCategory =
  | 'tool-packages'
  | 'agent-permissions'
  | 'claude-code'
  | 'claude'
  | 'openai'
  | 'openai-codex'
  | 'lmstudio'
  | 'notifications'
  | 'voice-mode'
  | 'sync'
  | 'themes'
  | 'advanced'
  | 'beta-features'
  | 'mcp-servers'
  | 'installed-extensions'
  | 'claude-plugins'
  | 'shared-links'
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
  scope?: SettingsScope;
}

export const SettingsSidebar: React.FC<SettingsSidebarProps> = ({
  selectedCategory,
  onSelectCategory,
  providerStatus = {},
  installedPackageCount = 0,
  totalPackageCount = 0,
  scope = 'user',
}) => {
  // Get release channel and alpha/beta feature flags from Jotai atoms
  const releaseChannel = useAtomValue(releaseChannelAtom);
  const alphaFeatures = useAlphaFeatures(['sync', 'voice-mode', 'claude-plugins', 'openai-codex']);
  const isCodexBetaEnabled = useBetaFeature('codex');

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
          hidden: !alphaFeatures.sync, // Only visible when feature is enabled
        },
        {
          id: 'shared-links',
          name: 'Shared Links',
          icon: <MaterialSymbol icon="link" size={16} />,
          hidden: !alphaFeatures.sync, // Only visible when sync is enabled
        },
        {
          id: 'notifications',
          name: 'Notifications',
          icon: <MaterialSymbol icon="notifications" size={16} />,
        },
        {
          id: 'themes',
          name: 'Themes',
          icon: <MaterialSymbol icon="palette" size={16} />,
        },
        {
          id: 'voice-mode',
          name: 'Voice Mode',
          icon: <MaterialSymbol icon="mic" size={16} />,
          hidden: !alphaFeatures['voice-mode'], // Only visible when feature is enabled
        },
        {
          id: 'advanced',
          name: 'Advanced',
          icon: <MaterialSymbol icon="settings" size={16} />,
        },
        {
          id: 'beta-features',
          name: 'Beta Features',
          icon: <MaterialSymbol icon="science" size={16} />,
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
          hidden: !alphaFeatures['openai-codex'] || !isCodexBetaEnabled,
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
          id: 'claude-plugins',
          name: 'Claude Plugins',
          icon: <MaterialSymbol icon="widgets" size={16} />,
          hidden: !alphaFeatures['claude-plugins'],
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
    <div className="settings-sidebar w-[220px] shrink-0 border-r border-[var(--nim-border)] bg-[var(--nim-bg)] overflow-y-auto">
      <div className="settings-sidebar-content p-3">
        {filteredGroups.map((group) => (
          <div key={group.title} className="settings-sidebar-group mb-4">
            <div className="settings-sidebar-group-title flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--nim-text-muted)]">
              {group.title}
              {group.infoTooltip && (
                <span
                  className="settings-sidebar-group-info cursor-help text-[var(--nim-text-faint)] hover:text-[var(--nim-text-muted)] transition-colors"
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
                  className={`settings-sidebar-item flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm transition-colors ${
                    selectedCategory === item.id
                      ? 'bg-[var(--nim-bg-selected)] text-[var(--nim-text)]'
                      : 'text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]'
                  }`}
                  onClick={() => onSelectCategory(item.id)}
                >
                  <span className="settings-sidebar-item-icon flex items-center justify-center w-5 h-5 shrink-0 text-[var(--nim-text-muted)]">{item.icon}</span>
                  <span className="settings-sidebar-item-name flex-1 truncate">{item.name}</span>
                  {item.badge && (
                    <span className="settings-sidebar-item-badge text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)]">
                      {item.badge}
                    </span>
                  )}
                  {item.statusDot && (
                    <span
                      className={`settings-sidebar-item-status w-2 h-2 rounded-full shrink-0 ${
                        item.statusDot === 'success'
                          ? 'bg-[var(--nim-success)]'
                          : item.statusDot === 'error'
                          ? 'bg-[var(--nim-error)]'
                          : 'bg-[var(--nim-warning)]'
                      }`}
                    />
                  )}
                </div>
              ))}
          </div>
        ))}
      </div>
      {tooltip &&
        createPortal(
          <div
            className="settings-sidebar-tooltip fixed z-[10000] max-w-[280px] px-3 py-2 bg-[var(--nim-bg-tertiary)] border border-[var(--nim-border)] rounded-lg shadow-lg text-sm text-[var(--nim-text)] whitespace-pre-wrap pointer-events-none transform -translate-y-1/2"
            style={{ top: `${tooltip.top}px`, left: `${tooltip.left}px` }}
          >
            {tooltip.text}
          </div>,
          document.body
        )}
    </div>
  );
};
