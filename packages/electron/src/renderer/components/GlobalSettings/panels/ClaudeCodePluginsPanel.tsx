import React, { useState, useEffect } from 'react';
import { usePostHog } from 'posthog-js/react';
import { ErrorBoundary } from '../../ErrorBoundary';
import { useTheme } from '../../../hooks/useTheme';
import './ClaudeCodePluginsPanel.css';

// Marketplace plugin from the official registry
interface MarketplacePlugin {
  name: string;
  description: string;
  author: string;
  homepage?: string;
  source: string;
  category: string;
}

// Installed plugin from local system
interface InstalledPlugin {
  name: string;
  path: string;
  enabled: boolean;
}

// Marketplace data structure from GitHub
interface MarketplaceData {
  plugins: MarketplacePlugin[];
  categories: string[];
  lastUpdated?: string;
}

type ViewState = 'installed' | 'discover';

// Icon configuration for plugin templates
type IconConfig =
  | { type: 'simple-icons'; slug: string }
  | { type: 'material-symbol'; icon: string };

// Icons that are dark/black and need a light color override in dark mode
const DARK_ICONS_NEEDING_LIGHT_OVERRIDE = new Set(['github', 'notion']);

// Map plugin names/categories to icons
const PLUGIN_ICON_CONFIG: Record<string, IconConfig> = {
  // Brand icons
  github: { type: 'simple-icons', slug: 'github' },
  linear: { type: 'simple-icons', slug: 'linear' },
  slack: { type: 'simple-icons', slug: 'slack' },
  notion: { type: 'simple-icons', slug: 'notion' },
  asana: { type: 'simple-icons', slug: 'asana' },
  figma: { type: 'simple-icons', slug: 'figma' },
  vercel: { type: 'simple-icons', slug: 'vercel' },
  sentry: { type: 'simple-icons', slug: 'sentry' },
  stripe: { type: 'simple-icons', slug: 'stripe' },
  firebase: { type: 'simple-icons', slug: 'firebase' },
  supabase: { type: 'simple-icons', slug: 'supabase' },
  pinecone: { type: 'simple-icons', slug: 'pinecone' },
  playwright: { type: 'simple-icons', slug: 'playwright' },
  typescript: { type: 'simple-icons', slug: 'typescript' },
  python: { type: 'simple-icons', slug: 'python' },
  go: { type: 'simple-icons', slug: 'go' },
  rust: { type: 'simple-icons', slug: 'rust' },
  swift: { type: 'simple-icons', slug: 'swift' },
  kotlin: { type: 'simple-icons', slug: 'kotlin' },
  java: { type: 'simple-icons', slug: 'oracle' },
  php: { type: 'simple-icons', slug: 'php' },
  lua: { type: 'simple-icons', slug: 'lua' },
  gitlab: { type: 'simple-icons', slug: 'gitlab' },
  atlassian: { type: 'simple-icons', slug: 'atlassian' },
  huggingface: { type: 'simple-icons', slug: 'huggingface' },

  // Generic icons by category
  development: { type: 'material-symbol', icon: 'code' },
  productivity: { type: 'material-symbol', icon: 'task_alt' },
  database: { type: 'material-symbol', icon: 'storage' },
  testing: { type: 'material-symbol', icon: 'science' },
  security: { type: 'material-symbol', icon: 'shield' },
  learning: { type: 'material-symbol', icon: 'school' },
  design: { type: 'material-symbol', icon: 'brush' },
  monitoring: { type: 'material-symbol', icon: 'monitoring' },
  deployment: { type: 'material-symbol', icon: 'cloud_upload' },
  external: { type: 'material-symbol', icon: 'extension' },
};

// Category labels for display
const CATEGORY_LABELS: Record<string, string> = {
  development: 'Development',
  productivity: 'Productivity',
  database: 'Database',
  testing: 'Testing',
  security: 'Security',
  learning: 'Learning',
  design: 'Design',
  monitoring: 'Monitoring',
  deployment: 'Deployment',
  external: 'External / Community',
};

const CATEGORY_ORDER = [
  'development',
  'productivity',
  'database',
  'testing',
  'security',
  'learning',
  'design',
  'monitoring',
  'deployment',
  'external',
];

