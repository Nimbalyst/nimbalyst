import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ProviderIcon } from '@nimbalyst/runtime';
import { getRelativeTimeString } from '../utils/dateFormatting';
import './SessionQuickOpen.css';

interface SessionItem {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  provider: string;
  model?: string;
  messageCount: number;
}

interface SessionQuickOpenProps {
  isOpen: boolean;
  onClose: () => void;
  workspacePath: string;
  onSessionSelect: (sessionId: string) => void;
}

export const SessionQuickOpen: React.FC<SessionQuickOpenProps> = ({
  isOpen,
  onClose,
  workspacePath,
  onSessionSelect,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [allSessions, setAllSessions] = useState<SessionItem[]>([]);
  const [mouseHasMoved, setMouseHasMoved] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultsListRef = useRef<HTMLUListElement>(null);

  // Filter sessions in-memory by title (fast, no database query)
  const displaySessions = useMemo(() => {
    if (!searchQuery.trim()) {
      return allSessions;
    }
    const query = searchQuery.toLowerCase();
    return allSessions.filter(session =>
      (session.title || 'New conversation').toLowerCase().includes(query)
    );
  }, [searchQuery, allSessions]);

  // Load all sessions when modal opens
  useEffect(() => {
    if (isOpen && workspacePath) {
      window.electronAPI.invoke('sessions:list', workspacePath, { includeArchived: false })
        .then((result: { success: boolean; sessions: SessionItem[] }) => {
          console.log('[SessionQuickOpen] sessions:list returned', result.sessions?.length, 'sessions');
          if (result.success && Array.isArray(result.sessions)) {
            setAllSessions(result.sessions);
          } else {
            setAllSessions([]);
          }
        })
        .catch((error: Error) => {
          console.error('[SessionQuickOpen] Failed to load sessions:', error);
          setAllSessions([]);
        });
    }
  }, [isOpen, workspacePath]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setSelectedIndex(0);
      setMouseHasMoved(false);
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Track mouse movement to distinguish between mouse hover and mouse at rest
  useEffect(() => {
    if (!isOpen) return;

    const handleMouseMove = () => {
      setMouseHasMoved(true);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (!resultsListRef.current) return;

    const items = resultsListRef.current.querySelectorAll('.session-quick-open-item');
    const selectedItem = items[selectedIndex] as HTMLElement;

    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev =>
            prev < displaySessions.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => prev > 0 ? prev - 1 : prev);
          break;
        case 'Enter':
          e.preventDefault();
          if (displaySessions[selectedIndex]) {
            handleSessionSelect(displaySessions[selectedIndex].id);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedIndex, displaySessions, onClose]);

  const handleSessionSelect = (sessionId: string) => {
    onSessionSelect(sessionId);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="session-quick-open-backdrop" onClick={onClose} />
      <div className="session-quick-open-modal">
        <div className="session-quick-open-header">
          <input
            ref={searchInputRef}
            type="text"
            className="session-quick-open-search"
            placeholder="Search AI sessions by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="session-quick-open-results">
          {displaySessions.length === 0 ? (
            <div className="session-quick-open-empty">
              {searchQuery ? 'No sessions found' : 'No recent sessions'}
            </div>
          ) : (
            <ul className="session-quick-open-list" ref={resultsListRef}>
              {displaySessions.map((session, index) => (
                <li
                  key={session.id}
                  className={`session-quick-open-item ${
                    index === selectedIndex ? 'selected' : ''
                  }`}
                  onClick={() => handleSessionSelect(session.id)}
                  onMouseEnter={() => {
                    if (mouseHasMoved) {
                      setSelectedIndex(index);
                    }
                  }}
                >
                  <div className="session-quick-open-item-icon">
                    <ProviderIcon provider={session.provider || 'claude'} size={16} />
                  </div>
                  <div className="session-quick-open-item-content">
                    <div className="session-quick-open-item-name">
                      {session.title || 'New conversation'}
                      {session.messageCount > 0 && (
                        <span className="session-quick-open-badge">
                          {session.messageCount} msg{session.messageCount !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="session-quick-open-item-meta">
                      {getRelativeTimeString(session.updatedAt)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="session-quick-open-footer">
          <span className="session-quick-open-hint">
            <kbd>Up/Down</kbd> Navigate
          </span>
          <span className="session-quick-open-hint">
            <kbd>Enter</kbd> Open
          </span>
          <span className="session-quick-open-hint">
            <kbd>Esc</kbd> Close
          </span>
        </div>
      </div>
    </>
  );
};
