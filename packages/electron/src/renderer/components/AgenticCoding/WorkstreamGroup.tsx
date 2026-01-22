import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol, ProviderIcon } from '@nimbalyst/runtime';
import { sessionProcessingAtom, sessionUnreadAtom, sessionPendingPromptAtom } from '../../store';
import './WorkstreamGroup.css';

/**
 * Unified component for rendering expandable session groups in the session history.
 * Supports both workstreams (sessions with children) and worktrees (git worktrees with sessions).
 */

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
  isArchived?: boolean;
}

interface WorkstreamGroupProps {
  type: 'workstream' | 'worktree';
  id: string;
  title: string;
  isExpanded: boolean;
  isActive: boolean;
  onToggle: () => void;
  onSelect: () => void;

  // Common props
  sessions: SessionItem[];
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onChildSessionSelect?: (childSessionId: string, parentId: string, parentType: 'workstream' | 'worktree') => void;
  onSessionDelete?: (sessionId: string) => void;
  onSessionArchive?: (sessionId: string) => void;
  onSessionPinToggle?: (sessionId: string, isPinned: boolean) => void;
  onSessionRename?: (sessionId: string, newName: string) => void;

  // Session/workstream-specific
  provider?: string;
  isPinned?: boolean;
  isArchived?: boolean;
  childCount?: number;

  // Worktree-specific
  worktree?: WorktreeData;
  gitStatus?: GitStatus;
  onWorktreePinToggle?: (worktreeId: string, isPinned: boolean) => void;
  onWorktreeArchive?: (worktreeId: string) => void;
  onFilesMode?: (worktreeId: string) => void;
  onChangesMode?: (worktreeId: string) => void;
  onAddSession?: (worktreeId: string) => void;
  onAddTerminal?: (worktreeId: string) => void;
}

