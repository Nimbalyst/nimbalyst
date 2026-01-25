import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePostHog } from 'posthog-js/react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { ErrorBoundary } from '../../ErrorBoundary';
import { useTheme } from '../../../hooks/useTheme';

interface MCPServerConfig {
  command?: string;
  args?: string[];
  url?: string;
  type?: 'stdio' | 'sse' | 'http';
  headers?: Record<string, string>;
  env?: Record<string, string>;
  disabled?: boolean;
}

interface MCPServerWithName extends MCPServerConfig {
  name: string;
}

interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

interface MCPServerTemplate {
  id: string;
  name: string;
  description: string;
  docsUrl?: string;
  /** Authentication type: 'oauth' uses mcp-remote for browser-based login, 'api-key' requires manual key */
  authType?: 'oauth' | 'api-key' | 'none';
  config: MCPServerConfig;
}

// Icon configuration for MCP server templates
// Uses Simple Icons CDN for brand icons, Material Symbols for generic tools
type IconConfig =
  | { type: 'simple-icons'; slug: string }
  | { type: 'material-symbol'; icon: string }
  | { type: 'url'; url: string };

// Icons that are dark/black and need a light color override in dark mode
// Most brand icons have colorful logos that work on both light and dark backgrounds
const DARK_ICONS_NEEDING_LIGHT_OVERRIDE = new Set(['github', 'notion']);

const TEMPLATE_ICON_CONFIG: Record<string, IconConfig> = {
  // Brand icons from Simple Icons CDN
  linear: { type: 'simple-icons', slug: 'linear' },
  github: { type: 'simple-icons', slug: 'github' },
  'brave-search': { type: 'simple-icons', slug: 'brave' },
  posthog: { type: 'simple-icons', slug: 'posthog' },
  atlassian: { type: 'simple-icons', slug: 'atlassian' },
  notion: { type: 'simple-icons', slug: 'notion' },
  asana: { type: 'simple-icons', slug: 'asana' },
  zapier: { type: 'simple-icons', slug: 'zapier' },
  aws: { type: 'url', url: 'https://cdn.jsdelivr.net/npm/simple-icons/icons/amazonwebservices.svg' },
  stripe: { type: 'simple-icons', slug: 'stripe' },
  snowflake: { type: 'simple-icons', slug: 'snowflake' },
  shopify: { type: 'simple-icons', slug: 'shopify' },
  'chrome-devtools': { type: 'simple-icons', slug: 'googlechrome' },
  playwright: { type: 'simple-icons', slug: 'playwright' },
  context7: { type: 'simple-icons', slug: 'upstash' },
  sentry: { type: 'simple-icons', slug: 'sentry' },
  corridor: { type: 'material-symbol', icon: 'vpn_key' },

  // Generic tools using Material Symbols
  filesystem: { type: 'material-symbol', icon: 'folder' },
  fetch: { type: 'material-symbol', icon: 'cloud_download' },
  'sequential-thinking': { type: 'material-symbol', icon: 'psychology' },
  'knowledge-graph-memory': { type: 'material-symbol', icon: 'hub' },
  serena: { type: 'material-symbol', icon: 'code' }
};

// Component to render MCP server icon
function MCPServerIcon({ templateId, name, isDark }: { templateId: string; name: string; isDark: boolean }) {
  const config = TEMPLATE_ICON_CONFIG[templateId];

  if (!config) {
    // Fallback to first letter
    return <span className="mcp-icon-fallback text-sm font-semibold text-[var(--nim-text-muted)] flex items-center justify-center w-full h-full">{name[0]}</span>;
  }

  if (config.type === 'simple-icons') {
    // Simple Icons CDN supports color parameters:
    // - Default brand color: https://cdn.simpleicons.org/{slug}
    // - Custom color: https://cdn.simpleicons.org/{slug}/{color}
    // Most brand icons have colorful logos that work on both backgrounds.
    // Only override dark/black icons (like GitHub, Notion) in dark mode.
    const needsLightOverride = isDark && DARK_ICONS_NEEDING_LIGHT_OVERRIDE.has(config.slug);
    const iconUrl = needsLightOverride
      ? `https://cdn.simpleicons.org/${config.slug}/ffffff`
      : `https://cdn.simpleicons.org/${config.slug}`;

    return (
      <img
        src={iconUrl}
        alt=""
        className="mcp-icon-img w-5 h-5 object-contain"
        loading="lazy"
        onError={(e) => {
          // Hide image on error and show fallback
          const target = e.target as HTMLImageElement;
          target.style.display = 'none';
          const fallback = target.nextElementSibling as HTMLElement;
          if (fallback) fallback.style.display = 'flex';
        }}
      />
    );
  }

  if (config.type === 'material-symbol') {
    return (
      <span className="material-symbols-outlined mcp-icon-material text-xl text-[var(--nim-text-muted)]">
        {config.icon}
      </span>
    );
  }

  if (config.type === 'url') {
    return (
      <img
        src={config.url}
        alt=""
        className="mcp-icon-img w-5 h-5 object-contain"
        loading="lazy"
      />
    );
  }

  return <span className="mcp-icon-fallback text-sm font-semibold text-[var(--nim-text-muted)] flex items-center justify-center w-full h-full">{name[0]}</span>;
}

// Template categories
type TemplateCategory = 'development' | 'productivity' | 'automation' | 'ai' | 'commerce' | 'data' | 'search' | 'files';

const TEMPLATE_CATEGORIES: Record<string, TemplateCategory> = {
  github: 'development',
  playwright: 'development',
  context7: 'development',
  'chrome-devtools': 'development',
  serena: 'development',
  sentry: 'development',
  corridor: 'development',
  linear: 'productivity',
  asana: 'productivity',
  atlassian: 'productivity',
  notion: 'productivity',
  zapier: 'automation',
  'sequential-thinking': 'ai',
  'knowledge-graph-memory': 'ai',
  stripe: 'commerce',
  shopify: 'commerce',
  posthog: 'data',
  snowflake: 'data',
  aws: 'data',
  'brave-search': 'search',
  fetch: 'search',
  filesystem: 'files'
};

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  development: 'Development',
  productivity: 'Productivity & Project Management',
  automation: 'Automation & Workflows',
  ai: 'AI & Reasoning',
  commerce: 'Commerce & Payments',
  data: 'Data & Analytics',
  search: 'Search',
  files: 'Files & Storage'
};

const CATEGORY_ORDER: TemplateCategory[] = ['development', 'productivity', 'automation', 'ai', 'commerce', 'data', 'search', 'files'];

// Help text for common env vars
const ENV_VAR_HELP: Record<string, { label: string; help: string; link?: string }> = {
  GITHUB_PERSONAL_ACCESS_TOKEN: {
    label: 'GitHub Personal Access Token',
    help: 'Create a PAT with repo scope',
    link: 'https://github.com/settings/tokens/new?scopes=repo'
  },
  BRAVE_API_KEY: {
    label: 'Brave Search API Key',
    help: 'Get from Brave Search API dashboard',
    link: 'https://brave.com/search/api/'
  },
  POSTHOG_PERSONAL_API_KEY: {
    label: 'PostHog Personal API Key',
    help: 'Get from PostHog > Settings > Personal API Keys',
    link: 'https://app.posthog.com/settings/user-api-keys'
  },
  CORRIDOR_API_KEY: {
    label: 'Corridor API Key',
    help: 'Get from Corridor dashboard',
    link: 'https://app.corridor.dev'
  },
  AWS_ACCESS_KEY_ID: {
    label: 'AWS Access Key ID',
    help: 'Get from AWS IAM console',
    link: 'https://console.aws.amazon.com/iam/'
  },
  AWS_SECRET_ACCESS_KEY: {
    label: 'AWS Secret Access Key',
    help: 'Get from AWS IAM console when creating access key'
  },
  AWS_REGION: {
    label: 'AWS Region',
    help: 'AWS region (default: us-east-1)'
  },
  STRIPE_SECRET_KEY: {
    label: 'Stripe Secret Key',
    help: 'Get from Stripe Dashboard > Developers > API keys',
    link: 'https://dashboard.stripe.com/apikeys'
  },
  SNOWFLAKE_ACCOUNT: {
    label: 'Snowflake Account',
    help: 'Your Snowflake account identifier'
  },
  SNOWFLAKE_USER: {
    label: 'Snowflake Username',
    help: 'Your Snowflake username'
  },
  SNOWFLAKE_PASSWORD: {
    label: 'Snowflake Password',
    help: 'Your Snowflake password'
  },
  SNOWFLAKE_WAREHOUSE: {
    label: 'Snowflake Warehouse',
    help: 'The warehouse to use for queries'
  },
  ZAPIER_MCP_URL: {
    label: 'Zapier MCP URL',
    help: 'Get your personal MCP URL from Zapier MCP dashboard',
    link: 'https://zapier.com/mcp'
  },
  FILESYSTEM_ALLOWED_DIR: {
    label: 'Allowed Directory',
    help: 'Directory path the server is allowed to access (e.g., /Users/you/projects)'
  }
};

