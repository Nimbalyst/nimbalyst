import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CollapsibleGroup } from './CollapsibleGroup';
import { SessionListItem } from './SessionListItem';
import { WorktreeSingle } from './WorktreeSingle';
import { groupSessionsByTime, TimeGroupKey } from '../../utils/dateFormatting';
import { getFileName } from '../../utils/pathUtils';
import { KeyboardShortcuts, getShortcutDisplay } from '../../../shared/KeyboardShortcuts';
import './SessionHistory.css';

interface SessionItem {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  provider: string;
  model?: string;
  sessionType?: 'chat' | 'planning' | 'coding' | 'terminal';
  messageCount: number;
  isProcessing?: boolean;
  hasUnread?: boolean;
  hasPendingPrompt?: boolean;
  isArchived?: boolean;
  worktree_id?: string | null; // Associated worktree ID if this is a worktree session
}

interface WorktreeData {
  id: string;
  name: string;
  path: string;
  branch: string;
  base_branch?: string;
}

interface WorktreeWithStatus extends WorktreeData {
  gitStatus?: {
    ahead?: number;
    behind?: number;
    uncommitted?: boolean;
  };
}

interface SessionHistoryProps {
  workspacePath: string;
  activeSessionId: string | null;
  loadedSessionIds?: string[]; // IDs of sessions loaded in tabs
  processingSessions?: Set<string>; // IDs of sessions currently processing
  unreadSessions?: Set<string>; // IDs of sessions with unread messages
  pendingPromptSessions?: Set<string>; // IDs of sessions with pending permission/question prompts
  renamedSession?: { id: string; title: string } | null; // Session that was just renamed
  updatedSession?: { id: string; timestamp: number } | null; // Session that was just updated
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete?: (sessionId: string) => void;
  onSessionArchive?: (sessionId: string) => void; // Callback when session is archived (to close tab)
  onSessionRename?: (sessionId: string, newName: string) => void; // Callback when session is renamed
  onNewSession?: () => void;
  onNewTerminal?: () => void; // Callback for creating a new terminal session
  onNewWorktreeSession?: () => void; // Callback for creating new worktree session
  onImportSessions?: () => void; // Callback for opening import dialog
  onOpenQuickSearch?: () => void; // Callback for opening session quick search (Cmd+L)
  collapsedGroups: string[];
  onCollapsedGroupsChange: (groups: string[]) => void;
  sortOrder?: 'updated' | 'created'; // Sort order for sessions
  onSortOrderChange?: (sortOrder: 'updated' | 'created') => void; // Callback when sort order changes
  refreshTrigger?: number; // Optional trigger to force refresh
  mode?: 'chat' | 'agent'; // Mode determines which sessions to show
}

// Generate a consistent color based on workspace path
function generateWorkspaceColor(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    hash = ((hash << 5) - hash) + path.charCodeAt(i);
    hash = hash & hash;
  }

  // Generate a hue value (0-360)
  const hue = Math.abs(hash) % 360;
  // Use consistent saturation and lightness for pleasant colors
  return `hsl(${hue}, 65%, 55%)`;
}

// Component to render a worktree session with async data loading
interface WorktreeSessionItemProps {
  session: SessionItem;
  worktreeId: string;
  isActive: boolean;
  onSessionSelect: (sessionId: string) => void;
  fetchWorktreeData: (worktreeId: string) => Promise<WorktreeWithStatus | null>;
}

const WorktreeSessionItem: React.FC<WorktreeSessionItemProps> = ({
  session,
  worktreeId,
  isActive,
  onSessionSelect,
  fetchWorktreeData
}) => {
  const [worktreeData, setWorktreeData] = useState<WorktreeWithStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadWorktreeData = async () => {
      setLoading(true);
      const data = await fetchWorktreeData(worktreeId);
      if (mounted) {
        setWorktreeData(data);
        setLoading(false);
      }
    };

    loadWorktreeData();

    return () => {
      mounted = false;
    };
  }, [worktreeId, fetchWorktreeData]);

  // Show loading state or fallback if data not available
  if (loading || !worktreeData) {
    return (
      <WorktreeSingle
        session={session}
        worktreeName={loading ? 'Loading...' : 'Unknown worktree'}
        worktreePath=""
        isActive={isActive}
        onClick={() => onSessionSelect(session.id)}
      />
    );
  }

  return (
    <WorktreeSingle
      session={session}
      worktreeName={worktreeData.name}
      worktreePath={worktreeData.path}
      gitStatus={worktreeData.gitStatus}
      isActive={isActive}
      onClick={() => onSessionSelect(session.id)}
    />
  );
};

