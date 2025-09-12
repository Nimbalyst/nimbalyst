import React, { useState, useEffect } from 'react';
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

interface Session {
  id: string;
  timestamp: number;
  provider: string;
  model: string;
  messages: any[];
  projectPath?: string | null;
  title?: string;
}

interface SessionManagerProps {
  filterProject?: string;
}

export const SessionManager: React.FC<SessionManagerProps> = ({ filterProject }) => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

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
    // Apply project filter if provided
    if (filterProject && session.projectPath !== filterProject) {
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
        session.projectPath?.toLowerCase().includes(searchLower)
      );
    }

    return true;
  });

  const handleOpenSession = async () => {
    if (!selectedSession) return;
    
    try {
      await window.electronAPI.ai.openSessionInWindow(
        selectedSession.id,
        selectedSession.projectPath || undefined
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
        selectedSession.projectPath || 'default'
      );
      await loadSessions();
      setSelectedSession(null);
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const getProjectName = (path: string | null | undefined) => {
    if (!path) return 'No Project';
    const parts = path.split('/');
    return parts[parts.length - 1] || path;
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
          {filterProject && (
            <span className="project-filter">
              {getProjectName(filterProject)}
            </span>
          )}
        </div>

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
            filteredSessions.map(session => (
              <div
                key={session.id}
                className={`session-item ${selectedSession?.id === session.id ? 'selected' : ''}`}
                onClick={() => setSelectedSession(session)}
              >
                <div className="session-item-title">
                  {session.title || `Session ${session.id.slice(0, 8)}`}
                </div>
                <div className="session-item-meta">
                  <span className={`session-item-provider ${getProviderClass(session.provider)}`}>
                    {session.provider}
                  </span>
                  <span className="session-item-project">
                    {getProjectName(session.projectPath)}
                  </span>
                  <span className="session-item-date">
                    {formatDate(session.timestamp)}
                  </span>
                </div>
              </div>
            ))
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
                  {selectedSession.provider} / {selectedSession.model}
                </span>
                <span>{selectedSession.messages.length} messages</span>
                <span>{formatDate(selectedSession.timestamp)}</span>
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
  );
};
