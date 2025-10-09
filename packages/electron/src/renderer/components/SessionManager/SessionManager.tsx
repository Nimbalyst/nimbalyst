import React, { useState, useEffect } from 'react';
import type { SessionData } from '@stravu/runtime/ai/server/types';
import { formatDate } from '@stravu/runtime';
import { ProviderIcon } from '../icons/ProviderIcons';
import { WorkspaceHeader } from '../WorkspaceHeader';
import './SessionManager.css';

// Helper function to apply theme
const applyTheme = () => {
  if (typeof window === 'undefined') return;

  const savedTheme = localStorage.getItem('theme');
  const root = document.documentElement;

  // Clear all theme classes first
  root.classList.remove('light-theme', 'dark-theme', 'crystal-dark-theme');

  if (savedTheme === 'dark') {
    root.setAttribute('data-theme', 'dark');
    root.classList.add('dark-theme');
  } else if (savedTheme === 'crystal-dark') {
    root.setAttribute('data-theme', 'crystal-dark');
    root.classList.add('crystal-dark-theme');
  } else if (savedTheme === 'light') {
    root.setAttribute('data-theme', 'light');
    root.classList.add('light-theme');
  } else {
    // Auto - check system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      root.setAttribute('data-theme', 'dark');
      root.classList.add('dark-theme');
    } else {
      root.setAttribute('data-theme', 'light');
      root.classList.add('light-theme');
    }
  }
};

// Apply theme on mount
applyTheme();

// Listen for theme changes
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'theme') {
      applyTheme();
    }
  });

  // Also listen for IPC theme changes
  if (window.electronAPI?.onThemeChange) {
    const unsubscribe = window.electronAPI.onThemeChange((theme) => {
      // Guard: skip if unchanged
      if (localStorage.getItem('theme') === theme) return;
      // Update localStorage with the new theme
      localStorage.setItem('theme', theme);
      applyTheme();
    });
    // Note: unsubscribe is returned but we're not cleaning it up since this is module-level
  }
}


interface SessionManagerProps {
  filterWorkspace?: string;
}

