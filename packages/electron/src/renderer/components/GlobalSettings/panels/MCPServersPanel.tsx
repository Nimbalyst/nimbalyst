import React, { useState, useEffect } from 'react';
import './MCPServersPanel.css';

interface MCPServerConfig {
  command?: string;
  args?: string[];
  url?: string;
  type?: 'stdio' | 'sse';
  env?: Record<string, string>;
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
  config: MCPServerConfig;
}

const MCP_SERVER_TEMPLATES: MCPServerTemplate[] = [
  {
    id: 'linear',
    name: 'Linear',
    description: 'Issue tracking and project management (Official Remote Server)',
    docsUrl: 'https://linear.app/docs/mcp',
    config: {
      type: 'sse',
      url: 'https://mcp.linear.app/sse',
      env: {
        LINEAR_API_KEY: '${LINEAR_API_KEY}'
      }
    }
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repository management and code collaboration',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
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
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres'],
      env: {
        POSTGRES_CONNECTION_STRING: '${POSTGRES_CONNECTION_STRING}'
      }
    }
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Local file system access',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      env: {}
    }
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web search capabilities',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: {
        BRAVE_API_KEY: '${BRAVE_API_KEY}'
      }
    }
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Access files and documents in Google Drive',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gdrive',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-gdrive'],
      env: {}
    }
  },
  {
    id: 'posthog',
    name: 'PostHog',
    description: 'Product analytics, feature flags, and error tracking',
    docsUrl: 'https://posthog.com/docs/model-context-protocol',
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
  }
];

interface MCPServersPanelProps {
  /** Scope for MCP config: 'user' for global, 'workspace' for project-specific. */
  scope?: 'user' | 'workspace';
  /** Workspace path required when scope is 'workspace'. */
  workspacePath?: string;
}