// Component to render plugin icon
function PluginIcon({ pluginName, category, isDark }: { pluginName: string; category: string; isDark: boolean }) {
  // Try to find icon by plugin name first
  const nameKey = pluginName.toLowerCase().replace(/[^a-z0-9]/g, '');
  let config = PLUGIN_ICON_CONFIG[nameKey];

  // Fall back to category icon
  if (!config) {
    const categoryKey = category.toLowerCase();
    config = PLUGIN_ICON_CONFIG[categoryKey] || { type: 'material-symbol', icon: 'extension' };
  }

  if (config.type === 'simple-icons') {
    const needsLightOverride = isDark && DARK_ICONS_NEEDING_LIGHT_OVERRIDE.has(config.slug);
    const iconUrl = needsLightOverride
      ? `https://cdn.simpleicons.org/${config.slug}/ffffff`
      : `https://cdn.simpleicons.org/${config.slug}`;

    return (
      <>
        <img
          src={iconUrl}
          alt=""
          className="plugin-icon-img"
          loading="lazy"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
            const fallback = target.nextElementSibling as HTMLElement;
            if (fallback) fallback.style.display = 'flex';
          }}
        />
        <span className="plugin-icon-fallback" style={{ display: 'none' }}>{pluginName[0]}</span>
      </>
    );
  }

  if (config.type === 'material-symbol') {
    return (
      <span className="material-symbols-outlined plugin-icon-material">
        {config.icon}
      </span>
    );
  }

  return <span className="plugin-icon-fallback">{pluginName[0]}</span>;
}

interface ClaudeCodePluginsPanelProps {
  scope?: 'user' | 'workspace';
  workspacePath?: string;
}

