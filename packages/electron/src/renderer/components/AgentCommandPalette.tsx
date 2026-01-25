import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Agent } from '@nimbalyst/runtime/agents';
import { agentApi } from '../services/agentApi';
import { aiApi } from '../services/aiApi';

interface AgentCommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  workspacePath?: string;
  documentContext?: { content?: string; filePath?: string };
}

export const AgentCommandPalette: React.FC<AgentCommandPaletteProps> = ({
  isOpen,
  onClose,
  workspacePath,
  documentContext,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [filteredAgents, setFilteredAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [parameters, setParameters] = useState<Record<string, any>>({});
  const [isExecuting, setIsExecuting] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultsListRef = useRef<HTMLUListElement>(null);

  // Use refs to store latest values without causing re-renders
  const documentContextRef = useRef(documentContext);
  const workspacePathRef = useRef(workspacePath);

  // Update refs when props change
  useEffect(() => {
    documentContextRef.current = documentContext;
    workspacePathRef.current = workspacePath;
  }, [documentContext, workspacePath]);

  // Load agents when component opens
  useEffect(() => {
    if (isOpen) {
      loadAgents();
    }
  }, [isOpen, workspacePath]);

  // Load agents initially and listen for updates - only set up listener once
  useEffect(() => {
    if (!window.electronAPI) return;

    const handleAgentsUpdated = () => {
      console.log('Agents updated, reloading...');
      loadAgents();
    };

    // Listen for updates from main process
    window.electronAPI.on('agents:updated', handleAgentsUpdated);

    return () => {
      window.electronAPI.off('agents:updated', handleAgentsUpdated);
    };
  }, []); // Empty dependency array - only set up once

  // Load agents when workspacePath changes
  useEffect(() => {
    if (workspacePath) {
      // loadAgents();
    }
  }, [workspacePath]);

  const loadAgents = async () => {
    setIsLoading(true);
    try {
      // const loadedAgents = await agentApi.getAllAgents(workspacePathRef.current);
      // setAgents(loadedAgents);
      // setFilteredAgents(loadedAgents);
    } catch (error) {
      console.error('Failed to load agents:', error);
      setAgents([]);
      setFilteredAgents([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Filter agents based on search query
  useEffect(() => {
    if (!searchQuery) {
      setFilteredAgents(agents);
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = agents.filter(agent => {
        const metadata = agent.metadata;
        return (
          metadata.name.toLowerCase().includes(query) ||
          metadata.description.toLowerCase().includes(query) ||
          metadata.tags?.some(tag => tag.toLowerCase().includes(query))
        );
      });
      setFilteredAgents(filtered);
    }
    setSelectedIndex(0);
  }, [searchQuery, agents]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setSelectedIndex(0);
      setSelectedAgent(null);
      setParameters({});
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Listen for agent messages from main process - only set up once
  useEffect(() => {
    if (!window.electronAPI) return;

    const handleAgentMessage = async (data: any) => {
      console.log('Received agent message:', data);

      // Send the message to the AI chat using ref values
      if (data.sessionId && data.message) {
        // Only pass documentContext if content is defined
        const docContext = documentContextRef.current?.content
          ? documentContextRef.current as { content: string; filePath?: string }
          : undefined;
        await aiApi.sendMessage(
          data.message,
          docContext,
          data.sessionId,
          workspacePathRef.current
        );
      }
    };

    // Set up listener
    window.electronAPI.on('agent:message', handleAgentMessage);

    // Cleanup - must use the exact same function reference
    return () => {
      window.electronAPI.off('agent:message', handleAgentMessage);
    };
  }, []); // Empty dependency array - only set up once

  // Scroll selected item into view
  useEffect(() => {
    console.log('selectedIndex changed to:', selectedIndex, 'filteredAgents:', filteredAgents.length);
    if (resultsListRef.current && selectedIndex >= 0) {
      const items = resultsListRef.current.querySelectorAll('li');
      if (items[selectedIndex]) {
        items[selectedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex, filteredAgents]);

  // Handle keyboard navigation - don't use useCallback to ensure fresh state
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!selectedAgent) {
      // Agent selection mode
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex(prev => {
          const newIndex = Math.min(prev + 1, filteredAgents.length - 1);
          console.log('Arrow down - new index:', newIndex);
          return newIndex;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex(prev => {
          const newIndex = Math.max(prev - 1, 0);
          console.log('Arrow up - new index:', newIndex);
          return newIndex;
        });
      } else if (e.key === 'Enter' && filteredAgents[selectedIndex]) {
        e.preventDefault();
        e.stopPropagation();
        selectAgent(filteredAgents[selectedIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    } else {
      // Parameter input mode
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        console.log('Escape pressed in parameter mode');
        setSelectedAgent(null);
        setParameters({});
        setTimeout(() => searchInputRef.current?.focus(), 100);
      } else if (e.key === 'Enter' && e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        executeAgent();
      }
    }
  };

  const selectAgent = (agent: Agent) => {
    setSelectedAgent(agent);

    // Initialize parameters with defaults
    const defaultParams: Record<string, any> = {};
    if (agent.metadata.parameters) {
      for (const [key, param] of Object.entries(agent.metadata.parameters)) {
        defaultParams[key] = param.default ?? '';
      }
    }
    setParameters(defaultParams);
  };

  const executeAgent = async () => {
    if (!selectedAgent) return;

    setIsExecuting(true);
    try {
      // Create or get current AI session using ref values
      const sessions = await aiApi.getSessions(workspacePathRef.current);
      let currentSession = sessions?.[0];

      if (!currentSession) {
        // Create a new session if none exists
        await aiApi.createSessionWithProvider('claude-code', undefined, workspacePathRef.current ?? undefined);
        const updatedSessions = await aiApi.getSessions(workspacePathRef.current);
        currentSession = updatedSessions?.[0];
      }

      if (!currentSession) {
        throw new Error('Failed to create AI session');
      }

      // Execute the agent using ref values
      const result = await agentApi.executeAgent({
        agentId: selectedAgent.id,
        parameters,
        documentContext: documentContextRef.current?.content,
        sessionId: currentSession.id,
        workspacePath: workspacePathRef.current,
      });

      if (result.success) {
        console.log('Agent executed successfully:', result);
        onClose();

        // Open AI chat if it's not already open
        window.electronAPI?.send('toggle-ai-chat');
      } else {
        console.error('Agent execution failed:', result.error);
        alert(`Agent execution failed: ${result.error}`);
      }
    } catch (error) {
      console.error('Error executing agent:', error);
      alert(`Error executing agent: ${error}`);
    } finally {
      setIsExecuting(false);
    }
  };

  const renderParameterInput = (key: string, param: any) => {
    const value = parameters[key] ?? '';

    switch (param.type) {
      case 'select':
        return (
          <select
            value={value}
            onChange={(e) => setParameters({ ...parameters, [key]: e.target.value })}
            className="agent-param-select py-2 px-3 rounded-md text-sm outline-none bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] focus:border-[var(--nim-primary)]"
          >
            {param.options?.map((option: any) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );
      case 'boolean':
        return (
          <input
            type="checkbox"
            checked={value}
            onChange={(e) => setParameters({ ...parameters, [key]: e.target.checked })}
            className="agent-param-checkbox w-5 h-5 cursor-pointer"
          />
        );
      case 'number':
        return (
          <input
            type="number"
            value={value}
            onChange={(e) => setParameters({ ...parameters, [key]: e.target.value })}
            min={param.min}
            max={param.max}
            className="agent-param-input py-2 px-3 rounded-md text-sm outline-none bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] focus:border-[var(--nim-primary)]"
          />
        );
      default:
        return (
          <input
            type="text"
            value={value}
            onChange={(e) => setParameters({ ...parameters, [key]: e.target.value })}
            className="agent-param-input py-2 px-3 rounded-md text-sm outline-none bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] focus:border-[var(--nim-primary)]"
          />
        );
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="agent-command-palette-overlay nim-overlay items-start justify-center pt-[10vh]"
      onClick={onClose}
    >
      <div
        className="agent-command-palette nim-modal w-[90%] max-w-[600px] max-h-[70vh] shadow-[0_8px_32px_rgba(0,0,0,0.2)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {!selectedAgent ? (
          <>
            <div className="agent-command-palette-header p-3 border-b border-[var(--nim-border)]">
              <input
                ref={searchInputRef}
                type="text"
                className="agent-command-palette-input nim-input text-base"
                placeholder="Search agents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
              />
            </div>

            <div className="agent-command-palette-content flex-1 overflow-y-auto min-h-[200px] max-h-[400px]">
              {isLoading ? (
                <div className="agent-command-palette-loading p-8 text-center text-sm text-[var(--nim-text-muted)]">Loading agents...</div>
              ) : filteredAgents.length === 0 ? (
                <div className="agent-command-palette-empty p-8 text-center text-sm text-[var(--nim-text-muted)]">
                  {agents.length === 0
                    ? "No agents found. Create agents in the workspace/agents folder."
                    : "No matching agents found."}
                </div>
              ) : (
                <ul ref={resultsListRef} className="agent-command-palette-results list-none m-0 p-2">
                  {filteredAgents.map((agent, index) => (
                    <li
                      key={agent.id}
                      className={`agent-command-palette-item p-2 mb-1 rounded-md cursor-pointer transition-colors duration-150 ${index === selectedIndex ? 'selected bg-[var(--nim-bg-selected)]' : 'hover:bg-[var(--nim-bg-hover)]'}`}
                      onClick={() => selectAgent(agent)}
                      onMouseEnter={() => setSelectedIndex(index)}
                    >
                      <div className="agent-item-header flex items-center gap-2 mb-1">
                        <span className="agent-item-icon text-lg">🤖</span>
                        <span className="agent-item-name font-medium flex-1 text-[var(--nim-text)]">{agent.metadata.name}</span>
                        {agent.metadata.version && (
                          <span className="agent-item-version text-[11px] py-0.5 px-1.5 rounded bg-[var(--nim-bg-secondary)] text-[var(--nim-text-muted)]">v{agent.metadata.version}</span>
                        )}
                      </div>
                      <div className="agent-item-description text-[13px] leading-snug ml-[26px] text-[var(--nim-text-muted)]">{agent.metadata.description}</div>
                      {agent.metadata.tags && agent.metadata.tags.length > 0 && (
                        <div className="agent-item-tags flex gap-1 mt-1.5 ml-[26px] flex-wrap">
                          {agent.metadata.tags.map(tag => (
                            <span key={tag} className="agent-item-tag text-[11px] py-0.5 px-1.5 rounded bg-[color-mix(in_srgb,var(--nim-primary)_10%,transparent)] text-[var(--nim-primary)]">{tag}</span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="agent-command-palette-footer py-2 px-3 border-t border-[var(--nim-border)] flex items-center justify-between">
              <span className="agent-command-palette-hint text-xs flex items-center gap-2 text-[var(--nim-text-muted)]">
                <kbd className="py-0.5 px-1 rounded text-[11px] font-mono bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)]">↑↓</kbd> Navigate <kbd className="py-0.5 px-1 rounded text-[11px] font-mono bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)]">Enter</kbd> Select <kbd className="py-0.5 px-1 rounded text-[11px] font-mono bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)]">Esc</kbd> Cancel
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="agent-command-palette-header p-3 border-b border-[var(--nim-border)]">
              <div className="agent-params-header flex items-center gap-2">
                <span className="agent-params-icon text-xl">🤖</span>
                <span className="agent-params-title text-lg font-medium text-[var(--nim-text)]">{selectedAgent.metadata.name}</span>
              </div>
            </div>

            <div className="agent-command-palette-content agent-params-content flex-1 overflow-y-auto p-4">
              <div className="agent-params-description mb-5 leading-snug text-[var(--nim-text-muted)]">
                {selectedAgent.metadata.description}
              </div>

              {selectedAgent.metadata.parameters && Object.keys(selectedAgent.metadata.parameters).length > 0 ? (
                <div className="agent-params-list flex flex-col gap-4">
                  <div className="agent-params-label text-xs font-semibold uppercase mb-2 text-[var(--nim-text-muted)]">Parameters:</div>
                  {Object.entries(selectedAgent.metadata.parameters).map(([key, param]) => (
                    <div key={key} className="agent-param-item flex flex-col gap-1.5">
                      <label className="agent-param-label text-sm font-medium flex items-center gap-1.5 text-[var(--nim-text)]">
                        {key}
                        {param.required && <span className="agent-param-required text-[var(--nim-error)]">*</span>}
                        {param.description && (
                          <span className="agent-param-description text-xs font-normal text-[var(--nim-text-muted)]">{param.description}</span>
                        )}
                      </label>
                      {renderParameterInput(key, param)}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="agent-params-none p-5 text-center italic text-[var(--nim-text-muted)]">
                  This agent has no configurable parameters.
                </div>
              )}
            </div>

            <div className="agent-command-palette-footer py-2 px-3 border-t border-[var(--nim-border)] flex items-center justify-between">
              <div className="flex gap-2">
                <button
                  className="agent-cancel-btn nim-btn-secondary"
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  className="agent-execute-btn nim-btn-primary"
                  onClick={executeAgent}
                  disabled={isExecuting}
                >
                  {isExecuting ? 'Executing...' : 'Execute Agent'}
                </button>
              </div>
              <span className="agent-command-palette-hint text-xs flex items-center gap-2 text-[var(--nim-text-muted)]">
                <kbd className="py-0.5 px-1 rounded text-[11px] font-mono bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)]">⌘Enter</kbd> Execute <kbd className="py-0.5 px-1 rounded text-[11px] font-mono bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)]">Esc</kbd> Back
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
