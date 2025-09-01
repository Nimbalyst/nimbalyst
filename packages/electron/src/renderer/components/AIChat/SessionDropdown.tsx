import React, { useState, useRef, useEffect } from 'react';
import { MaterialSymbol } from '../MaterialSymbol';
import './SessionDropdown.css';

interface Session {
  id: string;
  timestamp: number;
  name?: string;
  title?: string;
  messageCount?: number;
  provider?: string;
  model?: string;
}

interface SessionDropdownProps {
  currentSessionId: string | null;
  sessions: Session[];
  onSessionSelect: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, newName: string) => void;
  onOpenSessionManager?: () => void;
}

export function SessionDropdown({
  currentSessionId,
  sessions,
  onSessionSelect,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  onOpenSessionManager
}: SessionDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const getProviderLabel = (provider: string) => {
    switch (provider) {
      case 'claude': return 'SDK';
      case 'claude-code': return 'CODE';
      case 'openai': return 'GPT';
      case 'lmstudio': return 'LOCAL';
      default: return provider.toUpperCase();
    }
  };

  const getModelShortName = (model: string) => {
    // Shorten model names for display
    if (model.includes('claude-opus-4-1')) return '4.1 Opus';
    if (model.includes('claude-opus-4')) return '4 Opus';
    if (model.includes('claude-sonnet-4')) return '4 Sonnet';
    if (model.includes('claude-3-7-sonnet')) return '3.7 Sonnet';
    if (model.includes('claude-3-5-sonnet')) return '3.5 Sonnet';
    if (model.includes('claude-3-5-haiku')) return '3.5 Haiku';
    if (model.includes('claude-3-opus')) return '3 Opus';
    if (model.includes('claude-3-sonnet')) return '3 Sonnet';
    if (model.includes('claude-3-haiku')) return '3 Haiku';
    if (model.includes('gpt-4-turbo')) return 'GPT-4T';
    if (model.includes('gpt-4')) return 'GPT-4';
    if (model.includes('gpt-3.5')) return 'GPT-3.5';
    // For local models, truncate if too long
    if (model.length > 15) return model.substring(0, 12) + '...';
    return model;
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setRenamingId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getCurrentSessionName = () => {
    if (!currentSessionId) return 'New Session';
    const session = sessions.find(s => s.id === currentSessionId);
    if (session?.title) return session.title;
    if (session?.name) return session.name;
    if (session) {
      const date = new Date(session.timestamp);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return 'Current Session';
  };

  const formatSessionName = (session: Session) => {
    if (session.title) return session.title;
    if (session.name) return session.name;
    const date = new Date(session.timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleRename = (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    setRenamingId(sessionId);
    setRenameValue(session?.name || formatSessionName(session!));
  };

  const submitRename = () => {
    if (renamingId && renameValue.trim() && onRenameSession) {
      onRenameSession(renamingId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      submitRename();
    } else if (e.key === 'Escape') {
      setRenamingId(null);
      setRenameValue('');
    }
  };

  return (
    <div className="session-dropdown" ref={dropdownRef}>
      <button 
        className="session-dropdown-trigger"
        onClick={() => setIsOpen(!isOpen)}
        title="Session History"
      >
        <MaterialSymbol icon="history" size={18} />
        <MaterialSymbol icon="expand_more" size={16} className={`session-dropdown-arrow ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="session-dropdown-menu">
          {onOpenSessionManager && (
            <button
              className="session-dropdown-all-sessions"
              onClick={() => {
                onOpenSessionManager();
                setIsOpen(false);
              }}
            >
              <MaterialSymbol icon="folder_open" size={16} />
              <span>All Sessions</span>
            </button>
          )}
          {sessions.length > 0 && (
            <div className="session-dropdown-divider" />
          )}
          <div className="session-dropdown-sessions">
            {sessions.map(session => (
                  <div 
                    key={session.id} 
                    className={`session-dropdown-item ${session.id === currentSessionId ? 'active' : ''}`}
                  >
                    {renamingId === session.id ? (
                      <input
                        type="text"
                        className="session-rename-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={submitRename}
                        onKeyDown={handleKeyDown}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div 
                        className="session-info"
                        onClick={() => {
                          onSessionSelect(session.id);
                          setIsOpen(false);
                        }}
                      >
                        <div className="session-name-row">
                          <span className="session-name">{formatSessionName(session)}</span>
                          {session.provider && (
                            <span className={`session-provider-badge provider-${session.provider}`}>
                              {getProviderLabel(session.provider)}
                            </span>
                          )}
                          {session.model && (
                            <span className="session-model-badge">
                              {getModelShortName(session.model)}
                            </span>
                          )}
                        </div>
                        {session.messageCount !== undefined && (
                          <span className="session-message-count">{session.messageCount} messages</span>
                        )}
                      </div>
                    )}
                    
                    <div className="session-actions">
                      {onRenameSession && (
                        <button
                          className="session-action-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRename(session.id);
                          }}
                          title="Rename"
                        >
                          <MaterialSymbol icon="edit" size={14} />
                        </button>
                      )}
                      <button
                        className="session-action-btn delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm('Delete this session?')) {
                            onDeleteSession(session.id);
                          }
                        }}
                        title="Delete"
                      >
                        <MaterialSymbol icon="delete" size={14} />
                      </button>
                    </div>
                  </div>
            ))}
          </div>
          {sessions.length === 0 && (
            <div className="session-dropdown-empty">
              <span>No sessions yet</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}