export const WorkstreamGroup: React.FC<WorkstreamGroupProps> = ({
  type,
  id,
  title,
  isExpanded,
  isActive,
  onToggle,
  onSelect,
  sessions,
  activeSessionId,
  onSessionSelect,
  onChildSessionSelect,
  onSessionDelete,
  onSessionArchive,
  onSessionPinToggle,
  onSessionRename,
  provider,
  isPinned,
  isArchived,
  childCount,
  worktree,
  gitStatus,
  onWorktreePinToggle,
  onWorktreeArchive,
  onFilesMode,
  onChangesMode,
  onAddSession,
  onAddTerminal,
}) => {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [adjustedContextMenuPosition, setAdjustedContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Sort sessions: pinned first, then by updatedAt
  const sortedSessions = React.useMemo(() => {
    return [...sessions].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
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

  const handlePinToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowContextMenu(false);
    if (type === 'worktree' && worktree && onWorktreePinToggle) {
      onWorktreePinToggle(worktree.id, !worktree.isPinned);
    }
    // TODO: Add workstream pin toggle when implemented
  }, [type, worktree, onWorktreePinToggle]);

  const handleArchive = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowContextMenu(false);
    if (type === 'worktree' && worktree && onWorktreeArchive) {
      onWorktreeArchive(worktree.id);
    }
    // TODO: Add workstream archive when implemented
  }, [type, worktree, onWorktreeArchive]);

  const handleAddSession = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowContextMenu(false);
    if (type === 'worktree' && worktree && onAddSession) {
      onAddSession(worktree.id);
    }
  }, [type, worktree, onAddSession]);

  const handleAddTerminal = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowContextMenu(false);
    if (type === 'worktree' && worktree && onAddTerminal) {
      onAddTerminal(worktree.id);
    }
  }, [type, worktree, onAddTerminal]);

  const handleFilesMode = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (type === 'worktree' && worktree && onFilesMode) {
      onFilesMode(worktree.id);
    }
  }, [type, worktree, onFilesMode]);

  const handleChangesMode = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (type === 'worktree' && worktree && onChangesMode) {
      onChangesMode(worktree.id);
    }
  }, [type, worktree, onChangesMode]);

  const handleHeaderClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
  }, [onSelect]);

  const handleChevronClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle();
  }, [onToggle]);

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

  // Determine display values based on type
  const displayTitle = type === 'worktree'
    ? (worktree?.displayName || worktree?.name || title)
    : title;

  const displayIsPinned = type === 'worktree' ? worktree?.isPinned : isPinned;
  const displayIsArchived = type === 'worktree' ? worktree?.isArchived : isArchived;
  const sessionCount = sessions.length || childCount || 0;

  return (
    <div
      className={`workstream-group ${displayIsArchived ? 'archived' : ''} ${isActive ? 'active' : ''}`}
      data-testid={type === 'worktree' ? 'worktree-group' : 'workstream-group'}
      onMouseLeave={handleCloseContextMenu}
    >
      {/* Header */}
      <div
        className="workstream-group-header"
        onContextMenu={handleContextMenu}
      >
        {/* Chevron - separate click target for expand/collapse */}
        <button
          className="workstream-group-chevron-button"
          onClick={handleChevronClick}
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${type}`}
        >
          <MaterialSymbol
            icon="chevron_right"
            size={12}
            className={`workstream-group-chevron ${isExpanded ? 'expanded' : ''}`}
          />
        </button>

        {/* Main clickable area - icon and content */}
        <div
          className="workstream-group-main"
          onClick={handleHeaderClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect();
            }
          }}
          aria-label={`${type === 'worktree' ? 'Worktree' : 'Workstream'}: ${displayTitle}, ${sessionCount} session${sessionCount !== 1 ? 's' : ''}`}
        >
          {/* Icon */}
          <div className="workstream-group-icon">
            {type === 'worktree' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 21v-4a2 2 0 0 1 2-2h4"/>
                <path d="M14 15V7"/>
                <circle cx="8" cy="7" r="2"/>
                <circle cx="14" cy="7" r="2"/>
                <path d="M8 9v4a2 2 0 0 0 2 2"/>
              </svg>
            ) : (
              <MaterialSymbol icon="account_tree" size={16} />
            )}
          </div>

          {/* Content */}
          <div className="workstream-group-content">
            <div className="workstream-group-row-primary">
              <span className="workstream-group-name">{displayTitle}</span>
              {displayIsPinned && (
                <MaterialSymbol icon="push_pin" size={12} className="workstream-group-pin-icon" />
              )}
              {displayIsArchived && (
                <span className="workstream-group-badge archived">archived</span>
              )}
            </div>
            <div className="workstream-group-row-secondary">
              {/* Git status badges for worktrees */}
              {type === 'worktree' && gitStatus && (
                <>
                  {gitStatus.ahead && gitStatus.ahead > 0 && (
                    <span className="workstream-group-badge ahead">
                      {gitStatus.ahead} ahead
                    </span>
                  )}
                  {gitStatus.behind && gitStatus.behind > 0 && (
                    <span className="workstream-group-badge behind">
                      {gitStatus.behind} behind
                    </span>
                  )}
                  {gitStatus.uncommitted && (
                    <span className="workstream-group-badge uncommitted">
                      uncommitted
                    </span>
                  )}
                </>
              )}
              <span className="workstream-group-count">
                {sessionCount} session{sessionCount !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>

        {/* Action buttons for worktrees */}
        {type === 'worktree' && (onFilesMode || onChangesMode) && (
          <div className="workstream-group-actions">
            {onFilesMode && (
              <button
                className="workstream-group-action-button"
                onClick={handleFilesMode}
                title="Browse Files"
                aria-label="Browse files in worktree"
              >
                <MaterialSymbol icon="description" size={14} />
              </button>
            )}
            {onChangesMode && (
              <button
                className="workstream-group-action-button"
                onClick={handleChangesMode}
                title="View Changes"
                aria-label="View changes in worktree"
              >
                <MaterialSymbol icon="difference" size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Sessions List */}
      {isExpanded && (
        <div className="workstream-group-sessions">
          {sortedSessions.map(session => (
            <WorkstreamSessionItem
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              onClick={() => {
                // If onChildSessionSelect is provided, use it to maintain parent context
                // Otherwise fall back to regular session select
                if (onChildSessionSelect) {
                  onChildSessionSelect(session.id, id, type);
                } else {
                  onSessionSelect(session.id);
                }
              }}
              onDelete={onSessionDelete ? () => onSessionDelete(session.id) : undefined}
              onArchive={onSessionArchive ? () => onSessionArchive(session.id) : undefined}
              onPinToggle={onSessionPinToggle ? (pinned) => onSessionPinToggle(session.id, pinned) : undefined}
              onRename={onSessionRename ? (newName) => onSessionRename(session.id, newName) : undefined}
            />
          ))}
        </div>
      )}

      {/* Context Menu */}
      {showContextMenu && (
        <div
          ref={contextMenuRef}
          className="workstream-group-context-menu"
          style={{
            left: (adjustedContextMenuPosition || contextMenuPosition).x,
            top: (adjustedContextMenuPosition || contextMenuPosition).y
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {type === 'worktree' && onWorktreePinToggle && (
            <button
              className="workstream-group-context-menu-item"
              onClick={handlePinToggle}
            >
              <MaterialSymbol icon="push_pin" size={14} />
              {worktree?.isPinned ? 'Unpin' : 'Pin'}
            </button>
          )}
          {type === 'worktree' && onAddSession && (
            <button
              className="workstream-group-context-menu-item"
              onClick={handleAddSession}
            >
              <MaterialSymbol icon="add" size={14} />
              Add Session
            </button>
          )}
          {type === 'worktree' && onAddTerminal && (
            <button
              className="workstream-group-context-menu-item"
              onClick={handleAddTerminal}
            >
              <MaterialSymbol icon="terminal" size={14} />
              Add Terminal
            </button>
          )}
          {type === 'worktree' && onWorktreeArchive && (
            <>
              <div className="workstream-group-context-menu-divider" />
              <button
                className="workstream-group-context-menu-item destructive"
                onClick={handleArchive}
              >
                <MaterialSymbol icon="archive" size={14} />
                Archive Worktree
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Status indicator for workstream child sessions.
 * Subscribes to Jotai atoms for real-time processing/unread/pending state.
 */
const WorkstreamSessionStatusIndicator = memo<{ sessionId: string; messageCount?: number }>(({ sessionId, messageCount }) => {
  const isProcessing = useAtomValue(sessionProcessingAtom(sessionId));
  const hasPendingPrompt = useAtomValue(sessionPendingPromptAtom(sessionId));
  const hasUnread = useAtomValue(sessionUnreadAtom(sessionId));

  // Priority: processing > pending prompt > unread > message count
  if (isProcessing) {
    return (
      <div className="workstream-session-item-status processing" title="Processing...">
        <MaterialSymbol icon="progress_activity" size={12} />
      </div>
    );
  }

  if (hasPendingPrompt) {
    return (
      <div className="workstream-session-item-status pending-prompt" title="Waiting for your response">
        <MaterialSymbol icon="help" size={12} />
      </div>
    );
  }

  if (hasUnread) {
    return (
      <div className="workstream-session-item-status unread" title="Unread response">
        <MaterialSymbol icon="circle" size={6} fill />
      </div>
    );
  }

  if (messageCount && messageCount > 0) {
    return <span className="workstream-session-item-count">{messageCount}</span>;
  }

  return null;
});

// Child session item within a workstream group
interface WorkstreamSessionItemProps {
  session: SessionItem;
  isActive: boolean;
  onClick: () => void;
  onDelete?: () => void;
  onArchive?: () => void;
  onPinToggle?: (isPinned: boolean) => void;
  onRename?: (newName: string) => void;
}

const WorkstreamSessionItem: React.FC<WorkstreamSessionItemProps> = ({
  session,
  isActive,
  onClick,
  onDelete,
  onArchive,
  onPinToggle,
  onRename,
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

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  return (
    <div
      className={`workstream-session-item ${isActive ? 'active' : ''}`}
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
      <div className="workstream-session-item-icon">
        <ProviderIcon provider={session.provider || 'claude'} size={14} />
      </div>
      {session.isPinned && (
        <MaterialSymbol icon="push_pin" size={10} className="workstream-session-item-pin-icon" />
      )}
      {isRenaming ? (
        <input
          ref={renameInputRef}
          type="text"
          className="workstream-session-item-rename-input"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={handleRenameKeyDown}
          onBlur={handleRenameSubmit}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="workstream-session-item-title">{displayTitle}</span>
      )}
      <div className="workstream-session-item-right">
        <WorkstreamSessionStatusIndicator sessionId={session.id} messageCount={session.messageCount} />
      </div>

      {/* Context Menu */}
      {showContextMenu && (
        <div
          ref={contextMenuRef}
          className="workstream-group-context-menu"
          style={{
            left: contextMenuPosition.x,
            top: contextMenuPosition.y
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {onPinToggle && (
            <button
              className="workstream-group-context-menu-item"
              onClick={handlePinToggle}
            >
              <MaterialSymbol icon="push_pin" size={14} />
              {session.isPinned ? 'Unpin' : 'Pin'}
            </button>
          )}
          {onRename && (
            <button
              className="workstream-group-context-menu-item"
              onClick={handleRenameClick}
            >
              <MaterialSymbol icon="edit" size={14} />
              Rename
            </button>
          )}
          {onArchive && (
            <button
              className="workstream-group-context-menu-item"
              onClick={handleArchive}
            >
              <MaterialSymbol icon="archive" size={14} />
              Archive
            </button>
          )}
          {onDelete && (
            <button
              className="workstream-group-context-menu-item destructive"
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