export function MCPServersPanel({ scope = 'user', workspacePath }: MCPServersPanelProps = {}) {
  const [servers, setServers] = useState<MCPServerWithName[]>([]);
  const [selectedServer, setSelectedServer] = useState<MCPServerWithName | null>(null);
  const [isNewServer, setIsNewServer] = useState(false);
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
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState<string>('');

  // Reload servers when scope or workspace path changes
  useEffect(() => {
    loadServers();
  }, [scope, workspacePath]);

  const loadServers = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load from the appropriate scope
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
    } catch (err: any) {
      console.error('Failed to load MCP servers:', err);
      setError(err.message || 'Failed to load MCP servers');
    } finally {
      setLoading(false);
    }
  };

  const handleServerSelect = (server: MCPServerWithName) => {
    setSelectedServer(server);
    setIsNewServer(false);
    setSaveStatus('idle');

    // Populate form
    setFormName(server.name);
    setFormType(server.type || 'stdio');
    setFormCommand(server.command || '');
    setFormUrl(server.url || '');
    setFormArgs(server.args || []);
    setFormEnv(
      Object.entries(server.env || {}).map(([key, value]) => ({ key, value }))
    );
    setSelectedTemplateId(null);
  };

  const handleNewServer = () => {
    setSelectedServer(null);
    setIsNewServer(true);
    setSaveStatus('idle');

    // Clear form
    setFormName('');
    setFormType('stdio');
    setFormCommand('');
    setFormUrl('');
    setFormArgs([]);
    setFormEnv([]);
    setSelectedTemplateId(null);
  };

  const handleTemplateSelect = (templateId: string) => {
    if (!templateId) {
      setSelectedTemplateId(null);
      return;
    }

    const template = MCP_SERVER_TEMPLATES.find(t => t.id === templateId);
    if (!template) return;

    // Populate form with template
    setFormName(template.id);
    setFormType(template.config.type || 'stdio');
    setFormCommand(template.config.command || '');
    setFormUrl(template.config.url || '');
    setFormArgs(template.config.args || []);
    setFormEnv(
      Object.entries(template.config.env || {}).map(([key, value]) => ({ key, value }))
    );
    setSelectedTemplateId(templateId);
  };

  // Auto-save function - called on blur from form fields
  const autoSave = async () => {
    // Don't save if form is incomplete
    if (!formName.trim()) return;

    // Validate based on transport type
    if (formType === 'stdio' && !formCommand.trim()) return;
    if (formType === 'sse' && !formUrl.trim()) return;

    try {
      setSaveStatus('saving');

      // Build server config based on type
      const serverConfig: MCPServerConfig = {
        type: formType,
        env: Object.fromEntries(
          formEnv.filter(({ key }) => key.trim()).map(({ key, value }) => [key.trim(), value])
        )
      };

      if (formType === 'stdio') {
        serverConfig.command = formCommand.trim();
        serverConfig.args = formArgs.filter(arg => arg.trim()).map(arg => arg.trim());

        // Remove empty args if not needed
        if (serverConfig.args?.length === 0) {
          delete serverConfig.args;
        }
      } else if (formType === 'sse') {
        serverConfig.url = formUrl.trim();
      }

      // Remove empty env if not needed
      if (Object.keys(serverConfig.env || {}).length === 0) {
        delete serverConfig.env;
      }

      // Build new config - read from the appropriate scope
      const config: MCPConfig = scope === 'workspace' && workspacePath
        ? await window.electronAPI.invoke('mcp-config:read-workspace', workspacePath)
        : await window.electronAPI.invoke('mcp-config:read-user');

      // If renaming, delete old entry
      if (selectedServer && selectedServer.name !== formName.trim()) {
        delete config.mcpServers[selectedServer.name];
      }

      config.mcpServers[formName.trim()] = serverConfig;

      // Validate
      const validation = await window.electronAPI.invoke('mcp-config:validate', config);
      if (!validation.valid) {
        setSaveStatus('error');
        return;
      }

      // Save to the appropriate scope
      const result = scope === 'workspace' && workspacePath
        ? await window.electronAPI.invoke('mcp-config:write-workspace', workspacePath, config)
        : await window.electronAPI.invoke('mcp-config:write-user', config);

      if (!result.success) {
        setSaveStatus('error');
        return;
      }

      // Reload servers list and update selected server
      await loadServers();
      const savedServer = {
        name: formName.trim(),
        ...serverConfig
      };
      setSelectedServer(savedServer);
      setIsNewServer(false);
      setSaveStatus('saved');

      // Reset status after a delay
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err: any) {
      console.error('Failed to save server:', err);
      setSaveStatus('error');
    }
  };

  const handleDelete = async () => {
    if (!selectedServer) return;

    if (!confirm(`Delete MCP server "${selectedServer.name}"?`)) {
      return;
    }

    try {
      // Delete from the appropriate scope
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
      setIsNewServer(false);
    } catch (err: any) {
      console.error('Failed to delete server:', err);
      alert(`Error: ${err.message || 'Failed to delete server'}`);
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

  const handleTestConnection = async () => {
    // Validate based on type
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

    // Subscribe to progress updates
    const unsubscribe = window.electronAPI.on(
      'mcp-config:test-progress',
      (data: { status: string; message: string }) => {
        if (data.message) {
          setTestMessage(data.message);
        }
      }
    );

    try {
      // Build temporary server config for testing
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

      // Test the MCP server connection
      const result = await window.electronAPI.invoke('mcp-config:test-server', testConfig);

      if (result.success) {
        setTestStatus('success');
        setTestMessage('Connection successful');
      } else {
        setTestStatus('error');
        setTestMessage(result.error || 'Connection failed');
      }
    } catch (error: any) {
      setTestStatus('error');
      setTestMessage(error.message || 'Test failed');
    } finally {
      // Clean up progress listener
      unsubscribe();
    }
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
        <div className="mcp-servers-sidebar">
          <div className="mcp-servers-header">
            <h4>Servers</h4>
            <button onClick={handleNewServer} className="mcp-new-button">+</button>
          </div>

          <div className="mcp-servers-list">
            {servers.length === 0 ? (
              <div className="mcp-empty-state">No MCP servers configured</div>
            ) : (
              servers.map((server) => (
                <div
                  key={server.name}
                  className={`mcp-server-item ${selectedServer?.name === server.name ? 'active' : ''}`}
                  onClick={() => handleServerSelect(server)}
                >
                  <div className="mcp-server-item-name">{server.name}</div>
                  <div className="mcp-server-item-command">{server.command}</div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mcp-server-details">
          {!selectedServer && !isNewServer ? (
            <div className="mcp-no-selection">
              Select a server or create a new one
            </div>
          ) : (
            <div className="mcp-server-form">
              {isNewServer && (
                <>
                  <div className="mcp-form-group">
                    <label>Start from Template</label>
                    <select
                      onChange={(e) => handleTemplateSelect(e.target.value)}
                      defaultValue=""
                      className="mcp-template-select"
                    >
                      <option value="">Choose a template or create from scratch</option>
                      {MCP_SERVER_TEMPLATES.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name} - {template.description}
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedTemplateId && (
                    <div className="mcp-docs-link">
                      {MCP_SERVER_TEMPLATES.find(t => t.id === selectedTemplateId)?.docsUrl && (
                        <a
                          href={MCP_SERVER_TEMPLATES.find(t => t.id === selectedTemplateId)?.docsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mcp-docs-link-button"
                        >
                          View {MCP_SERVER_TEMPLATES.find(t => t.id === selectedTemplateId)?.name} Documentation →
                        </a>
                      )}
                    </div>
                  )}
                </>
              )}

              <div className="mcp-form-group">
                <label>Server Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  onBlur={autoSave}
                  placeholder="my-server"
                />
              </div>

              <div className="mcp-form-group">
                <label>Transport Type</label>
                <select
                  value={formType}
                  onChange={(e) => {
                    setFormType(e.target.value as 'stdio' | 'sse');
                    // Auto-save after type change
                    setTimeout(autoSave, 0);
                  }}
                  className="mcp-type-select"
                >
                  <option value="stdio">stdio (Local executable)</option>
                  <option value="sse">SSE (Remote server)</option>
                </select>
                <div className="mcp-form-hint">
                  {formType === 'stdio'
                    ? 'Runs a local executable that communicates via stdin/stdout'
                    : 'Connects to a remote server via Server-Sent Events (more secure)'}
                </div>
              </div>

              {formType === 'stdio' ? (
                <>
                  <div className="mcp-form-group">
                    <label>Command</label>
                    <div className="mcp-command-row">
                      <input
                        type="text"
                        value={formCommand}
                        onChange={(e) => setFormCommand(e.target.value)}
                        onBlur={autoSave}
                        placeholder="/path/to/server or npx @modelcontextprotocol/server-name"
                        className="mcp-command-input"
                      />
                      <button
                        onClick={handleTestConnection}
                        disabled={testStatus === 'testing' || !formCommand.trim()}
                        className={`mcp-test-button ${testStatus}`}
                      >
                        {testStatus === 'testing' ? 'Testing...' :
                         testStatus === 'success' ? '✓ Connected' :
                         testStatus === 'error' ? '✗ Failed' : 'Test'}
                      </button>
                    </div>
                    {testMessage && (
                      <div className={`mcp-test-message ${testStatus}`}>
                        {testStatus === 'testing' && <span className="mcp-test-spinner" />}
                        {testMessage}
                      </div>
                    )}
                    <div className="mcp-form-hint">Supports ${'{VAR}'} and ${'{VAR:-default}'} syntax</div>
                  </div>

                  <div className="mcp-form-group">
                    <label>Arguments</label>
                    {formArgs.map((arg, index) => (
                      <div key={index} className="mcp-array-item">
                        <input
                          type="text"
                          value={arg}
                          onChange={(e) => updateArg(index, e.target.value)}
                          onBlur={autoSave}
                          placeholder="argument"
                        />
                        <button onClick={() => { removeArg(index); setTimeout(autoSave, 0); }} className="mcp-remove-button">×</button>
                      </div>
                    ))}
                    <button onClick={addArg} className="mcp-add-button">+ Add Argument</button>
                  </div>
                </>
              ) : (
                <div className="mcp-form-group">
                  <label>Server URL</label>
                  <div className="mcp-command-row">
                    <input
                      type="url"
                      value={formUrl}
                      onChange={(e) => setFormUrl(e.target.value)}
                      onBlur={autoSave}
                      placeholder="https://example.com/mcp/sse"
                      className="mcp-command-input"
                    />
                    <button
                      onClick={handleTestConnection}
                      disabled={testStatus === 'testing' || !formUrl.trim()}
                      className={`mcp-test-button ${testStatus}`}
                    >
                      {testStatus === 'testing' ? 'Testing...' :
                       testStatus === 'success' ? '✓ Connected' :
                       testStatus === 'error' ? '✗ Failed' : 'Test'}
                    </button>
                  </div>
                  {testMessage && (
                    <div className={`mcp-test-message ${testStatus}`}>
                      {testStatus === 'testing' && <span className="mcp-test-spinner" />}
                      {testMessage}
                    </div>
                  )}
                  <div className="mcp-form-hint">Remote MCP server endpoint (HTTPS recommended)</div>
                </div>
              )}

              <div className="mcp-form-group">
                <label>Environment Variables</label>
                {formEnv.map((envVar, index) => (
                  <div key={index} className="mcp-env-item">
                    <input
                      type="text"
                      value={envVar.key}
                      onChange={(e) => updateEnvVar(index, 'key', e.target.value)}
                      onBlur={autoSave}
                      placeholder="KEY"
                      className="mcp-env-key"
                    />
                    <input
                      type="text"
                      value={envVar.value}
                      onChange={(e) => updateEnvVar(index, 'value', e.target.value)}
                      onBlur={autoSave}
                      placeholder="value or ${'{VAR}'}"
                      className="mcp-env-value"
                    />
                    <button onClick={() => { removeEnvVar(index); setTimeout(autoSave, 0); }} className="mcp-remove-button">×</button>
                  </div>
                ))}
                <button onClick={addEnvVar} className="mcp-add-button">+ Add Environment Variable</button>
              </div>

              <div className="mcp-form-actions">
                {selectedServer && (
                  <button onClick={handleDelete} className="mcp-delete-button">Delete</button>
                )}
                <span className={`mcp-save-status ${saveStatus}`}>
                  {saveStatus === 'saving' && 'Saving...'}
                  {saveStatus === 'saved' && 'Saved'}
                  {saveStatus === 'error' && 'Error saving'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
