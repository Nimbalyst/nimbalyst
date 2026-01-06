import React, { useState, useCallback, useEffect, useRef } from 'react';
import { MaterialSymbol, ProviderIcon } from '@nimbalyst/runtime';
import { getRelativeTimeString } from '../../utils/dateFormatting';
import './WorktreeGroup.css';

interface SessionItem {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  provider: string;
  model?: string;
  messageCount: number;
  isProcessing?: boolean;
  hasUnread?: boolean;
  hasPendingPrompt?: boolean;
  isArchived?: boolean;
  isPinned?: boolean;
}

interface GitStatus {
  ahead?: number;
  behind?: number;
  uncommitted?: boolean;
}

interface WorktreeData {
  id: string;
  name: string;
  displayName?: string;
  path: string;
  branch: string;
  isPinned?: boolean;
}

interface WorktreeGroupProps {
  worktree: WorktreeData;
  gitStatus?: GitStatus;
  sessions: SessionItem[];
  activeSessionId: string | null;
  isExpanded: boolean;
  onToggle: () => void;
  onSessionSelect: (sessionId: string) => void;
  onAddSession: (worktreeId: string) => void;
  onAddTerminal?: (worktreeId: string) => void;
  onSessionDelete?: (sessionId: string) => void;
  onSessionArchive?: (sessionId: string) => void;
  onWorktreePinToggle?: (worktreeId: string, isPinned: boolean) => void;
  onSessionPinToggle?: (sessionId: string, isPinned: boolean) => void;
  onSessionRename?: (sessionId: string, newName: string) => void;
}

