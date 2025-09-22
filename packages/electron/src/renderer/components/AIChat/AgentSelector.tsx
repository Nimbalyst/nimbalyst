import React, { useState, useEffect, useCallback } from 'react';
import { Agent } from '@stravu/runtime/agents';
import './AgentSelector.css';

interface AgentSelectorProps {
  agents: Agent[];
  selectedAgent?: Agent | null;
  onSelectAgent: (agent: Agent | null) => void;
  disabled?: boolean;
}

export function AgentSelector({
  agents,
  selectedAgent,
  onSelectAgent,
  disabled = false
}: AgentSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredAgents = agents.filter(agent => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      agent.metadata.name.toLowerCase().includes(query) ||
      agent.metadata.description.toLowerCase().includes(query) ||
      agent.metadata.tags?.some(tag => tag.toLowerCase().includes(query))
    );
  });

  const groupedAgents = filteredAgents.reduce((groups, agent) => {
    const tags = agent.metadata.tags || ['other'];
    tags.forEach(tag => {
      if (!groups[tag]) {
        groups[tag] = [];
      }
      groups[tag].push(agent);
    });
    return groups;
  }, {} as Record<string, Agent[]>);

  const handleSelectAgent = useCallback((agent: Agent | null) => {
    onSelectAgent(agent);
    setIsOpen(false);
    setSearchQuery('');
  }, [onSelectAgent]);

  const handleClearAgent = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    handleSelectAgent(null);
  }, [handleSelectAgent]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.agent-selector')) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div className="agent-selector">
      <button
        className={`agent-selector-trigger ${selectedAgent ? 'has-selection' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
      >
        <span className="agent-icon">🤖</span>
        <span className="agent-label">
          {selectedAgent ? selectedAgent.metadata.name : 'No Agent'}
        </span>
        {selectedAgent && (
          <button
            className="agent-clear"
            onClick={handleClearAgent}
            aria-label="Clear agent selection"
          >
            ×
          </button>
        )}
      </button>

      {isOpen && (
        <div className="agent-dropdown">
          <div className="agent-search">
            <input
              type="text"
              placeholder="Search agents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>

          <div className="agent-list">
            {agents.length === 0 ? (
              <div className="agent-empty">
                <p>No agents available</p>
                <small>Create agents in the workspace/agents folder</small>
              </div>
            ) : filteredAgents.length === 0 ? (
              <div className="agent-empty">
                <p>No matching agents</p>
              </div>
            ) : (
              <>
                <button
                  className="agent-item no-agent"
                  onClick={() => handleSelectAgent(null)}
                >
                  <span className="agent-item-icon">➖</span>
                  <div className="agent-item-details">
                    <div className="agent-item-name">No Agent</div>
                    <div className="agent-item-description">
                      Regular chat without agent instructions
                    </div>
                  </div>
                </button>

                {Object.entries(groupedAgents).map(([tag, tagAgents]) => (
                  <div key={tag} className="agent-group">
                    <div className="agent-group-header">{tag}</div>
                    {tagAgents.map(agent => (
                      <button
                        key={agent.id}
                        className={`agent-item ${selectedAgent?.id === agent.id ? 'selected' : ''}`}
                        onClick={() => handleSelectAgent(agent)}
                      >
                        <span className="agent-item-icon">🤖</span>
                        <div className="agent-item-details">
                          <div className="agent-item-name">
                            {agent.metadata.name}
                            {agent.metadata.version && (
                              <span className="agent-item-version">
                                v{agent.metadata.version}
                              </span>
                            )}
                          </div>
                          <div className="agent-item-description">
                            {agent.metadata.description}
                          </div>
                          {agent.metadata.parameters && Object.keys(agent.metadata.parameters).length > 0 && (
                            <div className="agent-item-params">
                              ⚙️ Has parameters
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}