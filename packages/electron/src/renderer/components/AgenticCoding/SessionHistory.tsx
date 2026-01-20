import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { CollapsibleGroup } from './CollapsibleGroup';
import { SessionListItem } from './SessionListItem';
import { WorktreeGroup } from './WorktreeGroup';
import { WorktreeSingle } from './WorktreeSingle';
import { ArchiveProgress } from './ArchiveProgress';
import { IndexBuildDialog } from './IndexBuildDialog';
import { getTimeGroupKey, TimeGroupKey } from '../../utils/dateFormatting';
import { getFileName } from '../../utils/pathUtils';
import { KeyboardShortcuts, getShortcutDisplay } from '../../../shared/KeyboardShortcuts';
import {
  sessionListFullAtom,
  sessionListLoadingAtom,
  showArchivedSessionsAtom,
  refreshSessionListAtom,
  updateSessionFullAtom,
  removeSessionFullAtom,
  type SessionListItem as SessionListItemType,
} from '../../store';
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
  isPinned?: boolean; // Whether this session is pinned to the top
  worktree_id?: string | null; // Associated worktree ID if this is a worktree session
  parentSessionId?: string; // ID of parent session if this is a branch
  branchPointMessageId?: number; // Message ID where this branch diverged
  branchedAt?: number; // Timestamp when this session was branched
}