const MCP_SERVER_TEMPLATES: MCPServerTemplate[] = [
  {
    id: 'linear',
    name: 'Linear',
    description: 'Issue tracking and project management',
    docsUrl: 'https://linear.app/docs/mcp',
    authType: 'oauth',
    config: {
      command: 'npx',
      args: ['-y', 'mcp-remote', 'https://mcp.linear.app/mcp']
    }
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repository management and code collaboration',
    docsUrl: 'https://github.com/github/github-mcp-server',
    authType: 'api-key',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_PERSONAL_ACCESS_TOKEN}'
      }
    }
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Local file system access (configure allowed directories)',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    authType: 'none',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '${FILESYSTEM_ALLOWED_DIR}'],
      env: {
        FILESYSTEM_ALLOWED_DIR: ''
      }
    }
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web search capabilities',
    docsUrl: 'https://github.com/brave/brave-search-mcp-server',
    authType: 'api-key',
    config: {
      command: 'npx',
      args: ['-y', '@brave/brave-search-mcp-server'],
      env: {
        BRAVE_API_KEY: '${BRAVE_API_KEY}'
      }
    }
  },
  {
    id: 'posthog',
    name: 'PostHog',
    description: 'Product analytics, feature flags, and error tracking',
    docsUrl: 'https://posthog.com/docs/model-context-protocol',
    authType: 'api-key',
    config: {
      command: 'npx',
      args: [
        '-y',
        'mcp-remote@latest',
        'https://mcp.posthog.com/sse',
        '--header',
        'Authorization:Bearer ${POSTHOG_PERSONAL_API_KEY}'
      ],
      env: {
        POSTHOG_PERSONAL_API_KEY: ''
      }
    }
  },
  {
    id: 'atlassian',
    name: 'Atlassian',
    description: 'Jira and Confluence access',
    docsUrl: 'https://www.atlassian.com/blog/announcements/remote-mcp-server',
    authType: 'oauth',
    config: {
      command: 'npx',
      args: ['-y', 'mcp-remote', 'https://mcp.atlassian.com/v1/sse']
    }
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Workspace and page management',
    docsUrl: 'https://developers.notion.com/docs/mcp',
    authType: 'oauth',
    config: {
      command: 'npx',
      args: ['-y', 'mcp-remote', 'https://mcp.notion.com/mcp']
    }
  },
  {
    id: 'asana',
    name: 'Asana',
    description: 'Task and project management',
    docsUrl: 'https://developers.asana.com/docs/mcp-server',
    authType: 'oauth',
    config: {
      command: 'npx',
      args: ['-y', 'mcp-remote', 'https://mcp.asana.com/sse']
    }
  },
  {
    id: 'playwright',
    name: 'Playwright',
    description: 'Browser automation and testing',
    docsUrl: 'https://github.com/microsoft/playwright-mcp',
    authType: 'none',
    config: {
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
      env: {}
    }
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Error tracking and performance monitoring',
    docsUrl: 'https://docs.sentry.io/product/sentry-mcp/',
    authType: 'oauth',
    config: {
      type: 'http',
      url: 'https://mcp.sentry.dev/mcp'
    }
  },
  {
    id: 'corridor',
    name: 'Corridor',
    description: 'Infrastructure access and management',
    docsUrl: 'https://corridor.dev',
    authType: 'api-key',
    config: {
      type: 'http',
      url: 'https://app.corridor.dev/api/mcp',
      headers: {
        Authorization: 'Bearer ${CORRIDOR_API_KEY}'
      },
      env: {
        CORRIDOR_API_KEY: ''
      }
    }
  },
  {
    id: 'context7',
    name: 'Context7',
    description: 'Up-to-date documentation context for LLMs',
    docsUrl: 'https://github.com/upstash/context7',
    authType: 'none',
    config: {
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp@latest'],
      env: {}
    }
  },
  {
    id: 'zapier',
    name: 'Zapier',
    description: 'Automation and app integrations (requires MCP URL from Zapier)',
    docsUrl: 'https://zapier.com/mcp',
    authType: 'api-key',
    config: {
      command: 'npx',
      args: ['-y', 'mcp-remote', '${ZAPIER_MCP_URL}'],
      env: {
        ZAPIER_MCP_URL: ''
      }
    }
  },
  {
    id: 'aws',
    name: 'AWS',
    description: 'Amazon Web Services cloud management',
    docsUrl: 'https://github.com/awslabs/mcp',
    authType: 'api-key',
    config: {
      command: 'uvx',
      args: ['awslabs.aws-api-mcp-server@latest'],
      env: {
        AWS_ACCESS_KEY_ID: '${AWS_ACCESS_KEY_ID}',
        AWS_SECRET_ACCESS_KEY: '${AWS_SECRET_ACCESS_KEY}',
        AWS_REGION: '${AWS_REGION:-us-east-1}'
      }
    }
  },
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Payment processing and management',
    docsUrl: 'https://docs.stripe.com/mcp',
    authType: 'api-key',
    config: {
      command: 'npx',
      args: ['-y', '@stripe/mcp', '--tools=all'],
      env: {
        STRIPE_SECRET_KEY: '${STRIPE_SECRET_KEY}'
      }
    }
  },
  {
    id: 'snowflake',
    name: 'Snowflake',
    description: 'Cloud data warehouse queries',
    docsUrl: 'https://github.com/Snowflake-Labs/mcp',
    authType: 'api-key',
    config: {
      command: 'uvx',
      args: ['snowflake-labs-mcp'],
      env: {
        SNOWFLAKE_ACCOUNT: '${SNOWFLAKE_ACCOUNT}',
        SNOWFLAKE_USER: '${SNOWFLAKE_USER}',
        SNOWFLAKE_PASSWORD: '${SNOWFLAKE_PASSWORD}',
        SNOWFLAKE_WAREHOUSE: '${SNOWFLAKE_WAREHOUSE}'
      }
    }
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Step-by-step reasoning and problem solving',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    authType: 'none',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
      env: {}
    }
  },
  {
    id: 'shopify',
    name: 'Shopify Dev',
    description: 'Shopify development documentation and API schemas',
    docsUrl: 'https://shopify.dev/docs/apps/build/devmcp',
    authType: 'none',
    config: {
      command: 'npx',
      args: ['-y', '@shopify/dev-mcp@latest'],
      env: {}
    }
  },
  {
    id: 'fetch',
    name: 'Fetch',
    description: 'HTTP requests and web content retrieval',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    authType: 'none',
    config: {
      command: 'uvx',
      args: ['mcp-server-fetch'],
      env: {}
    }
  },
  {
    id: 'chrome-devtools',
    name: 'Chrome DevTools',
    description: 'Browser debugging and inspection',
    docsUrl: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
    authType: 'none',
    config: {
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest'],
      env: {}
    }
  },
  {
    id: 'knowledge-graph-memory',
    name: 'Knowledge Graph Memory',
    description: 'Persistent memory with knowledge graphs',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    authType: 'none',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      env: {}
    }
  },
  {
    id: 'serena',
    name: 'Serena',
    description: 'Semantic code retrieval and editing for codebases',
    docsUrl: 'https://github.com/oraios/serena',
    authType: 'none',
    config: {
      command: 'uvx',
      args: ['--from', 'git+https://github.com/oraios/serena', 'serena', 'start-mcp-server'],
      env: {}
    }
  }
];

type ViewState = 'list' | 'template-selection' | 'server-config';

interface MCPServersPanelProps {
  /** Scope for MCP config: 'user' for global, 'workspace' for project-specific. */
  scope?: 'user' | 'workspace';
  /** Workspace path required when scope is 'workspace'. */
  workspacePath?: string;
}

