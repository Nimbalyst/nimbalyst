import React, { useState, useRef, useEffect } from 'react';
import { MaterialSymbol, ProviderIcon } from '@nimbalyst/runtime';
import { parseModelInfo, getProviderLabel } from '../../utils/modelUtils';
import type { SessionData } from '@nimbalyst/runtime/ai/server/types';
import { formatDate } from '@nimbalyst/runtime';
import './SessionDropdown.css';

// SessionDropdownItem extends SessionData with message count for display
type SessionDropdownItem = Pick<SessionData, 'id' | 'createdAt' | 'name' | 'title' | 'provider' | 'model'> & {
  messageCount?: number;
};

interface SessionDropdownProps {
  currentSessionId: string | null;
  sessions: SessionDropdownItem[];
  processingSessions?: Set<string>;
  unreadSessions?: Set<string>;
  onSessionSelect: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, newName: string) => void;
  onOpenSessionManager?: () => void;
}

export function SessionDropdown({
  currentSessionId,
  sessions,
  processingSessions = new Set(),
  unreadSessions = new Set(),
  onSessionSelect,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  onOpenSessionManager
}: SessionDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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

  const getCurrentSession = () => {
    if (!currentSessionId) return null;
    return sessions.find(s => s.id === currentSessionId) || null;
  };

  const getCurrentSessionName = () => {
    const session = getCurrentSession();
    if (!session) return 'New Session';
    if (session.title) return session.title;
    if (session.name) return session.name;
    return formatDate(session.createdAt);
  };

  const formatSessionName = (session: SessionDropdownItem) => {
    if (session.title) return session.title;
    if (session.name) return session.name;
    return formatDate(session.createdAt);
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

  // Calculate menu position when opening
  const handleToggle = () => {
    if (!isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      // Position menu so its right edge aligns with button's right edge
      setMenuPosition({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right // Distance from right edge of viewport
      });
    }
    setIsOpen(!isOpen);
  };

  return (
    <div className="session-dropdown" ref={dropdownRef}>
      <button
        ref={triggerRef}
        className="session-dropdown-trigger"
        onClick={handleToggle}
        title="Session History"
      >
        {currentSessionId && processingSessions.has(currentSessionId) && (
          <div className="session-status-indicator processing" title="Running" />
        )}
        <ProviderIcon provider={getCurrentSession()?.provider || 'claude'} size={16} />
        <span className="session-dropdown-name">{getCurrentSessionName()}</span>
        <MaterialSymbol icon="expand_more" size={16} className={`session-dropdown-arrow ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && menuPosition && (
        <div
          className="session-dropdown-menu"
          style={{
            position: 'fixed',
            top: `${menuPosition.top}px`,
            right: `${menuPosition.right}px`
          }}
        >
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
                          {processingSessions.has(session.id) && (
                            <div className="session-status-indicator processing" title="Running" />
                          )}
                          {!processingSessions.has(session.id) && unreadSessions.has(session.id) && (
                            <div className="session-status-indicator unread" title="Unread response" />
                          )}
                          <span className="session-name">{formatSessionName(session)}</span>
                          {session.provider && (
                            <span className={`session-provider-badge provider-${session.provider}`}>
                              {getProviderLabel(session.provider)}
                            </span>
                          )}
                          {session.model && (
                            <span className="session-model-badge">
                              {parseModelInfo(session.model)?.shortModelName}
                            </span>
                          )}
                        </div>
                        {session.messageCount !== undefined && (
                          <span className="session-message-count">{session.messageCount} turns</span>
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
