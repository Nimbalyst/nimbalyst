import React, { useState, useEffect } from 'react';
import { usePostHog } from 'posthog-js/react';
import { ErrorBoundary } from '../../ErrorBoundary';
import { useTheme } from '../../../hooks/useTheme';
import './MCPServersPanel.css';

interface MCPServerConfig {
  command?: string;
  args?: string[];
  url?: string;
  type?: 'stdio' | 'sse';
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
const DARK_ICONS_NEEDING_LIGHT_OVERRIDE = new Set(['github', 'notion', 'n8n']);

const TEMPLATE_ICON_CONFIG: Record<string, IconConfig> = {
  // Brand icons from Simple Icons CDN
  linear: { type: 'simple-icons', slug: 'linear' },
  github: { type: 'simple-icons', slug: 'github' },
  gitlab: { type: 'simple-icons', slug: 'gitlab' },
  slack: { type: 'simple-icons', slug: 'slack' },
  postgres: { type: 'simple-icons', slug: 'postgresql' },
  'brave-search': { type: 'simple-icons', slug: 'brave' },
  'google-drive': { type: 'simple-icons', slug: 'googledrive' },
  posthog: { type: 'simple-icons', slug: 'posthog' },
  atlassian: { type: 'simple-icons', slug: 'atlassian' },
  notion: { type: 'simple-icons', slug: 'notion' },
  asana: { type: 'simple-icons', slug: 'asana' },
  n8n: { type: 'simple-icons', slug: 'n8n' },
  zapier: { type: 'simple-icons', slug: 'zapier' },
  aws: { type: 'url', url: 'https://cdn.jsdelivr.net/npm/simple-icons/icons/amazonwebservices.svg' },
  stripe: { type: 'simple-icons', slug: 'stripe' },
  snowflake: { type: 'simple-icons', slug: 'snowflake' },
  shopify: { type: 'simple-icons', slug: 'shopify' },
  blender: { type: 'simple-icons', slug: 'blender' },
  'chrome-devtools': { type: 'simple-icons', slug: 'googlechrome' },
  playwright: { type: 'simple-icons', slug: 'playwright' },
  context7: { type: 'simple-icons', slug: 'upstash' },

  // Generic tools using Material Symbols
  filesystem: { type: 'material-symbol', icon: 'folder' },
  fetch: { type: 'material-symbol', icon: 'cloud_download' },
  'sequential-thinking': { type: 'material-symbol', icon: 'psychology' },
  'claude-flow': { type: 'material-symbol', icon: 'account_tree' },
  'knowledge-graph-memory': { type: 'material-symbol', icon: 'hub' },
  'task-master': { type: 'material-symbol', icon: 'task_alt' },
  serena: { type: 'material-symbol', icon: 'code' },
  'desktop-commander': { type: 'material-symbol', icon: 'terminal' }
};

// Component to render MCP server icon
function MCPServerIcon({ templateId, name, isDark }: { templateId: string; name: string; isDark: boolean }) {
  const config = TEMPLATE_ICON_CONFIG[templateId];

  if (!config) {
    // Fallback to first letter
    return <span className="mcp-icon-fallback">{name[0]}</span>;
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
        className="mcp-icon-img"
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
      <span className="material-symbols-outlined mcp-icon-material">
        {config.icon}
      </span>
    );
  }

  if (config.type === 'url') {
    return (
      <img
        src={config.url}
        alt=""
        className="mcp-icon-img"
        loading="lazy"
      />
    );
  }

  return <span className="mcp-icon-fallback">{name[0]}</span>;
}

// Template categories
type TemplateCategory = 'development' | 'productivity' | 'automation' | 'ai' | 'commerce' | 'data' | 'search' | 'files';