function MCPServersPanelInner({ scope = 'user', workspacePath }: MCPServersPanelProps = {}) {
  const posthog = usePostHog();
  const { theme } = useTheme();
  const isDark = theme === 'dark' || theme === 'crystal-dark';
  const [servers, setServers] = useState<MCPServerWithName[]>([]);
  const [selectedServer, setSelectedServer] = useState<MCPServerWithName | null>(null);
  const [viewState, setViewState] = useState<ViewState>('list');
  const [selectedTemplate, setSelectedTemplate] = useState<MCPServerTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Form state
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'stdio' | 'sse' | 'http'>('stdio');
  const [formCommand, setFormCommand] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formArgs, setFormArgs] = useState<string[]>([]);
  const [formEnv, setFormEnv] = useState<Array<{ key: string; value: string }>>([]);
  const [formHeaders, setFormHeaders] = useState<Array<{ key: string; value: string }>>([]);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState<string>('');
  const [testHelpUrl, setTestHelpUrl] = useState<string | null>(null);
  const [isStalePortError, setIsStalePortError] = useState(false);

  // OAuth state
  const [oauthStatus, setOauthStatus] = useState<'unknown' | 'checking' | 'authorized' | 'not-authorized'>('unknown');
  const [oauthAction, setOauthAction] = useState<'idle' | 'authorizing' | 'revoking' | 'clearing-cache'>('idle');

  // Track OAuth status for all servers in the list
  const [serverOAuthStatuses, setServerOAuthStatuses] = useState<Record<string, 'unknown' | 'checking' | 'authorized' | 'not-authorized'>>({});

  // Template search
  const [templateSearch, setTemplateSearch] = useState('');

  // Track if we're currently making changes (to ignore file watcher updates)
  // Use ref instead of state because the callback closure needs current value
  const isLocalChangeRef = useRef(false);

  // Define loadServers before the useEffects that use it
  const loadServers = useCallback(async () => {
    const loadStart = performance.now();
    try {
      setLoading(true);
      setError(null);

      console.log('[MCPServersPanel] loadServers called with scope:', scope, 'workspace:', workspacePath);

      const ipcStart = performance.now();
      const config: MCPConfig = scope === 'workspace' && workspacePath
        ? await window.electronAPI.invoke('mcp-config:read-workspace', workspacePath)
        : await window.electronAPI.invoke('mcp-config:read-user');
      const ipcDuration = performance.now() - ipcStart;
      if (ipcDuration > 500) {
        console.warn(`[MCPServersPanel] loadServers IPC call took ${ipcDuration.toFixed(0)}ms (>500ms threshold)`);
      }

      console.log('[MCPServersPanel] Loaded config:', Object.keys(config.mcpServers));

      const serverList: MCPServerWithName[] = Object.entries(config.mcpServers || {}).map(
        ([name, serverConfig]) => ({
          name,
          ...serverConfig
        })
      );

      setServers(serverList);
      const loadDuration = performance.now() - loadStart;
      if (loadDuration > 1000) {
        console.warn(`[MCPServersPanel] loadServers completed in ${loadDuration.toFixed(0)}ms (>1s threshold)`);
      }
    } catch (err: unknown) {
      const loadDuration = performance.now() - loadStart;
      console.error(`Failed to load MCP servers after ${loadDuration.toFixed(0)}ms:`, err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to load MCP servers';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [scope, workspacePath]);

  // Reload servers when scope or workspace path changes
  useEffect(() => {
    loadServers();
  }, [loadServers]);

  // Listen for external config changes (file watcher) and reload
  useEffect(() => {
    if (!window.electronAPI?.onMcpConfigChanged) {
      return;
    }

    const cleanup = window.electronAPI.onMcpConfigChanged((data) => {
      console.log('[MCPServersPanel] File watcher event received:', {
        eventData: data,
        currentScope: scope,
        currentWorkspace: workspacePath,
        isLocalChangeFlag: isLocalChangeRef.current
      });

      // Only reload if this is an external change (not from our own saves/deletes)
      if (isLocalChangeRef.current) {
        console.log('[MCPServersPanel] Ignoring file watcher event - local change in progress');
        return;
      }

      // Check if this event is relevant to our scope
      const isRelevant =
        (data.scope === 'user' && scope === 'user') ||
        (data.scope === 'workspace' && scope === 'workspace' && data.workspacePath === workspacePath);

      console.log('[MCPServersPanel] Event relevance check:', { isRelevant, reason: isRelevant ? 'will reload' : 'ignoring - not relevant' });

      if (isRelevant) {
        console.log('[MCPServersPanel] Reloading due to external config change:', data);
        loadServers();
      }
    });

    return cleanup;
  }, [scope, workspacePath, loadServers]);

  // Check OAuth status for all servers when they're loaded
  useEffect(() => {
    const oauthServers = servers.filter(s => isOAuthServer(s));
    if (oauthServers.length > 0) {
      console.log(`[MCPServersPanel] Starting OAuth status check for ${oauthServers.length} server(s)`);
      const startTime = performance.now();
      let completedCount = 0;

      oauthServers.forEach(server => {
        const serverStart = performance.now();
        checkServerOAuthStatus(server.name, server).finally(() => {
          const serverDuration = performance.now() - serverStart;
          completedCount++;
          if (serverDuration > 1000) {
            console.warn(`[MCPServersPanel] OAuth check for "${server.name}" took ${serverDuration.toFixed(0)}ms (>1s threshold)`);
          }
          if (completedCount === oauthServers.length) {
            const totalDuration = performance.now() - startTime;
            if (totalDuration > 2000) {
              console.warn(`[MCPServersPanel] All OAuth checks completed in ${totalDuration.toFixed(0)}ms total (>2s threshold)`);
            }
          }
        });
      });
    }
  }, [servers]);

  const handleServerSelect = (server: MCPServerWithName) => {
    setSelectedServer(server);
    setSelectedTemplate(null);
    setViewState('list');
    setSaveStatus('idle');
    setTestStatus('idle');
    setTestMessage('');

    // Populate form
    setFormName(server.name);
    setFormType(server.type || 'stdio');
    setFormCommand(server.command || '');
    setFormUrl(server.url || '');
    setFormArgs(server.args || []);
    setFormEnv(
      Object.entries(server.env || {}).map(([key, value]) => ({ key, value }))
    );
    setFormHeaders(
      Object.entries(server.headers || {}).map(([key, value]) => ({ key, value }))
    );

    // Check OAuth status for mcp-remote servers and HTTP transport
    if (isOAuthServer(server)) {
      checkOAuthStatus(server);
    } else {
      setOauthStatus('unknown');
    }
  };

  const handleNewServer = () => {
    setViewState('template-selection');
    setSelectedServer(null);
    setSelectedTemplate(null);
    setSaveStatus('idle');
    setTestStatus('idle');
    setTestMessage('');
  };

  const handleTemplateSelect = (template: MCPServerTemplate | null) => {
    setSelectedTemplate(template);
    setViewState('server-config');
    setSelectedServer(null);
    setTestStatus('idle');
    setTestMessage('');

    if (template) {
      // Populate form with template
      setFormName(template.id);
      setFormType(template.config.type || 'stdio');
      setFormCommand(template.config.command || '');
      setFormUrl(template.config.url || '');
      setFormArgs(template.config.args || []);
      // For env vars, extract required ones with empty values for user to fill
      setFormEnv(
        Object.entries(template.config.env || {}).map(([key, value]) => ({
          key,
          value: value.startsWith('${') ? '' : value
        }))
      );
      // For headers, extract and expand env vars in values
      setFormHeaders(
        Object.entries(template.config.headers || {}).map(([key, value]) => ({
          key,
          value: value.startsWith('${') ? '' : value
        }))
      );

      if (template.authType === 'oauth') {
        checkOAuthStatus(template.config);
      } else {
        setOauthStatus('unknown');
      }
    } else {
      // Start from scratch
      setFormName('');
      setFormType('stdio');
      setFormCommand('');
      setFormUrl('');
      setFormArgs([]);
      setFormEnv([]);
      setFormHeaders([]);
      setOauthStatus('unknown');
    }
  };

  const handleBackToTemplates = () => {
    setViewState('template-selection');
    setSelectedTemplate(null);
  };

  const handleBackToList = () => {
    setViewState('list');
    setSelectedTemplate(null);
  };

  /**
   * Extract the server URL from mcp-remote args or http config
   */
  const getOAuthServerUrl = (config: MCPServerConfig): string | null => {
    // HTTP transport - use the URL directly
    if (config.type === 'http' && config.url) {
      return config.url;
    }

    // stdio with mcp-remote - extract URL from args
    const args = config.args || [];
    for (const arg of args) {
      if (arg.startsWith('http://') || arg.startsWith('https://')) {
        return arg;
      }
    }
    return null;
  };

  /**
   * Check if this is an OAuth server (uses mcp-remote or http transport)
   */
  const isOAuthServer = (config: MCPServerConfig): boolean => {
    // HTTP transport - check if it uses API key auth via headers (Bearer token)
    // If it has an Authorization header with a template variable, it uses API key, not OAuth
    if (config.type === 'http') {
      const authHeader = config.headers?.Authorization || config.headers?.authorization;
      if (authHeader && (authHeader.includes('${') || authHeader.startsWith('Bearer '))) {
        // Has API key in headers, not OAuth
        return false;
      }
      // HTTP without API key headers = OAuth
      return true;
    }

    // stdio with mcp-remote explicitly
    return config.command === 'npx' &&
           Boolean(config.args?.some(arg => arg === 'mcp-remote' || arg.includes('mcp-remote')));
  };

  /**
   * Check OAuth authorization status for a specific server (for list display)
   */
  const checkServerOAuthStatus = async (serverName: string, config: MCPServerConfig) => {
    if (!isOAuthServer(config)) {
      return;
    }

    const serverUrl = getOAuthServerUrl(config);
    if (!serverUrl) {
      setServerOAuthStatuses(prev => ({ ...prev, [serverName]: 'unknown' }));
      return;
    }

    setServerOAuthStatuses(prev => ({ ...prev, [serverName]: 'checking' }));
    const ipcStart = performance.now();
    try {
      const result = await window.electronAPI.invoke('mcp-config:check-oauth-status', serverUrl);
      const ipcDuration = performance.now() - ipcStart;
      if (ipcDuration > 1000) {
        console.warn(`[MCPServersPanel] IPC call for "${serverName}" OAuth check took ${ipcDuration.toFixed(0)}ms (>1s threshold)`);
      }
      setServerOAuthStatuses(prev => ({
        ...prev,
        [serverName]: result.authorized ? 'authorized' : 'not-authorized'
      }));
    } catch (error) {
      const ipcDuration = performance.now() - ipcStart;
      console.error(`Failed to check OAuth status for "${serverName}" after ${ipcDuration.toFixed(0)}ms:`, error);
      setServerOAuthStatuses(prev => ({ ...prev, [serverName]: 'unknown' }));
    }
  };

  /**
   * Check OAuth authorization status
   */
  const checkOAuthStatus = async (config: MCPServerConfig) => {
    const serverUrl = getOAuthServerUrl(config);
    if (!serverUrl) {
      setOauthStatus('unknown');
      return;
    }

    setOauthStatus('checking');
    try {
      const result = await window.electronAPI.invoke('mcp-config:check-oauth-status', serverUrl);
      setOauthStatus(result.authorized ? 'authorized' : 'not-authorized');
    } catch (error) {
      console.error('Failed to check OAuth status:', error);
      setOauthStatus('unknown');
    }
  };

  /**
   * Trigger OAuth authorization flow
   */
  const handleAuthorize = async () => {
    // Build config from current form state
    const config: MCPServerConfig = {
      type: formType,
      url: formUrl,
      command: formCommand,
      args: formArgs
    };

    const serverUrl = getOAuthServerUrl(config);
    if (!serverUrl) return;

    setOauthAction('authorizing');
    setIsStalePortError(false);
    try {
      const result = await window.electronAPI.invoke('mcp-config:trigger-oauth', serverUrl);
      if (result.success) {
        setOauthStatus('authorized');
        setTestStatus('idle');
        setTestMessage('');
        // Track successful OAuth
        posthog?.capture('mcp_oauth_authorize', {
          templateId: selectedTemplate?.id || null,
          success: true
        });
      } else {
        const errorMsg = result.error || 'Authorization failed';
        console.error('OAuth authorization failed:', errorMsg);
        setTestStatus('error');
        setTestMessage(`Authorization failed: ${errorMsg}`);
        setIsStalePortError(result.isStalePortError === true);
        await checkOAuthStatus(config);
        // Track failed OAuth
        posthog?.capture('mcp_oauth_authorize', {
          templateId: selectedTemplate?.id || null,
          success: false,
          errorType: result.isStalePortError ? 'stale_port' : 'auth_rejected'
        });
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('Failed to trigger OAuth:', errorMsg);
      setTestStatus('error');
      setTestMessage(`Authorization error: ${errorMsg}`);
      setOauthStatus('not-authorized');
      // Track OAuth exception
      posthog?.capture('mcp_oauth_authorize', {
        templateId: selectedTemplate?.id || null,
        success: false,
        errorType: 'exception'
      });
    } finally {
      setOauthAction('idle');
    }
  };

  /**
   * Revoke OAuth authorization
   */
  const handleRevoke = async () => {
    // Build config from current form state
    const config: MCPServerConfig = {
      type: formType,
      url: formUrl,
      command: formCommand,
      args: formArgs
    };

    const serverUrl = getOAuthServerUrl(config);
    if (!serverUrl) return;

    if (!confirm('Revoke authorization? You will need to re-authorize to use this server.')) {
      return;
    }

    setOauthAction('revoking');
    try {
      const result = await window.electronAPI.invoke('mcp-config:revoke-oauth', serverUrl);
      if (result.success) {
        setOauthStatus('not-authorized');
        setTestMessage('Authorization revoked successfully');
      } else {
        const errorMsg = result.error || 'Failed to revoke authorization';
        console.error('Failed to revoke OAuth:', errorMsg);
        setTestStatus('error');
        setTestMessage(errorMsg);
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('Failed to revoke OAuth:', errorMsg);
      setTestStatus('error');
      setTestMessage(`Revocation error: ${errorMsg}`);
    } finally {
      setOauthAction('idle');
    }
  };

  /**
   * Clear stale OAuth cache and retry authorization
   * Used when EADDRINUSE error occurs due to stale lock files
   */
  const handleClearAuthCacheAndRetry = async () => {
    // Build config from current form state
    const config: MCPServerConfig = {
      type: formType,
      url: formUrl,
      command: formCommand,
      args: formArgs
    };

    const serverUrl = getOAuthServerUrl(config);
    if (!serverUrl) return;

    setOauthAction('clearing-cache');
    setIsStalePortError(false);
    try {
      // First, revoke/clear any existing auth files (including lock files)
      await window.electronAPI.invoke('mcp-config:revoke-oauth', serverUrl);
      setTestMessage('Auth cache cleared. Retrying authorization...');
      setTestStatus('idle');

      // Wait a moment for any port to be released
      await new Promise(resolve => setTimeout(resolve, 500));

      // Then trigger OAuth again
      const result = await window.electronAPI.invoke('mcp-config:trigger-oauth', serverUrl);
      if (result.success) {
        setOauthStatus('authorized');
        setTestStatus('idle');
        setTestMessage('');
        posthog?.capture('mcp_oauth_authorize', {
          templateId: selectedTemplate?.id || null,
          success: true,
          retryAfterCacheClear: true
        });
      } else {
        const errorMsg = result.error || 'Authorization failed';
        console.error('OAuth authorization failed after cache clear:', errorMsg);
        setTestStatus('error');
        setTestMessage(`Authorization failed: ${errorMsg}`);
        setIsStalePortError(result.isStalePortError === true);
        await checkOAuthStatus(config);
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('Failed to clear cache and retry OAuth:', errorMsg);
      setTestStatus('error');
      setTestMessage(`Error: ${errorMsg}`);
    } finally {
      setOauthAction('idle');
    }
  };

  // Auto-save function
  const autoSave = async () => {
    if (!formName.trim()) return;
    if (formType === 'stdio' && !formCommand.trim()) return;
    if ((formType === 'sse' || formType === 'http') && !formUrl.trim()) return;

    const saveStart = performance.now();
    console.log('[MCPServersPanel] autoSave starting for server:', formName.trim());
    try {
      setSaveStatus('saving');
      // Mark as local change to ignore file watcher updates
      isLocalChangeRef.current = true;

      const serverConfig: MCPServerConfig = {
        type: formType,
        env: Object.fromEntries(
          formEnv.filter(({ key }) => key.trim()).map(({ key, value }) => [key.trim(), value])
        )
      };

      if (formType === 'stdio') {
        serverConfig.command = formCommand.trim();
        serverConfig.args = formArgs.filter(arg => arg.trim()).map(arg => arg.trim());
        if (serverConfig.args?.length === 0) {
          delete serverConfig.args;
        }
      } else if (formType === 'sse' || formType === 'http') {
        serverConfig.url = formUrl.trim();
      }

      if (formType === 'http') {
        serverConfig.headers = Object.fromEntries(
          formHeaders.filter(({ key }) => key.trim()).map(({ key, value }) => [key.trim(), value])
        );
        if (Object.keys(serverConfig.headers || {}).length === 0) {
          delete serverConfig.headers;
        }
      }

      if (Object.keys(serverConfig.env || {}).length === 0) {
        delete serverConfig.env;
      }

      const config: MCPConfig = scope === 'workspace' && workspacePath
        ? await window.electronAPI.invoke('mcp-config:read-workspace', workspacePath)
        : await window.electronAPI.invoke('mcp-config:read-user');

      if (selectedServer && selectedServer.name !== formName.trim()) {
        delete config.mcpServers[selectedServer.name];
      }

      config.mcpServers[formName.trim()] = serverConfig;

      const validation = await window.electronAPI.invoke('mcp-config:validate', config);
      if (!validation.valid) {
        setSaveStatus('error');
        isLocalChangeRef.current = false;
        return;
      }

      const result = scope === 'workspace' && workspacePath
        ? await window.electronAPI.invoke('mcp-config:write-workspace', workspacePath, config)
        : await window.electronAPI.invoke('mcp-config:write-user', config);

      if (!result.success) {
        setSaveStatus('error');
        isLocalChangeRef.current = false;
        return;
      }

      await loadServers();
      const savedServer = {
        name: formName.trim(),
        ...serverConfig
      };
      setSelectedServer(savedServer);
      setViewState('list');
      setSaveStatus('saved');

      // Track successful MCP server configuration
      const isNewServer = !selectedServer || selectedServer.name !== formName.trim();
      posthog?.capture('mcp_server_added', {
        templateId: selectedTemplate?.id || null,
        scope,
        isCustom: !selectedTemplate,
        authType: selectedTemplate?.authType || 'none',
        transportType: formType,
        isNew: isNewServer
      });

      const saveDuration = performance.now() - saveStart;
      console.log(`[MCPServersPanel] autoSave completed in ${saveDuration.toFixed(0)}ms`);
      if (saveDuration > 2000) {
        console.warn(`[MCPServersPanel] autoSave took ${saveDuration.toFixed(0)}ms (>2s threshold)`);
      }

      setTimeout(() => setSaveStatus('idle'), 2000);

      // Clear the flag after a longer delay to ensure file watcher events are ignored
      setTimeout(() => {
        isLocalChangeRef.current = false;
      }, 2000);
    } catch (err: unknown) {
      const saveDuration = performance.now() - saveStart;
      const errorMsg = err instanceof Error ? err.message : 'Failed to save server';
      console.error(`Failed to save server after ${saveDuration.toFixed(0)}ms:`, errorMsg);
      setSaveStatus('error');
      setTestStatus('error');
      setTestMessage(`Save error: ${errorMsg}`);
      isLocalChangeRef.current = false;
    }
  };

  const handleDelete = async () => {
    if (!selectedServer) return;

    if (!confirm(`Delete MCP server "${selectedServer.name}"?`)) {
      return;
    }

    try {
      // Mark as local change to ignore file watcher updates
      console.log('[MCPServersPanel] Setting isLocalChangeRef = true before delete');
      isLocalChangeRef.current = true;

      const config: MCPConfig = scope === 'workspace' && workspacePath
        ? await window.electronAPI.invoke('mcp-config:read-workspace', workspacePath)
        : await window.electronAPI.invoke('mcp-config:read-user');

      console.log('[MCPServersPanel] Deleting server:', selectedServer.name);
      console.log('[MCPServersPanel] Config before delete:', Object.keys(config.mcpServers));
      delete config.mcpServers[selectedServer.name];
      console.log('[MCPServersPanel] Config after delete:', Object.keys(config.mcpServers));

      const result = scope === 'workspace' && workspacePath
        ? await window.electronAPI.invoke('mcp-config:write-workspace', workspacePath, config)
        : await window.electronAPI.invoke('mcp-config:write-user', config);

      if (!result.success) {
        alert(`Failed to delete: ${result.error}`);
        isLocalChangeRef.current = false;
        return;
      }

      console.log('[MCPServersPanel] Write successful, reloading servers');
      // Wait a bit for file watcher to process, then reload and clear flag
      await loadServers();
      setSelectedServer(null);

      // Clear the flag after a longer delay to ensure file watcher events are ignored
      // File watcher has 500ms debounce + can fire twice (file + dir), so wait longer
      setTimeout(() => {
        console.log('[MCPServersPanel] Clearing isLocalChangeRef flag');
        isLocalChangeRef.current = false;
      }, 2000);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to delete server';
      console.error('Failed to delete server:', errorMsg);
      alert(`Error: ${errorMsg}`);
      isLocalChangeRef.current = false;
    }
  };

  const handleToggleDisabled = async (serverName: string, disabled: boolean) => {
    try {
      // Mark as local change to ignore file watcher updates
      isLocalChangeRef.current = true;

      const config: MCPConfig = scope === 'workspace' && workspacePath
        ? await window.electronAPI.invoke('mcp-config:read-workspace', workspacePath)
        : await window.electronAPI.invoke('mcp-config:read-user');

      if (config.mcpServers[serverName]) {
        if (disabled) {
          config.mcpServers[serverName].disabled = true;
        } else {
          delete config.mcpServers[serverName].disabled;
        }
      }

      const result = scope === 'workspace' && workspacePath
        ? await window.electronAPI.invoke('mcp-config:write-workspace', workspacePath, config)
        : await window.electronAPI.invoke('mcp-config:write-user', config);

      if (!result.success) {
        console.error('Failed to toggle server:', result.error);
        isLocalChangeRef.current = false;
        return;
      }

      await loadServers();

      // Clear the flag after a longer delay to ensure file watcher events are ignored
      setTimeout(() => {
        isLocalChangeRef.current = false;
      }, 2000);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to toggle server';
      console.error('Failed to toggle server:', errorMsg);
      alert(`Error: ${errorMsg}`);
      isLocalChangeRef.current = false;
    }
  };

  const addArg = () => {
    setFormArgs([...formArgs, '']);
  };

  const updateArg = (index: number, value: string) => {
    const newArgs = [...formArgs];
    newArgs[index] = value;
    setFormArgs(newArgs);
  };

  const removeArg = (index: number) => {
    setFormArgs(formArgs.filter((_, i) => i !== index));
  };

  const addEnvVar = () => {
    setFormEnv([...formEnv, { key: '', value: '' }]);
  };

  const updateEnvVar = (index: number, field: 'key' | 'value', value: string) => {
    const newEnv = [...formEnv];
    newEnv[index][field] = value;
    setFormEnv(newEnv);
  };

  const removeEnvVar = (index: number) => {
    setFormEnv(formEnv.filter((_, i) => i !== index));
  };

  const addHeader = () => {
    setFormHeaders([...formHeaders, { key: '', value: '' }]);
  };

  const updateHeader = (index: number, field: 'key' | 'value', value: string) => {
    const newHeaders = [...formHeaders];
    newHeaders[index][field] = value;
    setFormHeaders(newHeaders);
  };

  const removeHeader = (index: number) => {
    setFormHeaders(formHeaders.filter((_, i) => i !== index));
  };

  /**
   * Categorize test connection errors for analytics
   */
  const categorizeTestError = (error: string | undefined): string => {
    if (!error) return 'unknown';
    const errorLower = error.toLowerCase();
    if (errorLower.includes('not found') || errorLower.includes('enoent')) return 'command_not_found';
    if (errorLower.includes('timeout')) return 'timeout';
    if (errorLower.includes('401') || errorLower.includes('403') || errorLower.includes('auth')) return 'auth_failure';
    if (errorLower.includes('network') || errorLower.includes('econnrefused') || errorLower.includes('enotfound')) return 'network';
    return 'other';
  };

  const handleTestConnection = async () => {
    if (formType === 'stdio' && !formCommand.trim()) {
      setTestStatus('error');
      setTestMessage('Command is required');
      return;
    }
    if ((formType === 'sse' || formType === 'http') && !formUrl.trim()) {
      setTestStatus('error');
      setTestMessage('URL is required');
      return;
    }

    setTestStatus('testing');
    setTestMessage('Starting...');

    const unsubscribe = window.electronAPI.on(
      'mcp-config:test-progress',
      (data: { status: string; message: string }) => {
        if (data.message) {
          setTestMessage(data.message);
        }
      }
    );

    try {
      const testConfig: MCPServerConfig = {
        type: formType,
        env: Object.fromEntries(
          formEnv.filter(({ key }) => key.trim()).map(({ key, value }) => [key.trim(), value])
        )
      };

      if (formType === 'stdio') {
        testConfig.command = formCommand.trim();
        testConfig.args = formArgs.filter(arg => arg.trim()).map(arg => arg.trim());
      } else if (formType === 'sse' || formType === 'http') {
        testConfig.url = formUrl.trim();
      }

      if (formType === 'http') {
        testConfig.headers = Object.fromEntries(
          formHeaders.filter(({ key }) => key.trim()).map(({ key, value }) => [key.trim(), value])
        );
      }

      const startTime = Date.now();
      const result = await window.electronAPI.invoke('mcp-config:test-server', testConfig);
      const durationMs = Date.now() - startTime;

      if (result.success) {
        setTestStatus('success');
        setTestMessage('Connection successful');
        setTestHelpUrl(null);
        // Track successful test
        posthog?.capture('mcp_server_test_result', {
          templateId: selectedTemplate?.id || null,
          success: true,
          durationMs
        });
      } else {
        setTestStatus('error');
        setTestMessage(result.error || 'Connection failed');
        setTestHelpUrl(result.helpUrl || null);
        // Track failed test
        posthog?.capture('mcp_server_test_result', {
          templateId: selectedTemplate?.id || null,
          success: false,
          errorType: categorizeTestError(result.error),
          durationMs
        });
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : 'Test failed';
      setTestStatus('error');
      setTestMessage(errorMsg);
      setTestHelpUrl(null);
      // Track test exception
      posthog?.capture('mcp_server_test_result', {
        templateId: selectedTemplate?.id || null,
        success: false,
        errorType: 'exception'
      });
    } finally {
      unsubscribe();
    }
  };

  // Get required env vars for a template (ones that need user input)
  const getRequiredEnvVars = (): Array<{ key: string; index: number }> => {
    if (!selectedTemplate || selectedTemplate.authType === 'oauth' || selectedTemplate.authType === 'none') {
      return [];
    }

    return formEnv
      .map((env, index) => ({ key: env.key, index }))
      .filter(({ key }) => key && ENV_VAR_HELP[key]);
  };

  if (loading) {
    return (
      <div className="provider-panel flex flex-col">
        <div className="mcp-loading p-8 text-center text-[var(--nim-text-muted)]">Loading MCP servers...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="provider-panel flex flex-col">
        <div className="mcp-error p-8 text-center text-[#e74c3c]">
          Error: {error}
          <button onClick={loadServers} className="mcp-retry-button ml-4 px-4 py-2 bg-[var(--nim-primary)] text-white border-none rounded cursor-pointer">Retry</button>
        </div>
      </div>
    );
  }

  // Template Selection View
  const renderTemplateSelection = () => {
    const searchLower = templateSearch.toLowerCase().trim();

    // Filter templates by search
    const filteredTemplates = searchLower
      ? MCP_SERVER_TEMPLATES.filter(t =>
          t.name.toLowerCase().includes(searchLower) ||
          t.description.toLowerCase().includes(searchLower)
        )
      : MCP_SERVER_TEMPLATES;

    // Group templates by category
    const templatesByCategory: Record<TemplateCategory, MCPServerTemplate[]> = {
      development: [],
      productivity: [],
      automation: [],
      ai: [],
      commerce: [],
      data: [],
      search: [],
      files: []
    };

    filteredTemplates.forEach(template => {
      const category = TEMPLATE_CATEGORIES[template.id] || 'files';
      templatesByCategory[category].push(template);
    });

    const getAuthBadge = (authType: string | undefined) => {
      if (authType === 'oauth') return { className: 'oauth', label: 'OAuth' };
      if (authType === 'api-key') return { className: 'api-key', label: 'API Key' };
      return { className: 'no-auth', label: 'No Auth' };
    };

    return (
      <div className="mcp-template-selection p-6 h-full overflow-y-auto" role="main" aria-label="Template selection">
        <button
          onClick={handleBackToList}
          className="mcp-back-button inline-flex items-center gap-1.5 px-3 py-2 border border-[var(--nim-border)] rounded-md bg-[var(--nim-bg)] text-[var(--nim-text)] text-[0.8125rem] cursor-pointer transition-all duration-150 mb-4 hover:bg-[var(--nim-bg-hover)]"
          aria-label="Back to server list"
        >
          ← Back to servers
        </button>

        <div className="mcp-template-selection-header mb-6">
          <h3 className="mcp-template-selection-title text-lg font-semibold text-[var(--nim-text)] m-0 mb-2">Add MCP Server</h3>
          <p className="mcp-template-selection-description text-sm text-[var(--nim-text-muted)] m-0">
            Choose a template to get started quickly, or create a custom configuration.
          </p>
        </div>

        {/* Search Bar */}
        <div className="mcp-template-search relative mb-6" role="search">
          <input
            type="text"
            value={templateSearch}
            onChange={(e) => setTemplateSearch(e.target.value)}
            placeholder="Search templates..."
            className="mcp-template-search-input w-full py-3 pl-4 pr-10 border border-[var(--nim-border)] rounded-lg bg-[var(--nim-bg)] text-[var(--nim-text)] text-[0.9375rem] placeholder:text-[var(--nim-text-faint)] focus:border-[var(--nim-primary)] focus:outline-none"
            aria-label="Search MCP server templates"
            autoFocus
          />
          {templateSearch && (
            <button
              className="mcp-template-search-clear absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 border-none rounded-full bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)] text-xs cursor-pointer flex items-center justify-center hover:bg-[var(--nim-text-faint)] hover:text-[var(--nim-bg)]"
              onClick={() => setTemplateSearch('')}
              aria-label="Clear search"
              title="Clear search"
            >
              x
            </button>
          )}
        </div>

        {/* Custom/Scratch - always show unless searching */}
        {!templateSearch && (
          <div className="mcp-template-category mb-6">
            <h4 className="mcp-template-category-title text-xs font-semibold uppercase tracking-wider text-[var(--nim-text-faint)] m-0 mb-3 pb-2 border-b border-[var(--nim-border)]">Custom Configuration</h4>
            <div className="mcp-template-grid grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              <div
                className="mcp-template-card mcp-template-scratch-card flex flex-col items-center justify-center min-h-[100px] p-4 border-2 border-dashed border-[var(--nim-border)] rounded-lg bg-transparent cursor-pointer transition-all duration-150 hover:border-[var(--nim-primary)] hover:bg-[color-mix(in_srgb,var(--nim-primary)_5%,transparent)]"
                onClick={() => handleTemplateSelect(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleTemplateSelect(null);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label="Start from scratch - Configure all settings manually"
              >
                <div className="mcp-template-scratch-text text-sm text-[var(--nim-text-muted)] text-center">
                  + Start from scratch<br />
                  <small>Configure all settings manually</small>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Templates by Category */}
        {CATEGORY_ORDER.map(category => {
          const templates = templatesByCategory[category];
          if (templates.length === 0) return null;

          return (
            <div key={category} className="mcp-template-category mb-6">
              <h4 className="mcp-template-category-title text-xs font-semibold uppercase tracking-wider text-[var(--nim-text-faint)] m-0 mb-3 pb-2 border-b border-[var(--nim-border)]">{CATEGORY_LABELS[category]}</h4>
              <div className="mcp-template-grid grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3" role="list" aria-label={CATEGORY_LABELS[category]}>
                {templates.map((template) => {
                  const badge = getAuthBadge(template.authType);
                  return (
                    <div
                      key={template.id}
                      className="mcp-template-card flex flex-col p-4 border border-[var(--nim-border)] rounded-lg bg-[var(--nim-bg-secondary)] cursor-pointer transition-all duration-150 hover:border-[var(--nim-primary)] hover:bg-[var(--nim-bg-hover)]"
                      onClick={() => handleTemplateSelect(template)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleTemplateSelect(template);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`${template.name} - ${template.description} - ${badge.label} authentication`}
                    >
                      <div className="mcp-template-card-header flex items-center gap-3 mb-2">
                        <div className="mcp-template-card-icon w-8 h-8 rounded-md bg-[var(--nim-bg-tertiary)] flex items-center justify-center text-base shrink-0 overflow-hidden" aria-hidden="true">
                          <MCPServerIcon templateId={template.id} name={template.name} isDark={isDark} />
                          <span className="mcp-icon-fallback hidden text-sm font-semibold text-[var(--nim-text-muted)]">{template.name[0]}</span>
                        </div>
                        <div className="mcp-template-card-name font-semibold text-[0.9375rem] text-[var(--nim-text)]">{template.name}</div>
                      </div>
                      <div className="mcp-template-card-description text-[0.8125rem] text-[var(--nim-text-muted)] leading-snug mb-3 flex-1">{template.description}</div>
                      <div className={`mcp-template-card-badge inline-flex items-center gap-1 px-2 py-1 rounded text-[0.6875rem] font-semibold uppercase tracking-tight self-start ${badge.className === 'oauth' ? 'bg-[rgba(52,152,219,0.15)] text-[#3498db]' : badge.className === 'api-key' ? 'bg-[rgba(243,156,18,0.15)] text-[#f39c12]' : 'bg-[rgba(39,174,96,0.15)] text-[#27ae60]'}`} aria-label={`Authentication type: ${badge.label}`}>
                        {badge.label}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* No results */}
        {filteredTemplates.length === 0 && templateSearch && (
          <div className="mcp-template-no-results p-8 text-center text-[var(--nim-text-faint)] text-[0.9375rem]" role="status" aria-live="polite">
            No templates match "{templateSearch}"
          </div>
        )}
      </div>
    );
  };

  // Server Configuration Form
  const renderServerConfig = () => {
    const isFromTemplate = Boolean(selectedTemplate);
    const requiredEnvVars = getRequiredEnvVars();
    const isOAuth = selectedTemplate?.authType === 'oauth';
    const isNewConfig = !selectedServer;

    return (
      <div className="mcp-server-form p-6" role="form" aria-label="MCP Server Configuration">
        {isNewConfig && (
          <button
            onClick={handleBackToTemplates}
            className="mcp-back-button inline-flex items-center gap-1.5 px-3 py-2 border border-[var(--nim-border)] rounded-md bg-[var(--nim-bg)] text-[var(--nim-text)] text-[0.8125rem] cursor-pointer transition-all duration-150 mb-4 hover:bg-[var(--nim-bg-hover)]"
            aria-label="Back to template selection"
          >
            ← Back to templates
          </button>
        )}

        {/* Header */}
        {selectedTemplate && (
          <div className="mcp-config-header flex items-center justify-between mb-6 pb-4 border-b border-[var(--nim-border)]">
            <div className="mcp-config-title flex items-center gap-3">
              <div className="mcp-config-title-icon w-9 h-9 rounded-lg bg-[var(--nim-bg-tertiary)] flex items-center justify-center text-lg overflow-hidden" aria-hidden="true">
                <MCPServerIcon templateId={selectedTemplate.id} name={selectedTemplate.name} isDark={isDark} />
              </div>
              <div className="mcp-config-title-text">
                <h4 className="m-0 text-base font-semibold text-[var(--nim-text)]">{selectedTemplate.name}</h4>
                <p className="m-0 mt-0.5 text-xs text-[var(--nim-text-faint)]">{selectedTemplate.description}</p>
              </div>
            </div>
            {selectedTemplate.docsUrl && (
              <a
                href={selectedTemplate.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mcp-docs-link-button inline-flex items-center gap-1 px-3 py-2 border border-[var(--nim-border)] rounded bg-[var(--nim-bg-secondary)] text-[var(--nim-primary)] text-sm no-underline transition-colors duration-150 hover:bg-[var(--nim-bg-hover)]"
                aria-label={`View documentation for ${selectedTemplate.name}`}
              >
                View Docs
              </a>
            )}
          </div>
        )}

        {/* Server Name */}
        <div className="mcp-form-group mb-6">
          <label htmlFor="server-name" className="block mb-2 font-medium text-sm text-[var(--nim-text)]">Server Name</label>
          <input
            id="server-name"
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            onBlur={!isNewConfig ? autoSave : undefined}
            placeholder="my-server"
            aria-required="true"
            className="w-full px-3 py-2 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-sm"
          />
        </div>

        {/* OAuth Section */}
        {isOAuth && (
          <div className="mcp-oauth-section p-4 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded-md mb-4" role="group" aria-label="OAuth Authorization">
            <div className="mcp-oauth-status flex items-center gap-3 mb-3">
              <span className="mcp-oauth-label text-sm font-medium text-[var(--nim-text)]">Authorization:</span>
              {oauthStatus === 'checking' && (
                <span className="mcp-oauth-badge checking inline-flex items-center px-3 py-1 rounded-xl text-xs font-medium bg-[rgba(52,152,219,0.15)] text-[#3498db]" role="status" aria-live="polite">Checking...</span>
              )}
              {oauthStatus === 'authorized' && (
                <span className="mcp-oauth-badge authorized inline-flex items-center px-3 py-1 rounded-xl text-xs font-medium bg-[rgba(39,174,96,0.15)] text-[#27ae60]" role="status" aria-live="polite">Authorized</span>
              )}
              {oauthStatus === 'not-authorized' && (
                <span className="mcp-oauth-badge not-authorized inline-flex items-center px-3 py-1 rounded-xl text-xs font-medium bg-[rgba(243,156,18,0.15)] text-[#f39c12]" role="status" aria-live="polite">Not authorized</span>
              )}
              {oauthStatus === 'unknown' && (
                <span className="mcp-oauth-badge unknown inline-flex items-center px-3 py-1 rounded-xl text-xs font-medium bg-[rgba(149,165,166,0.15)] text-[#95a5a6]" role="status">Unknown</span>
              )}
            </div>
            <div className="mcp-oauth-actions flex gap-2 mb-2">
              {oauthStatus !== 'authorized' && (
                <button
                  onClick={handleAuthorize}
                  disabled={oauthAction !== 'idle'}
                  className="mcp-oauth-button authorize px-4 py-2 rounded text-sm font-medium cursor-pointer transition-all duration-150 bg-[var(--nim-primary)] text-white border-none disabled:opacity-60 disabled:cursor-not-allowed hover:enabled:opacity-90"
                  aria-label="Authorize OAuth connection"
                  aria-busy={oauthAction === 'authorizing'}
                >
                  {oauthAction === 'authorizing' ? 'Authorizing...' : 'Authorize'}
                </button>
              )}
              {oauthStatus === 'authorized' && (
                <button
                  onClick={handleRevoke}
                  disabled={oauthAction !== 'idle'}
                  className="mcp-oauth-button revoke px-4 py-2 rounded text-sm font-medium cursor-pointer transition-all duration-150 bg-transparent text-[#e74c3c] border border-[#e74c3c] disabled:opacity-60 disabled:cursor-not-allowed hover:enabled:bg-[#e74c3c] hover:enabled:text-white"
                  aria-label="Revoke OAuth authorization"
                  aria-busy={oauthAction === 'revoking'}
                >
                  {oauthAction === 'revoking' ? 'Revoking...' : 'Revoke'}
                </button>
              )}
            </div>
            <div className="mcp-oauth-hint text-xs text-[var(--nim-text-faint)] leading-snug" role="note">
              {oauthStatus === 'authorized'
                ? 'You are authorized to use this server.'
                : 'Click Authorize to open a browser window and log in.'}
            </div>
            {testStatus === 'error' && testMessage && (
              <div className="mcp-oauth-error mt-3 p-3 bg-[color-mix(in_srgb,var(--nim-error)_10%,transparent)] border border-[color-mix(in_srgb,var(--nim-error)_30%,transparent)] rounded-md text-[var(--nim-error)] text-[0.8125rem] leading-snug" role="alert" aria-live="assertive">
                {testMessage}
                {isStalePortError && (
                  <button
                    type="button"
                    className="mcp-clear-cache-button block mt-3 px-3 py-1.5 text-[0.8125rem] font-medium text-white bg-[var(--nim-warning)] border-none rounded cursor-pointer transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed hover:enabled:brightness-90"
                    onClick={handleClearAuthCacheAndRetry}
                    disabled={oauthAction !== 'idle'}
                    aria-label="Clear auth cache and retry authorization"
                  >
                    {oauthAction === 'clearing-cache' ? 'Clearing...' : 'Clear Auth Cache & Retry'}
                  </button>
                )}
                {testHelpUrl && (
                  <button
                    type="button"
                    className="mcp-help-link-button block mt-2 px-2 py-1 text-xs font-medium text-[var(--nim-primary)] bg-transparent border border-[var(--nim-primary)] rounded cursor-pointer transition-all duration-150 hover:bg-[var(--nim-primary)] hover:text-white"
                    onClick={() => window.electronAPI.openExternal(testHelpUrl)}
                  >
                    Install Instructions
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Required Fields Section (API Key templates) */}
        {requiredEnvVars.length > 0 && (
          <div className="mcp-required-section p-5 bg-[color-mix(in_srgb,var(--nim-warning)_8%,transparent)] border border-[color-mix(in_srgb,var(--nim-warning)_30%,transparent)] rounded-lg mb-6">
            <div className="mcp-required-section-header flex items-center gap-2 mb-2">
              <span className="mcp-required-icon flex items-center justify-center w-5 h-5 bg-[var(--nim-warning)] text-white rounded-full text-xs font-bold shrink-0">!</span>
              <h4 className="mcp-required-section-title text-[0.9375rem] font-semibold text-[var(--nim-text)] m-0">Required: Enter Your Credentials</h4>
            </div>
            <p className="mcp-required-section-hint text-[0.8125rem] text-[var(--nim-text-muted)] m-0 mb-4">
              These values are required for the server to connect.
            </p>

            {requiredEnvVars.map(({ key, index }) => {
              const help = ENV_VAR_HELP[key];
              return (
                <div key={key} className="mcp-required-field mb-4 last:mb-0">
                  <label className="flex items-center gap-1 mb-1.5 font-medium text-sm text-[var(--nim-text)]">
                    {help?.label || key}
                    <span className="required-asterisk text-[var(--nim-warning)]">*</span>
                  </label>
                  <input
                    type="password"
                    value={formEnv[index].value}
                    onChange={(e) => updateEnvVar(index, 'value', e.target.value)}
                    onBlur={!isNewConfig ? autoSave : undefined}
                    placeholder={`Enter your ${help?.label || key}`}
                    className="w-full px-3 py-2.5 border-2 border-[color-mix(in_srgb,var(--nim-warning)_50%,transparent)] rounded-md bg-[var(--nim-bg)] text-[var(--nim-text)] text-sm placeholder:text-[var(--nim-text-faint)] focus:border-[var(--nim-primary)] focus:outline-none"
                  />
                  {help && (
                    <span className="mcp-field-help block mt-1 text-xs text-[var(--nim-text-faint)]">
                      {help.help}
                      {help.link && (
                        <>
                          {' - '}
                          <a href={help.link} target="_blank" rel="noopener noreferrer" className="text-[var(--nim-primary)] no-underline hover:underline">
                            Get one here
                          </a>
                        </>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Test Connection Button (visible for templates, outside Advanced section) */}
        {isFromTemplate && (
          <div className="mcp-form-group mb-6">
            <label className="block mb-2 font-medium text-sm text-[var(--nim-text)]">Test Connection</label>
            <div className="mcp-test-standalone flex flex-col gap-2">
              <button
                onClick={handleTestConnection}
                disabled={testStatus === 'testing'}
                className={`mcp-test-button self-start px-4 py-2 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-sm cursor-pointer whitespace-nowrap min-w-[100px] disabled:opacity-50 disabled:cursor-not-allowed ${testStatus === 'testing' ? 'bg-[var(--nim-bg-secondary)] text-[var(--nim-text-muted)]' : ''} ${testStatus === 'success' ? 'bg-[#27ae60] text-white border-[#27ae60]' : ''}`}
                aria-label="Test server connection"
                aria-busy={testStatus === 'testing'}
              >
                {testStatus === 'testing' ? 'Testing...' :
                 testStatus === 'success' ? 'Connected' : 'Test Connection'}
              </button>
              {testStatus === 'error' && <span className="mcp-test-failed-label text-[#e74c3c] font-medium text-sm ml-2">Failed</span>}
              {testMessage && (
                <div
                  className={`mcp-test-message mt-2 p-2 rounded text-sm flex items-center gap-2 ${testStatus === 'testing' ? 'bg-[rgba(52,152,219,0.1)] text-[var(--nim-text-muted)] border border-[rgba(52,152,219,0.3)]' : ''} ${testStatus === 'success' ? 'bg-[rgba(39,174,96,0.1)] text-[#27ae60] border border-[rgba(39,174,96,0.3)]' : ''} ${testStatus === 'error' ? 'bg-[rgba(231,76,60,0.1)] text-[#e74c3c] border border-[rgba(231,76,60,0.3)]' : ''}`}
                  role={testStatus === 'error' ? 'alert' : 'status'}
                  aria-live="polite"
                >
                  {testStatus === 'testing' && <span className="mcp-test-spinner inline-block w-3.5 h-3.5 border-2 border-[rgba(52,152,219,0.3)] border-t-[#3498db] rounded-full animate-spin shrink-0" aria-hidden="true" />}
                  {testMessage}
                  {testHelpUrl && testStatus === 'error' && (
                    <button
                      type="button"
                      className="mcp-help-link-button ml-3 px-2 py-1 text-xs font-medium text-[var(--nim-primary)] bg-transparent border border-[var(--nim-primary)] rounded cursor-pointer transition-all duration-150 hover:bg-[var(--nim-primary)] hover:text-white"
                      onClick={() => window.electronAPI.openExternal(testHelpUrl)}
                    >
                      Install Instructions
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Advanced Configuration (collapsed for templates) */}
        {isFromTemplate ? (
          <details className="mcp-advanced-section mt-6 border border-[var(--nim-border)] rounded-lg overflow-hidden [&[open]>summary::after]:rotate-45">
            <summary className="p-4 cursor-pointer flex items-center justify-between font-medium text-sm bg-[var(--nim-bg-secondary)] text-[var(--nim-text)] list-none [&::-webkit-details-marker]:hidden after:content-[''] after:w-1.5 after:h-1.5 after:border-r-2 after:border-b-2 after:border-[var(--nim-text-faint)] after:-rotate-45 after:transition-transform after:duration-200">
              Advanced Configuration
              <span className="mcp-advanced-hint text-xs text-[var(--nim-text-faint)] font-normal mr-2">Pre-configured, typically no changes needed</span>
            </summary>
            <div className="mcp-advanced-content p-4 border-t border-[var(--nim-border)]">
              {renderAdvancedFields(true)}
            </div>
          </details>
        ) : (
          // Show all fields expanded for custom config
          renderAdvancedFields(false)
        )}

        {/* Actions */}
        <div className="mcp-form-actions flex gap-3 mt-8 pt-6 border-t border-[var(--nim-border)]">
          {selectedServer && (
            <button
              onClick={handleDelete}
              className="mcp-delete-button px-4 py-2 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[#e74c3c] text-sm cursor-pointer hover:bg-[#e74c3c] hover:text-white hover:border-[#e74c3c]"
              aria-label={`Delete ${selectedServer.name} server`}
            >
              Delete
            </button>
          )}
          {isNewConfig && formName.trim() && (formCommand.trim() || formUrl.trim()) && (
            <button
              onClick={autoSave}
              className="mcp-save-button ml-auto px-4 py-2 border-none rounded bg-[var(--nim-primary)] text-white text-sm cursor-pointer hover:opacity-90"
              disabled={saveStatus === 'saving'}
              aria-label="Add new MCP server"
              aria-busy={saveStatus === 'saving'}
            >
              {saveStatus === 'saving' ? 'Saving...' : 'Add Server'}
            </button>
          )}
          <span
            className={`mcp-save-status text-sm ml-auto ${saveStatus === 'saving' ? 'text-[var(--nim-text-muted)]' : ''} ${saveStatus === 'saved' ? 'text-[#27ae60]' : ''} ${saveStatus === 'error' ? 'text-[#e74c3c]' : ''}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {saveStatus === 'saving' && !isNewConfig && 'Saving...'}
            {saveStatus === 'saved' && 'Saved'}
            {saveStatus === 'error' && 'Error saving'}
          </span>
        </div>
      </div>
    );
  };

  // Advanced form fields (shared between template and custom config)
  const renderAdvancedFields = (readonly: boolean) => {
    const isExistingServer = Boolean(selectedServer);

    return (
      <>
        <div className={`mcp-form-group mb-6 ${readonly ? 'mcp-readonly-group' : ''}`}>
          <label className="block mb-2 font-medium text-sm text-[var(--nim-text)]">Transport Type</label>
          <select
            value={formType}
            onChange={(e) => {
              setFormType(e.target.value as 'stdio' | 'sse' | 'http');
              if (isExistingServer) setTimeout(autoSave, 0);
            }}
            className={`mcp-type-select w-full px-3 py-2 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-sm cursor-pointer ${readonly ? 'opacity-60 cursor-not-allowed bg-[var(--nim-bg-tertiary)]' : ''}`}
            disabled={readonly}
          >
            <option value="stdio">stdio (Local executable)</option>
            <option value="http">HTTP (Remote server - Streamable HTTP)</option>
            <option value="sse">SSE (Remote server - Legacy)</option>
          </select>
          <div className="mcp-form-hint mt-1 text-xs text-[var(--nim-text-faint)]">
            {formType === 'stdio'
              ? 'Runs a local executable that communicates via stdin/stdout'
              : formType === 'http'
              ? 'Connects to a remote server using Streamable HTTP (recommended for remote servers)'
              : 'Connects to a remote server via Server-Sent Events (legacy)'}
          </div>
        </div>

        {formType === 'stdio' ? (
          <>
            <div className={`mcp-form-group mb-6 ${readonly ? 'mcp-readonly-group' : ''}`}>
              <label className="block mb-2 font-medium text-sm text-[var(--nim-text)]">Command</label>
              <div className="mcp-command-row flex gap-2 items-center">
                <input
                  type="text"
                  value={formCommand}
                  onChange={(e) => setFormCommand(e.target.value)}
                  onBlur={isExistingServer ? autoSave : undefined}
                  placeholder="/path/to/server or npx @modelcontextprotocol/server-name"
                  className={`mcp-command-input flex-1 px-3 py-2 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-sm ${readonly ? 'opacity-60 cursor-not-allowed' : ''}`}
                  disabled={readonly}
                />
                <button
                  onClick={handleTestConnection}
                  disabled={testStatus === 'testing' || !formCommand.trim()}
                  className={`mcp-test-button px-4 py-2 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-sm cursor-pointer whitespace-nowrap min-w-[100px] disabled:opacity-50 disabled:cursor-not-allowed ${testStatus === 'testing' ? 'bg-[var(--nim-bg-secondary)] text-[var(--nim-text-muted)]' : ''} ${testStatus === 'success' ? 'bg-[#27ae60] text-white border-[#27ae60]' : ''}`}
                  aria-label="Test server connection"
                  aria-busy={testStatus === 'testing'}
                >
                  {testStatus === 'testing' ? 'Testing...' :
                   testStatus === 'success' ? 'Connected' : 'Test'}
                </button>
                {testStatus === 'error' && <span className="mcp-test-failed-label text-[#e74c3c] font-medium text-sm ml-2">Failed</span>}
              </div>
              {testMessage && (
                <div
                  className={`mcp-test-message mt-2 p-2 rounded text-sm flex items-center gap-2 ${testStatus === 'testing' ? 'bg-[rgba(52,152,219,0.1)] text-[var(--nim-text-muted)] border border-[rgba(52,152,219,0.3)]' : ''} ${testStatus === 'success' ? 'bg-[rgba(39,174,96,0.1)] text-[#27ae60] border border-[rgba(39,174,96,0.3)]' : ''} ${testStatus === 'error' ? 'bg-[rgba(231,76,60,0.1)] text-[#e74c3c] border border-[rgba(231,76,60,0.3)]' : ''}`}
                  role={testStatus === 'error' ? 'alert' : 'status'}
                  aria-live="polite"
                >
                  {testStatus === 'testing' && <span className="mcp-test-spinner inline-block w-3.5 h-3.5 border-2 border-[rgba(52,152,219,0.3)] border-t-[#3498db] rounded-full animate-spin shrink-0" aria-hidden="true" />}
                  {testMessage}
                  {testHelpUrl && testStatus === 'error' && (
                    <button
                      type="button"
                      className="mcp-help-link-button ml-3 px-2 py-1 text-xs font-medium text-[var(--nim-primary)] bg-transparent border border-[var(--nim-primary)] rounded cursor-pointer transition-all duration-150 hover:bg-[var(--nim-primary)] hover:text-white"
                      onClick={() => window.electronAPI.openExternal(testHelpUrl)}
                    >
                      Install Instructions
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className={`mcp-form-group mb-6 ${readonly ? 'mcp-readonly-group' : ''}`}>
              <label className="block mb-2 font-medium text-sm text-[var(--nim-text)]">Arguments</label>
              {formArgs.map((arg, index) => (
                <div key={index} className="mcp-array-item flex gap-2 mb-2">
                  <input
                    type="text"
                    value={arg}
                    onChange={(e) => updateArg(index, e.target.value)}
                    onBlur={isExistingServer ? autoSave : undefined}
                    placeholder="argument"
                    disabled={readonly}
                    className={`flex-1 px-3 py-2 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-sm ${readonly ? 'opacity-70 cursor-not-allowed bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)]' : ''}`}
                  />
                  {!readonly && (
                    <button onClick={() => { removeArg(index); if (isExistingServer) setTimeout(autoSave, 0); }} className="mcp-remove-button w-7 h-7 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text-faint)] text-lg leading-none cursor-pointer hover:bg-[#e74c3c] hover:text-white hover:border-[#e74c3c]">x</button>
                  )}
                </div>
              ))}
              {!readonly && (
                <button onClick={addArg} className="mcp-add-button w-full px-4 py-2 border border-dashed border-[var(--nim-border)] rounded bg-transparent text-[var(--nim-primary)] text-sm cursor-pointer text-left hover:bg-[var(--nim-bg-hover)]">+ Add Argument</button>
              )}
            </div>
          </>
        ) : (
          <div className={`mcp-form-group mb-6 ${readonly ? 'mcp-readonly-group' : ''}`}>
            <label className="block mb-2 font-medium text-sm text-[var(--nim-text)]">Server URL</label>
            <div className="mcp-command-row flex gap-2 items-center">
              <input
                type="url"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                onBlur={isExistingServer ? autoSave : undefined}
                placeholder={formType === 'http' ? 'https://mcp.example.com/mcp' : 'https://example.com/mcp/sse'}
                className={`mcp-command-input flex-1 px-3 py-2 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-sm ${readonly ? 'opacity-60 cursor-not-allowed' : ''}`}
                disabled={readonly}
              />
              <button
                onClick={handleTestConnection}
                disabled={testStatus === 'testing' || !formUrl.trim()}
                className={`mcp-test-button px-4 py-2 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-sm cursor-pointer whitespace-nowrap min-w-[100px] disabled:opacity-50 disabled:cursor-not-allowed ${testStatus === 'testing' ? 'bg-[var(--nim-bg-secondary)] text-[var(--nim-text-muted)]' : ''} ${testStatus === 'success' ? 'bg-[#27ae60] text-white border-[#27ae60]' : ''}`}
                aria-label="Test server connection"
                aria-busy={testStatus === 'testing'}
              >
                {testStatus === 'testing' ? 'Testing...' :
                 testStatus === 'success' ? 'Connected' : 'Test'}
              </button>
              {testStatus === 'error' && <span className="mcp-test-failed-label text-[#e74c3c] font-medium text-sm ml-2">Failed</span>}
            </div>
            {testMessage && (
              <div
                className={`mcp-test-message mt-2 p-2 rounded text-sm flex items-center gap-2 ${testStatus === 'testing' ? 'bg-[rgba(52,152,219,0.1)] text-[var(--nim-text-muted)] border border-[rgba(52,152,219,0.3)]' : ''} ${testStatus === 'success' ? 'bg-[rgba(39,174,96,0.1)] text-[#27ae60] border border-[rgba(39,174,96,0.3)]' : ''} ${testStatus === 'error' ? 'bg-[rgba(231,76,60,0.1)] text-[#e74c3c] border border-[rgba(231,76,60,0.3)]' : ''}`}
                role={testStatus === 'error' ? 'alert' : 'status'}
                aria-live="polite"
              >
                {testStatus === 'testing' && <span className="mcp-test-spinner inline-block w-3.5 h-3.5 border-2 border-[rgba(52,152,219,0.3)] border-t-[#3498db] rounded-full animate-spin shrink-0" aria-hidden="true" />}
                {testMessage}
                {testHelpUrl && testStatus === 'error' && (
                  <button
                    type="button"
                    className="mcp-help-link-button ml-3 px-2 py-1 text-xs font-medium text-[var(--nim-primary)] bg-transparent border border-[var(--nim-primary)] rounded cursor-pointer transition-all duration-150 hover:bg-[var(--nim-primary)] hover:text-white"
                    onClick={() => window.electronAPI.openExternal(testHelpUrl)}
                  >
                    Install Instructions
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* HTTP Headers (HTTP only) */}
        {formType === 'http' && !readonly && (
          <div className="mcp-form-group mb-6">
            <label className="block mb-2 font-medium text-sm text-[var(--nim-text)]">HTTP Headers</label>
            {formHeaders.map((header, index) => (
              <div key={index} className="mcp-env-item flex gap-2 mb-2">
                <input
                  type="text"
                  value={header.key}
                  onChange={(e) => updateHeader(index, 'key', e.target.value)}
                  onBlur={isExistingServer ? autoSave : undefined}
                  placeholder="Header-Name"
                  className="mcp-env-key flex-[0_0_150px] px-3 py-2 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-sm"
                />
                <input
                  type="text"
                  value={header.value}
                  onChange={(e) => updateHeader(index, 'value', e.target.value)}
                  onBlur={isExistingServer ? autoSave : undefined}
                  placeholder="value"
                  className="mcp-env-value flex-1 px-3 py-2 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-sm"
                />
                <button onClick={() => { removeHeader(index); if (isExistingServer) setTimeout(autoSave, 0); }} className="mcp-remove-button w-7 h-7 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text-faint)] text-lg leading-none cursor-pointer hover:bg-[#e74c3c] hover:text-white hover:border-[#e74c3c]">x</button>
              </div>
            ))}
            <button onClick={addHeader} className="mcp-add-button w-full px-4 py-2 border border-dashed border-[var(--nim-border)] rounded bg-transparent text-[var(--nim-primary)] text-sm cursor-pointer text-left hover:bg-[var(--nim-bg-hover)]">+ Add HTTP Header</button>
          </div>
        )}

        {/* Additional env vars (not in required section) */}
        {!readonly && (
          <div className="mcp-form-group mb-6">
            <label className="block mb-2 font-medium text-sm text-[var(--nim-text)]">Environment Variables</label>
            {formEnv.map((envVar, index) => (
              <div key={index} className="mcp-env-item flex gap-2 mb-2">
                <input
                  type="text"
                  value={envVar.key}
                  onChange={(e) => updateEnvVar(index, 'key', e.target.value)}
                  onBlur={isExistingServer ? autoSave : undefined}
                  placeholder="KEY"
                  className="mcp-env-key flex-[0_0_150px] px-3 py-2 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-sm"
                />
                <input
                  type="text"
                  value={envVar.value}
                  onChange={(e) => updateEnvVar(index, 'value', e.target.value)}
                  onBlur={isExistingServer ? autoSave : undefined}
                  placeholder="value"
                  className="mcp-env-value flex-1 px-3 py-2 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-sm"
                />
                <button onClick={() => { removeEnvVar(index); if (isExistingServer) setTimeout(autoSave, 0); }} className="mcp-remove-button w-7 h-7 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text-faint)] text-lg leading-none cursor-pointer hover:bg-[#e74c3c] hover:text-white hover:border-[#e74c3c]">x</button>
              </div>
            ))}
            <button onClick={addEnvVar} className="mcp-add-button w-full px-4 py-2 border border-dashed border-[var(--nim-border)] rounded bg-transparent text-[var(--nim-primary)] text-sm cursor-pointer text-left hover:bg-[var(--nim-bg-hover)]">+ Add Environment Variable</button>
          </div>
        )}

        {/* OAuth section for existing mcp-remote servers and HTTP transport */}
        {isExistingServer && (formType === 'http' || (formCommand === 'npx' && formArgs.some(arg => arg === 'mcp-remote' || arg.includes('mcp-remote')))) && (
          <div className="mcp-form-group mb-6">
            <label className="block mb-2 font-medium text-sm text-[var(--nim-text)]">OAuth Authorization</label>
            <div className="mcp-oauth-section p-4 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded-md">
              <div className="mcp-oauth-status flex items-center gap-3 mb-3">
                <span className="mcp-oauth-label text-sm font-medium text-[var(--nim-text)]">Status:</span>
                {oauthStatus === 'checking' && (
                  <span className="mcp-oauth-badge checking inline-flex items-center px-3 py-1 rounded-xl text-xs font-medium bg-[rgba(52,152,219,0.15)] text-[#3498db]">Checking...</span>
                )}
                {oauthStatus === 'authorized' && (
                  <span className="mcp-oauth-badge authorized inline-flex items-center px-3 py-1 rounded-xl text-xs font-medium bg-[rgba(39,174,96,0.15)] text-[#27ae60]">Authorized</span>
                )}
                {oauthStatus === 'not-authorized' && (
                  <span className="mcp-oauth-badge not-authorized inline-flex items-center px-3 py-1 rounded-xl text-xs font-medium bg-[rgba(243,156,18,0.15)] text-[#f39c12]">Not authorized</span>
                )}
                {oauthStatus === 'unknown' && (
                  <span className="mcp-oauth-badge unknown inline-flex items-center px-3 py-1 rounded-xl text-xs font-medium bg-[rgba(149,165,166,0.15)] text-[#95a5a6]">Unknown</span>
                )}
              </div>
              <div className="mcp-oauth-actions flex gap-2">
                {oauthStatus !== 'authorized' && (
                  <button
                    onClick={handleAuthorize}
                    disabled={oauthAction !== 'idle'}
                    className="mcp-oauth-button authorize px-4 py-2 rounded text-sm font-medium cursor-pointer transition-all duration-150 bg-[var(--nim-primary)] text-white border-none disabled:opacity-60 disabled:cursor-not-allowed hover:enabled:opacity-90"
                  >
                    {oauthAction === 'authorizing' ? 'Authorizing...' : 'Authorize'}
                  </button>
                )}
                {oauthStatus === 'authorized' && (
                  <button
                    onClick={handleRevoke}
                    disabled={oauthAction !== 'idle'}
                    className="mcp-oauth-button revoke px-4 py-2 rounded text-sm font-medium cursor-pointer transition-all duration-150 bg-transparent text-[#e74c3c] border border-[#e74c3c] disabled:opacity-60 disabled:cursor-not-allowed hover:enabled:bg-[#e74c3c] hover:enabled:text-white"
                  >
                    {oauthAction === 'revoking' ? 'Revoking...' : 'Revoke'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </>
    );
  };

  // Main render
  return (
    <div className="provider-panel flex flex-col">
      <div className="provider-panel-header mb-6 pb-4 border-b border-[var(--nim-border)]">
        <h3 className="provider-panel-title text-xl font-semibold leading-tight mb-2 text-[var(--nim-text)]">MCP Servers</h3>
        <p className="provider-panel-description text-sm leading-relaxed text-[var(--nim-text-muted)]">
          {scope === 'user'
            ? 'Configure global MCP servers available in all projects.'
            : 'Configure project-specific MCP servers (saved to .mcp.json).'}
        </p>
      </div>

      <div className="mcp-servers-container [container-type:inline-size] [container-name:mcp-servers] flex gap-6 flex-1 min-h-[400px] max-h-[calc(100vh-250px)] mt-4">
        {/* Sidebar - always visible in list view */}
        {viewState === 'list' && (
          <aside className="mcp-servers-sidebar flex-[0_0_280px] min-w-[220px] max-w-[350px] flex flex-col border border-[var(--nim-border)] rounded-md overflow-hidden @[max-width:600px]:flex-[0_0_100%] @[max-width:600px]:max-w-full" aria-label="MCP servers list">
            <div className="mcp-servers-header flex justify-between items-center px-4 py-3 border-b border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]">
              <h4 className="m-0 text-sm font-semibold text-[var(--nim-text)]">Servers</h4>
              <button
                onClick={handleNewServer}
                className="mcp-add-server-button flex items-center gap-1.5 px-3 py-1.5 rounded-md border-none bg-[var(--nim-primary)] text-white text-[0.8125rem] font-medium cursor-pointer transition-opacity duration-150 hover:opacity-90"
                aria-label="Add new MCP server"
              >
                <span className="mcp-add-icon text-base leading-none" aria-hidden="true">+</span>
                <span>Add</span>
              </button>
            </div>

            <div className="mcp-servers-list flex-1 overflow-y-auto" role="list">
              {servers.length === 0 ? (
                <div className="mcp-empty-state px-4 py-8 text-center text-[var(--nim-text-faint)] text-sm flex flex-col items-center gap-4" role="status">
                  <span className="mcp-empty-state-text text-[var(--nim-text-muted)]">No MCP servers configured</span>
                  <button
                    onClick={handleNewServer}
                    className="mcp-empty-state-cta px-5 py-2.5 rounded-md border-2 border-dashed border-[var(--nim-primary)] bg-transparent text-[var(--nim-primary)] text-sm font-medium cursor-pointer transition-all duration-150 hover:bg-[color-mix(in_srgb,var(--nim-primary)_10%,transparent)]"
                    aria-label="Add your first MCP server"
                  >
                    + Add Your First Server
                  </button>
                </div>
              ) : (
                servers.map((server) => {
                  const isActive = selectedServer?.name === server.name;
                  const isDisabled = server.disabled;
                  return (
                    <div
                      key={server.name}
                      className={`mcp-server-item flex items-center gap-3 px-4 py-3 border-b border-[var(--nim-border)] cursor-pointer transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] ${isActive ? 'active bg-[var(--nim-primary)] text-white' : ''} ${isDisabled ? 'disabled opacity-50' : ''}`}
                      onClick={() => handleServerSelect(server)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleServerSelect(server);
                        }
                      }}
                      role="listitem button"
                      tabIndex={0}
                      aria-label={`${server.name} server - ${server.disabled ? 'disabled' : 'enabled'} - ${server.command || server.url}`}
                      aria-current={selectedServer?.name === server.name ? 'true' : undefined}
                    >
                      <label
                        className="mcp-server-toggle relative inline-block shrink-0 cursor-pointer"
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Toggle ${server.name} server ${server.disabled ? 'on' : 'off'}`}
                      >
                        <input
                          type="checkbox"
                          checked={!server.disabled}
                          onChange={(e) => handleToggleDisabled(server.name, !e.target.checked)}
                          aria-label={`${server.name} enabled`}
                          className="hidden peer"
                        />
                        <span className={`mcp-toggle-slider relative block w-8 h-[18px] rounded-[9px] transition-colors duration-200 before:content-[''] before:absolute before:top-0.5 before:left-0.5 before:w-3.5 before:h-3.5 before:bg-white before:rounded-full before:transition-transform before:duration-200 before:shadow-[0_1px_2px_rgba(0,0,0,0.2)] peer-checked:before:translate-x-3.5 ${isActive ? (server.disabled ? 'bg-white/30' : 'bg-white/90 peer-checked:before:bg-[var(--nim-primary)]') : (server.disabled ? 'bg-[var(--nim-bg-tertiary)]' : 'bg-[var(--nim-primary)]')}`} aria-hidden="true"></span>
                      </label>
                      <div className="mcp-server-item-info flex-1 min-w-0">
                        <div className={`mcp-server-item-name font-medium text-sm mb-0.5 ${isActive ? 'text-white' : ''} ${isDisabled ? 'line-through' : ''}`}>{server.name}</div>
                        <div className={`mcp-server-item-command text-xs overflow-hidden text-ellipsis whitespace-nowrap ${isActive ? 'text-white/80' : 'text-[var(--nim-text-faint)]'}`}>{server.command || server.url}</div>
                      </div>
                      {isOAuthServer(server) && serverOAuthStatuses[server.name] === 'not-authorized' && (
                        <div className={`mcp-server-status-icon mcp-server-status-not-authorized flex items-center justify-center shrink-0 ${isActive ? 'text-[#fbbf24]' : 'text-[#f39c12]'}`}>
                          <MaterialSymbol icon="error" size={16} title="Not authorized" />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        )}

        {/* Details Panel */}
        <div className="mcp-server-details flex-1 border border-[var(--nim-border)] rounded-md overflow-y-auto">
          {viewState === 'template-selection' && renderTemplateSelection()}

          {viewState === 'server-config' && renderServerConfig()}

          {viewState === 'list' && !selectedServer && (
            <div className="mcp-no-selection flex items-center justify-center h-full text-[var(--nim-text-faint)] text-sm">
              Select a server or click "Add" to create a new one
            </div>
          )}

          {viewState === 'list' && selectedServer && renderServerConfig()}
        </div>
      </div>
    </div>
  );
}

export function MCPServersPanel(props: MCPServersPanelProps) {
  return (
    <ErrorBoundary
      fallback={
        <div className="provider-panel flex flex-col" role="alert" aria-live="assertive">
          <div className="mcp-error p-8 text-center text-[#e74c3c]">
            <h3 className="mt-0 mb-4">Unable to load MCP Servers</h3>
            <p className="mb-6 text-[var(--nim-text-muted)]">
              An unexpected error occurred while loading the MCP servers panel.
              Please try refreshing the application.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mcp-retry-button px-4 py-2 bg-[var(--nim-primary)] text-white border-none rounded-md cursor-pointer"
            >
              Reload Application
            </button>
          </div>
        </div>
      }
    >
      <MCPServersPanelInner {...props} />
    </ErrorBoundary>
  );
}
