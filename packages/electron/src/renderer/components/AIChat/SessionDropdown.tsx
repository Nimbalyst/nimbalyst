import React, { useState, useRef, useEffect } from 'react';
import { MaterialSymbol } from '../MaterialSymbol';
import './SessionDropdown.css';

interface Session {
  id: string;
  timestamp: number;
  name?: string;
  title?: string;
  messageCount?: number;
  provider?: 'claude' | 'claude-code';
}

interface SessionDropdownProps {
  currentSessionId: string | null;
  sessions: Session[];
  onSessionSelect: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, newName: string) => void;
}

export function SessionDropdown({
  currentSessionId,
  sessions,
  onSessionSelect,
  onNewSession,
  onDeleteSession,
  onRenameSession
}: SessionDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

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
        onClick={() => sessions.length > 0 && setIsOpen(!isOpen)}
        title="Session History"
        disabled={sessions.length === 0}
      >
        <MaterialSymbol icon="history" size={16} />
        <span className="session-dropdown-label">{getCurrentSessionName()}</span>
        <MaterialSymbol icon="expand_more" size={16} className={`session-dropdown-arrow ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && sessions.length > 0 && (
        <div className="session-dropdown-menu">
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
                        <span className="session-name">{formatSessionName(session)}</span>
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
        </div>
      )}
    </div>
  );
}