export const SessionManager: React.FC<SessionManagerProps> = ({ filterWorkspace }) => {
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionData | null>(null);
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [sessionTypeFilters, setSessionTypeFilters] = useState<Set<'chat' | 'planning' | 'coding'>>(
    new Set(['chat', 'planning', 'coding'])
  );

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const allSessions = await window.electronAPI.ai.getAllSessions();
      setSessions(allSessions);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredSessions = sessions.filter(session => {
    // Apply workspace filter if provided
    if (filterWorkspace && session.workspacePath !== filterWorkspace) {
      return false;
    }

    // Apply session type filter
    const sessionType = session.sessionType || 'chat'; // Default to 'chat' if not specified
    if (!sessionTypeFilters.has(sessionType)) {
      return false;
    }

    // Apply search filter
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      return (
        session.title?.toLowerCase().includes(searchLower) ||
        session.messages.some(msg =>
          msg.content?.toLowerCase().includes(searchLower)
        ) ||
        session.workspacePath?.toLowerCase().includes(searchLower)
      );
    }

    return true;
  });

  const handleOpenSession = async () => {
    if (!selectedSession) return;

    try {
      await window.electronAPI.ai.openSessionInWindow(
        selectedSession.id,
        selectedSession.workspacePath || undefined
      );
    } catch (error) {
      console.error('Failed to open session:', error);
    }
  };

  const handleExportSession = async () => {
    if (!selectedSession) return;

    try {
      const result = await window.electronAPI.ai.exportSession(selectedSession);
      if (result.success) {
        console.log('Session exported to:', result.filePath);
      }
    } catch (error) {
      console.error('Failed to export session:', error);
    }
  };

  const handleDeleteSession = async () => {
    if (!selectedSession) return;

    if (!confirm('Are you sure you want to delete this session?')) {
      return;
    }

    try {
      await window.electronAPI.ai.deleteSession(
        selectedSession.id,
        selectedSession.workspacePath || 'default'
      );
      await loadSessions();
      setSelectedSession(null);
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const handleDeleteSelectedSessions = async () => {
    if (selectedSessions.size === 0) return;

    const count = selectedSessions.size;
    if (!confirm(`Are you sure you want to delete ${count} session${count > 1 ? 's' : ''}?`)) {
      return;
    }

    try {
      // Delete all selected sessions
      for (const sessionId of selectedSessions) {
        const session = sessions.find(s => s.id === sessionId);
        if (session) {
          await window.electronAPI.ai.deleteSession(
            session.id,
            session.workspacePath || 'default'
          );
        }
      }
      await loadSessions();
      setSelectedSessions(new Set());
      if (selectedSession && selectedSessions.has(selectedSession.id)) {
        setSelectedSession(null);
      }
    } catch (error) {
      console.error('Failed to delete sessions:', error);
    }
  };

  const handleSessionClick = (session: SessionData, event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey) {
      // Cmd/Ctrl+Click: Toggle multi-select
      const newSelected = new Set(selectedSessions);
      if (newSelected.has(session.id)) {
        newSelected.delete(session.id);
      } else {
        newSelected.add(session.id);
      }
      setSelectedSessions(newSelected);
    } else if (event.shiftKey && selectedSession) {
      // Shift+Click: Range select
      const startIdx = filteredSessions.findIndex(s => s.id === selectedSession.id);
      const endIdx = filteredSessions.findIndex(s => s.id === session.id);
      const [min, max] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
      const newSelected = new Set(selectedSessions);
      for (let i = min; i <= max; i++) {
        newSelected.add(filteredSessions[i].id);
      }
      setSelectedSessions(newSelected);
    } else {
      // Regular click: Select for detail view and clear multi-select
      setSelectedSession(session);
      setSelectedSessions(new Set());
    }
  };

  const getWorkspaceName = (path: string | null | undefined) => {
    if (!path) return 'No Workspace';
    const parts = path.split('/');
    return parts[parts.length - 1] || path;
  };

  const toggleSessionTypeFilter = (type: 'chat' | 'planning' | 'coding') => {
    const newFilters = new Set(sessionTypeFilters);
    if (newFilters.has(type)) {
      // Don't allow unchecking the last filter
      if (newFilters.size > 1) {
        newFilters.delete(type);
      }
    } else {
      newFilters.add(type);
    }
    setSessionTypeFilters(newFilters);
  };

  const getProviderClass = (provider: string) => {
    switch (provider) {
      case 'claude':
        return 'provider-claude';
      case 'claude-code':
        return 'provider-claude-code';
      case 'openai':
        return 'provider-openai';
      case 'lmstudio':
        return 'provider-lmstudio';
      default:
        return 'provider-default';
    }
  };

  return (
    <div className="session-manager">
      {filterWorkspace && (
        <WorkspaceHeader
          workspacePath={filterWorkspace}
          subtitle="History"
        />
      )}
      <div className="session-manager-body">
        <div className="sidebar">
        <div className="sidebar-header">
          <div className="search-container">
            <span className="search-icon material-symbols-outlined">search</span>
            <input
              type="text"
              className="search-input"
              placeholder="Search sessions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="session-stats">
          {filteredSessions.length} session{filteredSessions.length !== 1 ? 's' : ''}
          {selectedSessions.size > 0 && (
            <span className="selection-count">
              {selectedSessions.size} selected
            </span>
          )}
        </div>
        <div className="session-type-filters">
          <button
            className={`session-type-filter ${sessionTypeFilters.has('chat') ? 'active' : ''}`}
            onClick={() => toggleSessionTypeFilter('chat')}
            title="Toggle chat sessions"
          >
            Chat
          </button>
          <button
            className={`session-type-filter ${sessionTypeFilters.has('planning') ? 'active' : ''}`}
            onClick={() => toggleSessionTypeFilter('planning')}
            title="Toggle planning sessions"
          >
            Planning
          </button>
          <button
            className={`session-type-filter ${sessionTypeFilters.has('coding') ? 'active' : ''}`}
            onClick={() => toggleSessionTypeFilter('coding')}
            title="Toggle coding sessions"
          >
            Coding
          </button>
        </div>
        {selectedSessions.size > 0 && (
          <div className="bulk-actions">
            <button className="btn btn-danger btn-small" onClick={handleDeleteSelectedSessions}>
              Delete {selectedSessions.size} session{selectedSessions.size > 1 ? 's' : ''}
            </button>
            <button className="btn btn-small" onClick={() => setSelectedSessions(new Set())}>
              Clear Selection
            </button>
          </div>
        )}

        <div className="sessions-list">
          {loading ? (
            <div className="loading">
              <div className="spinner"></div>
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="empty-state">
              <p>No sessions found</p>
            </div>
          ) : (
            filteredSessions.map(session => {
              const isSelected = selectedSession?.id === session.id;
              const isMultiSelected = selectedSessions.has(session.id);
              return (
              <div
                key={session.id}
                className={`session-item ${isSelected ? 'selected' : ''} ${isMultiSelected ? 'multi-selected' : ''}`}
                onClick={(e) => handleSessionClick(session, e)}
              >
                <div className="session-item-icon">
                  <ProviderIcon provider={session.provider} size={16} />
                </div>
                <div className="session-item-content">
                  <div className="session-item-title">
                    {session.title || `Session ${session.id.slice(0, 8)}`}
                  </div>
                  <div className="session-item-meta">
                    <span className={`session-item-provider ${getProviderClass(session.provider)}`}>
                      {session.provider}
                    </span>
                    {/*<span className="session-item-workspace">*/}
                    {/*  {getWorkspaceName(session.workspacePath)}*/}
                    {/*</span>*/}
                    <span className="session-item-date">
                      {formatDate(session.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
              );
            })
          )}
        </div>
      </div>

        <div className="content">
        {selectedSession ? (
          <>
            <div className="content-header">
              <div className="content-title">
                {selectedSession.title || `Session ${selectedSession.id.slice(0, 8)}`}
              </div>
              <div className="content-meta">
                <span className={`provider-badge ${getProviderClass(selectedSession.provider)}`}>
                  {selectedSession.provider} / {selectedSession.model || 'Unknown'}
                </span>
                <span>{selectedSession.messages.length} messages</span>
                <span>{formatDate(selectedSession.createdAt)}</span>
              </div>
            </div>

            <div className="content-actions">
              <button className="btn btn-primary" onClick={handleOpenSession}>
                Open Session
              </button>
              <button className="btn" onClick={handleExportSession}>
                Export
              </button>
              <button className="btn btn-danger" onClick={handleDeleteSession}>
                Delete
              </button>
            </div>

            <div className="messages-container">
              {selectedSession.messages.map((message, idx) => (
                <div key={idx} className="message">
                  <div className={`message-role ${message.role}`}>
                    {message.role}
                  </div>
                  <div className="message-content">
                    {message.role === 'tool' && message.toolCall ? (
                      <div className="tool-call">
                        <div className="tool-name">
                          <strong>Tool:</strong> {message.toolCall.name || 'Unknown'}
                        </div>
                        {message.toolCall.arguments && (
                          <div className="tool-arguments">
                            <strong>Arguments:</strong>
                            <pre>{JSON.stringify(message.toolCall.arguments, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                    ) : message.isStreamingStatus && message.streamingData ? (
                      <div className="streaming-status">
                        <div className="streaming-info">
                          <strong>Streamed Content</strong>
                          <span className="streaming-mode">Mode: {message.streamingData.mode}</span>
                          <span className="streaming-position">Position: {message.streamingData.position}</span>
                        </div>
                        {message.streamingData.content && (
                          <div className="streaming-content">
                            <pre>{message.streamingData.content}</pre>
                          </div>
                        )}
                      </div>
                    ) : (
                      <pre>{message.content || '(empty)'}</pre>
                    )}

                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <h2>Select a Session</h2>
            <p>Choose a session from the list to view its messages</p>
          </div>
        )}
        </div>
      </div>
    </div>
  );
};