interface WorktreeData {
  id: string;
  name: string;
  displayName?: string;
  path: string;
  branch: string;
  base_branch?: string;
  createdAt?: number;
  isPinned?: boolean; // Whether this worktree is pinned to the top
  isArchived?: boolean; // Whether this worktree is archived
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
  // Note: processingSessions, unreadSessions, pendingPromptSessions are now deprecated
  // SessionListItem subscribes directly to Jotai atoms for these states
  renamedSession?: { id: string; title: string } | null; // Session that was just renamed
  renamedWorktree?: { worktreeId: string; displayName: string } | null; // Worktree that just got a display name
  updatedSession?: { id: string; timestamp: number } | null; // Session that was just updated
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete?: (sessionId: string) => void;
  onSessionArchive?: (sessionId: string) => void; // Callback when session is archived (to close tab)
  onSessionRename?: (sessionId: string, newName: string) => void; // Callback when session is renamed
  onSessionBranch?: (sessionId: string) => void; // Callback when user wants to branch a session
  onNewSession?: () => void;
  onNewTerminal?: () => void; // Callback for creating a new terminal session
  onNewWorktreeSession?: () => void; // Callback for creating new worktree session
  onAddSessionToWorktree?: (worktreeId: string) => void; // Callback for adding session to existing worktree
  onAddTerminalToWorktree?: (worktreeId: string) => void; // Callback for adding terminal to existing worktree
  onWorktreeFilesMode?: (worktreeId: string) => void; // Callback to open Files mode for a worktree
  onWorktreeChangesMode?: (worktreeId: string) => void; // Callback to open Changes mode for a worktree
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
  renamedSession = null,
  renamedWorktree = null,
  updatedSession = null,
  onSessionSelect,
  onSessionDelete,
  onSessionArchive,
  onSessionRename,
  onSessionBranch,
  onNewSession,
  onNewTerminal,
  onNewWorktreeSession,
  onAddSessionToWorktree,
  onAddTerminalToWorktree,
  onWorktreeFilesMode,
  onWorktreeChangesMode,
  onImportSessions,
  onOpenQuickSearch,
  collapsedGroups,
  onCollapsedGroupsChange,
  sortOrder: controlledSortOrder,
  onSortOrderChange,
  refreshTrigger,
  mode = 'agent'
}) => {
  // === Atom subscriptions for session list ===
  const allSessionsFromAtom = useAtomValue(sessionListFullAtom);
  const atomLoading = useAtomValue(sessionListLoadingAtom);
  const showArchivedAtom = useAtomValue(showArchivedSessionsAtom);
  const setShowArchivedAtom = useSetAtom(showArchivedSessionsAtom);
  const refreshSessions = useSetAtom(refreshSessionListAtom);
  const updateSessionInAtom = useSetAtom(updateSessionFullAtom);
  const removeSessionFromAtom = useSetAtom(removeSessionFullAtom);

  // Convert atom sessions to local SessionItem format
  // Note: isProcessing, hasUnread, hasPendingPrompt are no longer set here
  // SessionListItem subscribes directly to Jotai atoms for these states
  const allSessions = useMemo<SessionItem[]>(() => {
    return allSessionsFromAtom.map((s) => ({
      id: s.id,
      title: s.title || s.name || 'Untitled Session',
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      provider: s.provider || 'claude',
      model: s.model,
      sessionType: s.sessionType || 'chat',
      messageCount: s.messageCount || 0,
      isArchived: s.isArchived || false,
      isPinned: s.isPinned || false,
      worktree_id: s.worktreeId || null,
    }));
  }, [allSessionsFromAtom]);

  const [sessions, setSessions] = useState<SessionItem[]>([]); // Filtered sessions to display
  const loading = atomLoading && allSessions.length === 0; // Only show loading on initial load
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Use controlled sort order from props if provided, otherwise use internal state
  const [internalSortOrder, setInternalSortOrder] = useState<'updated' | 'created'>('updated');
  const sortBy = controlledSortOrder ?? internalSortOrder;
  const setSortBy = onSortOrderChange ?? setInternalSortOrder;
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const [newDropdownOpen, setNewDropdownOpen] = useState(false);
  const [contentSearchTriggered, setContentSearchTriggered] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  // Use atom for showArchived state
  const showArchived = showArchivedAtom;
  const setShowArchived = setShowArchivedAtom;
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null); // For shift+click range selection
  const [worktreeCache, setWorktreeCache] = useState<Map<string, WorktreeWithStatus>>(new Map()); // Cache worktree data

  // FTS index build dialog state
  const [showIndexDialog, setShowIndexDialog] = useState(false);
  const [indexMessageCount, setIndexMessageCount] = useState(0);
  const [isIndexBuilding, setIsIndexBuilding] = useState(false);
  const [pendingSearchQuery, setPendingSearchQuery] = useState<string | null>(null); // Query to run after index build

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

  // Load all sessions - now just triggers atom refresh
  // The atom handles IPC calls and state updates
  const loadAllSessions = useCallback(async () => {
    setError(null);
    try {
      await refreshSessions();
      // Restore scroll position after update
      requestAnimationFrame(() => {
        if (scrollContainerRef.current && scrollPositionRef.current > 0) {
          scrollContainerRef.current.scrollTop = scrollPositionRef.current;
        }
      });
    } catch (err) {
      console.error('[SessionHistory] Failed to load sessions:', err);
      setError('Failed to load sessions');
    }
  }, [refreshSessions]);

  // Execute the actual search query
  const executeSearch = useCallback(async (query: string) => {
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
          searchResults = searchResults.filter((session: SessionItem) => !session.worktree_id);
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

  // Search message content in database (heavy operation)
  // Checks if FTS index exists and prompts user to build if needed for large databases
  const searchMessageContent = useCallback(async (query: string) => {
    try {
      // Check FTS index status before searching
      const { indexExists, messageCount } = await window.electronAPI.ai.getFtsIndexStatus(workspacePath);

      // If index doesn't exist and database is large, prompt user to build
      if (!indexExists && messageCount > 5000) {
        setIndexMessageCount(messageCount);
        setPendingSearchQuery(query);
        setShowIndexDialog(true);
        return;
      }

      // Otherwise proceed with search
      await executeSearch(query);
    } catch (err) {
      console.error('[SessionHistory] Failed to search sessions:', err);
      setError('Failed to search sessions');
    }
  }, [workspacePath, executeSearch]);

  // Load all sessions on mount and when refreshTrigger or showArchived changes
  useEffect(() => {
    loadAllSessions();
  }, [loadAllSessions, refreshTrigger, showArchived]);

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

  // Handle user choosing to build FTS index
  const handleBuildIndex = useCallback(async () => {
    setIsIndexBuilding(true);
    try {
      const result = await window.electronAPI.ai.buildFtsIndex();
      if (result.success) {
        console.log('[SessionHistory] FTS index built successfully');
        // Run the pending search now that index is built
        if (pendingSearchQuery) {
          await executeSearch(pendingSearchQuery);
        }
      } else {
        console.error('[SessionHistory] Failed to build FTS index:', result.error);
        setError('Failed to build search index');
      }
    } catch (err) {
      console.error('[SessionHistory] Failed to build FTS index:', err);
      setError('Failed to build search index');
    } finally {
      setIsIndexBuilding(false);
      setShowIndexDialog(false);
      setPendingSearchQuery(null);
    }
  }, [pendingSearchQuery, executeSearch]);

  // Handle user skipping index build
  const handleSkipIndex = useCallback(async () => {
    setShowIndexDialog(false);
    // Still run the search, just slower
    if (pendingSearchQuery) {
      await executeSearch(pendingSearchQuery);
    }
    setPendingSearchQuery(null);
  }, [pendingSearchQuery, executeSearch]);

  // Note: Visual indicators (processing, unread, pending) are now applied in the
  // allSessions useMemo above, which depends on the status props. The filtering
  // effect updates `sessions` whenever `allSessions` changes, so no separate
  // effect is needed.

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

  // Update worktree display name when first session in worktree is named
  useEffect(() => {
    if (renamedWorktree) {
      setWorktreeCache(prev => {
        const existing = prev.get(renamedWorktree.worktreeId);
        if (existing) {
          const updated = new Map(prev);
          updated.set(renamedWorktree.worktreeId, {
            ...existing,
            displayName: renamedWorktree.displayName
          });
          return updated;
        }
        return prev;
      });
    }
  }, [renamedWorktree]);

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
      // Update atom state immediately for instant feedback (optimistic update)
      // If not showing archived, this effectively removes it from view
      updateSessionInAtom({ id: sessionId, isArchived: true });
      // Also remove from filtered list for immediate feedback
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      // Notify parent to close the tab if open
      if (onSessionArchive) {
        onSessionArchive(sessionId);
      }
    } catch (err) {
      console.error('[SessionHistory] Failed to archive session:', err);
    }
  };

  const handleArchiveWorktree = async (worktreeId: string) => {
    try {
      // Get sessions for this worktree to notify parent to close tabs
      const worktreeSessions = allSessions.filter(s => s.worktree_id === worktreeId);

      // Archive the worktree (this queues the cleanup task)
      const result = await window.electronAPI.worktreeArchive(worktreeId, workspacePath);

      if (result.success) {
        // Remove worktree sessions from atom state immediately (optimistic update)
        worktreeSessions.forEach(session => {
          removeSessionFromAtom(session.id);
        });
        // Also remove from filtered list for immediate feedback
        setSessions(prev => prev.filter(s => s.worktree_id !== worktreeId));

        // Notify parent to close tabs for archived sessions
        worktreeSessions.forEach(session => {
          if (onSessionArchive) {
            onSessionArchive(session.id);
          }
        });

        // Remove from worktree cache
        setWorktreeCache(prev => {
          const newCache = new Map(prev);
          newCache.delete(worktreeId);
          return newCache;
        });
      } else {
        console.error('[SessionHistory] Failed to archive worktree:', result.error);
      }
    } catch (err) {
      console.error('[SessionHistory] Failed to archive worktree:', err);
    }
  };

  const handleUnarchiveSession = async (sessionId: string) => {
    try {
      await window.electronAPI.invoke('sessions:update-metadata', sessionId, { isArchived: false });
      // Update atom state immediately for instant feedback (optimistic update)
      updateSessionInAtom({ id: sessionId, isArchived: false });
      // Also update filtered list for immediate feedback
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, isArchived: false } : s));
    } catch (err) {
      console.error('[SessionHistory] Failed to unarchive session:', err);
    }
  };

  const toggleShowArchived = () => {
    setShowArchived(!showArchived);
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
        // Get visual order from grouped items (flattened) - only include regular sessions, not worktree sessions
        const visualOrderIds = groupKeys.flatMap(key =>
          groupedItems[key]
            .filter(item => item.type === 'session')
            .map(item => (item as { type: 'session'; session: SessionItem }).session.id)
        );

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
    // Update atom state for each archived session
    selectedSessionIds.forEach(sessionId => {
      updateSessionInAtom({ id: sessionId, isArchived: true });
    });
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
    // Update atom state for each unarchived session
    selectedSessionIds.forEach(sessionId => {
      updateSessionInAtom({ id: sessionId, isArchived: false });
    });
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

  // Toggle pin status for a session
  const handleSessionPinToggle = useCallback(async (sessionId: string, isPinned: boolean) => {
    try {
      await window.electronAPI.invoke('sessions:update-pinned', sessionId, isPinned);
      // Update atom state (optimistic update)
      updateSessionInAtom({ id: sessionId, isPinned });
      // Also update filtered list for immediate feedback
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, isPinned } : s));
    } catch (error) {
      console.error('[SessionHistory] Failed to toggle session pin:', error);
    }
  }, [updateSessionInAtom]);

  // Toggle pin status for a worktree
  const handleWorktreePinToggle = useCallback(async (worktreeId: string, isPinned: boolean) => {
    try {
      await window.electronAPI.invoke('worktree:update-pinned', worktreeId, isPinned);
      // Update worktree cache
      setWorktreeCache(prev => {
        const updated = new Map(prev);
        const worktree = updated.get(worktreeId);
        if (worktree) {
          updated.set(worktreeId, { ...worktree, isPinned });
        }
        return updated;
      });
    } catch (error) {
      console.error('[SessionHistory] Failed to toggle worktree pin:', error);
    }
  }, []);

  // Rename a worktree
  const handleWorktreeRename = useCallback(async (worktreeId: string, newName: string) => {
    try {
      await window.electronAPI.invoke('worktree:update-display-name', worktreeId, newName);
      // Update worktree cache
      setWorktreeCache(prev => {
        const updated = new Map(prev);
        const worktree = updated.get(worktreeId);
        if (worktree) {
          updated.set(worktreeId, { ...worktree, displayName: newName });
        }
        return updated;
      });
    } catch (error) {
      console.error('[SessionHistory] Failed to rename worktree:', error);
    }
  }, []);

  const toggleSortDropdown = () => {
    setSortDropdownOpen(!sortDropdownOpen);
  };

  const selectSortOption = (option: 'updated' | 'created') => {
    setSortBy(option);
    setSortDropdownOpen(false);
  };

  const toggleNewDropdown = () => {
    setNewDropdownOpen(!newDropdownOpen);
  };

  // Handle new button click - if only one option available, trigger it directly
  const handleNewButtonClick = () => {
    const availableOptions = [onNewSession, onNewWorktreeSession, onNewTerminal].filter(Boolean);
    if (availableOptions.length === 1) {
      // Only one option available, trigger it directly
      if (onNewSession) onNewSession();
      else if (onNewWorktreeSession) onNewWorktreeSession();
      else if (onNewTerminal) onNewTerminal();
    } else {
      // Multiple options, show dropdown
      toggleNewDropdown();
    }
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (sortDropdownOpen && !target.closest('.session-history-sort-dropdown')) {
        setSortDropdownOpen(false);
      }
      if (newDropdownOpen && !target.closest('.session-history-new-dropdown')) {
        setNewDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [sortDropdownOpen, newDropdownOpen]);

  // Group worktree sessions by worktree_id and compute worktree timestamps
  const worktreeGroupsData = useMemo(() => {
    const groups = new Map<string, { sessions: SessionItem[]; timestamp: number }>();
    for (const session of sessions) {
      if (session.worktree_id) {
        const existing = groups.get(session.worktree_id);
        if (existing) {
          existing.sessions.push(session);
          // For 'updated', track the latest session update. For 'created', we'll use worktree.createdAt later
          if (sortBy === 'updated') {
            const sessionTimestamp = session.updatedAt || session.createdAt;
            existing.timestamp = Math.max(existing.timestamp, sessionTimestamp);
          }
        } else {
          // Initial timestamp (will be replaced with worktree.createdAt for 'created' sort)
          const initialTimestamp = sortBy === 'updated' ? (session.updatedAt || session.createdAt) : 0;
          groups.set(session.worktree_id, { sessions: [session], timestamp: initialTimestamp });
        }
      }
    }
    return groups;
  }, [sessions, sortBy]);

  // Get all worktree IDs for batch fetching
  const sortedWorktreeIds = useMemo(() => {
    return Array.from(worktreeGroupsData.keys());
  }, [worktreeGroupsData]);

  // Create unified list items that can be either a session or a worktree group
  type UnifiedListItem =
    | { type: 'session'; session: SessionItem; timestamp: number }
    | { type: 'worktree'; worktreeId: string; sessions: SessionItem[]; timestamp: number };

  // Build unified time-grouped data with both sessions and worktrees interleaved
  const groupedItems = useMemo(() => {
    const timestampField = sortBy === 'updated' ? 'updatedAt' : 'createdAt';
    const items: UnifiedListItem[] = [];
    const pinnedItems: UnifiedListItem[] = [];

    // Add regular sessions (those without worktree_id)
    for (const session of sessions) {
      if (!session.worktree_id) {
        const timestamp = timestampField === 'updatedAt' ? (session.updatedAt || session.createdAt) : session.createdAt;
        const item = { type: 'session' as const, session, timestamp };

        if (session.isPinned) {
          pinnedItems.push(item);
        } else {
          items.push(item);
        }
      }
    }

    // Add worktree groups as single items
    for (const [worktreeId, data] of worktreeGroupsData) {
      // For 'created' sort, use the worktree's actual creation time, not the latest session time
      let timestamp = data.timestamp;
      if (sortBy === 'created') {
        const worktreeData = worktreeCache.get(worktreeId);
        timestamp = worktreeData?.createdAt || 0;
      }
      const item = { type: 'worktree' as const, worktreeId, sessions: data.sessions, timestamp };

      const worktreeData = worktreeCache.get(worktreeId);
      if (worktreeData?.isPinned) {
        pinnedItems.push(item);
      } else {
        items.push(item);
      }
    }

    // Group non-pinned items into time buckets
    const groups: Record<TimeGroupKey, UnifiedListItem[]> = {
      'Today': [],
      'Yesterday': [],
      'This Week': [],
      'Last Week': [],
      'This Month': [],
      'Last Month': [],
      'Older': []
    };

    for (const item of items) {
      const groupKey = getTimeGroupKey(item.timestamp);
      groups[groupKey].push(item);
    }

    // Sort items within each group by timestamp (newest first)
    for (const groupKey of Object.keys(groups) as TimeGroupKey[]) {
      groups[groupKey].sort((a, b) => b.timestamp - a.timestamp);
    }

    // Sort pinned items by timestamp (newest first)
    pinnedItems.sort((a, b) => b.timestamp - a.timestamp);

    // If we have pinned items, add them as a "Pinned" group at the beginning
    const result: Record<string, UnifiedListItem[]> = {};
    if (pinnedItems.length > 0) {
      result['Pinned'] = pinnedItems;
    }

    // Add time-based groups
    for (const [groupKey, groupItems] of Object.entries(groups)) {
      if (groupItems.length > 0) {
        result[groupKey] = groupItems;
      }
    }

    return result as Record<TimeGroupKey | 'Pinned', UnifiedListItem[]>;
  }, [sessions, worktreeGroupsData, sortBy, worktreeCache]);

  const groupKeys = Object.keys(groupedItems) as (TimeGroupKey | 'Pinned')[];

  // Batch fetch all worktree data when sortedWorktreeIds changes (prevents N+1 query problem)
  useEffect(() => {
    const missingWorktreeIds = sortedWorktreeIds.filter(id => !worktreeCache.has(id));

    if (missingWorktreeIds.length === 0) {
      return;
    }

    const fetchBatch = async () => {
      try {
        const result = await window.electronAPI.invoke('worktree:get-batch', missingWorktreeIds);

        if (result.success && result.worktrees) {
          // Update cache with all fetched worktrees at once
          setWorktreeCache(prev => {
            const updated = new Map(prev);
            for (const [worktreeId, worktreeData] of Object.entries(result.worktrees)) {
              updated.set(worktreeId, worktreeData as WorktreeWithStatus);
            }
            return updated;
          });
        }
      } catch (err) {
        console.error('[SessionHistory] Failed to batch fetch worktrees:', err);
      }
    };

    fetchBatch();
  }, [sortedWorktreeIds, worktreeCache]);

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
            {(onNewSession || onNewWorktreeSession || onNewTerminal) && (
              <div className="session-history-new-dropdown">
                <button
                  className="session-history-new-button"
                  data-testid="new-dropdown-button"
                  onClick={handleNewButtonClick}
                  title="Create new..."
                  aria-label="Create new session, worktree, or terminal"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
                {newDropdownOpen && (
                  <div className="session-history-new-menu">
                    {onNewSession && (
                      <button
                        className="session-history-new-option"
                        data-testid="new-session-button"
                        onClick={() => { onNewSession(); setNewDropdownOpen(false); }}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                        <span>New Session</span>
                        <span className="session-history-new-option-shortcut">{getShortcutDisplay(KeyboardShortcuts.file.newSession)}</span>
                      </button>
                    )}
                    {onNewWorktreeSession && (
                      <button
                        className="session-history-new-option"
                        data-testid="new-worktree-session-button"
                        onClick={() => { onNewWorktreeSession(); setNewDropdownOpen(false); }}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M5 13v-2.5a1.5 1.5 0 0 1 1.5-1.5h3"/>
                          <path d="M9.5 9V4.5"/>
                          <circle cx="5" cy="4.5" r="1.5"/>
                          <circle cx="9.5" cy="4.5" r="1.5"/>
                          <path d="M5 6v2.5a1.5 1.5 0 0 0 1.5 1.5"/>
                          <path d="M12 7v4M10 9h4"/>
                        </svg>
                        <span>New Worktree</span>
                      </button>
                    )}
                    {onNewTerminal && (
                      <button
                        className="session-history-new-option"
                        data-testid="new-terminal-button"
                        onClick={() => { onNewTerminal(); setNewDropdownOpen(false); }}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M3 5L7 9L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M9 13H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                        <span>New Terminal</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
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
          <div className="session-history-header-buttons">
            {(onNewSession || onNewWorktreeSession || onNewTerminal) && (
              <div className="session-history-new-dropdown">
                <button
                  className="session-history-new-button"
                  data-testid="new-dropdown-button"
                  onClick={handleNewButtonClick}
                  title="Create new..."
                  aria-label="Create new session, worktree, or terminal"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
                {newDropdownOpen && (
                  <div className="session-history-new-menu">
                    {onNewSession && (
                      <button
                        className="session-history-new-option"
                        data-testid="new-session-button"
                        onClick={() => { onNewSession(); setNewDropdownOpen(false); }}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                        <span>New Session</span>
                        <span className="session-history-new-option-shortcut">{getShortcutDisplay(KeyboardShortcuts.file.newSession)}</span>
                      </button>
                    )}
                    {onNewWorktreeSession && (
                      <button
                        className="session-history-new-option"
                        data-testid="new-worktree-session-button"
                        onClick={() => { onNewWorktreeSession(); setNewDropdownOpen(false); }}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M5 13v-2.5a1.5 1.5 0 0 1 1.5-1.5h3"/>
                          <path d="M9.5 9V4.5"/>
                          <circle cx="5" cy="4.5" r="1.5"/>
                          <circle cx="9.5" cy="4.5" r="1.5"/>
                          <path d="M5 6v2.5a1.5 1.5 0 0 0 1.5 1.5"/>
                          <path d="M12 7v4M10 9h4"/>
                        </svg>
                        <span>New Worktree</span>
                      </button>
                    )}
                    {onNewTerminal && (
                      <button
                        className="session-history-new-option"
                        data-testid="new-terminal-button"
                        onClick={() => { onNewTerminal(); setNewDropdownOpen(false); }}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M3 5L7 9L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M9 13H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                        <span>New Terminal</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
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
            {(onNewSession || onNewWorktreeSession) && (
              <div className="session-history-new-dropdown">
                <button
                  className="session-history-new-button"
                  data-testid="new-dropdown-button"
                  onClick={handleNewButtonClick}
                  title="Create new..."
                  aria-label="Create new session or worktree"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
                {newDropdownOpen && (
                  <div className="session-history-new-menu">
                    {onNewSession && (
                      <button
                        className="session-history-new-option"
                        data-testid="new-session-button"
                        onClick={() => { onNewSession(); setNewDropdownOpen(false); }}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                        <span>New Session</span>
                        <span className="session-history-new-option-shortcut">{getShortcutDisplay(KeyboardShortcuts.file.newSession)}</span>
                      </button>
                    )}
                    {onNewWorktreeSession && (
                      <button
                        className="session-history-new-option"
                        data-testid="new-worktree-session-button"
                        onClick={() => { onNewWorktreeSession(); setNewDropdownOpen(false); }}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M5 13v-2.5a1.5 1.5 0 0 1 1.5-1.5h3"/>
                          <path d="M9.5 9V4.5"/>
                          <circle cx="5" cy="4.5" r="1.5"/>
                          <circle cx="9.5" cy="4.5" r="1.5"/>
                          <path d="M5 6v2.5a1.5 1.5 0 0 0 1.5 1.5"/>
                          <path d="M12 7v4M10 9h4"/>
                        </svg>
                        <span>New Worktree</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
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
          {(onNewSession || onNewWorktreeSession || onNewTerminal) && (
            <div className="session-history-new-dropdown">
              <button
                className="session-history-new-button"
                data-testid="new-dropdown-button"
                onClick={handleNewButtonClick}
                title="Create new..."
                aria-label="Create new session, worktree, or terminal"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
              {newDropdownOpen && (
                <div className="session-history-new-menu">
                  {onNewSession && (
                    <button
                      className="session-history-new-option"
                      data-testid="new-session-button"
                      onClick={() => { onNewSession(); setNewDropdownOpen(false); }}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                      <span>New Session</span>
                      <span className="session-history-new-option-shortcut">{getShortcutDisplay(KeyboardShortcuts.file.newSession)}</span>
                    </button>
                  )}
                  {onNewWorktreeSession && (
                    <button
                      className="session-history-new-option"
                      data-testid="new-worktree-session-button"
                      onClick={() => { onNewWorktreeSession(); setNewDropdownOpen(false); }}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M5 13v-2.5a1.5 1.5 0 0 1 1.5-1.5h3"/>
                        <path d="M9.5 9V4.5"/>
                        <circle cx="5" cy="4.5" r="1.5"/>
                        <circle cx="9.5" cy="4.5" r="1.5"/>
                        <path d="M5 6v2.5a1.5 1.5 0 0 0 1.5 1.5"/>
                        <path d="M12 7v4M10 9h4"/>
                      </svg>
                      <span>New Worktree</span>
                    </button>
                  )}
                  {onNewTerminal && (
                    <button
                      className="session-history-new-option"
                      data-testid="new-terminal-button"
                      onClick={() => { onNewTerminal(); setNewDropdownOpen(false); }}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M3 5L7 9L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M9 13H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                      <span>New Terminal</span>
                    </button>
                  )}
                </div>
              )}
            </div>
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
          <>
            {/* Unified time groups with interleaved sessions and worktrees */}
            {groupKeys.map(groupKey => {
              const items = groupedItems[groupKey];
              const isExpanded = !collapsedGroups.includes(groupKey);

              return (
                <CollapsibleGroup
                  key={groupKey}
                  title={groupKey}
                  isExpanded={isExpanded}
                  onToggle={() => handleToggleGroup(groupKey)}
                  count={items.length}
                >
                  {items.map(item => {
                    if (item.type === 'worktree') {
                      const worktreeData = worktreeCache.get(item.worktreeId);
                      const isWorktreeExpanded = !collapsedGroups.includes(`worktree:${item.worktreeId}`);

                      return (
                        <WorktreeGroup
                          key={`worktree-${item.worktreeId}`}
                          worktree={worktreeData || { id: item.worktreeId, name: 'Loading...', path: '', branch: '' }}
                          gitStatus={worktreeData?.gitStatus}
                          sessions={item.sessions}
                          activeSessionId={activeSessionId}
                          isExpanded={isWorktreeExpanded}
                          onToggle={() => handleToggleGroup(`worktree:${item.worktreeId}`)}
                          onSessionSelect={onSessionSelect}
                          onAddSession={onAddSessionToWorktree || (() => {})}
                          onAddTerminal={onAddTerminalToWorktree}
                          onSessionDelete={onSessionDelete ? handleDeleteSession : undefined}
                          onSessionArchive={handleArchiveSession}
                          onWorktreePinToggle={handleWorktreePinToggle}
                          onWorktreeArchive={handleArchiveWorktree}
                          onWorktreeRename={handleWorktreeRename}
                          onSessionPinToggle={handleSessionPinToggle}
                          onSessionRename={onSessionRename}
                          onFilesMode={onWorktreeFilesMode}
                          onChangesMode={onWorktreeChangesMode}
                        />
                      );
                    } else {
                      const session = item.session;
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
                          isPinned={session.isPinned}
                          isSelected={selectedSessionIds.has(session.id)}
                          sortBy={sortBy}
                          onClick={(e) => handleSessionClick(session.id, e)}
                          onDelete={onSessionDelete ? () => handleDeleteSession(session.id) : undefined}
                          onArchive={() => handleArchiveSession(session.id)}
                          onUnarchive={() => handleUnarchiveSession(session.id)}
                          onRename={onSessionRename ? (newName: string) => onSessionRename(session.id, newName) : undefined}
                          onPinToggle={(isPinned) => handleSessionPinToggle(session.id, isPinned)}
                          onBranch={onSessionBranch ? () => onSessionBranch(session.id) : undefined}
                          provider={session.provider}
                          model={session.model}
                          messageCount={session.messageCount}
                          isProcessing={session.isProcessing}
                          hasUnread={session.hasUnread}
                          hasPendingPrompt={session.hasPendingPrompt}
                          sessionType={session.sessionType}
                          parentSessionId={session.parentSessionId}
                          branchedAt={session.branchedAt}
                        />
                      );
                    }
                  })}
                </CollapsibleGroup>
              );
            })}
          </>
        )}
      </div>
      <ArchiveProgress />
      <IndexBuildDialog
        isOpen={showIndexDialog}
        messageCount={indexMessageCount}
        isBuilding={isIndexBuilding}
        onBuild={handleBuildIndex}
        onSkip={handleSkipIndex}
      />
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

// Memoize SessionHistory to prevent re-renders when props haven't meaningfully changed
// This is critical for performance during typing in AIInput
// Note: processingSessions, unreadSessions, pendingPromptSessions are no longer compared here
// SessionListItem subscribes directly to Jotai atoms for these states
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