export const WorktreeGroup: React.FC<WorktreeGroupProps> = ({
  worktree,
  gitStatus,
  sessions,
  activeSessionId,
  isExpanded,
  onToggle,
  onSessionSelect,
  onAddSession,
  onAddTerminal,
  onSessionDelete,
  onSessionArchive,
  onWorktreePinToggle,
  onSessionPinToggle,
  onSessionRename
}) => {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [adjustedContextMenuPosition, setAdjustedContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Sort sessions: pinned first, then by updatedAt
  const sortedSessions = React.useMemo(() => {
    return [...sessions].sort((a, b) => {
      // Pinned sessions first
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      // Then by updatedAt (most recent first)
      return (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);
    });
  }, [sessions]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setShowContextMenu(false);
    setAdjustedContextMenuPosition(null);
  }, []);

  const handleAddSession = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowContextMenu(false);
    onAddSession(worktree.id);
  }, [onAddSession, worktree.id]);

  const handlePinToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowContextMenu(false);
    onWorktreePinToggle?.(worktree.id, !worktree.isPinned);
  }, [onWorktreePinToggle, worktree.id, worktree.isPinned]);

  const handleAddTerminal = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowContextMenu(false);
    onAddTerminal?.(worktree.id);
  }, [onAddTerminal, worktree.id]);

  // Adjust context menu position to keep it within viewport
  useEffect(() => {
    if (showContextMenu && contextMenuRef.current) {
      const rect = contextMenuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newX = contextMenuPosition.x;
      let newY = contextMenuPosition.y;

      if (contextMenuPosition.x + rect.width > viewportWidth) {
        newX = contextMenuPosition.x - rect.width;
      }
      if (contextMenuPosition.y + rect.height > viewportHeight) {
        newY = contextMenuPosition.y - rect.height;
      }

      newX = Math.max(0, newX);
      newY = Math.max(0, newY);

      if (newX !== contextMenuPosition.x || newY !== contextMenuPosition.y) {
        setAdjustedContextMenuPosition({ x: newX, y: newY });
      }
    }
  }, [showContextMenu, contextMenuPosition]);

  return (
    <div
      className="worktree-group"
      onMouseLeave={handleCloseContextMenu}
    >
      {/* Worktree Header */}
      <button
        className="worktree-group-header"
        onClick={onToggle}
        onContextMenu={handleContextMenu}
        aria-expanded={isExpanded}
        aria-label={`Worktree ${worktree.name}, ${sessions.length} session${sessions.length !== 1 ? 's' : ''}, ${isExpanded ? 'expanded' : 'collapsed'}`}
      >
        <MaterialSymbol
          icon="chevron_right"
          size={12}
          className={`worktree-group-chevron ${isExpanded ? 'expanded' : ''}`}
        />
        <div className="worktree-group-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 21v-4a2 2 0 0 1 2-2h4"/>
            <path d="M14 15V7"/>
            <circle cx="8" cy="7" r="2"/>
            <circle cx="14" cy="7" r="2"/>
            <path d="M8 9v4a2 2 0 0 0 2 2"/>
          </svg>
        </div>
        <div className="worktree-group-content-wrapper">
          <div className="worktree-group-row-primary">
            <span className="worktree-group-name">{worktree.displayName || worktree.name}</span>
            {worktree.isPinned && (
              <MaterialSymbol icon="push_pin" size={12} className="worktree-group-pin-icon" />
            )}
          </div>
          <div className="worktree-group-row-secondary">
            {gitStatus?.ahead && gitStatus.ahead > 0 && (
              <span className="worktree-group-badge ahead">
                {gitStatus.ahead} ahead
              </span>
            )}
            {gitStatus?.behind && gitStatus.behind > 0 && (
              <span className="worktree-group-badge behind">
                {gitStatus.behind} behind
              </span>
            )}
            {gitStatus?.uncommitted && (
              <span className="worktree-group-badge uncommitted">
                uncommitted
              </span>
            )}
            <span className="worktree-group-count">{sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </button>

      {/* Sessions List */}
      {isExpanded && (
        <div className="worktree-group-content">
          {sortedSessions.map(session => (
            <WorktreeSessionItem
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              onClick={() => onSessionSelect(session.id)}
              onDelete={onSessionDelete ? () => onSessionDelete(session.id) : undefined}
              onArchive={onSessionArchive ? () => onSessionArchive(session.id) : undefined}
              onPinToggle={onSessionPinToggle ? (isPinned) => onSessionPinToggle(session.id, isPinned) : undefined}
              onRename={onSessionRename ? (newName) => onSessionRename(session.id, newName) : undefined}
            />
          ))}
        </div>
      )}

      {/* Context Menu */}
      {showContextMenu && (
        <div
          ref={contextMenuRef}
          className="worktree-group-context-menu"
          style={{
            left: (adjustedContextMenuPosition || contextMenuPosition).x,
            top: (adjustedContextMenuPosition || contextMenuPosition).y
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {onWorktreePinToggle && (
            <button
              className="worktree-group-context-menu-item"
              onClick={handlePinToggle}
            >
              <MaterialSymbol icon={worktree.isPinned ? 'push_pin' : 'push_pin'} size={14} />
              {worktree.isPinned ? 'Unpin' : 'Pin'}
            </button>
          )}
          <button
            className="worktree-group-context-menu-item"
            onClick={handleAddSession}
          >
            <MaterialSymbol icon="add" size={14} />
            Add Session
          </button>
          {onAddTerminal && (
            <button
              className="worktree-group-context-menu-item"
              onClick={handleAddTerminal}
            >
              <MaterialSymbol icon="terminal" size={14} />
              Add Terminal
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// Simplified session item for use within WorktreeGroup
interface WorktreeSessionItemProps {
  session: SessionItem;
  isActive: boolean;
  onClick: () => void;
  onDelete?: () => void;
  onArchive?: () => void;
  onPinToggle?: (isPinned: boolean) => void;
  onRename?: (newName: string) => void;
}

const WorktreeSessionItem: React.FC<WorktreeSessionItemProps> = ({
  session,
  isActive,
  onClick,
  onDelete,
  onArchive,
  onPinToggle,
  onRename
}) => {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const displayTitle = session.title || 'Untitled Session';

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  }, []);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowContextMenu(false);
    onDelete?.();
  };

  const handleArchive = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowContextMenu(false);
    onArchive?.();
  };

  const handlePinToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowContextMenu(false);
    onPinToggle?.(!session.isPinned);
  };

  const handleRenameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowContextMenu(false);
    setRenameValue(displayTitle);
    setIsRenaming(true);
  };

  const handleRenameSubmit = () => {
    const trimmedValue = renameValue.trim();
    if (trimmedValue && trimmedValue !== displayTitle && onRename) {
      onRename(trimmedValue);
    }
    setIsRenaming(false);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsRenaming(false);
    }
  };

  // Auto-focus and select text when rename input appears
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  return (
    <div
      className={`worktree-session-item ${isActive ? 'active' : ''}`}
      onClick={onClick}
      onContextMenu={handleContextMenu}
      onMouseLeave={() => setShowContextMenu(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={`Session: ${displayTitle}`}
      aria-current={isActive ? 'page' : undefined}
    >
      <div className="worktree-session-item-icon">
        <ProviderIcon provider={session.provider || 'claude'} size={14} />
      </div>
      {session.isPinned && (
        <MaterialSymbol icon="push_pin" size={10} className="worktree-session-item-pin-icon" />
      )}
      {isRenaming ? (
        <input
          ref={renameInputRef}
          type="text"
          className="worktree-session-item-rename-input"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={handleRenameKeyDown}
          onBlur={handleRenameSubmit}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="worktree-session-item-title">{displayTitle}</span>
      )}
      <div className="worktree-session-item-right">
        {session.isProcessing ? (
          <div className="worktree-session-item-status processing" title="Processing...">
            <MaterialSymbol icon="progress_activity" size={12} />
          </div>
        ) : session.hasPendingPrompt ? (
          <div className="worktree-session-item-status pending-prompt" title="Waiting for your response">
            <MaterialSymbol icon="help" size={12} />
          </div>
        ) : session.hasUnread ? (
          <div className="worktree-session-item-status unread" title="Unread response">
            <MaterialSymbol icon="circle" size={6} fill />
          </div>
        ) : session.messageCount > 0 ? (
          <span className="worktree-session-item-count">{session.messageCount}</span>
        ) : null}
      </div>

      {/* Context Menu */}
      {showContextMenu && (
        <div
          ref={contextMenuRef}
          className="worktree-group-context-menu"
          style={{
            left: contextMenuPosition.x,
            top: contextMenuPosition.y
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {onPinToggle && (
            <button
              className="worktree-group-context-menu-item"
              onClick={handlePinToggle}
            >
              <MaterialSymbol icon="push_pin" size={14} />
              {session.isPinned ? 'Unpin' : 'Pin'}
            </button>
          )}
          {onRename && (
            <button
              className="worktree-group-context-menu-item"
              onClick={handleRenameClick}
            >
              <MaterialSymbol icon="edit" size={14} />
              Rename
            </button>
          )}
          {onArchive && (
            <button
              className="worktree-group-context-menu-item"
              onClick={handleArchive}
            >
              <MaterialSymbol icon="archive" size={14} />
              Archive
            </button>
          )}
          {onDelete && (
            <button
              className="worktree-group-context-menu-item destructive"
              onClick={handleDelete}
            >
              <MaterialSymbol icon="delete" size={14} />
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
};