const SessionHistoryComponent: React.FC<SessionHistoryProps> = ({
  workspacePath,
  activeSessionId,
  loadedSessionIds = [],
  processingSessions = new Set(),
  unreadSessions = new Set(),
  pendingPromptSessions = new Set(),
  renamedSession = null,
  updatedSession = null,
  onSessionSelect,
  onSessionDelete,
  onSessionArchive,
  onSessionRename,
  onNewSession,
  onNewTerminal,
  onNewWorktreeSession,
  onImportSessions,
  onOpenQuickSearch,
  collapsedGroups,
  onCollapsedGroupsChange,
  sortOrder: controlledSortOrder,
  onSortOrderChange,
  refreshTrigger,
  mode = 'agent'
}) => {
  const [allSessions, setAllSessions] = useState<SessionItem[]>([]); // All sessions from DB
  const [sessions, setSessions] = useState<SessionItem[]>([]); // Filtered sessions to display
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Use controlled sort order from props if provided, otherwise use internal state
  const [internalSortOrder, setInternalSortOrder] = useState<'updated' | 'created'>('updated');
  const sortBy = controlledSortOrder ?? internalSortOrder;
  const setSortBy = onSortOrderChange ?? setInternalSortOrder;
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const [contentSearchTriggered, setContentSearchTriggered] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null); // For shift+click range selection
  const [worktreeCache, setWorktreeCache] = useState<Map<string, WorktreeWithStatus>>(new Map()); // Cache worktree data

  // Track scroll position to restore after refresh
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef<number>(0);

  // Save scroll position on scroll
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      scrollPositionRef.current = container.scrollTop;
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Extract workspace name from path
  const workspaceName = getFileName(workspacePath) || 'Workspace';
  const workspaceColor = generateWorkspaceColor(workspacePath);

  // Fetch worktree data by ID (with caching)
  const fetchWorktreeData = useCallback(async (worktreeId: string): Promise<WorktreeWithStatus | null> => {
    // Check cache first
    if (worktreeCache.has(worktreeId)) {
      const cached = worktreeCache.get(worktreeId);
      if (cached) {
        return cached;
      }
    }

    try {
      // Fetch worktree from database
      const result = await window.electronAPI.invoke('worktree:get', worktreeId);
      if (!result.success || !result.worktree) {
        console.error(`[SessionHistory] Worktree not found: ${worktreeId}`);
        return null;
      }

      const worktreeData: WorktreeData = result.worktree;

      // Fetch git status for the worktree
      let gitStatus: { ahead?: number; behind?: number; uncommitted?: boolean } | undefined;
      try {
        const statusResult = await window.electronAPI.invoke('worktree:get-status', worktreeData.path);
        if (statusResult.success && statusResult.status) {
          gitStatus = {
            ahead: statusResult.status.ahead,
            behind: statusResult.status.behind,
            uncommitted: statusResult.status.hasUncommittedChanges,
          };
        }
      } catch (err) {
        console.warn(`[SessionHistory] Failed to get git status for worktree ${worktreeId}:`, err);
        // Continue without git status - it's not critical
      }

      const worktreeWithStatus: WorktreeWithStatus = {
        ...worktreeData,
        gitStatus,
      };

      // Cache the result
      setWorktreeCache(prev => new Map(prev).set(worktreeId, worktreeWithStatus));

      return worktreeWithStatus;
    } catch (err) {
      console.error(`[SessionHistory] Failed to fetch worktree data for ${worktreeId}:`, err);
      return null;
    }
  }, [worktreeCache]);

  // Load all sessions from database (no search query)
  const loadAllSessions = useCallback(async () => {
    try {
      // Don't show loading spinner if we already have sessions (just refreshing)
      const hasExistingSessions = allSessions.length > 0;
      if (!hasExistingSessions) {
        setLoading(true);
      }
      setError(null);

      const result = await window.electronAPI.invoke('sessions:list', workspacePath, { includeArchived: showArchived });

      if (result.success && Array.isArray(result.sessions)) {
        // Map sessions with base data only. Visual indicators (isProcessing, hasUnread)
        // are applied separately by the useEffect below to avoid stale closure issues.
        const incomingSessions = result.sessions.map((s: any) => ({
          id: s.id,
          title: s.title || s.name || 'Untitled Session',
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          provider: s.provider || 'claude',
          model: s.model,
          sessionType: s.sessionType || 'chat',
          messageCount: s.messageCount || 0,
          isProcessing: false,  // Will be updated by visual indicator effect
          hasUnread: false,     // Will be updated by visual indicator effect
          isArchived: s.isArchived || false,
          worktree_id: s.worktreeId || null
        }));

        // Merge incoming sessions with existing ones to preserve React keys and reduce flicker
        setAllSessions(prev => {
          // If first load, just set the new sessions
          if (prev.length === 0) {
            return incomingSessions;
          }

          // Create a map of incoming sessions by ID
          const incomingMap = new Map(incomingSessions.map((s: SessionItem) => [s.id, s]));

          // Update existing sessions and add new ones
          const merged = prev.map(existing => {
            const incoming = incomingMap.get(existing.id);
            if (incoming) {
              // Session still exists, update it while preserving visual state
              incomingMap.delete(existing.id); // Mark as processed
              return {
                ...incoming,
                isProcessing: existing.isProcessing, // Preserve these from current state
                hasUnread: existing.hasUnread
              };
            }
            return null; // Session was deleted
          }).filter((s): s is NonNullable<typeof s> => s !== null);

          // Add any new sessions that weren't in the previous list
          const newSessions = Array.from(incomingMap.values());

          return [...merged, ...newSessions];
        });

        // Apply the same merge logic to filtered sessions
        setSessions(prev => {
          if (prev.length === 0) {
            return incomingSessions;
          }

          const incomingMap = new Map(incomingSessions.map((s: SessionItem) => [s.id, s]));
          const merged = prev.map(existing => {
            const incoming = incomingMap.get(existing.id);
            if (incoming) {
              incomingMap.delete(existing.id);
              return {
                ...incoming,
                isProcessing: existing.isProcessing,
                hasUnread: existing.hasUnread
              };
            }
            return null;
          }).filter((s): s is NonNullable<typeof s> => s !== null);

          const newSessions = Array.from(incomingMap.values());
          return [...merged, ...newSessions];
        });

        // Restore scroll position after update
        requestAnimationFrame(() => {
          if (scrollContainerRef.current && scrollPositionRef.current > 0) {
            scrollContainerRef.current.scrollTop = scrollPositionRef.current;
          }
        });
      }
    } catch (err) {
      console.error('[SessionHistory] Failed to load sessions:', err);
      setError('Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, [workspacePath, allSessions.length, showArchived]);

  // Search message content in database (heavy operation)
  const searchMessageContent = useCallback(async (query: string) => {
    try {
      setIsSearching(true);
      setError(null);

      const result = await window.electronAPI.invoke('sessions:search', workspacePath, query.trim(), { includeArchived: showArchived });

      if (result.success && Array.isArray(result.sessions)) {
        let searchResults = result.sessions.map((s: any) => ({
          id: s.id,
          title: s.title || s.name || 'Untitled Session',
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          provider: s.provider || 'claude',
          model: s.model,
          sessionType: s.sessionType || 'chat',
          messageCount: s.messageCount || 0,
          isProcessing: false,
          hasUnread: false,
          isArchived: s.isArchived || false,
          worktree_id: s.worktreeId || null
        }));

        // Filter out worktree sessions in non-agent mode
        if (mode !== 'agent') {
          searchResults = searchResults.filter(session => !session.worktree_id);
        }

        setSessions(searchResults);
      }
    } catch (err) {
      console.error('[SessionHistory] Failed to search sessions:', err);
      setError('Failed to search sessions');
    } finally {
      setIsSearching(false);
    }
  }, [workspacePath, showArchived, mode]);

  // Load all sessions on mount and when refreshTrigger changes
  useEffect(() => {
    loadAllSessions();
  }, [loadAllSessions, refreshTrigger]);

  // Client-side title filtering (instant, no database query)
  useEffect(() => {
    // Reset content search trigger when query changes
    setContentSearchTriggered(false);

    // Filter out worktree sessions in non-agent mode
    let sessionsToFilter = allSessions;
    if (mode !== 'agent') {
      sessionsToFilter = allSessions.filter(session => !session.worktree_id);
    }

    if (!searchQuery.trim()) {
      // No search query - show all sessions (filtered by mode)
      setSessions(sessionsToFilter);
      return;
    }

    // Filter sessions by title in memory (case-insensitive)
    const query = searchQuery.toLowerCase();
    const filtered = sessionsToFilter.filter(session =>
      (session.title ?? '').toLowerCase().includes(query)
    );
    setSessions(filtered);
  }, [searchQuery, allSessions, mode]);

  // Function to trigger content search (database query for message content)
  const searchMessageContents = useCallback(() => {
    if (!searchQuery.trim() || contentSearchTriggered) {
      return; // Don't search if already triggered or no query
    }
    setContentSearchTriggered(true);
    searchMessageContent(searchQuery);
  }, [searchQuery, contentSearchTriggered, searchMessageContent]);

  // Update visual indicators (processing state, unread badges, pending prompts) without reloading from database
  useEffect(() => {
    setSessions(prevSessions => prevSessions.map(session => ({
      ...session,
      isProcessing: processingSessions.has(session.id),
      hasUnread: unreadSessions.has(session.id),
      hasPendingPrompt: pendingPromptSessions.has(session.id)
    })));
  }, [processingSessions, unreadSessions, pendingPromptSessions]);

  // Update session title when renamed (efficient update without database reload)
  useEffect(() => {
    if (renamedSession) {
      setSessions(prevSessions => prevSessions.map(session => {
        if (session.id === renamedSession.id) {
          return { ...session, title: renamedSession.title };
        }
        return session;
      }));
    }
  }, [renamedSession]);

  // Update session timestamp when updated (efficient update without database reload)
  useEffect(() => {
    if (updatedSession) {
      setSessions(prevSessions => prevSessions.map(session => {
        if (session.id === updatedSession.id) {
          return { ...session, updatedAt: updatedSession.timestamp };
        }
        return session;
      }));
    }
  }, [updatedSession]);

  const handleToggleGroup = (groupName: string) => {
    if (collapsedGroups.includes(groupName)) {
      onCollapsedGroupsChange(collapsedGroups.filter(g => g !== groupName));
    } else {
      onCollapsedGroupsChange([...collapsedGroups, groupName]);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (onSessionDelete) {
      onSessionDelete(sessionId);
      // Reload sessions after delete
      await loadAllSessions();
    }
  };

  const handleArchiveSession = async (sessionId: string) => {
    try {
      await window.electronAPI.invoke('sessions:update-metadata', sessionId, { isArchived: true });
      // Remove from local state immediately for instant feedback
      setAllSessions(prev => prev.filter(s => s.id !== sessionId));
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      // Notify parent to close the tab if open
      if (onSessionArchive) {
        onSessionArchive(sessionId);
      }
    } catch (err) {
      console.error('[SessionHistory] Failed to archive session:', err);
    }
  };

  const handleUnarchiveSession = async (sessionId: string) => {
    try {
      await window.electronAPI.invoke('sessions:update-metadata', sessionId, { isArchived: false });
      // Update local state immediately for instant feedback
      setAllSessions(prev => prev.map(s => s.id === sessionId ? { ...s, isArchived: false } : s));
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, isArchived: false } : s));
    } catch (err) {
      console.error('[SessionHistory] Failed to unarchive session:', err);
    }
  };

  const toggleShowArchived = () => {
    setShowArchived(prev => !prev);
  };

  // Clear selection when clicking elsewhere
  const clearSelection = useCallback(() => {
    setSelectedSessionIds(new Set());
    setLastSelectedId(null);
  }, []);

  // Handle session click with multi-select support
  const handleSessionClick = useCallback((sessionId: string, e: React.MouseEvent) => {
    const isMetaKey = e.metaKey || e.ctrlKey;
    const isShiftKey = e.shiftKey;

    if (isMetaKey) {
      // Cmd/Ctrl+click: toggle selection
      setSelectedSessionIds(prev => {
        const next = new Set(prev);
        if (next.has(sessionId)) {
          next.delete(sessionId);
        } else {
          next.add(sessionId);
        }
        return next;
      });
      setLastSelectedId(sessionId);
    } else if (isShiftKey) {
      // Shift+click: range selection
      // Use lastSelectedId, or fall back to activeSessionId as the anchor
      const anchorId = lastSelectedId || activeSessionId;
      if (anchorId) {
        // Get visual order from grouped sessions (flattened)
        const grouped = groupSessionsByTime(sessions, sortBy === 'updated' ? 'updatedAt' : 'createdAt');
        const visualOrderIds = (Object.keys(grouped) as TimeGroupKey[]).flatMap(key => grouped[key].map(s => s.id));

        const anchorIndex = visualOrderIds.indexOf(anchorId);
        const currentIndex = visualOrderIds.indexOf(sessionId);

        if (anchorIndex !== -1 && currentIndex !== -1) {
          const start = Math.min(anchorIndex, currentIndex);
          const end = Math.max(anchorIndex, currentIndex);
          const rangeIds = visualOrderIds.slice(start, end + 1);

          setSelectedSessionIds(new Set(rangeIds));
          setLastSelectedId(sessionId);
        }
      } else {
        // No anchor point, just select this one
        setSelectedSessionIds(new Set([sessionId]));
        setLastSelectedId(sessionId);
      }
    } else {
      // Regular click: clear selection and select session
      clearSelection();
      onSessionSelect(sessionId);
    }
  }, [sessions, lastSelectedId, activeSessionId, sortBy, clearSelection, onSessionSelect]);

  // Bulk archive selected sessions
  const handleBulkArchive = async () => {
    const promises = Array.from(selectedSessionIds).map(sessionId =>
      window.electronAPI.invoke('sessions:update-metadata', sessionId, { isArchived: true })
    );
    await Promise.all(promises);
    setAllSessions(prev => prev.filter(s => !selectedSessionIds.has(s.id)));
    setSessions(prev => prev.filter(s => !selectedSessionIds.has(s.id)));
    // Notify parent to close tabs for all archived sessions
    if (onSessionArchive) {
      selectedSessionIds.forEach(sessionId => onSessionArchive(sessionId));
    }
    clearSelection();
  };

  // Bulk unarchive selected sessions
  const handleBulkUnarchive = async () => {
    const promises = Array.from(selectedSessionIds).map(sessionId =>
      window.electronAPI.invoke('sessions:update-metadata', sessionId, { isArchived: false })
    );
    await Promise.all(promises);
    setAllSessions(prev => prev.map(s => selectedSessionIds.has(s.id) ? { ...s, isArchived: false } : s));
    setSessions(prev => prev.map(s => selectedSessionIds.has(s.id) ? { ...s, isArchived: false } : s));
    clearSelection();
  };

  // Bulk delete selected sessions
  const handleBulkDelete = async () => {
    if (!onSessionDelete) return;

    const count = selectedSessionIds.size;
    const confirmed = window.confirm(`Are you sure you want to permanently delete ${count} session${count > 1 ? 's' : ''}? This cannot be undone.`);
    if (!confirmed) return;

    for (const sessionId of selectedSessionIds) {
      await onSessionDelete(sessionId);
    }
    await loadAllSessions();
    clearSelection();
  };

  const toggleSortDropdown = () => {
    setSortDropdownOpen(!sortDropdownOpen);
  };

  const selectSortOption = (option: 'updated' | 'created') => {
    setSortBy(option);
    setSortDropdownOpen(false);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sortDropdownOpen) {
        const target = e.target as HTMLElement;
        if (!target.closest('.session-history-sort-dropdown')) {
          setSortDropdownOpen(false);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [sortDropdownOpen]);

  // Group sessions by time - use the selected sort field
  const groupedSessions = groupSessionsByTime(sessions, sortBy === 'updated' ? 'updatedAt' : 'createdAt');
  const groupKeys = Object.keys(groupedSessions) as TimeGroupKey[];

  if (loading) {
    return (
      <div className="session-history">
        <div className="workspace-color-accent" style={{ backgroundColor: workspaceColor }} />
        <div className="session-history-header">
          <div className="session-history-header-identity">
            <h3 className="session-history-header-name">{workspaceName}</h3>
            <div className="session-history-header-path">{workspacePath}</div>
          </div>
          <div className="session-history-header-buttons">
            {onOpenQuickSearch && (
              <button
                className="session-history-search-button"
                data-testid="session-quick-search-button"
                onClick={onOpenQuickSearch}
                title={`Search sessions (${getShortcutDisplay(KeyboardShortcuts.window.sessionQuickOpen)})`}
                aria-label="Search sessions"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            )}
            {onImportSessions && (
              <button
                className="session-history-import-button"
                data-testid="import-sessions-button"
                onClick={onImportSessions}
                title="Import Claude Agent sessions"
                aria-label="Import sessions"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M13.5 8.5V12.5C13.5 13.0523 13.0523 13.5 12.5 13.5H3.5C2.94772 13.5 2.5 13.0523 2.5 12.5V8.5M8 2.5V10.5M8 10.5L5.5 8M8 10.5L10.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
            {onNewWorktreeSession && (
              <button
                className="session-history-worktree-button"
                data-testid="new-worktree-session-button"
                onClick={onNewWorktreeSession}
                title="Create new git worktree session"
                aria-label="Create new worktree session"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M5 13v-2.5a1.5 1.5 0 0 1 1.5-1.5h3"/>
                  <path d="M9.5 9V4.5"/>
                  <circle cx="5" cy="4.5" r="1.5"/>
                  <circle cx="9.5" cy="4.5" r="1.5"/>
                  <path d="M5 6v2.5a1.5 1.5 0 0 0 1.5 1.5"/>
                  <path d="M12 7v4M10 9h4"/>
                </svg>
              </button>
            )}
            {onNewSession && (
              <button
                className="session-history-new-button"
                data-testid="new-session-button"
                onClick={() => onNewSession()}
                title={`New session (${getShortcutDisplay(KeyboardShortcuts.file.newSession)})`}
                aria-label="Create new session"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            )}
            {onNewTerminal && (
              <button
                className="session-history-new-terminal-button"
                data-testid="new-terminal-button"
                onClick={() => onNewTerminal()}
                title="New terminal"
                aria-label="Create new terminal"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3 5L7 9L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M9 13H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className="session-history-section-label">Agent Sessions</div>
        <div className="session-history-search">
          <input
            type="text"
            className="session-history-search-input"
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search sessions"
          />
        </div>
        <div className="session-history-filters">
          <div className="session-history-sort-dropdown">
            <button
              className="session-history-sort-button"
              onClick={toggleSortDropdown}
              title={`Sorted by: ${sortBy === 'updated' ? 'Last Updated' : 'Created'}`}
              aria-label="Sort sessions"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 2V14M8 14L4 10M8 14L12 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {sortDropdownOpen && (
              <div className="session-history-sort-menu">
                <button
                  className={`session-history-sort-option ${sortBy === 'updated' ? 'active' : ''}`}
                  onClick={() => selectSortOption('updated')}
                >
                  <span>Last Updated</span>
                  {sortBy === 'updated' && (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M13 4L6 11L3 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
                <button
                  className={`session-history-sort-option ${sortBy === 'created' ? 'active' : ''}`}
                  onClick={() => selectSortOption('created')}
                >
                  <span>Created</span>
                  {sortBy === 'created' && (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M13 4L6 11L3 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="session-history-loading">
          <span>Searching sessions...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="session-history">
        <div className="workspace-color-accent" style={{ backgroundColor: workspaceColor }} />
        <div className="session-history-header">
          <div className="session-history-header-identity">
            <h3 className="session-history-header-name">{workspaceName}</h3>
            <div className="session-history-header-path">{workspacePath}</div>
          </div>
          {onNewSession && (
            <button
              className="session-history-new-button"
              onClick={(e) => {
                e.stopPropagation();
                onNewSession();
              }}
              title={`New session (${getShortcutDisplay(KeyboardShortcuts.file.newSession)})`}
              aria-label="Create new session"
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
        <div className="session-history-section-label">Agent Sessions</div>
        <div className="session-history-error">
          <span>{error}</span>
        </div>
      </div>
    );
  }

  // Check if we have an active search query
  const hasSearchQuery = searchQuery.trim().length > 0;

  if (sessions.length === 0 && !hasSearchQuery) {
    // No sessions at all - show simple empty state without search
    return (
      <div className="session-history">
        <div className="workspace-color-accent" style={{ backgroundColor: workspaceColor }} />
        <div className="session-history-header">
          <div className="session-history-header-identity">
            <h3 className="session-history-header-name">{workspaceName}</h3>
            <div className="session-history-header-path">{workspacePath}</div>
          </div>
          <div className="session-history-header-buttons">
            {onImportSessions && (
              <button
                className="session-history-import-button"
                data-testid="import-sessions-button"
                onClick={onImportSessions}
                title="Import Claude Agent sessions"
                aria-label="Import sessions"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M13.5 8.5V12.5C13.5 13.0523 13.0523 13.5 12.5 13.5H3.5C2.94772 13.5 2.5 13.0523 2.5 12.5V8.5M8 2.5V10.5M8 10.5L5.5 8M8 10.5L10.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
            {onNewWorktreeSession && (
              <button
                className="session-history-worktree-button"
                data-testid="new-worktree-session-button"
                onClick={onNewWorktreeSession}
                title="Create new git worktree session"
                aria-label="Create new worktree session"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M5 13v-2.5a1.5 1.5 0 0 1 1.5-1.5h3"/>
                  <path d="M9.5 9V4.5"/>
                  <circle cx="5" cy="4.5" r="1.5"/>
                  <circle cx="9.5" cy="4.5" r="1.5"/>
                  <path d="M5 6v2.5a1.5 1.5 0 0 0 1.5 1.5"/>
                  <path d="M12 7v4M10 9h4"/>
                </svg>
              </button>
            )}
            {onNewSession && (
              <button
                className="session-history-new-button"
                data-testid="new-session-button"
                onClick={onNewSession}
                title={`New session (${getShortcutDisplay(KeyboardShortcuts.file.newSession)})`}
                aria-label="Create new session"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            )}
            {onNewTerminal && (
              <button
                className="session-history-new-terminal-button"
                data-testid="new-terminal-button"
                onClick={() => onNewTerminal()}
                title="New terminal"
                aria-label="Create new terminal"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3 5L7 9L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M9 13H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className="session-history-section-label">Agent Sessions</div>
        <div className="session-history-empty">
          <p>No sessions yet</p>
          <p className="session-history-empty-hint">
            Create a new session to get started
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="session-history">
      <div className="workspace-color-accent" style={{ backgroundColor: workspaceColor }} />
      <div className="session-history-header">
        <div className="session-history-header-identity">
          <h3 className="session-history-header-name">{workspaceName}</h3>
          <div className="session-history-header-path">{workspacePath}</div>
        </div>
        <div className="session-history-header-buttons">
          {onOpenQuickSearch && (
            <button
              className="session-history-search-button"
              data-testid="session-quick-search-button"
              onClick={onOpenQuickSearch}
              title={`Search sessions (${getShortcutDisplay(KeyboardShortcuts.window.sessionQuickOpen)})`}
              aria-label="Search sessions"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
          {onImportSessions && (
            <button
              className="session-history-import-button"
              data-testid="import-sessions-button"
              onClick={onImportSessions}
              title="Import Claude Agent sessions"
              aria-label="Import sessions"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M13.5 8.5V12.5C13.5 13.0523 13.0523 13.5 12.5 13.5H3.5C2.94772 13.5 2.5 13.0523 2.5 12.5V8.5M8 2.5V10.5M8 10.5L5.5 8M8 10.5L10.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
          {onNewWorktreeSession && (
            <button
              className="session-history-worktree-button"
              data-testid="new-worktree-session-button"
              onClick={onNewWorktreeSession}
              title="Create new git worktree session"
              aria-label="Create new worktree session"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M5 13v-2.5a1.5 1.5 0 0 1 1.5-1.5h3"/>
                <path d="M9.5 9V4.5"/>
                <circle cx="5" cy="4.5" r="1.5"/>
                <circle cx="9.5" cy="4.5" r="1.5"/>
                <path d="M5 6v2.5a1.5 1.5 0 0 0 1.5 1.5"/>
                <path d="M12 7v4M10 9h4"/>
              </svg>
            </button>
          )}
          {onNewSession && (
            <button
              className="session-history-new-button"
              data-testid="new-session-button"
              onClick={onNewSession}
              title={`New session (${getShortcutDisplay(KeyboardShortcuts.file.newSession)})`}
              aria-label="Create new session"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          )}
          {onNewTerminal && (
            <button
              className="session-history-new-terminal-button"
              data-testid="new-terminal-button"
              onClick={() => onNewTerminal()}
              title="New terminal"
              aria-label="Create new terminal"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 5L7 9L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 13H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="session-history-section-label">Agent Sessions</div>
      <div className="session-history-search">
        <input
          type="text"
          className="session-history-search-input"
          placeholder="Search sessions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Tab' && searchQuery && !contentSearchTriggered) {
              e.preventDefault();
              searchMessageContents();
            }
          }}
          aria-label="Search sessions"
        />
        {isSearching && (
          <div className="session-history-search-status">
            {contentSearchTriggered ? 'Searching messages...' : 'Searching...'}
          </div>
        )}
        {!isSearching && searchQuery && !contentSearchTriggered && (
          <button
            className="session-history-content-search-hint"
            onClick={searchMessageContents}
            title="Press Tab to search message contents"
          >
            ⇥ Search contents
          </button>
        )}
      </div>
      <div className="session-history-filters">
        <button
          className={`session-history-archive-filter ${showArchived ? 'active' : ''}`}
          onClick={toggleShowArchived}
          title={showArchived ? 'Hide archived sessions' : 'Show archived sessions'}
          aria-label={showArchived ? 'Hide archived sessions' : 'Show archived sessions'}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 5h12M4 5v8a1 1 0 001 1h6a1 1 0 001-1V5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6 8h4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
          </svg>
        </button>
        <div className="session-history-sort-dropdown">
          <button
            className="session-history-sort-button"
            onClick={toggleSortDropdown}
            title={`Sorted by: ${sortBy === 'updated' ? 'Last Updated' : 'Created'}`}
            aria-label="Sort sessions"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 2V14M8 14L4 10M8 14L12 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          {sortDropdownOpen && (
            <div className="session-history-sort-menu">
              <button
                className={`session-history-sort-option ${sortBy === 'updated' ? 'active' : ''}`}
                onClick={() => selectSortOption('updated')}
              >
                <span>Last Updated</span>
                {sortBy === 'updated' && (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M13 4L6 11L3 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
              <button
                className={`session-history-sort-option ${sortBy === 'created' ? 'active' : ''}`}
                onClick={() => selectSortOption('created')}
              >
                <span>Created</span>
                {sortBy === 'created' && (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M13 4L6 11L3 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
      {selectedSessionIds.size > 0 && (
        <div className="session-history-bulk-actions">
          <span className="session-history-bulk-count">{selectedSessionIds.size} selected</span>
          <div className="session-history-bulk-buttons">
            {showArchived ? (
              <button className="session-history-bulk-button" onClick={handleBulkUnarchive} title="Unarchive selected">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2 5h12M4 5v8a1 1 0 001 1h6a1 1 0 001-1V5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M8 11V7M6 9l2-2 2 2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Unarchive
              </button>
            ) : (
              <button className="session-history-bulk-button" onClick={handleBulkArchive} title="Archive selected">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2 5h12M4 5v8a1 1 0 001 1h6a1 1 0 001-1V5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M8 7v4M6 9l2 2 2-2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Archive
              </button>
            )}
            {onSessionDelete && (
              <button className="session-history-bulk-button destructive" onClick={handleBulkDelete} title="Delete selected">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2 4h12M5.333 4V2.667A.667.667 0 016 2h4a.667.667 0 01.667.667V4M12.667 4v9.333a1.333 1.333 0 01-1.334 1.334H4.667a1.333 1.333 0 01-1.334-1.334V4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Delete
              </button>
            )}
            <button className="session-history-bulk-button" onClick={clearSelection} title="Clear selection">
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="session-history-list" ref={scrollContainerRef}>
        {groupKeys.length === 0 && hasSearchQuery ? (
          // No search results - show message with option to clear
          <div className="session-history-empty">
            <p>No matching sessions found</p>
            <p className="session-history-empty-hint">
              Try a different search term or{' '}
              <button
                className="session-history-clear-search-link"
                onClick={() => setSearchQuery('')}
                type="button"
              >
                clear search
              </button>
            </p>
          </div>
        ) : (
          groupKeys.map(groupKey => {
            const groupSessions = groupedSessions[groupKey];
            const isExpanded = !collapsedGroups.includes(groupKey);

            return (
              <CollapsibleGroup
                key={groupKey}
                title={groupKey}
                isExpanded={isExpanded}
                onToggle={() => handleToggleGroup(groupKey)}
                count={groupSessions.length}
              >
                {groupSessions.map(session => {
                  // Check if this is a worktree session (defensive null check)
                  if (session.worktree_id && typeof session.worktree_id === 'string') {
                    return (
                      <WorktreeSessionItem
                        key={session.id}
                        session={session}
                        worktreeId={session.worktree_id}
                        isActive={session.id === activeSessionId}
                        onSessionSelect={onSessionSelect}
                        fetchWorktreeData={fetchWorktreeData}
                      />
                    );
                  }

                  // Regular session - use SessionListItem
                  return (
                    <SessionListItem
                      key={session.id}
                      id={session.id}
                      title={session.title || 'Untitled Session'}
                      createdAt={session.createdAt}
                      updatedAt={session.updatedAt}
                      isActive={session.id === activeSessionId}
                      isLoaded={loadedSessionIds.includes(session.id)}
                      isArchived={session.isArchived}
                      isSelected={selectedSessionIds.has(session.id)}
                      sortBy={sortBy}
                      onClick={(e) => handleSessionClick(session.id, e)}
                      onDelete={onSessionDelete ? () => handleDeleteSession(session.id) : undefined}
                      onArchive={() => handleArchiveSession(session.id)}
                      onUnarchive={() => handleUnarchiveSession(session.id)}
                      onRename={onSessionRename ? (newName: string) => onSessionRename(session.id, newName) : undefined}
                      provider={session.provider}
                      model={session.model}
                      messageCount={session.messageCount}
                      isProcessing={session.isProcessing}
                      hasUnread={session.hasUnread}
                      hasPendingPrompt={session.hasPendingPrompt}
                      sessionType={session.sessionType}
                    />
                  );
                })}
              </CollapsibleGroup>
            );
          })
        )}
      </div>
    </div>
  );
};

// Helper to compare arrays by value (for loadedSessionIds, collapsedGroups)
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Helper to compare Sets by value
function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

// Memoize SessionHistory to prevent re-renders when props haven't meaningfully changed
// This is critical for performance during typing in AIInput
export const SessionHistory = React.memo(SessionHistoryComponent, (prevProps, nextProps) => {
  // Only re-render if meaningful props changed
  if (prevProps.workspacePath !== nextProps.workspacePath) return false;
  if (prevProps.activeSessionId !== nextProps.activeSessionId) return false;
  if (prevProps.refreshTrigger !== nextProps.refreshTrigger) return false;
  if (prevProps.sortOrder !== nextProps.sortOrder) return false;
  if (prevProps.mode !== nextProps.mode) return false;

  // Compare arrays by value
  if (!arraysEqual(prevProps.loadedSessionIds ?? [], nextProps.loadedSessionIds ?? [])) return false;
  if (!arraysEqual(prevProps.collapsedGroups, nextProps.collapsedGroups)) return false;

  // Compare Sets by value
  if (!setsEqual(prevProps.processingSessions ?? new Set(), nextProps.processingSessions ?? new Set())) return false;
  if (!setsEqual(prevProps.unreadSessions ?? new Set(), nextProps.unreadSessions ?? new Set())) return false;
  if (!setsEqual(prevProps.pendingPromptSessions ?? new Set(), nextProps.pendingPromptSessions ?? new Set())) return false;

  // Compare renamed/updated session objects
  const prevRenamed = prevProps.renamedSession;
  const nextRenamed = nextProps.renamedSession;
  if (prevRenamed?.id !== nextRenamed?.id || prevRenamed?.title !== nextRenamed?.title) return false;

  const prevUpdated = prevProps.updatedSession;
  const nextUpdated = nextProps.updatedSession;
  if (prevUpdated?.id !== nextUpdated?.id || prevUpdated?.timestamp !== nextUpdated?.timestamp) return false;

  // Callback functions are assumed stable (wrapped in useCallback at parent)
  // If they're equal by reference, that's a bonus, but we don't require it

  return true; // Props are equal, skip re-render
});