function ClaudeCodePluginsPanelInner({ scope = 'user', workspacePath }: ClaudeCodePluginsPanelProps) {
  const posthog = usePostHog();
  const { theme } = useTheme();
  const isDark = theme === 'dark' || theme === 'crystal-dark';

  const [viewState, setViewState] = useState<ViewState>('discover');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marketplace, setMarketplace] = useState<MarketplaceData | null>(null);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlugin, setSelectedPlugin] = useState<MarketplacePlugin | null>(null);
  const [installStatus, setInstallStatus] = useState<Record<string, 'idle' | 'installing' | 'installed' | 'error'>>({});
  const [installMessage, setInstallMessage] = useState<string>('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch marketplace data and installed plugins in parallel
      const [marketplaceResult, installedResult] = await Promise.all([
        window.electronAPI.invoke('claude-plugin:fetch-marketplace'),
        window.electronAPI.invoke('claude-plugin:list-installed'),
      ]);

      if (marketplaceResult.success) {
        setMarketplace(marketplaceResult.data);
      } else {
        setError(marketplaceResult.error || 'Failed to load marketplace');
      }

      if (installedResult.success) {
        setInstalledPlugins(installedResult.data || []);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load plugin data';
      console.error('Failed to load plugin data:', err);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleInstall = async (plugin: MarketplacePlugin) => {
    setInstallStatus(prev => ({ ...prev, [plugin.name]: 'installing' }));
    setInstallMessage(`Installing ${plugin.name}...`);

    try {
      // Pass both plugin name and source to the install handler
      const result = await window.electronAPI.invoke('claude-plugin:install', plugin.name, plugin.source);

      if (result.success) {
        setInstallStatus(prev => ({ ...prev, [plugin.name]: 'installed' }));
        setInstallMessage(`${plugin.name} installed successfully`);

        // Track analytics
        posthog?.capture('claude_plugin_installed', {
          pluginName: plugin.name,
          category: plugin.category,
          source: plugin.source,
        });

        // Refresh installed plugins
        const installedResult = await window.electronAPI.invoke('claude-plugin:list-installed');
        if (installedResult.success) {
          setInstalledPlugins(installedResult.data || []);
        }
      } else {
        setInstallStatus(prev => ({ ...prev, [plugin.name]: 'error' }));
        setInstallMessage(result.error || 'Installation failed');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Installation failed';
      setInstallStatus(prev => ({ ...prev, [plugin.name]: 'error' }));
      setInstallMessage(errorMessage);
    }

    // Clear message after a few seconds
    setTimeout(() => {
      setInstallMessage('');
    }, 5000);
  };

  const handleUninstall = async (pluginName: string) => {
    if (!confirm(`Uninstall ${pluginName}?`)) {
      return;
    }

    try {
      const result = await window.electronAPI.invoke('claude-plugin:uninstall', pluginName);

      if (result.success) {
        setInstallStatus(prev => ({ ...prev, [pluginName]: 'idle' }));
        setInstallMessage(`${pluginName} uninstalled`);

        // Refresh installed plugins
        const installedResult = await window.electronAPI.invoke('claude-plugin:list-installed');
        if (installedResult.success) {
          setInstalledPlugins(installedResult.data || []);
        }
      } else {
        setInstallMessage(result.error || 'Uninstall failed');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Uninstall failed';
      setInstallMessage(errorMessage);
    }

    setTimeout(() => {
      setInstallMessage('');
    }, 5000);
  };

  const isPluginInstalled = (pluginName: string): boolean => {
    return installedPlugins.some(p => p.name.toLowerCase() === pluginName.toLowerCase());
  };

  // Filter plugins by search query
  const filteredPlugins = marketplace?.plugins.filter(plugin => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      plugin.name.toLowerCase().includes(query) ||
      plugin.description.toLowerCase().includes(query) ||
      plugin.author.toLowerCase().includes(query) ||
      plugin.category.toLowerCase().includes(query)
    );
  }) || [];

  // Group plugins by category
  const pluginsByCategory: Record<string, MarketplacePlugin[]> = {};
  filteredPlugins.forEach(plugin => {
    const category = plugin.category.toLowerCase();
    if (!pluginsByCategory[category]) {
      pluginsByCategory[category] = [];
    }
    pluginsByCategory[category].push(plugin);
  });

  if (loading) {
    return (
      <div className="provider-panel">
        <div className="plugin-loading">Loading Claude Code plugins...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="provider-panel">
        <div className="plugin-error">
          Error: {error}
          <button onClick={loadData} className="plugin-retry-button">Retry</button>
        </div>
      </div>
    );
  }

  const renderDiscover = () => (
    <div className="plugin-discover" role="main" aria-label="Plugin discovery">
      {/* Search Bar */}
      <div className="plugin-search" role="search">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search plugins..."
          className="plugin-search-input"
          aria-label="Search Claude Code plugins"
          autoFocus
        />
        {searchQuery && (
          <button
            className="plugin-search-clear"
            onClick={() => setSearchQuery('')}
            aria-label="Clear search"
            title="Clear search"
          >
            x
          </button>
        )}
      </div>

      {/* Plugins by Category */}
      {CATEGORY_ORDER.map(category => {
        const plugins = pluginsByCategory[category];
        if (!plugins || plugins.length === 0) return null;

        return (
          <div key={category} className="plugin-category">
            <h4 className="plugin-category-title">{CATEGORY_LABELS[category] || category}</h4>
            <div className="plugin-grid" role="list" aria-label={CATEGORY_LABELS[category] || category}>
              {plugins.map((plugin) => {
                const installed = isPluginInstalled(plugin.name);
                const status = installStatus[plugin.name] || 'idle';

                return (
                  <div
                    key={plugin.name}
                    className={`plugin-card ${installed ? 'installed' : ''}`}
                    onClick={() => setSelectedPlugin(plugin)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedPlugin(plugin);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`${plugin.name} by ${plugin.author} - ${plugin.description}`}
                  >
                    <div className="plugin-card-header">
                      <div className="plugin-card-icon" aria-hidden="true">
                        <PluginIcon pluginName={plugin.name} category={plugin.category} isDark={isDark} />
                      </div>
                      <div className="plugin-card-name">{plugin.name}</div>
                    </div>
                    <div className="plugin-card-description">{plugin.description}</div>
                    <div className="plugin-card-footer">
                      <span className="plugin-card-author">by {plugin.author}</span>
                      {installed ? (
                        <span className="plugin-card-badge installed">Installed</span>
                      ) : (
                        <button
                          className={`plugin-install-button ${status}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleInstall(plugin);
                          }}
                          disabled={status === 'installing'}
                        >
                          {status === 'installing' ? 'Installing...' : 'Install'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* No results */}
      {filteredPlugins.length === 0 && searchQuery && (
        <div className="plugin-no-results" role="status" aria-live="polite">
          No plugins match "{searchQuery}"
        </div>
      )}
    </div>
  );

  const renderInstalled = () => (
    <div className="plugin-installed-view" role="main" aria-label="Installed plugins">
      {installedPlugins.length === 0 ? (
        <div className="plugin-empty-state">
          <span className="plugin-empty-icon material-symbols-outlined">extension_off</span>
          <p>No plugins installed yet</p>
          <button
            className="plugin-empty-cta"
            onClick={() => setViewState('discover')}
          >
            Browse Plugins
          </button>
        </div>
      ) : (
        <div className="plugin-installed-list" role="list">
          {installedPlugins.map((plugin) => (
            <div key={plugin.name} className="plugin-installed-item" role="listitem">
              <div className="plugin-installed-info">
                <div className="plugin-installed-icon">
                  <PluginIcon pluginName={plugin.name} category="external" isDark={isDark} />
                </div>
                <div className="plugin-installed-details">
                  <div className="plugin-installed-name">{plugin.name}</div>
                  <div className="plugin-installed-path">{plugin.path}</div>
                </div>
              </div>
              <div className="plugin-installed-actions">
                <button
                  className="plugin-uninstall-button"
                  onClick={() => handleUninstall(plugin.name)}
                  aria-label={`Uninstall ${plugin.name}`}
                >
                  Uninstall
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderPluginDetails = () => {
    if (!selectedPlugin) return null;

    const installed = isPluginInstalled(selectedPlugin.name);
    const status = installStatus[selectedPlugin.name] || 'idle';

    return (
      <div className="plugin-details-overlay" onClick={() => setSelectedPlugin(null)}>
        <div className="plugin-details-modal" onClick={(e) => e.stopPropagation()}>
          <button
            className="plugin-details-close"
            onClick={() => setSelectedPlugin(null)}
            aria-label="Close"
          >
            x
          </button>

          <div className="plugin-details-header">
            <div className="plugin-details-icon">
              <PluginIcon pluginName={selectedPlugin.name} category={selectedPlugin.category} isDark={isDark} />
            </div>
            <div className="plugin-details-title">
              <h3>{selectedPlugin.name}</h3>
              <span className="plugin-details-author">by {selectedPlugin.author}</span>
            </div>
          </div>

          <p className="plugin-details-description">{selectedPlugin.description}</p>

          <div className="plugin-details-meta">
            <div className="plugin-details-meta-item">
              <span className="plugin-details-meta-label">Category:</span>
              <span className="plugin-details-meta-value">{CATEGORY_LABELS[selectedPlugin.category.toLowerCase()] || selectedPlugin.category}</span>
            </div>
            {selectedPlugin.homepage && (
              <div className="plugin-details-meta-item">
                <span className="plugin-details-meta-label">Homepage:</span>
                <a
                  href={selectedPlugin.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="plugin-details-link"
                  onClick={() => window.electronAPI.openExternal(selectedPlugin.homepage!)}
                >
                  View Documentation
                </a>
              </div>
            )}
          </div>

          <div className="plugin-details-actions">
            {installed ? (
              <>
                <span className="plugin-details-installed-badge">Installed</span>
                <button
                  className="plugin-uninstall-button"
                  onClick={() => {
                    handleUninstall(selectedPlugin.name);
                    setSelectedPlugin(null);
                  }}
                >
                  Uninstall
                </button>
              </>
            ) : (
              <button
                className={`plugin-details-install-button ${status}`}
                onClick={() => handleInstall(selectedPlugin)}
                disabled={status === 'installing'}
              >
                {status === 'installing' ? 'Installing...' : 'Install Plugin'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="provider-panel">
      <div className="provider-panel-header">
        <h3 className="provider-panel-title">Claude Code Plugins</h3>
        <p className="provider-panel-description">
          Discover and install plugins to extend Claude Code's capabilities.
        </p>
      </div>

      {/* View Switcher */}
      <div className="plugin-view-switcher">
        <button
          className={`plugin-view-button ${viewState === 'discover' ? 'active' : ''}`}
          onClick={() => setViewState('discover')}
        >
          Discover
        </button>
        <button
          className={`plugin-view-button ${viewState === 'installed' ? 'active' : ''}`}
          onClick={() => setViewState('installed')}
        >
          Installed ({installedPlugins.length})
        </button>
      </div>

      {/* Status Message */}
      {installMessage && (
        <div className="plugin-status-message" role="status" aria-live="polite">
          {installMessage}
        </div>
      )}

      {/* Content */}
      <div className="plugin-content">
        {viewState === 'discover' && renderDiscover()}
        {viewState === 'installed' && renderInstalled()}
      </div>

      {/* Plugin Details Modal */}
      {selectedPlugin && renderPluginDetails()}
    </div>
  );
}

export function ClaudeCodePluginsPanel(props: ClaudeCodePluginsPanelProps) {
  return (
    <ErrorBoundary
      fallback={
        <div className="provider-panel" role="alert" aria-live="assertive">
          <div className="plugin-error" style={{ padding: '2rem', textAlign: 'center' }}>
            <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>Unable to load Claude Code Plugins</h3>
            <p style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>
              An unexpected error occurred while loading the plugins panel.
              Please try refreshing the application.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="plugin-retry-button"
              style={{
                padding: '0.5rem 1rem',
                background: 'var(--primary-color)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              Reload Application
            </button>
          </div>
        </div>
      }
    >
      <ClaudeCodePluginsPanelInner {...props} />
    </ErrorBoundary>
  );
}
