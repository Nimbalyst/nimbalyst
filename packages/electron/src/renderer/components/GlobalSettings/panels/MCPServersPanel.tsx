import React, { useState, useEffect } from 'react';
import './MCPServersPanel.css';

interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface MCPServerWithName extends MCPServerConfig {
  name: string;
}

interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

export function MCPServersPanel() {
  const [servers, setServers] = useState<MCPServerWithName[]>([]);
  const [selectedServer, setSelectedServer] = useState<MCPServerWithName | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formCommand, setFormCommand] = useState('');
  const [formArgs, setFormArgs] = useState<string[]>([]);
  const [formEnv, setFormEnv] = useState<Array<{ key: string; value: string }>>([]);

  useEffect(() => {
    loadServers();
  }, []);

  const loadServers = async () => {
    try {
      setLoading(true);
      setError(null);
      const config: MCPConfig = await window.electronAPI.invoke('mcp-config:read-user');

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
    setIsEditing(false);

    // Populate form
    setFormName(server.name);
    setFormCommand(server.command);
    setFormArgs(server.args || []);
    setFormEnv(
      Object.entries(server.env || {}).map(([key, value]) => ({ key, value }))
    );
  };

  const handleNewServer = () => {
    setSelectedServer(null);
    setIsEditing(true);

    // Clear form
    setFormName('');
    setFormCommand('');
    setFormArgs([]);
    setFormEnv([]);
  };

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleCancel = () => {
    if (selectedServer) {
      // Restore form to selected server
      setFormName(selectedServer.name);
      setFormCommand(selectedServer.command);
      setFormArgs(selectedServer.args || []);
      setFormEnv(
        Object.entries(selectedServer.env || {}).map(([key, value]) => ({ key, value }))
      );
    } else {
      // Clear form
      setFormName('');
      setFormCommand('');
      setFormArgs([]);
      setFormEnv([]);
    }
    setIsEditing(false);
  };

  const handleSave = async () => {
    try {
      if (!formName.trim()) {
        alert('Server name is required');
        return;
      }
      if (!formCommand.trim()) {
        alert('Command is required');
        return;
      }

      // Build server config
      const serverConfig: MCPServerConfig = {
        command: formCommand.trim(),
        args: formArgs.filter(arg => arg.trim()).map(arg => arg.trim()),
        env: Object.fromEntries(
          formEnv.filter(({ key, value }) => key.trim()).map(({ key, value }) => [key.trim(), value])
        )
      };

      // Remove empty args and env if not needed
      if (serverConfig.args?.length === 0) {
        delete serverConfig.args;
      }
      if (Object.keys(serverConfig.env || {}).length === 0) {
        delete serverConfig.env;
      }

      // Build new config
      const config: MCPConfig = await window.electronAPI.invoke('mcp-config:read-user');

      // If renaming, delete old entry
      if (selectedServer && selectedServer.name !== formName.trim()) {
        delete config.mcpServers[selectedServer.name];
      }

      config.mcpServers[formName.trim()] = serverConfig;

      // Validate
      const validation = await window.electronAPI.invoke('mcp-config:validate', config);
      if (!validation.valid) {
        alert(`Invalid configuration: ${validation.error}`);
        return;
      }

      // Save
      const result = await window.electronAPI.invoke('mcp-config:write-user', config);
      if (!result.success) {
        alert(`Failed to save: ${result.error}`);
        return;
      }

      // Reload and select the saved server
      await loadServers();
      const savedServer = {
        name: formName.trim(),
        ...serverConfig
      };
      setSelectedServer(savedServer);
      setIsEditing(false);
    } catch (err: any) {
      console.error('Failed to save server:', err);
      alert(`Error: ${err.message || 'Failed to save server'}`);
    }
  };

  const handleDelete = async () => {
    if (!selectedServer) return;

    if (!confirm(`Delete MCP server "${selectedServer.name}"?`)) {
      return;
    }

    try {
      const config: MCPConfig = await window.electronAPI.invoke('mcp-config:read-user');
      delete config.mcpServers[selectedServer.name];

      const result = await window.electronAPI.invoke('mcp-config:write-user', config);
      if (!result.success) {
        alert(`Failed to delete: ${result.error}`);
        return;
      }

      await loadServers();
      setSelectedServer(null);
      setIsEditing(false);
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
          Configure Model Context Protocol (MCP) servers for Claude Code.
          These servers are available globally across all projects.
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
          {!selectedServer && !isEditing ? (
            <div className="mcp-no-selection">
              Select a server or create a new one
            </div>
          ) : (
            <div className="mcp-server-form">
              <div className="mcp-form-group">
                <label>Server Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  disabled={!isEditing}
                  placeholder="my-server"
                />
              </div>

              <div className="mcp-form-group">
                <label>Command</label>
                <input
                  type="text"
                  value={formCommand}
                  onChange={(e) => setFormCommand(e.target.value)}
                  disabled={!isEditing}
                  placeholder="/path/to/server or npx @modelcontextprotocol/server-name"
                />
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
                      disabled={!isEditing}
                      placeholder="argument"
                    />
                    {isEditing && (
                      <button onClick={() => removeArg(index)} className="mcp-remove-button">×</button>
                    )}
                  </div>
                ))}
                {isEditing && (
                  <button onClick={addArg} className="mcp-add-button">+ Add Argument</button>
                )}
              </div>

              <div className="mcp-form-group">
                <label>Environment Variables</label>
                {formEnv.map((envVar, index) => (
                  <div key={index} className="mcp-env-item">
                    <input
                      type="text"
                      value={envVar.key}
                      onChange={(e) => updateEnvVar(index, 'key', e.target.value)}
                      disabled={!isEditing}
                      placeholder="KEY"
                      className="mcp-env-key"
                    />
                    <input
                      type="text"
                      value={envVar.value}
                      onChange={(e) => updateEnvVar(index, 'value', e.target.value)}
                      disabled={!isEditing}
                      placeholder="value or ${'{VAR}'}"
                      className="mcp-env-value"
                    />
                    {isEditing && (
                      <button onClick={() => removeEnvVar(index)} className="mcp-remove-button">×</button>
                    )}
                  </div>
                ))}
                {isEditing && (
                  <button onClick={addEnvVar} className="mcp-add-button">+ Add Environment Variable</button>
                )}
              </div>

              <div className="mcp-form-actions">
                {isEditing ? (
                  <>
                    <button onClick={handleCancel} className="mcp-cancel-button">Cancel</button>
                    <button onClick={handleSave} className="mcp-save-button">Save</button>
                  </>
                ) : (
                  <>
                    {selectedServer && (
                      <button onClick={handleDelete} className="mcp-delete-button">Delete</button>
                    )}
                    <button onClick={handleEdit} className="mcp-edit-button">Edit</button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