const TEMPLATE_CATEGORIES: Record<string, TemplateCategory> = {
  github: 'development',
  gitlab: 'development',
  playwright: 'development',
  context7: 'development',
  'chrome-devtools': 'development',
  linear: 'productivity',
  asana: 'productivity',
  atlassian: 'productivity',
  notion: 'productivity',
  slack: 'productivity',
  'task-master': 'productivity',
  serena: 'development',
  'desktop-commander': 'automation',
  n8n: 'automation',
  zapier: 'automation',
  'sequential-thinking': 'ai',
  'claude-flow': 'ai',
  'knowledge-graph-memory': 'ai',
  blender: 'ai',
  stripe: 'commerce',
  shopify: 'commerce',
  postgres: 'data',
  posthog: 'data',
  snowflake: 'data',
  aws: 'data',
  'brave-search': 'search',
  fetch: 'search',
  'google-drive': 'files',
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
    help: 'Create at Settings > Developer settings > Personal access tokens',
    link: 'https://github.com/settings/tokens'
  },
  GITLAB_PERSONAL_ACCESS_TOKEN: {
    label: 'GitLab Personal Access Token',
    help: 'Create at User Settings > Access Tokens',
    link: 'https://gitlab.com/-/user_settings/personal_access_tokens'
  },
  GITLAB_API_URL: {
    label: 'GitLab API URL',
    help: 'Your GitLab instance URL (default: https://gitlab.com)'
  },
  SLACK_BOT_TOKEN: {
    label: 'Slack Bot Token',
    help: 'Get from your Slack app settings',
    link: 'https://api.slack.com/apps'
  },
  SLACK_TEAM_ID: {
    label: 'Slack Team ID',
    help: 'Find in Slack workspace settings'
  },
  POSTGRES_CONNECTION_STRING: {
    label: 'PostgreSQL Connection String',
    help: 'Format: postgresql://user:password@host:5432/database'
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
  N8N_API_KEY: {
    label: 'n8n API Key',
    help: 'Get from n8n Settings > API',
    link: 'https://docs.n8n.io/api/'
  },
  N8N_API_URL: {
    label: 'n8n API URL',
    help: 'Your n8n API URL (e.g., http://localhost:5678/api/v1)',
    link: 'https://docs.n8n.io/api/'
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
  SHOPIFY_ACCESS_TOKEN: {
    label: 'Shopify Access Token',
    help: 'Get from Shopify Admin > Apps > Develop apps',
    link: 'https://shopify.dev/docs/apps/auth/admin-app-access-tokens'
  },
  SHOPIFY_STORE_URL: {
    label: 'Shopify Store URL',
    help: 'Your store URL (e.g., your-store.myshopify.com)'
  },
  ZAPIER_MCP_URL: {
    label: 'Zapier MCP URL',
    help: 'Get your personal MCP URL from Zapier MCP dashboard',
    link: 'https://zapier.com/mcp'
  },
  FILESYSTEM_ALLOWED_DIR: {
    label: 'Allowed Directory',
    help: 'Directory path the server is allowed to access (e.g., /Users/you/projects)'
  },
  ANTHROPIC_API_KEY: {
    label: 'Anthropic API Key',
    help: 'Get from Anthropic Console',
    link: 'https://console.anthropic.com/settings/keys'
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
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
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
    id: 'gitlab',
    name: 'GitLab',
    description: 'DevOps platform and repository management',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gitlab',
    authType: 'api-key',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-gitlab'],
      env: {
        GITLAB_PERSONAL_ACCESS_TOKEN: '${GITLAB_PERSONAL_ACCESS_TOKEN}',
        GITLAB_API_URL: '${GITLAB_API_URL:-https://gitlab.com}'
      }
    }
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Team communication and messaging',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
    authType: 'api-key',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
      env: {
        SLACK_BOT_TOKEN: '${SLACK_BOT_TOKEN}',
        SLACK_TEAM_ID: '${SLACK_TEAM_ID}'
      }
    }
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Database queries and management',
    docsUrl: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/postgres',
    authType: 'api-key',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres', '${POSTGRES_CONNECTION_STRING}'],
      env: {
        POSTGRES_CONNECTION_STRING: ''
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
    id: 'n8n',
    name: 'n8n',
    description: 'Workflow automation platform',
    docsUrl: 'https://github.com/czlonkowski/n8n-mcp',
    authType: 'api-key',
    config: {
      command: 'npx',
      args: ['-y', 'n8n-mcp'],
      env: {
        N8N_API_KEY: '${N8N_API_KEY}',
        N8N_API_URL: '${N8N_API_URL}',
        MCP_MODE: 'stdio'
      }
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
    id: 'claude-flow',
    name: 'Claude Flow',
    description: 'Multi-agent orchestration and workflows',
    docsUrl: 'https://github.com/ruvnet/claude-flow',
    authType: 'none',
    config: {
      command: 'npx',
      args: ['claude-flow@alpha', 'mcp', 'start'],
      env: {}
    }
  },
  {
    id: 'blender',
    name: 'Blender',
    description: '3D modeling and rendering control',
    docsUrl: 'https://github.com/ahujasid/blender-mcp',
    authType: 'none',
    config: {
      command: 'uvx',
      args: ['blender-mcp'],
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
    id: 'task-master',
    name: 'Task Master',
    description: 'AI-powered task management and planning',
    docsUrl: 'https://github.com/eyaltoledano/claude-task-master',
    authType: 'api-key',
    config: {
      command: 'npx',
      args: ['-y', 'task-master-ai'],
      env: {
        ANTHROPIC_API_KEY: '${ANTHROPIC_API_KEY}'
      }
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
  },
  {
    id: 'desktop-commander',
    name: 'Desktop Commander',
    description: 'Terminal control, file search, and diff editing',
    docsUrl: 'https://github.com/wonderwhy-er/DesktopCommanderMCP',
    authType: 'none',
    config: {
      command: 'npx',
      args: ['-y', '@wonderwhy-er/desktop-commander'],
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
  const [formType, setFormType] = useState<'stdio' | 'sse'>('stdio');
  const [formCommand, setFormCommand] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formArgs, setFormArgs] = useState<string[]>([]);
  const [formEnv, setFormEnv] = useState<Array<{ key: string; value: string }>>([]);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState<string>('');
  const [testHelpUrl, setTestHelpUrl] = useState<string | null>(null);

  // OAuth state
  const [oauthStatus, setOauthStatus] = useState<'unknown' | 'checking' | 'authorized' | 'not-authorized'>('unknown');
  const [oauthAction, setOauthAction] = useState<'idle' | 'authorizing' | 'revoking'>('idle');

  // Template search
  const [templateSearch, setTemplateSearch] = useState('');

  // Reload servers when scope or workspace path changes
  useEffect(() => {
    loadServers();
  }, [scope, workspacePath]);

  const loadServers = async () => {
    try {
      setLoading(true);
      setError(null);

      const config: MCPConfig = scope === 'workspace' && workspacePath
        ? await window.electronAPI.invoke('mcp-config:read-workspace', workspacePath)
        : await window.electronAPI.invoke('mcp-config:read-user');

      const serverList: MCPServerWithName[] = Object.entries(config.mcpServers || {}).map(
        ([name, serverConfig]) => ({
          name,
          ...serverConfig
        })
      );

      setServers(serverList);
    } catch (err: unknown) {
      console.error('Failed to load MCP servers:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to load MCP servers';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

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

    // Check OAuth status for mcp-remote servers
    if (isOAuthServer(server)) {
      checkOAuthStatus(server.args || []);
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

      if (template.authType === 'oauth') {
        checkOAuthStatus(template.config.args || []);
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
   * Extract the server URL from mcp-remote args
   */
  const getOAuthServerUrl = (args: string[]): string | null => {
    for (const arg of args) {
      if (arg.startsWith('http://') || arg.startsWith('https://')) {
        return arg;
      }
    }
    return null;
  };

  /**
   * Check if this is an OAuth server (uses mcp-remote)
   */
  const isOAuthServer = (config: MCPServerConfig): boolean => {
    return config.command === 'npx' &&
           Boolean(config.args?.some(arg => arg === 'mcp-remote' || arg.includes('mcp-remote')));
  };

  /**
   * Check OAuth authorization status
   */
  const checkOAuthStatus = async (args: string[]) => {
    const serverUrl = getOAuthServerUrl(args);
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
    const serverUrl = getOAuthServerUrl(formArgs);
    if (!serverUrl) return;

    setOauthAction('authorizing');
    try {
      const result = await window.electronAPI.invoke('mcp-config:trigger-oauth', serverUrl);
      if (result.success) {
        setOauthStatus('authorized');
        setTestStatus('idle');
        setTestMessage('');
        // Track successful OAuth
        posthog?.capture('mcp_oauth_result', {
          templateId: selectedTemplate?.id || null,
          success: true
        });
      } else {
        const errorMsg = result.error || 'Authorization failed';
        console.error('OAuth authorization failed:', errorMsg);
        setTestStatus('error');
        setTestMessage(`Authorization failed: ${errorMsg}`);
        await checkOAuthStatus(formArgs);
        // Track failed OAuth
        posthog?.capture('mcp_oauth_result', {
          templateId: selectedTemplate?.id || null,
          success: false,
          errorType: 'auth_rejected'
        });
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('Failed to trigger OAuth:', errorMsg);
      setTestStatus('error');
      setTestMessage(`Authorization error: ${errorMsg}`);
      setOauthStatus('not-authorized');
      // Track OAuth exception
      posthog?.capture('mcp_oauth_result', {
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
    const serverUrl = getOAuthServerUrl(formArgs);
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

  // Auto-save function
  const autoSave = async () => {
    if (!formName.trim()) return;
    if (formType === 'stdio' && !formCommand.trim()) return;
    if (formType === 'sse' && !formUrl.trim()) return;

    try {
      setSaveStatus('saving');

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
      } else if (formType === 'sse') {
        serverConfig.url = formUrl.trim();
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
        return;
      }

      const result = scope === 'workspace' && workspacePath
        ? await window.electronAPI.invoke('mcp-config:write-workspace', workspacePath, config)
        : await window.electronAPI.invoke('mcp-config:write-user', config);

      if (!result.success) {
        setSaveStatus('error');
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
      posthog?.capture('mcp_server_configured', {
        templateId: selectedTemplate?.id || null,
        scope,
        isCustom: !selectedTemplate,
        authType: selectedTemplate?.authType || 'none',
        transportType: formType
      });

      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to save server';
      console.error('Failed to save server:', errorMsg);
      setSaveStatus('error');
      setTestStatus('error');
      setTestMessage(`Save error: ${errorMsg}`);
    }
  };

  const handleDelete = async () => {
    if (!selectedServer) return;

    if (!confirm(`Delete MCP server "${selectedServer.name}"?`)) {
      return;
    }

    try {
      const config: MCPConfig = scope === 'workspace' && workspacePath
        ? await window.electronAPI.invoke('mcp-config:read-workspace', workspacePath)
        : await window.electronAPI.invoke('mcp-config:read-user');

      delete config.mcpServers[selectedServer.name];

      const result = scope === 'workspace' && workspacePath
        ? await window.electronAPI.invoke('mcp-config:write-workspace', workspacePath, config)
        : await window.electronAPI.invoke('mcp-config:write-user', config);

      if (!result.success) {
        alert(`Failed to delete: ${result.error}`);
        return;
      }

      await loadServers();
      setSelectedServer(null);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to delete server';
      console.error('Failed to delete server:', errorMsg);
      alert(`Error: ${errorMsg}`);
    }
  };

  const handleToggleDisabled = async (serverName: string, disabled: boolean) => {
    try {
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
        return;
      }

      await loadServers();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to toggle server';
      console.error('Failed to toggle server:', errorMsg);
      alert(`Error: ${errorMsg}`);
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
    if (formType === 'sse' && !formUrl.trim()) {
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
      } else if (formType === 'sse') {
        testConfig.url = formUrl.trim();
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
      <div className="provider-panel">
        <div className="mcp-loading">Loading MCP servers...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="provider-panel">
        <div className="mcp-error">
          Error: {error}
          <button onClick={loadServers} className="mcp-retry-button">Retry</button>
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
      <div className="mcp-template-selection" role="main" aria-label="Template selection">
        <button
          onClick={handleBackToList}
          className="mcp-back-button"
          aria-label="Back to server list"
        >
          ← Back to servers
        </button>

        <div className="mcp-template-selection-header">
          <h3 className="mcp-template-selection-title">Add MCP Server</h3>
          <p className="mcp-template-selection-description">
            Choose a template to get started quickly, or create a custom configuration.
          </p>
        </div>

        {/* Search Bar */}
        <div className="mcp-template-search" role="search">
          <input
            type="text"
            value={templateSearch}
            onChange={(e) => setTemplateSearch(e.target.value)}
            placeholder="Search templates..."
            className="mcp-template-search-input"
            aria-label="Search MCP server templates"
            autoFocus
          />
          {templateSearch && (
            <button
              className="mcp-template-search-clear"
              onClick={() => setTemplateSearch('')}
              aria-label="Clear search"
              title="Clear search"
            >
              x
            </button>
          )}
        </div>

        {/* Templates by Category */}
        {CATEGORY_ORDER.map(category => {
          const templates = templatesByCategory[category];
          if (templates.length === 0) return null;

          return (
            <div key={category} className="mcp-template-category">
              <h4 className="mcp-template-category-title">{CATEGORY_LABELS[category]}</h4>
              <div className="mcp-template-grid" role="list" aria-label={CATEGORY_LABELS[category]}>
                {templates.map((template) => {
                  const badge = getAuthBadge(template.authType);
                  return (
                    <div
                      key={template.id}
                      className="mcp-template-card"
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
                      <div className="mcp-template-card-header">
                        <div className="mcp-template-card-icon" aria-hidden="true">
                          <MCPServerIcon templateId={template.id} name={template.name} isDark={isDark} />
                          <span className="mcp-icon-fallback" style={{ display: 'none' }}>{template.name[0]}</span>
                        </div>
                        <div className="mcp-template-card-name">{template.name}</div>
                      </div>
                      <div className="mcp-template-card-description">{template.description}</div>
                      <div className={`mcp-template-card-badge ${badge.className}`} aria-label={`Authentication type: ${badge.label}`}>
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
          <div className="mcp-template-no-results" role="status" aria-live="polite">
            No templates match "{templateSearch}"
          </div>
        )}

        {/* Custom/Scratch - always show unless searching */}
        {!templateSearch && (
          <div className="mcp-template-category">
            <h4 className="mcp-template-category-title">Custom Configuration</h4>
            <div className="mcp-template-grid">
              <div
                className="mcp-template-card mcp-template-scratch-card"
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
                <div className="mcp-template-scratch-text">
                  + Start from scratch<br />
                  <small>Configure all settings manually</small>
                </div>
              </div>
            </div>
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
      <div className="mcp-server-form" role="form" aria-label="MCP Server Configuration">
        {isNewConfig && (
          <button
            onClick={handleBackToTemplates}
            className="mcp-back-button"
            aria-label="Back to template selection"
          >
            ← Back to templates
          </button>
        )}

        {/* Header */}
        {selectedTemplate && (
          <div className="mcp-config-header">
            <div className="mcp-config-title">
              <div className="mcp-config-title-icon" aria-hidden="true">
                <MCPServerIcon templateId={selectedTemplate.id} name={selectedTemplate.name} isDark={isDark} />
              </div>
              <div className="mcp-config-title-text">
                <h4>{selectedTemplate.name}</h4>
                <p>{selectedTemplate.description}</p>
              </div>
            </div>
            {selectedTemplate.docsUrl && (
              <a
                href={selectedTemplate.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mcp-docs-link-button"
                aria-label={`View documentation for ${selectedTemplate.name}`}
              >
                View Docs
              </a>
            )}
          </div>
        )}

        {/* Server Name */}
        <div className="mcp-form-group">
          <label htmlFor="server-name">Server Name</label>
          <input
            id="server-name"
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            onBlur={!isNewConfig ? autoSave : undefined}
            placeholder="my-server"
            aria-required="true"
          />
        </div>

        {/* OAuth Section */}
        {isOAuth && (
          <div className="mcp-oauth-section" role="group" aria-label="OAuth Authorization">
            <div className="mcp-oauth-status">
              <span className="mcp-oauth-label">Authorization:</span>
              {oauthStatus === 'checking' && (
                <span className="mcp-oauth-badge checking" role="status" aria-live="polite">Checking...</span>
              )}
              {oauthStatus === 'authorized' && (
                <span className="mcp-oauth-badge authorized" role="status" aria-live="polite">Authorized</span>
              )}
              {oauthStatus === 'not-authorized' && (
                <span className="mcp-oauth-badge not-authorized" role="status" aria-live="polite">Not authorized</span>
              )}
              {oauthStatus === 'unknown' && (
                <span className="mcp-oauth-badge unknown" role="status">Unknown</span>
              )}
            </div>
            <div className="mcp-oauth-actions">
              {oauthStatus !== 'authorized' && (
                <button
                  onClick={handleAuthorize}
                  disabled={oauthAction !== 'idle'}
                  className="mcp-oauth-button authorize"
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
                  className="mcp-oauth-button revoke"
                  aria-label="Revoke OAuth authorization"
                  aria-busy={oauthAction === 'revoking'}
                >
                  {oauthAction === 'revoking' ? 'Revoking...' : 'Revoke'}
                </button>
              )}
            </div>
            <div className="mcp-oauth-hint" role="note">
              {oauthStatus === 'authorized'
                ? 'You are authorized to use this server.'
                : 'Click Authorize to open a browser window and log in.'}
            </div>
            {testStatus === 'error' && testMessage && (
              <div className="mcp-oauth-error" role="alert" aria-live="assertive">
                {testMessage}
                {testHelpUrl && (
                  <button
                    type="button"
                    className="mcp-help-link-button"
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
          <div className="mcp-required-section">
            <div className="mcp-required-section-header">
              <span className="mcp-required-icon">!</span>
              <h4 className="mcp-required-section-title">Required: Enter Your Credentials</h4>
            </div>
            <p className="mcp-required-section-hint">
              These values are required for the server to connect.
            </p>

            {requiredEnvVars.map(({ key, index }) => {
              const help = ENV_VAR_HELP[key];
              return (
                <div key={key} className="mcp-required-field">
                  <label>
                    {help?.label || key}
                    <span className="required-asterisk">*</span>
                  </label>
                  <input
                    type="password"
                    value={formEnv[index].value}
                    onChange={(e) => updateEnvVar(index, 'value', e.target.value)}
                    onBlur={!isNewConfig ? autoSave : undefined}
                    placeholder={`Enter your ${help?.label || key}`}
                  />
                  {help && (
                    <span className="mcp-field-help">
                      {help.help}
                      {help.link && (
                        <>
                          {' - '}
                          <a href={help.link} target="_blank" rel="noopener noreferrer">
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
          <div className="mcp-form-group">
            <label>Test Connection</label>
            <div className="mcp-test-standalone">
              <button
                onClick={handleTestConnection}
                disabled={testStatus === 'testing'}
                className={`mcp-test-button ${testStatus}`}
                aria-label="Test server connection"
                aria-busy={testStatus === 'testing'}
              >
                {testStatus === 'testing' ? 'Testing...' :
                 testStatus === 'success' ? 'Connected' : 'Test Connection'}
              </button>
              {testStatus === 'error' && <span className="mcp-test-failed-label">Failed</span>}
              {testMessage && (
                <div
                  className={`mcp-test-message ${testStatus}`}
                  role={testStatus === 'error' ? 'alert' : 'status'}
                  aria-live="polite"
                >
                  {testStatus === 'testing' && <span className="mcp-test-spinner" aria-hidden="true" />}
                  {testMessage}
                  {testHelpUrl && testStatus === 'error' && (
                    <button
                      type="button"
                      className="mcp-help-link-button"
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
          <details className="mcp-advanced-section">
            <summary>
              Advanced Configuration
              <span className="mcp-advanced-hint">Pre-configured, typically no changes needed</span>
            </summary>
            <div className="mcp-advanced-content">
              {renderAdvancedFields(true)}
            </div>
          </details>
        ) : (
          // Show all fields expanded for custom config
          renderAdvancedFields(false)
        )}

        {/* Actions */}
        <div className="mcp-form-actions">
          {selectedServer && (
            <button
              onClick={handleDelete}
              className="mcp-delete-button"
              aria-label={`Delete ${selectedServer.name} server`}
            >
              Delete
            </button>
          )}
          {isNewConfig && formName.trim() && (formCommand.trim() || formUrl.trim()) && (
            <button
              onClick={autoSave}
              className="mcp-save-button"
              disabled={saveStatus === 'saving'}
              aria-label="Add new MCP server"
              aria-busy={saveStatus === 'saving'}
            >
              {saveStatus === 'saving' ? 'Saving...' : 'Add Server'}
            </button>
          )}
          <span
            className={`mcp-save-status ${saveStatus}`}
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
        <div className={`mcp-form-group ${readonly ? 'mcp-readonly-group' : ''}`}>
          <label>Transport Type</label>
          <select
            value={formType}
            onChange={(e) => {
              setFormType(e.target.value as 'stdio' | 'sse');
              if (isExistingServer) setTimeout(autoSave, 0);
            }}
            className="mcp-type-select"
            disabled={readonly}
          >
            <option value="stdio">stdio (Local executable)</option>
            <option value="sse">SSE (Remote server)</option>
          </select>
          <div className="mcp-form-hint">
            {formType === 'stdio'
              ? 'Runs a local executable that communicates via stdin/stdout'
              : 'Connects to a remote server via Server-Sent Events'}
          </div>
        </div>

        {formType === 'stdio' ? (
          <>
            <div className={`mcp-form-group ${readonly ? 'mcp-readonly-group' : ''}`}>
              <label>Command</label>
              <div className="mcp-command-row">
                <input
                  type="text"
                  value={formCommand}
                  onChange={(e) => setFormCommand(e.target.value)}
                  onBlur={isExistingServer ? autoSave : undefined}
                  placeholder="/path/to/server or npx @modelcontextprotocol/server-name"
                  className="mcp-command-input"
                  disabled={readonly}
                />
                <button
                  onClick={handleTestConnection}
                  disabled={testStatus === 'testing' || !formCommand.trim()}
                  className={`mcp-test-button ${testStatus}`}
                  aria-label="Test server connection"
                  aria-busy={testStatus === 'testing'}
                >
                  {testStatus === 'testing' ? 'Testing...' :
                   testStatus === 'success' ? 'Connected' : 'Test'}
                </button>
                {testStatus === 'error' && <span className="mcp-test-failed-label">Failed</span>}
              </div>
              {testMessage && (
                <div
                  className={`mcp-test-message ${testStatus}`}
                  role={testStatus === 'error' ? 'alert' : 'status'}
                  aria-live="polite"
                >
                  {testStatus === 'testing' && <span className="mcp-test-spinner" aria-hidden="true" />}
                  {testMessage}
                  {testHelpUrl && testStatus === 'error' && (
                    <button
                      type="button"
                      className="mcp-help-link-button"
                      onClick={() => window.electronAPI.openExternal(testHelpUrl)}
                    >
                      Install Instructions
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className={`mcp-form-group ${readonly ? 'mcp-readonly-group' : ''}`}>
              <label>Arguments</label>
              {formArgs.map((arg, index) => (
                <div key={index} className="mcp-array-item">
                  <input
                    type="text"
                    value={arg}
                    onChange={(e) => updateArg(index, e.target.value)}
                    onBlur={isExistingServer ? autoSave : undefined}
                    placeholder="argument"
                    disabled={readonly}
                  />
                  {!readonly && (
                    <button onClick={() => { removeArg(index); if (isExistingServer) setTimeout(autoSave, 0); }} className="mcp-remove-button">x</button>
                  )}
                </div>
              ))}
              {!readonly && (
                <button onClick={addArg} className="mcp-add-button">+ Add Argument</button>
              )}
            </div>
          </>
        ) : (
          <div className={`mcp-form-group ${readonly ? 'mcp-readonly-group' : ''}`}>
            <label>Server URL</label>
            <div className="mcp-command-row">
              <input
                type="url"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                onBlur={isExistingServer ? autoSave : undefined}
                placeholder="https://example.com/mcp/sse"
                className="mcp-command-input"
                disabled={readonly}
              />
              <button
                onClick={handleTestConnection}
                disabled={testStatus === 'testing' || !formUrl.trim()}
                className={`mcp-test-button ${testStatus}`}
                aria-label="Test server connection"
                aria-busy={testStatus === 'testing'}
              >
                {testStatus === 'testing' ? 'Testing...' :
                 testStatus === 'success' ? 'Connected' : 'Test'}
              </button>
              {testStatus === 'error' && <span className="mcp-test-failed-label">Failed</span>}
            </div>
            {testMessage && (
              <div
                className={`mcp-test-message ${testStatus}`}
                role={testStatus === 'error' ? 'alert' : 'status'}
                aria-live="polite"
              >
                {testStatus === 'testing' && <span className="mcp-test-spinner" aria-hidden="true" />}
                {testMessage}
                {testHelpUrl && testStatus === 'error' && (
                  <button
                    type="button"
                    className="mcp-help-link-button"
                    onClick={() => window.electronAPI.openExternal(testHelpUrl)}
                  >
                    Install Instructions
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Additional env vars (not in required section) */}
        {!readonly && (
          <div className="mcp-form-group">
            <label>Environment Variables</label>
            {formEnv.map((envVar, index) => (
              <div key={index} className="mcp-env-item">
                <input
                  type="text"
                  value={envVar.key}
                  onChange={(e) => updateEnvVar(index, 'key', e.target.value)}
                  onBlur={isExistingServer ? autoSave : undefined}
                  placeholder="KEY"
                  className="mcp-env-key"
                />
                <input
                  type="text"
                  value={envVar.value}
                  onChange={(e) => updateEnvVar(index, 'value', e.target.value)}
                  onBlur={isExistingServer ? autoSave : undefined}
                  placeholder="value"
                  className="mcp-env-value"
                />
                <button onClick={() => { removeEnvVar(index); if (isExistingServer) setTimeout(autoSave, 0); }} className="mcp-remove-button">x</button>
              </div>
            ))}
            <button onClick={addEnvVar} className="mcp-add-button">+ Add Environment Variable</button>
          </div>
        )}

        {/* OAuth section for existing mcp-remote servers */}
        {isExistingServer && formCommand === 'npx' && formArgs.some(arg => arg === 'mcp-remote' || arg.includes('mcp-remote')) && (
          <div className="mcp-form-group">
            <label>OAuth Authorization</label>
            <div className="mcp-oauth-section">
              <div className="mcp-oauth-status">
                <span className="mcp-oauth-label">Status:</span>
                {oauthStatus === 'checking' && (
                  <span className="mcp-oauth-badge checking">Checking...</span>
                )}
                {oauthStatus === 'authorized' && (
                  <span className="mcp-oauth-badge authorized">Authorized</span>
                )}
                {oauthStatus === 'not-authorized' && (
                  <span className="mcp-oauth-badge not-authorized">Not authorized</span>
                )}
                {oauthStatus === 'unknown' && (
                  <span className="mcp-oauth-badge unknown">Unknown</span>
                )}
              </div>
              <div className="mcp-oauth-actions">
                {oauthStatus !== 'authorized' && (
                  <button
                    onClick={handleAuthorize}
                    disabled={oauthAction !== 'idle'}
                    className="mcp-oauth-button authorize"
                  >
                    {oauthAction === 'authorizing' ? 'Authorizing...' : 'Authorize'}
                  </button>
                )}
                {oauthStatus === 'authorized' && (
                  <button
                    onClick={handleRevoke}
                    disabled={oauthAction !== 'idle'}
                    className="mcp-oauth-button revoke"
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
    <div className="provider-panel">
      <div className="provider-panel-header">
        <h3 className="provider-panel-title">MCP Servers</h3>
        <p className="provider-panel-description">
          {scope === 'user'
            ? 'Configure global MCP servers available in all projects.'
            : 'Configure project-specific MCP servers (saved to .mcp.json).'}
        </p>
      </div>

      <div className="mcp-servers-container">
        {/* Sidebar - always visible in list view */}
        {viewState === 'list' && (
          <aside className="mcp-servers-sidebar" aria-label="MCP servers list">
            <div className="mcp-servers-header">
              <h4>Servers</h4>
              <button
                onClick={handleNewServer}
                className="mcp-add-server-button"
                aria-label="Add new MCP server"
              >
                <span className="mcp-add-icon" aria-hidden="true">+</span>
                <span>Add</span>
              </button>
            </div>

            <div className="mcp-servers-list" role="list">
              {servers.length === 0 ? (
                <div className="mcp-empty-state" role="status">
                  <span className="mcp-empty-state-text">No MCP servers configured</span>
                  <button
                    onClick={handleNewServer}
                    className="mcp-empty-state-cta"
                    aria-label="Add your first MCP server"
                  >
                    + Add Your First Server
                  </button>
                </div>
              ) : (
                servers.map((server) => (
                  <div
                    key={server.name}
                    className={`mcp-server-item ${selectedServer?.name === server.name ? 'active' : ''} ${server.disabled ? 'disabled' : ''}`}
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
                      className="mcp-server-toggle"
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Toggle ${server.name} server ${server.disabled ? 'on' : 'off'}`}
                    >
                      <input
                        type="checkbox"
                        checked={!server.disabled}
                        onChange={(e) => handleToggleDisabled(server.name, !e.target.checked)}
                        aria-label={`${server.name} enabled`}
                      />
                      <span className="mcp-toggle-slider" aria-hidden="true"></span>
                    </label>
                    <div className="mcp-server-item-info">
                      <div className="mcp-server-item-name">{server.name}</div>
                      <div className="mcp-server-item-command">{server.command || server.url}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        )}

        {/* Details Panel */}
        <div className="mcp-server-details">
          {viewState === 'template-selection' && renderTemplateSelection()}

          {viewState === 'server-config' && renderServerConfig()}

          {viewState === 'list' && !selectedServer && (
            <div className="mcp-no-selection">
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
        <div className="provider-panel" role="alert" aria-live="assertive">
          <div className="mcp-error" style={{ padding: '2rem', textAlign: 'center' }}>
            <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>Unable to load MCP Servers</h3>
            <p style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>
              An unexpected error occurred while loading the MCP servers panel.
              Please try refreshing the application.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mcp-retry-button"
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
      <MCPServersPanelInner {...props} />
    </ErrorBoundary>
  );
}
