import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { useAtomValue } from 'jotai';
import { ProviderIcon, MaterialSymbol } from '@nimbalyst/runtime';
import { getRelativeTimeString } from '../utils/dateFormatting';
import { sessionOrChildProcessingAtom, sessionUnreadAtom, sessionPendingPromptAtom } from '../store';

interface SessionItem {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  provider: string;
  model?: string;
  messageCount: number;
  parentSessionId?: string | null;
  uncommittedCount?: number;
}

/**
 * Status indicator that shows processing, pending prompt, or unread status.
 * Only re-renders when this session's state changes.
 */
const SessionStatusIndicator = memo<{ sessionId: string }>(({ sessionId }) => {
  const isProcessing = useAtomValue(sessionOrChildProcessingAtom(sessionId));
  const hasPendingPrompt = useAtomValue(sessionPendingPromptAtom(sessionId));
  const hasUnread = useAtomValue(sessionUnreadAtom(sessionId));

  // Priority: processing > pending prompt > unread
  if (isProcessing) {
    return (
      <div
        className="session-quick-open-status processing flex items-center justify-center w-5 h-5 text-[var(--nim-primary)] opacity-80"
        title="Processing..."
      >
        <MaterialSymbol icon="progress_activity" size={14} className="animate-spin" />
      </div>
    );
  }

  if (hasPendingPrompt) {
    return (
      <div
        className="session-quick-open-status pending-prompt flex items-center justify-center w-5 h-5 text-[var(--nim-warning)] animate-pulse"
        title="Waiting for your response"
      >
        <MaterialSymbol icon="help" size={14} />
      </div>
    );
  }

  if (hasUnread) {
    return (
      <div
        className="session-quick-open-status unread flex items-center justify-center w-5 h-5 text-[var(--nim-primary)]"
        title="Unread response"
      >
        <MaterialSymbol icon="circle" size={8} fill />
      </div>
    );
  }

  return null;
});

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
          const sessionsWithParent = result.sessions?.filter(s => s.parentSessionId);
          console.log('[SessionQuickOpen] Sessions with parentSessionId:', sessionsWithParent?.length, sessionsWithParent?.map(s => ({ id: s.id, title: s.title, parent: s.parentSessionId })));
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
    // Pass the session ID to the parent handler
    // The AgentMode component will handle loading the session and determining
    // if it's a child session that needs to open its parent workstream
    onSessionSelect(sessionId);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="session-quick-open-backdrop fixed inset-0 bg-black/50 z-[99998] nim-animate-fade-in"
        onClick={onClose}
      />
      <div className="session-quick-open-modal fixed top-[20%] left-1/2 -translate-x-1/2 w-[90%] max-w-[600px] max-h-[60vh] flex flex-col overflow-hidden rounded-lg z-[99999] bg-[var(--nim-bg)] border border-[var(--nim-border)] shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
        <div className="session-quick-open-header relative p-3 border-b border-[var(--nim-border)]">
          <input
            ref={searchInputRef}
            type="text"
            className="session-quick-open-search w-full py-2 px-3 text-base rounded-md outline-none box-border bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] focus:border-[#007aff] focus:shadow-[0_0_0_3px_rgba(0,122,255,0.1)]"
            placeholder="Search AI sessions by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="session-quick-open-results flex-1 overflow-y-auto min-h-[200px]">
          {displaySessions.length === 0 ? (
            <div className="session-quick-open-empty p-10 text-center text-[var(--nim-text-faint)]">
              {searchQuery ? 'No sessions found' : 'No recent sessions'}
            </div>
          ) : (
            <ul className="session-quick-open-list list-none m-0 p-0" ref={resultsListRef}>
              {displaySessions.map((session, index) => (
                <li
                  key={session.id}
                  className={`session-quick-open-item flex items-start gap-3 py-2.5 px-4 cursor-pointer border-l-[3px] border-transparent transition-all duration-100 hover:bg-[var(--nim-bg-hover)] ${
                    index === selectedIndex ? 'selected bg-[rgba(0,122,255,0.1)] border-l-[#007aff]' : ''
                  }`}
                  onClick={() => handleSessionSelect(session.id)}
                  onMouseEnter={() => {
                    if (mouseHasMoved) {
                      setSelectedIndex(index);
                    }
                  }}
                >
                  <div className="session-quick-open-item-icon shrink-0 flex items-center justify-center pt-0.5 text-[var(--nim-text-muted)]">
                    <ProviderIcon provider={session.provider || 'claude'} size={16} />
                  </div>
                  <div className="session-quick-open-item-content flex-1 min-w-0">
                    <div className="session-quick-open-item-name text-sm font-medium text-[var(--nim-text)] flex items-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap">
                      {session.title || 'New conversation'}
                      {session.parentSessionId && (
                        <span className="session-quick-open-badge workstream-badge shrink-0 text-[10px] py-0.5 px-1.5 rounded-[3px] font-semibold bg-[var(--nim-primary)] text-white">
                          In Workstream
                        </span>
                      )}
                      {session.messageCount > 0 && (
                        <span className="session-quick-open-badge shrink-0 text-[10px] py-0.5 px-1.5 rounded-[3px] font-semibold bg-[var(--nim-text-faint)] text-white">
                          {session.messageCount} msg{session.messageCount !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="session-quick-open-item-meta text-xs text-[var(--nim-text-faint)] mt-0.5">
                      {getRelativeTimeString(session.updatedAt)}
                    </div>
                  </div>
                  <div className="session-quick-open-item-right shrink-0 flex items-center gap-1.5 ml-auto">
                    {session.uncommittedCount !== undefined && session.uncommittedCount > 0 && (
                      <span
                        className="session-quick-open-badge uncommitted shrink-0 text-[10px] py-0.5 px-1.5 rounded-[3px] font-semibold bg-[rgba(245,158,11,0.15)] text-[var(--nim-warning)]"
                        title={`${session.uncommittedCount} uncommitted change${session.uncommittedCount !== 1 ? 's' : ''}`}
                      >
                        {session.uncommittedCount}
                      </span>
                    )}
                    <SessionStatusIndicator sessionId={session.id} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="session-quick-open-footer flex gap-4 py-2 px-4 border-t border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]">
          <span className="session-quick-open-hint text-[11px] text-[var(--nim-text-faint)] flex items-center gap-1">
            <kbd className="py-0.5 px-1.5 rounded-[3px] font-mono text-[10px] bg-[var(--nim-bg)] border border-[var(--nim-border)] text-[var(--nim-text)]">Up/Down</kbd> Navigate
          </span>
          <span className="session-quick-open-hint text-[11px] text-[var(--nim-text-faint)] flex items-center gap-1">
            <kbd className="py-0.5 px-1.5 rounded-[3px] font-mono text-[10px] bg-[var(--nim-bg)] border border-[var(--nim-border)] text-[var(--nim-text)]">Enter</kbd> Open
          </span>
          <span className="session-quick-open-hint text-[11px] text-[var(--nim-text-faint)] flex items-center gap-1">
            <kbd className="py-0.5 px-1.5 rounded-[3px] font-mono text-[10px] bg-[var(--nim-bg)] border border-[var(--nim-border)] text-[var(--nim-text)]">Esc</kbd> Close
          </span>
        </div>
      </div>
    </>
  );
};
