import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { CollapsibleGroup } from './CollapsibleGroup';
import { SessionListItem } from './SessionListItem';
import { WorkstreamGroup } from './WorkstreamGroup';
import { BlitzGroup } from './BlitzGroup';
import { SuperLoopGroup } from './SuperLoopGroup';
import { NewSuperLoopDialog } from './NewSuperLoopDialog';
import { ArchiveProgress } from './ArchiveProgress';
import { IndexBuildDialog } from './IndexBuildDialog';
import { ArchiveWorktreeDialog } from '../AgentMode/ArchiveWorktreeDialog';
import { useArchiveWorktreeDialog } from '../../hooks/useArchiveWorktreeDialog';
import { getTimeGroupKey, TimeGroupKey } from '../../utils/dateFormatting';
import { getFileName } from '../../utils/pathUtils';
import { KeyboardShortcuts, getShortcutDisplay } from '../../../shared/KeyboardShortcuts';
import { MaterialSymbol } from '@nimbalyst/runtime';
import {
  sessionListRootAtom,
  sessionListLoadingAtom,
  showArchivedSessionsAtom,
  refreshSessionListAtom,
  updateSessionStoreAtom,
  removeSessionFullAtom,
  sessionRegistryAtom,
  sessionOrChildProcessingAtom,
  sessionUnreadAtom,
  sessionPendingPromptAtom,
  groupSessionStatusAtom,
  viewModeAtom,
  setViewModeAtom,
  worktreeActiveSessionAtom,
  type SessionListItem as SessionListItemType,
} from '../../store';
import { alphaFeatureEnabledAtom, worktreesFeatureAvailableAtom } from '../../store/atoms/appSettings';
import { superLoopListAtom, upsertSuperLoopAtom, removeSuperLoopAtom } from '../../store/atoms/superLoop';
import { useSuperLoopDialog } from '../../hooks/useSuperLoop';
import type { SuperLoop } from '../../../shared/types/superLoop';
import { store } from '@nimbalyst/runtime/store';
import './SessionHistory.css';

interface SessionItem {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  provider: string;
  model?: string;
  sessionType?: 'chat' | 'planning' | 'coding' | 'terminal' | 'blitz';
  messageCount: number;
  isProcessing?: boolean;
  hasUnread?: boolean;
  hasPendingPrompt?: boolean;
  isArchived?: boolean;
  isPinned?: boolean; // Whether this session is pinned to the top
  worktree_id?: string | null; // Associated worktree ID if this is a worktree session
  childCount?: number; // Number of child sessions (workstream indicator)
  parentSessionId?: string | null; // Parent session ID for hierarchical workstreams
  projectPath?: string; // Workspace path for drag-drop validation
  uncommittedCount?: number; // Number of uncommitted files in this session
  // Branch tracking - SEPARATE from hierarchical parentSessionId
  branchedFromSessionId?: string; // ID of session this was forked from
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

interface BlitzData {
  id: string;
  prompt: string;
  displayName?: string;
  isPinned?: boolean;
  isArchived?: boolean;
  createdAt?: number;
}

interface WorktreeWithStatus extends WorktreeData {
  gitStatus?: {
    ahead?: number;
    behind?: number;
    uncommitted?: boolean;
  };
}

// Search filter options for content search
type SearchTimeRange = '7d' | '30d' | '90d' | 'all';
type SearchDirection = 'all' | 'input' | 'output';

interface SearchFilters {
  timeRange: SearchTimeRange;
  direction: SearchDirection;
}

const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  timeRange: '30d',  // Default to last 30 days for performance
  direction: 'all',
};

const TIME_RANGE_LABELS: Record<SearchTimeRange, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  'all': 'All time',
};

const DIRECTION_LABELS: Record<SearchDirection, string> = {
  'all': 'All messages',
  'input': 'User prompts only',
  'output': 'Assistant only',
};

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
  onChildSessionSelect?: (childSessionId: string, parentId: string, parentType: 'workstream' | 'worktree') => void;
  onSessionDelete?: (sessionId: string) => void;
  onSessionArchive?: (sessionId: string) => void; // Callback when session is archived (to close tab)
  onSessionRename?: (sessionId: string, newName: string) => void; // Callback when session is renamed
  onSessionBranch?: (sessionId: string) => void; // Callback when user wants to branch a session
  onNewSession?: () => void;
  onNewTerminal?: () => void; // Callback for creating a new terminal session
  onNewWorktreeSession?: () => void; // Callback for creating new worktree session
  onNewBlitz?: () => void; // Callback for creating a new blitz (multi-worktree prompt)
  isGitRepo?: boolean; // Whether the workspace is a git repository (needed for worktree feature)
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

// Component for rendering session status indicators in card view
// Uses same MaterialSymbol icons as SessionListItem for consistency
const SessionCardStatus: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const isProcessing = useAtomValue(sessionOrChildProcessingAtom(sessionId));
  const hasUnread = useAtomValue(sessionUnreadAtom(sessionId));
  const hasPendingPrompt = useAtomValue(sessionPendingPromptAtom(sessionId));

  // Priority: processing > pending prompt > unread (same as SessionListItem)
  if (isProcessing) {
    return (
      <div className="session-card-status-indicator processing flex items-center justify-center text-[var(--nim-primary)]" title="Processing">
        <MaterialSymbol icon="progress_activity" size={14} className="animate-spin" />
      </div>
    );
  }

  if (hasPendingPrompt) {
    return (
      <div className="session-card-status-indicator pending flex items-center justify-center text-[var(--nim-warning)] animate-pulse" title="Waiting for your response">
        <MaterialSymbol icon="help" size={14} />
      </div>
    );
  }

  if (hasUnread) {
    return (
      <div className="session-card-status-indicator unread flex items-center justify-center text-[var(--nim-primary)]" title="Unread response">
        <MaterialSymbol icon="circle" size={8} fill />
      </div>
    );
  }

  return null;
};

// Component for rendering worktree/workstream status indicators (checks all child sessions)
// Uses groupSessionStatusAtom to properly subscribe to processing/unread/pending state changes
// for all sessions in the group without violating React hooks rules.
// Uses same MaterialSymbol icons as SessionListItem for consistency.
const GroupCardStatus: React.FC<{ sessionIds: string[] }> = ({ sessionIds }) => {
  // Create a stable key for the atom family by sorting and serializing session IDs
  const sessionIdsKey = useMemo(() => JSON.stringify([...sessionIds].sort()), [sessionIds]);

  // Subscribe to the aggregated status atom - this properly reacts to state changes
  const { hasPendingInteractivePrompt, hasProcessing, hasPendingPrompt, hasUnread } = useAtomValue(groupSessionStatusAtom(sessionIdsKey));

  // Priority: interactive prompt > processing > pending prompt > unread (same as SessionListItem)
  if (hasPendingInteractivePrompt) {
    return (
      <div className="session-card-status-indicator waiting-for-input flex items-center justify-center text-[var(--nim-warning)] animate-pulse" title="Waiting for your response">
        <MaterialSymbol icon="contact_support" size={14} />
      </div>
    );
  }

  if (hasProcessing) {
    return (
      <div className="session-card-status-indicator processing flex items-center justify-center text-[var(--nim-primary)]" title="Processing">
        <MaterialSymbol icon="progress_activity" size={14} className="animate-spin" />
      </div>
    );
  }

  if (hasPendingPrompt) {
    return (
      <div className="session-card-status-indicator pending flex items-center justify-center text-[var(--nim-warning)] animate-pulse" title="Waiting for your response">
        <MaterialSymbol icon="help" size={14} />
      </div>
    );
  }

  if (hasUnread) {
    return (
      <div className="session-card-status-indicator unread flex items-center justify-center text-[var(--nim-primary)]" title="Unread response">
        <MaterialSymbol icon="circle" size={8} fill />
      </div>
    );
  }

  return null;
};

const SessionHistoryComponent: React.FC<SessionHistoryProps> = ({
  workspacePath,
  activeSessionId,
  loadedSessionIds = [],
  renamedSession = null,
  renamedWorktree = null,
  updatedSession = null,
  onSessionSelect,
  onChildSessionSelect,
  onSessionDelete,
  onSessionArchive,
  onSessionRename,
  onSessionBranch,
  onNewSession,
  onNewTerminal,
  onNewWorktreeSession,
  onNewBlitz,
  isGitRepo = false,
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
  // Use sessionListRootAtom to only show root sessions (not children of workstreams)
  const allSessionsFromAtom = useAtomValue(sessionListRootAtom);
  const atomLoading = useAtomValue(sessionListLoadingAtom);
  const showArchivedAtom = useAtomValue(showArchivedSessionsAtom);
  const setShowArchivedAtom = useSetAtom(showArchivedSessionsAtom);
  const refreshSessions = useSetAtom(refreshSessionListAtom);
  const updateSessionStore = useSetAtom(updateSessionStoreAtom);
  const removeSessionFromAtom = useSetAtom(removeSessionFullAtom);

  const isWorktreesAvailable = useAtomValue(worktreesFeatureAvailableAtom);
  const isSuperLoopsAlphaEnabled = useAtomValue(alphaFeatureEnabledAtom('super-loops'));
  const isSuperLoopsAvailable = isWorktreesAvailable && isSuperLoopsAlphaEnabled;

  // === Super Loop state ===
  const superLoops = useAtomValue(superLoopListAtom);
  const upsertSuperLoop = useSetAtom(upsertSuperLoopAtom);
  const removeSuperLoop = useSetAtom(removeSuperLoopAtom);
  const { openDialog: openSuperLoopDialog } = useSuperLoopDialog();

  // Get the session registry to look up parent session IDs
  const sessionRegistry = useAtomValue(sessionRegistryAtom);

  // Get the parent session ID of the active session (if it's a child)
  const activeSessionParentId = activeSessionId
    ? sessionRegistry.get(activeSessionId)?.parentSessionId ?? null
    : null;

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
      childCount: s.childCount || 0,
      parentSessionId: s.parentSessionId || null,
      projectPath: s.projectPath,
      uncommittedCount: s.uncommittedCount || 0,
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
  const [newDropdownPosition, setNewDropdownPosition] = useState<{ x: number; y: number } | null>(null);
  const newDropdownButtonRef = useRef<HTMLButtonElement>(null);
  const newDropdownMenuRef = useRef<HTMLDivElement>(null);
  const [contentSearchTriggered, setContentSearchTriggered] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  // Use atom for showArchived state
  const showArchived = showArchivedAtom;
  const setShowArchived = setShowArchivedAtom;
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null); // For shift+click range selection
  const [worktreeCache, setWorktreeCache] = useState<Map<string, WorktreeWithStatus>>(new Map()); // Cache worktree data
  const [workstreamChildrenCache, setWorkstreamChildrenCache] = useState<Map<string, SessionItem[]>>(new Map()); // Cache workstream children
  const [blitzCache, setBlitzCache] = useState<Map<string, BlitzData>>(new Map()); // Cache blitz data

  // View mode persisted via agentMode atoms
  const viewMode = useAtomValue(viewModeAtom);
  const setViewMode = useSetAtom(setViewModeAtom);

  // Alpha feature check for card mode
  const isCardModeEnabled = useAtomValue(alphaFeatureEnabledAtom('card-mode'));

  // FTS index build dialog state
  const [showIndexDialog, setShowIndexDialog] = useState(false);
  const [indexMessageCount, setIndexMessageCount] = useState(0);

  // Card view context menu state
  const [cardContextMenu, setCardContextMenu] = useState<{
    sessionId?: string;
    worktreeId?: string;
    type: 'session' | 'workstream' | 'worktree';
    x: number;
    y: number;
    isPinned?: boolean;
    isArchived?: boolean;
  } | null>(null);
  const cardContextMenuRef = useRef<HTMLDivElement>(null);

  // Card view inline rename state (for worktrees and sessions)
  const [renamingWorktreeId, setRenamingWorktreeId] = useState<string | null>(null);
  const [worktreeRenameValue, setWorktreeRenameValue] = useState('');
  const worktreeRenameInputRef = useRef<HTMLInputElement>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [sessionRenameValue, setSessionRenameValue] = useState('');
  const sessionRenameInputRef = useRef<HTMLInputElement>(null);
  const [isIndexBuilding, setIsIndexBuilding] = useState(false);
  const [pendingSearchQuery, setPendingSearchQuery] = useState<string | null>(null); // Query to run after index build
  const [searchFilters, setSearchFilters] = useState<SearchFilters>(DEFAULT_SEARCH_FILTERS);
  const [showSearchFilters, setShowSearchFilters] = useState(false);
  const searchFiltersRef = useRef<HTMLDivElement>(null);

  // Archive worktree dialog hook
  const {
    dialogState: archiveWorktreeDialogState,
    showDialog: showArchiveWorktreeDialog,
    closeDialog: closeArchiveWorktreeDialog,
    confirmArchive: confirmArchiveWorktree,
  } = useArchiveWorktreeDialog();

  // Track scroll position to restore after refresh
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [scrollContainerEl, setScrollContainerEl] = useState<HTMLDivElement | null>(null);
  const scrollContainerCallbackRef = useCallback((node: HTMLDivElement | null) => {
    scrollContainerRef.current = node;
    setScrollContainerEl(node);
  }, []);
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
  const executeSearch = useCallback(async (query: string, filters: SearchFilters = searchFilters) => {
    try {
      setIsSearching(true);
      setError(null);

      const result = await window.electronAPI.invoke('sessions:search', workspacePath, query.trim(), {
        includeArchived: showArchived,
        timeRange: filters.timeRange,
        direction: filters.direction,
      });

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
          worktree_id: s.worktreeId || null,
          childCount: s.childCount || 0,
          parentSessionId: s.parentSessionId || null,
          projectPath: s.projectPath,
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
  }, [workspacePath, showArchived, mode, searchFilters]);

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

  // Update uncommittedCount for affected sessions when commits are detected
  // This is more efficient than refreshing all sessions
  useEffect(() => {
    if (!workspacePath) return;

    const unsubscribe = window.electronAPI?.git?.onCommitDetected?.(
      async (data: { workspacePath: string; committedFiles: string[] }) => {
        if (data.workspacePath !== workspacePath) return;

        // Find which sessions owned the committed files and get their new counts
        try {
          const result = await window.electronAPI.invoke(
            'sessions:get-uncommitted-counts',
            workspacePath
          );
          if (result.success && result.counts) {
            const counts = result.counts as Record<string, number>;

            // Update session atoms with new counts (for root sessions)
            for (const [sessionId, count] of Object.entries(counts)) {
              updateSessionStore({ sessionId, updates: { uncommittedCount: count } });
            }

            // Also update workstream children cache
            setWorkstreamChildrenCache(prev => {
              const updated = new Map(prev);
              for (const [parentId, children] of prev.entries()) {
                const updatedChildren = children.map(child => ({
                  ...child,
                  uncommittedCount: counts[child.id] ?? child.uncommittedCount ?? 0,
                }));
                updated.set(parentId, updatedChildren);
              }
              return updated;
            });
          }
        } catch (error) {
          console.error('[SessionHistory] Failed to update uncommitted counts:', error);
        }
      }
    );

    return () => {
      unsubscribe?.();
    };
  }, [workspacePath, updateSessionStore]);

  // Session list refresh is now handled by centralized listener in sessionListListeners.ts
  // Components just read from sessionListAtom which updates automatically

  // Client-side title filtering (instant, no database query)
  // Note: Archived session filtering is handled by sessionListRootAtom based on showArchivedSessionsAtom
  useEffect(() => {
    // Reset content search trigger when query changes
    setContentSearchTriggered(false);

    // Filter out sessions that belong to worktrees (they're shown in WorktreeGroup instead)
    // But keep standalone worktree sessions that should appear as WorktreeSingle
    const sessionsToFilter = allSessions;

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

  // Auto-select first session when there's no active session
  // This ensures a session is always selected when switching to Agent mode
  useEffect(() => {
    if (!activeSessionId && sessions.length > 0 && onSessionSelect) {
      // Small delay to ensure AgentMode is fully mounted
      const timer = setTimeout(() => {
        console.log('[SessionHistory] Auto-selecting first session:', sessions[0].id);
        onSessionSelect(sessions[0].id);
      }, 100);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [activeSessionId, sessions, onSessionSelect]);

  // Function to trigger content search (database query for message content)
  const searchMessageContents = useCallback(() => {
    if (!searchQuery.trim() || contentSearchTriggered) {
      return; // Don't search if already triggered or no query
    }
    setContentSearchTriggered(true);
    searchMessageContent(searchQuery);
  }, [searchQuery, contentSearchTriggered, searchMessageContent]);

  // Close search filters dropdown on click outside
  useEffect(() => {
    if (!showSearchFilters) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (searchFiltersRef.current && !searchFiltersRef.current.contains(event.target as Node)) {
        setShowSearchFilters(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSearchFilters]);

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

      // Also update workstream children cache if this is a child session
      // This ensures renamed children show updated names immediately
      setWorkstreamChildrenCache(prev => {
        const updated = new Map(prev);
        let cacheUpdated = false;

        for (const [parentId, children] of prev.entries()) {
          const childIndex = children.findIndex(c => c.id === renamedSession.id);
          if (childIndex !== -1) {
            const updatedChildren = [...children];
            updatedChildren[childIndex] = {
              ...updatedChildren[childIndex],
              title: renamedSession.title
            };
            updated.set(parentId, updatedChildren);
            cacheUpdated = true;
            break;
          }
        }

        return cacheUpdated ? updated : prev;
      });
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

  // Listen for worktree display name updates from main process
  // This handles automatic worktree naming when first session in worktree is named
  useEffect(() => {
    if (!workspacePath) return;

    const unsubscribe = window.electronAPI?.on?.('worktree:display-name-updated',
      (data: { worktreeId: string; displayName: string }) => {
        setWorktreeCache(prev => {
          const existing = prev.get(data.worktreeId);
          if (existing) {
            const updated = new Map(prev);
            updated.set(data.worktreeId, {
              ...existing,
              displayName: data.displayName
            });
            return updated;
          }
          return prev;
        });
      }
    );

    return () => unsubscribe?.();
  }, [workspacePath]);

  // Listen for blitz display name updates from main process
  // This handles automatic blitz naming when first session in any blitz worktree is named
  useEffect(() => {
    if (!workspacePath) return;

    const unsubscribe = window.electronAPI?.on?.('blitz:display-name-updated',
      (data: { blitzId: string; displayName: string }) => {
        setBlitzCache(prev => {
          const existing = prev.get(data.blitzId);
          if (existing) {
            const updated = new Map(prev);
            updated.set(data.blitzId, {
              ...existing,
              displayName: data.displayName
            });
            return updated;
          }
          return prev;
        });
      }
    );

    return () => unsubscribe?.();
  }, [workspacePath]);

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
      updateSessionStore({ sessionId, updates: { isArchived: true } });
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

  // Show confirmation dialog before archiving worktree
  const handleArchiveWorktree = async (worktreeId: string) => {
    // Get worktree info from cache
    const worktreeData = worktreeCache.get(worktreeId);
    const worktreeName = worktreeData?.displayName || worktreeData?.name || worktreeData?.path?.split('/').pop() || 'worktree';
    const worktreePath = worktreeData?.path || '';

    await showArchiveWorktreeDialog({
      worktreeId,
      worktreeName,
      worktreePath,
    });
  };

  const handleCleanGitignored = useCallback(async (worktreeId: string) => {
    const worktreeData = worktreeCache.get(worktreeId);
    if (!worktreeData?.path) return;

    const worktreeName = worktreeData.displayName || worktreeData.name || 'worktree';

    try {
      const preview = await window.electronAPI.worktreeListGitignored(worktreeData.path);
      if (!preview.success || preview.count === 0) return;

      const confirmed = window.confirm(
        `Remove ${preview.count} gitignored ${preview.count === 1 ? 'item' : 'items'} from "${worktreeName}"?\n\nThis includes files like node_modules and build artifacts that can be regenerated.`
      );
      if (!confirmed) return;

      const result = await window.electronAPI.worktreeCleanGitignored(worktreeData.path);
      if (result.success) {
        window.alert(`Removed ${result.count} gitignored ${result.count === 1 ? 'item' : 'items'} from "${worktreeName}".`);
      } else {
        console.error('[SessionHistory] Failed to clean gitignored files:', result.error);
        window.alert(`Failed to clean gitignored files: ${result.error}`);
      }
    } catch (error) {
      console.error('[SessionHistory] Failed to clean gitignored files:', error);
    }
  }, [worktreeCache]);

  // Handle archive confirmation - clean up sessions and cache after successful archive
  const handleConfirmArchiveWorktree = useCallback(async () => {
    if (!archiveWorktreeDialogState) return;

    const worktreeId = archiveWorktreeDialogState.worktreeId;

    // Get sessions for this worktree to notify parent to close tabs
    const worktreeSessions = allSessions.filter(s => s.worktree_id === worktreeId);

    await confirmArchiveWorktree(workspacePath, () => {
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

      // If this worktree belongs to a Super Loop, remove the loop from state
      const superLoop = superLoops.find(loop => loop.worktreeId === worktreeId);
      if (superLoop) {
        removeSuperLoop(superLoop.id);
      }
    });
  }, [archiveWorktreeDialogState, allSessions, workspacePath, confirmArchiveWorktree, removeSessionFromAtom, onSessionArchive, superLoops, removeSuperLoop]);

  const handleUnarchiveSession = async (sessionId: string) => {
    try {
      await window.electronAPI.invoke('sessions:update-metadata', sessionId, { isArchived: false });
      // Update atom state immediately for instant feedback (optimistic update)
      updateSessionStore({ sessionId, updates: { isArchived: false } });
      // Also update filtered list for immediate feedback
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, isArchived: false } : s));
    } catch (err) {
      console.error('[SessionHistory] Failed to unarchive session:', err);
    }
  };

  const toggleShowArchived = async () => {
    const newValue = !showArchived;
    setShowArchived(newValue);
    // Need to refresh from database since archived sessions may not be loaded yet
    // Pass the new value explicitly to avoid race condition with atom update
    await refreshSessions(newValue);
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
      updateSessionStore({ sessionId, updates: { isArchived: true } });
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
      updateSessionStore({ sessionId, updates: { isArchived: false } });
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
      updateSessionStore({ sessionId, updates: { isPinned } });
      // Also update filtered list for immediate feedback
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, isPinned } : s));
    } catch (error) {
      console.error('[SessionHistory] Failed to toggle session pin:', error);
    }
  }, [updateSessionStore]);

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

  // Rename a blitz
  const handleBlitzRename = useCallback(async (blitzId: string, newName: string) => {
    try {
      await window.electronAPI.invoke('blitz:update-display-name', blitzId, newName);
      setBlitzCache(prev => {
        const updated = new Map(prev);
        const blitz = updated.get(blitzId);
        if (blitz) {
          updated.set(blitzId, { ...blitz, displayName: newName });
        }
        return updated;
      });
    } catch (error) {
      console.error('[SessionHistory] Failed to rename blitz:', error);
    }
  }, []);

  // Toggle pin status for a blitz
  const handleBlitzPinToggle = useCallback(async (blitzId: string, isPinned: boolean) => {
    try {
      await window.electronAPI.invoke('blitz:update-pinned', blitzId, isPinned);
      setBlitzCache(prev => {
        const updated = new Map(prev);
        const blitz = updated.get(blitzId);
        if (blitz) {
          updated.set(blitzId, { ...blitz, isPinned });
        }
        return updated;
      });
    } catch (error) {
      console.error('[SessionHistory] Failed to toggle blitz pin:', error);
    }
  }, []);

  // Archive a blitz and all its worktrees
  const handleBlitzArchive = useCallback(async (blitzId: string) => {
    try {
      await window.electronAPI.invoke('blitz:archive', blitzId, workspacePath);
      setBlitzCache(prev => {
        const updated = new Map(prev);
        const blitz = updated.get(blitzId);
        if (blitz) {
          updated.set(blitzId, { ...blitz, isArchived: true });
        }
        return updated;
      });
    } catch (error) {
      console.error('[SessionHistory] Failed to archive blitz:', error);
    }
  }, [workspacePath]);

  // Archive all worktrees in a blitz except the one to keep
  const handleArchiveOtherBlitzWorktrees = useCallback(async (blitzId: string, keepWorktreeId: string) => {
    try {
      // Find worktree IDs belonging to this blitz from sessions with parentSessionId === blitzId
      const blitzWorktreeIds = new Set<string>();
      for (const session of sessions) {
        if (session.parentSessionId === blitzId && session.worktree_id && session.worktree_id !== keepWorktreeId) {
          const worktreeData = worktreeCache.get(session.worktree_id);
          if (!worktreeData?.isArchived) {
            blitzWorktreeIds.add(session.worktree_id);
          }
        }
      }

      // Archive each one
      for (const worktreeId of blitzWorktreeIds) {
        await window.electronAPI.worktreeArchive(worktreeId, workspacePath);
      }

      // Update worktree cache to mark them as archived
      setWorktreeCache(prev => {
        const updated = new Map(prev);
        for (const worktreeId of blitzWorktreeIds) {
          const wt = updated.get(worktreeId);
          if (wt) {
            updated.set(worktreeId, { ...wt, isArchived: true });
          }
        }
        return updated;
      });
    } catch (error) {
      console.error('[SessionHistory] Failed to archive other blitz worktrees:', error);
    }
  }, [sessions, worktreeCache, workspacePath]);

  // Super Loop handlers
  const handleSuperLoopUpdate = useCallback(async (
    loopId: string,
    updates: { title?: string; isArchived?: boolean; isPinned?: boolean }
  ) => {
    try {
      const result = await window.electronAPI.invoke('super-loop:update', loopId, updates);
      if (result.success && result.loop) {
        upsertSuperLoop(result.loop);
      }
    } catch (error) {
      console.error('[SessionHistory] Failed to update super loop:', error);
    }
  }, [upsertSuperLoop]);

  const handleSuperLoopArchive = useCallback(async (loop: SuperLoop) => {
    // Super loops own a dedicated worktree - archive via the worktree archive dialog
    // which queues deletion of the actual git worktree
    try {
      const result = await window.electronAPI.invoke('worktree:get', loop.worktreeId);
      if (!result.success || !result.worktree) {
        console.error('[SessionHistory] Failed to get worktree for super loop:', result.error);
        return;
      }
      const wt = result.worktree;
      await showArchiveWorktreeDialog({
        worktreeId: wt.id,
        worktreeName: wt.displayName || wt.name || wt.path?.split('/').pop() || 'worktree',
        worktreePath: wt.path,
      });
    } catch (error) {
      console.error('[SessionHistory] Failed to archive super loop:', error);
    }
  }, [showArchiveWorktreeDialog]);

  const handleSuperLoopRename = useCallback((loopId: string, newName: string) => {
    handleSuperLoopUpdate(loopId, { title: newName });
  }, [handleSuperLoopUpdate]);

  const handleSuperLoopPinToggle = useCallback((loopId: string, isPinned: boolean) => {
    handleSuperLoopUpdate(loopId, { isPinned });
  }, [handleSuperLoopUpdate]);

  const toggleSortDropdown = () => {
    setSortDropdownOpen(!sortDropdownOpen);
  };

  const selectSortOption = (option: 'updated' | 'created') => {
    setSortBy(option);
    setSortDropdownOpen(false);
  };

  const toggleNewDropdown = (buttonElement?: HTMLButtonElement) => {
    if (!newDropdownOpen) {
      const button = buttonElement || newDropdownButtonRef.current;
      if (button) {
        const rect = button.getBoundingClientRect();
        setNewDropdownPosition({
          x: rect.right,
          y: rect.bottom + 4
        });
      }
    }
    setNewDropdownOpen(!newDropdownOpen);
  };

  // Handle new button click - if only one option available, trigger it directly
  const handleNewButtonClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const availableOptions = [onNewSession, onNewWorktreeSession, onNewBlitz, onNewTerminal].filter(Boolean);
    if (availableOptions.length === 1) {
      // Only one option available, trigger it directly
      if (onNewSession) onNewSession();
      else if (onNewWorktreeSession) onNewWorktreeSession();
      else if (onNewTerminal) onNewTerminal();
    } else {
      // Multiple options, show dropdown
      toggleNewDropdown(e.currentTarget);
    }
  };

  // Card context menu handlers
  const handleCardContextMenu = useCallback((
    e: React.MouseEvent,
    type: 'session' | 'workstream' | 'worktree',
    sessionId?: string,
    worktreeId?: string,
    isPinned?: boolean,
    isArchived?: boolean
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setCardContextMenu({
      type,
      sessionId,
      worktreeId,
      x: e.clientX,
      y: e.clientY,
      isPinned,
      isArchived
    });
  }, []);

  const closeCardContextMenu = useCallback(() => {
    setCardContextMenu(null);
  }, []);

  // Context menu action handlers - initiate inline editing
  const handleCardRename = useCallback(() => {
    if (!cardContextMenu) return;
    closeCardContextMenu();

    if (cardContextMenu.type === 'worktree' && cardContextMenu.worktreeId) {
      // Multi-session worktree: start inline rename for the worktree
      const worktree = worktreeCache.get(cardContextMenu.worktreeId);
      const currentName = worktree?.displayName || worktree?.name || '';
      setWorktreeRenameValue(currentName);
      setRenamingWorktreeId(cardContextMenu.worktreeId);
    } else if (cardContextMenu.sessionId) {
      // Session: start inline rename for the session
      const session = sessions.find(s => s.id === cardContextMenu.sessionId);
      const currentTitle = session?.title || '';
      setSessionRenameValue(currentTitle);
      setRenamingSessionId(cardContextMenu.sessionId);
    }
  }, [cardContextMenu, closeCardContextMenu, worktreeCache, sessions]);

  // Handle worktree rename submit (for card view)
  const handleWorktreeRenameSubmit = useCallback(() => {
    if (!renamingWorktreeId) return;
    const trimmedValue = worktreeRenameValue.trim();
    const worktree = worktreeCache.get(renamingWorktreeId);
    const currentName = worktree?.displayName || worktree?.name || '';
    if (trimmedValue && trimmedValue !== currentName) {
      handleWorktreeRename(renamingWorktreeId, trimmedValue);
    }
    setRenamingWorktreeId(null);
  }, [renamingWorktreeId, worktreeRenameValue, worktreeCache, handleWorktreeRename]);

  // Handle session rename submit (for card view)
  const handleSessionRenameSubmit = useCallback(() => {
    if (!renamingSessionId || !onSessionRename) return;
    const trimmedValue = sessionRenameValue.trim();
    const session = sessions.find(s => s.id === renamingSessionId);
    const currentTitle = session?.title || '';
    if (trimmedValue && trimmedValue !== currentTitle) {
      onSessionRename(renamingSessionId, trimmedValue);

      // If this session belongs to a worktree and is the only session in that worktree,
      // also rename the worktree to keep them in sync
      if (session?.worktree_id) {
        const worktreeSessionCount = sessions.filter(s => s.worktree_id === session.worktree_id).length;
        if (worktreeSessionCount === 1) {
          handleWorktreeRename(session.worktree_id, trimmedValue);
        }
      }
    }
    setRenamingSessionId(null);
  }, [renamingSessionId, sessionRenameValue, sessions, onSessionRename, handleWorktreeRename]);

  // Handle keyboard events for inline rename
  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent, isWorktree: boolean) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isWorktree) {
        handleWorktreeRenameSubmit();
      } else {
        handleSessionRenameSubmit();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (isWorktree) {
        setRenamingWorktreeId(null);
      } else {
        setRenamingSessionId(null);
      }
    }
  }, [handleWorktreeRenameSubmit, handleSessionRenameSubmit]);

  // Focus inputs when entering rename mode
  useEffect(() => {
    if (renamingWorktreeId && worktreeRenameInputRef.current) {
      worktreeRenameInputRef.current.focus();
      worktreeRenameInputRef.current.select();
    }
  }, [renamingWorktreeId]);

  useEffect(() => {
    if (renamingSessionId && sessionRenameInputRef.current) {
      sessionRenameInputRef.current.focus();
      sessionRenameInputRef.current.select();
    }
  }, [renamingSessionId]);

  const handleCardPinToggle = useCallback(() => {
    if (!cardContextMenu) return;
    closeCardContextMenu();

    if (cardContextMenu.type === 'worktree' && cardContextMenu.worktreeId) {
      handleWorktreePinToggle(cardContextMenu.worktreeId, !cardContextMenu.isPinned);
    } else if (cardContextMenu.sessionId) {
      handleSessionPinToggle(cardContextMenu.sessionId, !cardContextMenu.isPinned);
    }
  }, [cardContextMenu, closeCardContextMenu, handleWorktreePinToggle, handleSessionPinToggle]);

  const handleCardBranch = useCallback(() => {
    if (!cardContextMenu || !cardContextMenu.sessionId || !onSessionBranch) return;
    closeCardContextMenu();
    onSessionBranch(cardContextMenu.sessionId);
  }, [cardContextMenu, closeCardContextMenu, onSessionBranch]);

  const handleCardArchive = useCallback(() => {
    if (!cardContextMenu) return;
    closeCardContextMenu();

    if (cardContextMenu.type === 'worktree' && cardContextMenu.worktreeId) {
      handleArchiveWorktree(cardContextMenu.worktreeId);
    } else if (cardContextMenu.sessionId) {
      if (cardContextMenu.isArchived) {
        handleUnarchiveSession(cardContextMenu.sessionId);
      } else {
        handleArchiveSession(cardContextMenu.sessionId);
      }
    }
  }, [cardContextMenu, closeCardContextMenu, handleArchiveWorktree, handleArchiveSession, handleUnarchiveSession]);

  const handleCardDelete = useCallback(() => {
    if (!cardContextMenu || !cardContextMenu.sessionId) return;
    closeCardContextMenu();
    handleDeleteSession(cardContextMenu.sessionId);
  }, [cardContextMenu, closeCardContextMenu, handleDeleteSession]);

  const handleCardAddSession = useCallback(() => {
    if (!cardContextMenu || !cardContextMenu.worktreeId || !onAddSessionToWorktree) return;
    closeCardContextMenu();
    onAddSessionToWorktree(cardContextMenu.worktreeId);
  }, [cardContextMenu, closeCardContextMenu, onAddSessionToWorktree]);

  const handleCardAddTerminal = useCallback(() => {
    if (!cardContextMenu || !cardContextMenu.worktreeId || !onAddTerminalToWorktree) return;
    closeCardContextMenu();
    onAddTerminalToWorktree(cardContextMenu.worktreeId);
  }, [cardContextMenu, closeCardContextMenu, onAddTerminalToWorktree]);

  const handleCardCleanGitignored = useCallback(() => {
    if (!cardContextMenu || !cardContextMenu.worktreeId) return;
    closeCardContextMenu();
    handleCleanGitignored(cardContextMenu.worktreeId);
  }, [cardContextMenu, closeCardContextMenu, handleCleanGitignored]);

  // Close dropdowns and context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (sortDropdownOpen && !target.closest('.session-history-sort-dropdown')) {
        setSortDropdownOpen(false);
      }
      if (newDropdownOpen && !target.closest('.session-history-new-dropdown')) {
        if (!newDropdownMenuRef.current || !newDropdownMenuRef.current.contains(target)) {
          setNewDropdownOpen(false);
          setNewDropdownPosition(null);
        }
      }
      if (cardContextMenu && cardContextMenuRef.current && !cardContextMenuRef.current.contains(target)) {
        closeCardContextMenu();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [sortDropdownOpen, newDropdownOpen, cardContextMenu, closeCardContextMenu]);

  // Close dropdown on window resize to prevent stale positioning
  useEffect(() => {
    const handleResize = () => {
      if (newDropdownOpen) {
        setNewDropdownOpen(false);
        setNewDropdownPosition(null);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [newDropdownOpen]);

  // Adjust card context menu position to stay within viewport
  const [adjustedCardMenuPosition, setAdjustedCardMenuPosition] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (cardContextMenu && cardContextMenuRef.current) {
      const menu = cardContextMenuRef.current;
      const rect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let x = cardContextMenu.x;
      let y = cardContextMenu.y;

      // Adjust horizontal position if menu extends beyond right edge
      if (x + rect.width > viewportWidth) {
        x = viewportWidth - rect.width - 8; // 8px margin
      }

      // Adjust vertical position if menu extends beyond bottom edge
      if (y + rect.height > viewportHeight) {
        y = viewportHeight - rect.height - 8; // 8px margin
      }

      setAdjustedCardMenuPosition({ x, y });
    } else {
      setAdjustedCardMenuPosition(null);
    }
  }, [cardContextMenu]);

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

  // Create unified list items that can be a session, workstream, worktree group, blitz group, or super loop
  type UnifiedListItem =
    | { type: 'session'; session: SessionItem; timestamp: number; isWorktreeSession?: boolean }
    | { type: 'workstream'; session: SessionItem; sessions: SessionItem[]; timestamp: number }
    | { type: 'worktree'; worktreeId: string; sessions: SessionItem[]; timestamp: number }
    | { type: 'blitz'; blitzId: string; worktrees: { worktreeId: string; sessions: SessionItem[] }[]; timestamp: number }
    | { type: 'superLoop'; loop: SuperLoop; timestamp: number };

  // Build unified time-grouped data with both sessions and worktrees interleaved
  const groupedItems = useMemo(() => {
    const timestampField = sortBy === 'updated' ? 'updatedAt' : 'createdAt';
    const items: UnifiedListItem[] = [];
    const pinnedItems: UnifiedListItem[] = [];

    // Add regular sessions and workstreams (those without worktree_id)
    for (const session of sessions) {
      // Skip blitz sessions - they're rendered via BlitzGroup, not as individual items
      if (session.sessionType === 'blitz') continue;

      if (!session.worktree_id) {
        // Check if this is a workstream (has children)
        const isWorkstream = (session.childCount ?? 0) > 0;
        if (isWorkstream) {
          // Create workstream item with cached children (or empty array if not loaded yet)
          const cachedChildren = workstreamChildrenCache.get(session.id) || [];

          // For workstreams, use the maximum updatedAt from all children for sorting
          // This ensures workstreams appear based on their most recent activity
          let timestamp: number;
          if (timestampField === 'updatedAt' && cachedChildren.length > 0) {
            timestamp = Math.max(...cachedChildren.map(child => child.updatedAt || child.createdAt));
          } else {
            timestamp = timestampField === 'updatedAt' ? (session.updatedAt || session.createdAt) : session.createdAt;
          }

          const item = { type: 'workstream' as const, session, sessions: cachedChildren, timestamp };

          if (session.isPinned) {
            pinnedItems.push(item);
          } else {
            items.push(item);
          }
        } else {
          const timestamp = timestampField === 'updatedAt' ? (session.updatedAt || session.createdAt) : session.createdAt;
          // Regular session
          const item = { type: 'session' as const, session, timestamp };

          if (session.isPinned) {
            pinnedItems.push(item);
          } else {
            items.push(item);
          }
        }
      }
    }

    // Exclude worktrees that belong to Super Loops - those are rendered via SuperLoopGroup
    const superLoopWorktreeIds = new Set(superLoops.map(loop => loop.worktreeId));

    // Group blitz worktrees by blitz parent session ID, keep standalone worktrees separate
    const blitzWorktrees = new Map<string, { worktreeId: string; sessions: SessionItem[] }[]>();
    const standaloneWorktrees: [string, { sessions: SessionItem[]; timestamp: number }][] = [];

    for (const [worktreeId, data] of worktreeGroupsData) {
      // Skip worktrees that belong to Super Loops
      if (superLoopWorktreeIds.has(worktreeId)) {
        continue;
      }

      // Check if any session in this worktree has a parentSessionId pointing to a blitz session
      const blitzParentId = data.sessions.find(s => s.parentSessionId && blitzCache.has(s.parentSessionId))?.parentSessionId;
      if (blitzParentId) {
        // This worktree belongs to a blitz
        const existing = blitzWorktrees.get(blitzParentId) || [];
        existing.push({ worktreeId, sessions: data.sessions });
        blitzWorktrees.set(blitzParentId, existing);
      } else {
        standaloneWorktrees.push([worktreeId, data]);
      }
    }

    // Sort blitz worktrees by creation time (oldest first) for stable ordering
    for (const worktrees of blitzWorktrees.values()) {
      worktrees.sort((a, b) => {
        const aMin = Math.min(...a.sessions.map(s => s.createdAt));
        const bMin = Math.min(...b.sessions.map(s => s.createdAt));
        return aMin - bMin;
      });
    }

    // Add blitz groups
    for (const [blitzId, worktrees] of blitzWorktrees) {
      const blitzData = blitzCache.get(blitzId);
      // Use the most recent session timestamp for the blitz group
      const allSessions = worktrees.flatMap(w => w.sessions);
      let timestamp = Math.max(...allSessions.map(s =>
        timestampField === 'updatedAt' ? (s.updatedAt || s.createdAt) : s.createdAt
      ));
      if (sortBy === 'created' && blitzData?.createdAt) {
        timestamp = blitzData.createdAt;
      }

      const item = { type: 'blitz' as const, blitzId, worktrees, timestamp };

      if (blitzData?.isPinned) {
        pinnedItems.push(item);
      } else {
        items.push(item);
      }
    }

    // Add standalone worktree groups as single items (only if they have 2+ sessions)
    // Single-session worktrees are displayed as flat session items
    for (const [worktreeId, data] of standaloneWorktrees) {
      if (data.sessions.length === 1) {
        // Single session in worktree - display as a regular session item (flat, not grouped)
        // but with the worktree icon to indicate it's a worktree session
        const session = data.sessions[0];
        const timestamp = timestampField === 'updatedAt' ? (session.updatedAt || session.createdAt) : session.createdAt;
        const item = { type: 'session' as const, session, timestamp, isWorktreeSession: true };

        if (session.isPinned) {
          pinnedItems.push(item);
        } else {
          items.push(item);
        }
      } else {
        // Multiple sessions in worktree - display as a worktree group hierarchy
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
    }

    // Add Super Loops as grouped items
    for (const loop of superLoops) {
      const timestamp = timestampField === 'updatedAt' ? loop.updatedAt : loop.createdAt;
      const item = { type: 'superLoop' as const, loop, timestamp };
      if (loop.isPinned) {
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
  }, [sessions, worktreeGroupsData, sortBy, worktreeCache, workstreamChildrenCache, blitzCache, superLoops]);

  const groupKeys = Object.keys(groupedItems) as (TimeGroupKey | 'Pinned')[];

  // Flatten groups and their visible items into a single array for Virtuoso.
  // Group headers are included as items; collapsed groups omit their children.
  type FlatVirtuosoItem =
    | { kind: 'group-header'; groupKey: string; itemCount: number; isExpanded: boolean }
    | { kind: 'item'; groupKey: string; item: UnifiedListItem };

  const flatVirtuosoItems = useMemo(() => {
    const flat: FlatVirtuosoItem[] = [];
    for (const groupKey of groupKeys) {
      const items = groupedItems[groupKey];
      const isExpanded = !collapsedGroups.includes(groupKey);
      flat.push({ kind: 'group-header', groupKey, itemCount: items.length, isExpanded });
      if (isExpanded) {
        for (const item of items) {
          flat.push({ kind: 'item', groupKey, item });
        }
      }
    }
    return flat;
  }, [groupKeys, groupedItems, collapsedGroups]);

  // Ref for Virtuoso to support scroll-to-active
  const virtuosoRef = useRef<VirtuosoHandle>(null);

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

  // Fetch blitz sessions (ai_sessions with session_type='blitz') for this workspace
  const fetchBlitzes = useCallback(async () => {
    if (!workspacePath) return;
    try {
      const result = await window.electronAPI.invoke('blitz:list', workspacePath);
      if (result.success && result.blitzes) {
        setBlitzCache(prev => {
          const updated = new Map(prev);
          for (const blitz of result.blitzes) {
            updated.set(blitz.id, {
              id: blitz.id,
              prompt: blitz.prompt,
              displayName: blitz.displayName,
              isPinned: blitz.isPinned,
              isArchived: blitz.isArchived,
              createdAt: blitz.createdAt,
            });
          }
          return updated;
        });
      }
    } catch (err) {
      console.error('[SessionHistory] Failed to fetch blitzes:', err);
    }
  }, [workspacePath]);

  // Initial fetch + re-fetch when blitz:created event fires
  useEffect(() => {
    if (!workspacePath) return;

    fetchBlitzes();

    const unsubscribe = window.electronAPI?.on?.('blitz:created',
      (data: { blitzId: string; workspacePath: string }) => {
        if (data.workspacePath === workspacePath) {
          fetchBlitzes();
        }
      }
    );

    return () => unsubscribe?.();
  }, [workspacePath, fetchBlitzes]);

  // Fetch children for expanded workstreams
  useEffect(() => {
    // Find workstream sessions that are expanded
    const workstreamSessions = sessions.filter(s =>
      !s.worktree_id &&
      (s.childCount ?? 0) > 0 &&
      !collapsedGroups.includes(`workstream:${s.id}`)
    );

    if (workstreamSessions.length === 0) {
      return;
    }

    const fetchChildren = async () => {
      for (const session of workstreamSessions) {
        try {
          const result = await window.electronAPI.invoke('sessions:list-children', session.id, workspacePath);
          if (result.success && Array.isArray(result.children)) {
            const children: SessionItem[] = result.children.map((c: any) => ({
              id: c.id,
              title: c.title || c.name || 'Untitled Session',
              createdAt: c.createdAt,
              updatedAt: c.updatedAt,
              provider: c.provider || 'claude',
              model: c.model,
              sessionType: c.sessionType || 'chat',
              messageCount: c.messageCount || 0,
              isArchived: c.isArchived || false,
              isPinned: c.isPinned || false,
              uncommittedCount: c.uncommittedCount || 0,
            }));
            setWorkstreamChildrenCache(prev => {
              const updated = new Map(prev);
              updated.set(session.id, children);
              return updated;
            });
          }
        } catch (err) {
          console.error(`[SessionHistory] Failed to fetch children for workstream ${session.id}:`, err);
        }
      }
    };

    fetchChildren();
  }, [sessions, collapsedGroups, workspacePath]);

  if (loading) {
    return (
      <div className="session-history flex flex-col h-full bg-[var(--nim-bg)] overflow-hidden">
        <div className="workspace-color-accent h-[3px] w-full opacity-90 shrink-0" style={{ backgroundColor: workspaceColor }} />
        <div className="session-history-header flex items-center justify-between px-3 pt-2.5 pb-2 border-b border-[var(--nim-border)] bg-[var(--nim-bg)] gap-2 min-h-14 shrink-0">
          <div className="session-history-header-identity flex-1 min-w-0 flex flex-col gap-0.5">
            <h3 className="session-history-header-name m-0 text-[15px] font-bold text-[var(--nim-text)] overflow-hidden text-ellipsis whitespace-nowrap tracking-tight leading-tight">{workspaceName}</h3>
            <div className="session-history-header-path text-[11px] text-[var(--nim-text-muted)] overflow-hidden text-ellipsis whitespace-nowrap opacity-75 font-normal">{workspacePath}</div>
          </div>
          <div className="session-history-header-buttons flex items-center gap-1.5 shrink-0">
            {onOpenQuickSearch && (
              <button
                className="session-history-search-button flex items-center justify-center p-1.5 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded text-[var(--nim-text)] cursor-pointer transition-colors duration-150 shrink-0 hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] active:bg-[var(--nim-bg-tertiary)] [&_svg]:block"
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
                className="session-history-import-button flex items-center justify-center p-1.5 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded text-[var(--nim-text)] cursor-pointer transition-colors duration-150 shrink-0 hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] active:bg-[var(--nim-bg-tertiary)] [&_svg]:block"
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
              <div className="session-history-new-dropdown relative z-10">
                <button
                  ref={newDropdownButtonRef}
                  className="session-history-new-button flex items-center justify-center p-1.5 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded text-[var(--nim-text)] cursor-pointer transition-colors duration-150 shrink-0 hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] active:bg-[var(--nim-bg-tertiary)] [&_svg]:block"
                  data-testid="new-dropdown-button"
                  onClick={handleNewButtonClick}
                  title="Create new..."
                  aria-label="Create new session, worktree, or terminal"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="session-history-section-label px-3 py-1.5 text-[11px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-wider border-b border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] shrink-0">Agent Sessions</div>
        <div className="session-history-search px-3 py-2 border-b border-[var(--nim-border)] shrink-0 relative">
          <input
            type="text"
            className="session-history-search-input nim-input w-full px-3 py-2 text-[13px] text-[var(--nim-text)] bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded outline-none transition-colors duration-150 placeholder:text-[var(--nim-text-faint)] focus:border-[var(--nim-primary)] focus:bg-[var(--nim-bg)]"
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search sessions"
          />
        </div>
        <div className="session-history-filters flex items-center px-3 py-2 border-b border-[var(--nim-border)] gap-1.5 shrink-0">
          <div className="session-history-sort-dropdown ml-auto relative">
            <button
              className="session-history-sort-button flex items-center justify-center px-1.5 py-1 text-xs rounded border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] text-[var(--nim-text-muted)] cursor-pointer transition-all duration-150 outline-none hover:bg-[var(--nim-bg-tertiary)] hover:border-[var(--nim-primary)] hover:text-[var(--nim-text)] [&_svg]:block"
              onClick={toggleSortDropdown}
              title={`Sorted by: ${sortBy === 'updated' ? 'Last Updated' : 'Created'}`}
              aria-label="Sort sessions"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 2V14M8 14L4 10M8 14L12 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {sortDropdownOpen && (
              <div className="session-history-sort-menu absolute top-[calc(100%+4px)] right-0 min-w-[140px] bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded overflow-hidden z-[100] shadow-[0_4px_12px_rgba(0,0,0,0.15)]">
                <button
                  className={`session-history-sort-option flex items-center justify-between w-full px-3 py-2 text-[13px] bg-transparent border-none text-[var(--nim-text)] cursor-pointer transition-colors duration-150 text-left gap-2 hover:bg-[var(--nim-bg-hover)] [&>span]:flex-1 [&_svg]:shrink-0 [&_svg]:text-[var(--nim-primary)] ${sortBy === 'updated' ? 'bg-[var(--nim-bg-selected)] font-medium' : ''}`}
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
                  className={`session-history-sort-option flex items-center justify-between w-full px-3 py-2 text-[13px] bg-transparent border-none text-[var(--nim-text)] cursor-pointer transition-colors duration-150 text-left gap-2 hover:bg-[var(--nim-bg-hover)] [&>span]:flex-1 [&_svg]:shrink-0 [&_svg]:text-[var(--nim-primary)] ${sortBy === 'created' ? 'bg-[var(--nim-bg-selected)] font-medium' : ''}`}
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
        <div className="session-history-loading flex flex-col items-center justify-center px-4 py-8 text-center text-[var(--nim-text-faint)] text-[13px]">
          <span>Searching sessions...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="session-history flex flex-col h-full bg-[var(--nim-bg)] overflow-hidden">
        <div className="workspace-color-accent h-[3px] w-full opacity-90 shrink-0" style={{ backgroundColor: workspaceColor }} />
        <div className="session-history-header flex items-center justify-between px-3 pt-2.5 pb-2 border-b border-[var(--nim-border)] bg-[var(--nim-bg)] gap-2 min-h-14 shrink-0">
          <div className="session-history-header-identity flex-1 min-w-0 flex flex-col gap-0.5">
            <h3 className="session-history-header-name m-0 text-[15px] font-bold text-[var(--nim-text)] overflow-hidden text-ellipsis whitespace-nowrap tracking-tight leading-tight">{workspaceName}</h3>
            <div className="session-history-header-path text-[11px] text-[var(--nim-text-muted)] overflow-hidden text-ellipsis whitespace-nowrap opacity-75 font-normal">{workspacePath}</div>
          </div>
          <div className="session-history-header-buttons flex items-center gap-1.5 shrink-0">
            {(onNewSession || onNewWorktreeSession || onNewTerminal) && (
              <div className="session-history-new-dropdown relative z-10">
                <button
                  ref={newDropdownButtonRef}
                  className="session-history-new-button flex items-center justify-center p-1.5 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded text-[var(--nim-text)] cursor-pointer transition-colors duration-150 shrink-0 hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] active:bg-[var(--nim-bg-tertiary)] [&_svg]:block"
                  data-testid="new-dropdown-button"
                  onClick={handleNewButtonClick}
                  title="Create new..."
                  aria-label="Create new session, worktree, or terminal"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="session-history-section-label px-3 py-1.5 text-[11px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-wider border-b border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] shrink-0">Agent Sessions</div>
        <div className="session-history-error flex flex-col items-center justify-center px-4 py-8 text-center text-[var(--nim-error)] text-[13px]">
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
      <div className="session-history flex flex-col h-full bg-[var(--nim-bg)] overflow-hidden">
        <div className="workspace-color-accent h-[3px] w-full opacity-90 shrink-0" style={{ backgroundColor: workspaceColor }} />
        <div className="session-history-header flex items-center justify-between px-3 pt-2.5 pb-2 border-b border-[var(--nim-border)] bg-[var(--nim-bg)] gap-2 min-h-14 shrink-0">
          <div className="session-history-header-identity flex-1 min-w-0 flex flex-col gap-0.5">
            <h3 className="session-history-header-name m-0 text-[15px] font-bold text-[var(--nim-text)] overflow-hidden text-ellipsis whitespace-nowrap tracking-tight leading-tight">{workspaceName}</h3>
            <div className="session-history-header-path text-[11px] text-[var(--nim-text-muted)] overflow-hidden text-ellipsis whitespace-nowrap opacity-75 font-normal">{workspacePath}</div>
          </div>
          <div className="session-history-header-buttons flex items-center gap-1.5 shrink-0">
            {onImportSessions && (
              <button
                className="session-history-import-button flex items-center justify-center p-1.5 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded text-[var(--nim-text)] cursor-pointer transition-colors duration-150 shrink-0 hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] active:bg-[var(--nim-bg-tertiary)] [&_svg]:block"
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
              <div className="session-history-new-dropdown relative z-10">
                <button
                  ref={newDropdownButtonRef}
                  className="session-history-new-button flex items-center justify-center p-1.5 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded text-[var(--nim-text)] cursor-pointer transition-colors duration-150 shrink-0 hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] active:bg-[var(--nim-bg-tertiary)] [&_svg]:block"
                  data-testid="new-dropdown-button"
                  onClick={handleNewButtonClick}
                  title="Create new..."
                  aria-label="Create new session or worktree"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            )}
            {onNewTerminal && (
              <button
                className="session-history-new-terminal-button flex items-center justify-center p-1.5 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded text-[var(--nim-text)] cursor-pointer transition-colors duration-150 shrink-0 hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] active:bg-[var(--nim-bg-tertiary)] [&_svg]:block"
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
        <div className="session-history-section-label px-3 py-1.5 text-[11px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-wider border-b border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] shrink-0">Agent Sessions</div>
        <div className="session-history-empty flex flex-col items-center justify-center px-4 py-8 text-center text-[var(--nim-text-faint)] text-[13px]">
          <p className="my-1">No sessions yet</p>
          <p className="session-history-empty-hint my-1 text-xs text-[var(--nim-text-faint)]">
            Create a new session to get started
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="session-history flex flex-col h-full bg-[var(--nim-bg)] overflow-hidden">
      <div className="workspace-color-accent h-[3px] w-full opacity-90 shrink-0" style={{ backgroundColor: workspaceColor }} />
      <div className="session-history-header flex items-center justify-between px-3 pt-2.5 pb-2 border-b border-[var(--nim-border)] bg-[var(--nim-bg)] gap-2 min-h-14 shrink-0">
        <div className="session-history-header-identity flex-1 min-w-0 flex flex-col gap-0.5">
          <h3 className="session-history-header-name m-0 text-[15px] font-bold text-[var(--nim-text)] overflow-hidden text-ellipsis whitespace-nowrap tracking-tight leading-tight">{workspaceName}</h3>
          <div className="session-history-header-path text-[11px] text-[var(--nim-text-muted)] overflow-hidden text-ellipsis whitespace-nowrap opacity-75 font-normal">{workspacePath}</div>
        </div>
        <div className="session-history-header-buttons flex items-center gap-1.5 shrink-0">
          {onOpenQuickSearch && (
            <button
              className="session-history-search-button flex items-center justify-center p-1.5 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded text-[var(--nim-text)] cursor-pointer transition-colors duration-150 shrink-0 hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] active:bg-[var(--nim-bg-tertiary)] [&_svg]:block"
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
              className="session-history-import-button flex items-center justify-center p-1.5 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded text-[var(--nim-text)] cursor-pointer transition-colors duration-150 shrink-0 hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] active:bg-[var(--nim-bg-tertiary)] [&_svg]:block"
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
            <div className="session-history-new-dropdown relative z-10">
              <button
                ref={newDropdownButtonRef}
                className="session-history-new-button flex items-center justify-center p-1.5 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded text-[var(--nim-text)] cursor-pointer transition-colors duration-150 shrink-0 hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] active:bg-[var(--nim-bg-tertiary)] [&_svg]:block"
                data-testid="new-dropdown-button"
                onClick={handleNewButtonClick}
                title="Create new..."
                aria-label="Create new session, worktree, or terminal"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="session-history-section-label px-3 py-1.5 text-[11px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-wider border-b border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] shrink-0">Agent Sessions</div>
      <div className="session-history-search px-3 py-2 border-b border-[var(--nim-border)] shrink-0 relative z-[101]">
        <input
          type="text"
          className="session-history-search-input nim-input w-full px-3 py-2 pr-8 text-[13px] text-[var(--nim-text)] bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded outline-none transition-colors duration-150 placeholder:text-[var(--nim-text-faint)] focus:border-[var(--nim-primary)] focus:bg-[var(--nim-bg)]"
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
          <div className="session-history-search-status absolute right-6 top-1/2 -translate-y-1/2 text-xs text-[var(--nim-text-faint)] pointer-events-none">
            {contentSearchTriggered ? 'Searching messages...' : 'Searching...'}
          </div>
        )}
        {!isSearching && searchQuery && !contentSearchTriggered && (
          <button
            className="session-history-content-search-hint absolute right-6 top-1/2 -translate-y-1/2 text-xs text-[var(--nim-text-muted)] bg-transparent border-none cursor-pointer flex items-center gap-1 px-2 py-1 rounded transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-primary)]"
            onClick={searchMessageContents}
            title="Press Tab to search message contents"
          >
            ⇥ Search contents
          </button>
        )}
        {/* Search filters dropdown - only visible when content search is active */}
        {contentSearchTriggered && searchQuery && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2" ref={searchFiltersRef}>
            <button
              className={`flex items-center justify-center w-5 h-5 rounded transition-all duration-150 ${
                showSearchFilters || searchFilters.timeRange !== '30d' || searchFilters.direction !== 'all'
                  ? 'bg-[var(--nim-primary)] text-white'
                  : 'text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]'
              }`}
              onClick={() => setShowSearchFilters(!showSearchFilters)}
              title="Search filters"
              aria-label="Search filters"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            {showSearchFilters && (
              <div className="absolute right-0 top-full mt-1 z-[100] min-w-[160px] bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded-lg shadow-lg overflow-hidden">
                <div className="px-3 py-2 text-xs font-medium text-[var(--nim-text-muted)] border-b border-[var(--nim-border)]">
                  Time Range
                </div>
                {(Object.entries(TIME_RANGE_LABELS) as [SearchTimeRange, string][]).map(([value, label]) => (
                  <button
                    key={value}
                    className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                      searchFilters.timeRange === value
                        ? 'bg-[var(--nim-bg-selected)] text-[var(--nim-primary)]'
                        : 'text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)]'
                    }`}
                    onClick={() => {
                      const newFilters = { ...searchFilters, timeRange: value };
                      setSearchFilters(newFilters);
                      executeSearch(searchQuery, newFilters);
                    }}
                  >
                    {label}
                    {searchFilters.timeRange === value && <span className="float-right">✓</span>}
                  </button>
                ))}
                <div className="px-3 py-2 text-xs font-medium text-[var(--nim-text-muted)] border-t border-b border-[var(--nim-border)]">
                  Message Type
                </div>
                {(Object.entries(DIRECTION_LABELS) as [SearchDirection, string][]).map(([value, label]) => (
                  <button
                    key={value}
                    className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                      searchFilters.direction === value
                        ? 'bg-[var(--nim-bg-selected)] text-[var(--nim-primary)]'
                        : 'text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)]'
                    }`}
                    onClick={() => {
                      const newFilters = { ...searchFilters, direction: value };
                      setSearchFilters(newFilters);
                      executeSearch(searchQuery, newFilters);
                    }}
                  >
                    {label}
                    {searchFilters.direction === value && <span className="float-right">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="session-history-filters flex items-center px-3 py-2 border-b border-[var(--nim-border)] gap-1.5 shrink-0">
        {isCardModeEnabled && (
          <button
            className={`session-history-view-toggle flex items-center justify-center px-1.5 py-1 text-xs rounded border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] text-[var(--nim-text-faint)] cursor-pointer transition-all duration-150 outline-none hover:bg-[var(--nim-bg-tertiary)] hover:border-[var(--nim-primary)] hover:text-[var(--nim-text)] [&_svg]:block ${viewMode === 'card' ? 'bg-[var(--nim-primary)] border-[var(--nim-primary)] text-white hover:opacity-90' : ''}`}
            onClick={() => setViewMode(viewMode === 'list' ? 'card' : 'list')}
            title={viewMode === 'list' ? 'Switch to card view' : 'Switch to list view'}
            aria-label={viewMode === 'list' ? 'Switch to card view' : 'Switch to list view'}
          >
            {viewMode === 'list' ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="2" width="5" height="5" stroke="currentColor" strokeWidth="1.25" rx="1"/>
                <rect x="9" y="2" width="5" height="5" stroke="currentColor" strokeWidth="1.25" rx="1"/>
                <rect x="2" y="9" width="5" height="5" stroke="currentColor" strokeWidth="1.25" rx="1"/>
                <rect x="9" y="9" width="5" height="5" stroke="currentColor" strokeWidth="1.25" rx="1"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="3" width="12" height="2" rx="0.5" fill="currentColor"/>
                <rect x="2" y="7" width="12" height="2" rx="0.5" fill="currentColor"/>
                <rect x="2" y="11" width="12" height="2" rx="0.5" fill="currentColor"/>
              </svg>
            )}
          </button>
        )}
        <button
          className={`session-history-archive-filter flex items-center justify-center px-1.5 py-1 text-xs rounded border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] text-[var(--nim-text-faint)] cursor-pointer transition-all duration-150 outline-none hover:bg-[var(--nim-bg-tertiary)] hover:border-[var(--nim-primary)] hover:text-[var(--nim-text)] [&_svg]:block ${showArchived ? 'bg-[var(--nim-primary)] border-[var(--nim-primary)] text-white hover:opacity-90' : ''}`}
          onClick={toggleShowArchived}
          title={showArchived ? 'Hide archived sessions' : 'Show archived sessions'}
          aria-label={showArchived ? 'Hide archived sessions' : 'Show archived sessions'}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 5h12M4 5v8a1 1 0 001 1h6a1 1 0 001-1V5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6 8h4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
          </svg>
        </button>
        <div className="session-history-sort-dropdown ml-auto relative">
          <button
            className="session-history-sort-button flex items-center justify-center px-1.5 py-1 text-xs rounded border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] text-[var(--nim-text-muted)] cursor-pointer transition-all duration-150 outline-none hover:bg-[var(--nim-bg-tertiary)] hover:border-[var(--nim-primary)] hover:text-[var(--nim-text)] [&_svg]:block"
            onClick={toggleSortDropdown}
            title={`Sorted by: ${sortBy === 'updated' ? 'Last Updated' : 'Created'}`}
            aria-label="Sort sessions"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 2V14M8 14L4 10M8 14L12 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          {sortDropdownOpen && (
            <div className="session-history-sort-menu absolute top-[calc(100%+4px)] right-0 min-w-[140px] bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded overflow-hidden z-[100] shadow-[0_4px_12px_rgba(0,0,0,0.15)]">
              <button
                className={`session-history-sort-option flex items-center justify-between w-full px-3 py-2 text-[13px] bg-transparent border-none text-[var(--nim-text)] cursor-pointer transition-colors duration-150 text-left gap-2 hover:bg-[var(--nim-bg-hover)] [&>span]:flex-1 [&_svg]:shrink-0 [&_svg]:text-[var(--nim-primary)] ${sortBy === 'updated' ? 'bg-[var(--nim-bg-selected)] font-medium' : ''}`}
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
                className={`session-history-sort-option flex items-center justify-between w-full px-3 py-2 text-[13px] bg-transparent border-none text-[var(--nim-text)] cursor-pointer transition-colors duration-150 text-left gap-2 hover:bg-[var(--nim-bg-hover)] [&>span]:flex-1 [&_svg]:shrink-0 [&_svg]:text-[var(--nim-primary)] ${sortBy === 'created' ? 'bg-[var(--nim-bg-selected)] font-medium' : ''}`}
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
        <div className="session-history-bulk-actions flex items-center justify-between px-3 py-2 bg-[var(--nim-bg-selected)] border-b border-[var(--nim-border)] gap-2">
          <span className="session-history-bulk-count text-xs font-medium text-[var(--nim-text)]">{selectedSessionIds.size} selected</span>
          <div className="session-history-bulk-buttons flex gap-1.5">
            {showArchived ? (
              <button className="session-history-bulk-button flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-[var(--nim-border)] bg-[var(--nim-bg)] text-[var(--nim-text)] cursor-pointer transition-all duration-150 hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] [&_svg]:shrink-0" onClick={handleBulkUnarchive} title="Unarchive selected">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2 5h12M4 5v8a1 1 0 001 1h6a1 1 0 001-1V5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M8 11V7M6 9l2-2 2 2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Unarchive
              </button>
            ) : (
              <button className="session-history-bulk-button flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-[var(--nim-border)] bg-[var(--nim-bg)] text-[var(--nim-text)] cursor-pointer transition-all duration-150 hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] [&_svg]:shrink-0" onClick={handleBulkArchive} title="Archive selected">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2 5h12M4 5v8a1 1 0 001 1h6a1 1 0 001-1V5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M8 7v4M6 9l2 2 2-2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Archive
              </button>
            )}
            {onSessionDelete && (
              <button className="session-history-bulk-button flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-[var(--nim-border)] bg-[var(--nim-bg)] text-[var(--nim-error)] cursor-pointer transition-all duration-150 hover:bg-[var(--nim-error)] hover:border-[var(--nim-error)] hover:text-white [&_svg]:shrink-0" onClick={handleBulkDelete} title="Delete selected">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2 4h12M5.333 4V2.667A.667.667 0 016 2h4a.667.667 0 01.667.667V4M12.667 4v9.333a1.333 1.333 0 01-1.334 1.334H4.667a1.333 1.333 0 01-1.334-1.334V4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Delete
              </button>
            )}
            <button className="session-history-bulk-button flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-[var(--nim-border)] bg-[var(--nim-bg)] text-[var(--nim-text)] cursor-pointer transition-all duration-150 hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] [&_svg]:shrink-0" onClick={clearSelection} title="Clear selection">
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="session-history-list nim-scrollbar flex-1 overflow-y-auto overflow-x-hidden py-2 scroll-smooth" ref={scrollContainerCallbackRef}>
        {groupKeys.length === 0 && hasSearchQuery ? (
          // No search results - show message with option to clear
          <div className="session-history-empty flex flex-col items-center justify-center px-4 py-8 text-center text-[var(--nim-text-faint)] text-[13px]">
            <p className="my-1">No matching sessions found</p>
            <p className="session-history-empty-hint my-1 text-xs text-[var(--nim-text-faint)]">
              Try a different search term or{' '}
              <button
                className="session-history-clear-search-link bg-transparent border-none text-[var(--nim-primary)] cursor-pointer underline p-0 text-inherit font-inherit hover:opacity-80"
                onClick={() => setSearchQuery('')}
                type="button"
              >
                clear search
              </button>
            </p>
          </div>
        ) : viewMode === 'card' ? (
          <>
            {/* Card view - flat display of top-level items only */}
            <div className="grid gap-3.5 [container-type:inline-size] [container-name:session-cards] [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))] [@container_session-cards_(max-width:550px)]:grid-cols-1 [@container_session-cards_(min-width:551px)_and_(max-width:800px)]:grid-cols-2">
              {groupKeys.map(groupKey => {
                const items = groupedItems[groupKey];
                return items.map(item => {
                  if (item.type === 'blitz') {
                    // Blitz card - show as a card with lightning icon
                    const blitzData = blitzCache.get(item.blitzId);
                    const allSessions = item.worktrees.flatMap(w => w.sessions);
                    const firstSession = allSessions[0];
                    if (!firstSession) return null;
                    const isBlitzActive = allSessions.some(s => s.id === activeSessionId);

                    return (
                      <div
                        key={`blitz-card-${item.blitzId}`}
                        className={`session-history-card p-4 rounded-xl border border-[var(--nim-border)] cursor-pointer transition-all duration-150 hover:border-[var(--nim-primary)]/40 hover:shadow-[0_0_0_1px_var(--nim-primary)]/20 ${isBlitzActive ? 'bg-[var(--nim-primary)]/10 border-[var(--nim-primary)]/30' : 'bg-[var(--nim-bg-secondary)]'}`}
                        onClick={() => onSessionSelect(firstSession.id)}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[var(--nim-primary)] shrink-0">
                            <path d="M9 2L4 9h4l-1 5 5-7H8l1-5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          <span className="text-[13px] font-medium text-[var(--nim-text)] truncate">
                            {blitzData?.displayName || blitzData?.prompt?.slice(0, 40) || 'Blitz'}
                          </span>
                        </div>
                        <div className="text-[12px] text-[var(--nim-text-faint)]">
                          {item.worktrees.length} worktree{item.worktrees.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                    );
                  }
                  if (item.type === 'worktree') {
                    // Worktree card - click to select first session
                    const worktreeData = worktreeCache.get(item.worktreeId);
                    const firstSession = item.sessions[0];
                    const isWorktreeActive = item.sessions.some(s => s.id === activeSessionId);

                    return (
                      <div
                        key={`worktree-card-${item.worktreeId}`}
                        className={`session-history-card ${isWorktreeActive ? 'active' : ''} ${worktreeData?.isPinned ? 'pinned' : ''} ${worktreeData?.isArchived ? 'archived' : ''}`}
                        onClick={() => firstSession && onSessionSelect(firstSession.id)}
                        onContextMenu={(e) => handleCardContextMenu(e, 'worktree', undefined, item.worktreeId, worktreeData?.isPinned, worktreeData?.isArchived)}
                      >
                        <div className="session-history-card-icon">
                          <svg width="32" height="32" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
                            <path d="M5 13v-2.5a1.5 1.5 0 0 1 1.5-1.5h3"/>
                            <path d="M9.5 9V4.5"/>
                            <circle cx="5" cy="4.5" r="1.5"/>
                            <circle cx="9.5" cy="4.5" r="1.5"/>
                            <path d="M5 6v2.5a1.5 1.5 0 0 0 1.5 1.5"/>
                          </svg>
                        </div>
                        <div className="session-history-card-content">
                          <div className="session-history-card-header">
                            {renamingWorktreeId === item.worktreeId ? (
                              <input
                                ref={worktreeRenameInputRef}
                                type="text"
                                className="session-history-card-rename-input flex-1 min-w-0 px-1 py-0.5 text-[0.8125rem] font-medium border border-[var(--nim-primary)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] outline-none"
                                value={worktreeRenameValue}
                                onChange={(e) => setWorktreeRenameValue(e.target.value)}
                                onKeyDown={(e) => handleRenameKeyDown(e, true)}
                                onBlur={handleWorktreeRenameSubmit}
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <span className="session-history-card-title">{worktreeData?.displayName || worktreeData?.name || 'Loading...'}</span>
                            )}
                            <div className="session-history-card-badges">
                              <GroupCardStatus sessionIds={item.sessions.map(s => s.id)} />
                              {worktreeData?.isPinned && renamingWorktreeId !== item.worktreeId && (
                                <svg className="session-history-card-pin-icon" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                                  <path d="M9.828 3.172a.5.5 0 0 1 .707 0l2.293 2.293a.5.5 0 0 1 0 .707l-4 4a.5.5 0 0 1-.708 0L5.828 7.879a.5.5 0 0 1 0-.707l4-4z"/>
                                  <path d="M8 12l-1.5 1.5a.5.5 0 0 1-.707-.707L7.293 11.5 8 12z"/>
                                </svg>
                              )}
                              {worktreeData?.isArchived && renamingWorktreeId !== item.worktreeId && (
                                <span className="session-history-card-archive-badge">archived</span>
                              )}
                            </div>
                          </div>
                          <div className="session-history-card-info">
                            <div className="session-history-card-git-badges">
                              {worktreeData?.gitStatus?.ahead && worktreeData.gitStatus.ahead > 0 && (
                                <span className="session-history-card-git-badge ahead">{worktreeData.gitStatus.ahead} ahead</span>
                              )}
                              {worktreeData?.gitStatus?.behind && worktreeData.gitStatus.behind > 0 && (
                                <span className="session-history-card-git-badge behind">{worktreeData.gitStatus.behind} behind</span>
                              )}
                              {worktreeData?.gitStatus?.uncommitted && (
                                <span className="session-history-card-git-badge uncommitted">uncommitted</span>
                              )}
                            </div>
                            <span className="session-history-card-branch">{worktreeData?.branch || ''}</span>
                            <span className="session-history-card-count">{item.sessions.length} session{item.sessions.length !== 1 ? 's' : ''}</span>
                          </div>
                        </div>
                      </div>
                    );
                  } else if (item.type === 'workstream') {
                    // Workstream card - click to select parent session
                    const session = item.session;
                    // Calculate total uncommitted from all child sessions
                    const totalUncommitted = item.sessions.reduce((sum, child) => sum + (child.uncommittedCount || 0), 0);

                    return (
                      <div
                        key={`workstream-card-${session.id}`}
                        className={`session-history-card ${session.id === activeSessionId || activeSessionParentId === session.id ? 'active' : ''} ${session.isPinned ? 'pinned' : ''} ${session.isArchived ? 'archived' : ''}`}
                        onClick={() => onSessionSelect(session.id)}
                        onContextMenu={(e) => handleCardContextMenu(e, 'workstream', session.id, undefined, session.isPinned, session.isArchived)}
                      >
                        <div className="session-history-card-icon">
                          <svg width="32" height="32" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="8" cy="4" r="2" stroke="currentColor" strokeWidth="1.2"/>
                            <circle cx="4" cy="12" r="2" stroke="currentColor" strokeWidth="1.2"/>
                            <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.2"/>
                            <path d="M8 6v2M6 8l-2 2M10 8l2 2" stroke="currentColor" strokeWidth="1.2"/>
                          </svg>
                        </div>
                        <div className="session-history-card-content">
                          <div className="session-history-card-header">
                            <span className="session-history-card-title">{session.title || 'Untitled Workstream'}</span>
                            <div className="session-history-card-badges">
                              <GroupCardStatus sessionIds={[session.id, ...item.sessions.map(s => s.id)]} />
                              {session.isPinned && (
                                <svg className="session-history-card-pin-icon" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                                  <path d="M9.828 3.172a.5.5 0 0 1 .707 0l2.293 2.293a.5.5 0 0 1 0 .707l-4 4a.5.5 0 0 1-.708 0L5.828 7.879a.5.5 0 0 1 0-.707l4-4z"/>
                                  <path d="M8 12l-1.5 1.5a.5.5 0 0 1-.707-.707L7.293 11.5 8 12z"/>
                                </svg>
                              )}
                              {session.isArchived && (
                                <span className="session-history-card-archive-badge">archived</span>
                              )}
                            </div>
                          </div>
                          <div className="session-history-card-info">
                            <span className="session-history-card-count">{session.childCount || 0} session{session.childCount !== 1 ? 's' : ''}</span>
                            <span className="session-history-card-meta">{session.messageCount || 0} message{session.messageCount !== 1 ? 's' : ''}</span>
                            {totalUncommitted > 0 && (
                              <span className="session-history-card-uncommitted-badge">{totalUncommitted} uncommitted</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  } else if (item.type === 'superLoop') {
                    // Super Loop card (in card view, we skip these for now - they show in list view)
                    return null;
                  } else {
                    // Regular session card
                    const session = item.session;
                    const timestamp = sortBy === 'updated' ? (session.updatedAt || session.createdAt) : session.createdAt;
                    const relativeTime = new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

                    return (
                      <div
                        key={`session-card-${session.id}`}
                        className={`session-history-card ${session.id === activeSessionId ? 'active' : ''} ${session.isPinned ? 'pinned' : ''} ${session.isArchived ? 'archived' : ''} ${loadedSessionIds.includes(session.id) ? 'loaded' : ''}`}
                        onClick={() => onSessionSelect(session.id)}
                        onContextMenu={(e) => handleCardContextMenu(e, 'session', session.id, undefined, session.isPinned, session.isArchived)}
                      >
                        <div className="session-history-card-icon">
                          {session.sessionType === 'terminal' ? (
                            <svg width="32" height="32" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M3 5L7 9L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M9 13H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                            </svg>
                          ) : (
                            <svg width="32" height="32" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M4 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" stroke="currentColor" strokeWidth="1.2"/>
                              <path d="M5 6h6M5 9h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                            </svg>
                          )}
                          {loadedSessionIds.includes(session.id) && (
                            <div className="session-history-card-loaded-dot"></div>
                          )}
                        </div>
                        <div className="session-history-card-content">
                          <div className="session-history-card-header">
                            <span className="session-history-card-title">{session.title || 'Untitled Session'}</span>
                            <div className="session-history-card-badges">
                              <SessionCardStatus sessionId={session.id} />
                              {session.isPinned && (
                                <svg className="session-history-card-pin-icon" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                                  <path d="M9.828 3.172a.5.5 0 0 1 .707 0l2.293 2.293a.5.5 0 0 1 0 .707l-4 4a.5.5 0 0 1-.708 0L5.828 7.879a.5.5 0 0 1 0-.707l4-4z"/>
                                  <path d="M8 12l-1.5 1.5a.5.5 0 0 1-.707-.707L7.293 11.5 8 12z"/>
                                </svg>
                              )}
                              {session.isArchived && (
                                <span className="session-history-card-archive-badge">archived</span>
                              )}
                            </div>
                          </div>
                          <div className="session-history-card-info">
                            <span className="session-history-card-provider">{session.provider}</span>
                            <span className="session-history-card-timestamp">{relativeTime}</span>
                            <span className="session-history-card-meta">{session.messageCount || 0} message{session.messageCount !== 1 ? 's' : ''}</span>
                            {session.uncommittedCount !== undefined && session.uncommittedCount > 0 && (
                              <span className="session-history-card-uncommitted-badge">{session.uncommittedCount} uncommitted</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }
                });
              })}
            </div>
          </>
        ) : (
          /* Virtualized list view - flat Virtuoso list with group headers as items */
          flatVirtuosoItems.length > 0 && scrollContainerEl ? (
            <Virtuoso
              ref={virtuosoRef}
              customScrollParent={scrollContainerEl}
              totalCount={flatVirtuosoItems.length}
              overscan={400}
              itemContent={(index) => {
                const entry = flatVirtuosoItems[index];
                if (entry.kind === 'group-header') {
                  // Render inline group header (same markup as CollapsibleGroup)
                  return (
                    <div className="collapsible-group mb-1">
                      <button
                        className="collapsible-group-header flex items-center gap-2 w-full py-2 px-3 bg-transparent border-none cursor-pointer text-xs font-semibold text-nim-muted text-left transition-colors duration-150 hover:bg-nim-hover"
                        onClick={() => handleToggleGroup(entry.groupKey)}
                        aria-expanded={entry.isExpanded}
                        aria-label={`${entry.groupKey} group, ${entry.isExpanded ? 'expanded' : 'collapsed'}`}
                      >
                        <MaterialSymbol
                          icon="chevron_right"
                          size={12}
                          className={`collapsible-group-chevron shrink-0 text-nim-faint transition-transform duration-200 ${entry.isExpanded ? 'rotate-90' : ''}`}
                        />
                        <span className="collapsible-group-title flex-1 overflow-hidden text-ellipsis whitespace-nowrap uppercase tracking-wide">{entry.groupKey}</span>
                        <span className="collapsible-group-count shrink-0 text-[0.625rem] text-nim-faint font-normal">{entry.itemCount}</span>
                      </button>
                    </div>
                  );
                }

                // Render the appropriate item type
                const item = entry.item;
                if (item.type === 'blitz') {
                  const blitzData = blitzCache.get(item.blitzId);
                  const isBlitzExpanded = !collapsedGroups.includes(`blitz:${item.blitzId}`);
                  const allSessionIds = item.worktrees.flatMap(w => w.sessions.map(s => s.id));
                  const isBlitzActive = allSessionIds.includes(activeSessionId || '');

                  return (
                    <BlitzGroup
                      blitzId={item.blitzId}
                      title={blitzData?.displayName || (blitzData?.prompt ? blitzData.prompt.slice(0, 60) + (blitzData.prompt.length > 60 ? '...' : '') : 'Loading...')}
                      isExpanded={isBlitzExpanded}
                      isActive={isBlitzActive}
                      isPinned={blitzData?.isPinned}
                      isArchived={blitzData?.isArchived}
                      onToggle={() => handleToggleGroup(`blitz:${item.blitzId}`)}
                      worktrees={item.worktrees.map(w => ({
                        worktreeId: w.worktreeId,
                        sessions: w.sessions,
                        worktreeData: worktreeCache.get(w.worktreeId),
                      }))}
                      activeSessionId={activeSessionId}
                      onSessionSelect={onSessionSelect}
                      worktreeCache={worktreeCache}
                      collapsedGroups={collapsedGroups}
                      onToggleWorktreeGroup={handleToggleGroup}
                      onBlitzRename={handleBlitzRename}
                      onBlitzPinToggle={handleBlitzPinToggle}
                      onBlitzArchive={handleBlitzArchive}
                      onArchiveOtherWorktrees={handleArchiveOtherBlitzWorktrees}
                      onWorktreeRename={handleWorktreeRename}
                      onWorktreeArchive={handleArchiveWorktree}
                      onWorktreeCleanGitignored={handleCleanGitignored}
                      onSessionRename={onSessionRename}
                    />
                  );
                }
                if (item.type === 'worktree') {
                  const worktreeData = worktreeCache.get(item.worktreeId);
                  const isWorktreeExpanded = !collapsedGroups.includes(`worktree:${item.worktreeId}`);

                  return (
                    <WorkstreamGroup
                      type="worktree"
                      id={item.worktreeId}
                      title={worktreeData?.displayName || worktreeData?.name || 'Loading...'}
                      isExpanded={isWorktreeExpanded}
                      isActive={item.sessions.some(s => s.id === activeSessionId)}
                      onToggle={() => handleToggleGroup(`worktree:${item.worktreeId}`)}
                      onSelect={() => {
                        const lastActiveSessionId = store.get(worktreeActiveSessionAtom(item.worktreeId));
                        const sessionToSelect = lastActiveSessionId
                          ? item.sessions.find(s => s.id === lastActiveSessionId)
                          : null;
                        const targetSession = sessionToSelect || item.sessions[0];
                        if (targetSession) {
                          onSessionSelect(targetSession.id);
                        }
                      }}
                      sessions={item.sessions}
                      sortBy={sortBy}
                      activeSessionId={activeSessionId}
                      onSessionSelect={onSessionSelect}
                      onChildSessionSelect={onChildSessionSelect}
                      onSessionDelete={onSessionDelete ? handleDeleteSession : undefined}
                      onSessionArchive={handleArchiveSession}
                      onSessionUnarchive={handleUnarchiveSession}
                      onSessionPinToggle={handleSessionPinToggle}
                      onSessionRename={onSessionRename}
                      worktree={worktreeData || { id: item.worktreeId, name: 'Loading...', path: '', branch: '' }}
                      gitStatus={worktreeData?.gitStatus}
                      onWorktreePinToggle={handleWorktreePinToggle}
                      onWorktreeArchive={handleArchiveWorktree}
                      onWorktreeRename={handleWorktreeRename}
                      onWorktreeCleanGitignored={handleCleanGitignored}
                      onFilesMode={onWorktreeFilesMode}
                      onChangesMode={onWorktreeChangesMode}
                      onAddSession={onAddSessionToWorktree}
                      onAddTerminal={onAddTerminalToWorktree}
                    />
                  );
                }
                if (item.type === 'workstream') {
                  const session = item.session;
                  const isWorkstreamExpanded = !collapsedGroups.includes(`workstream:${session.id}`);
                  const isWorkstreamActive = session.id === activeSessionId ||
                                             (activeSessionParentId === session.id);

                  return (
                    <WorkstreamGroup
                      type="workstream"
                      id={session.id}
                      title={session.title || 'Untitled Workstream'}
                      isExpanded={isWorkstreamExpanded}
                      isActive={isWorkstreamActive}
                      onToggle={() => handleToggleGroup(`workstream:${session.id}`)}
                      onSelect={() => onSessionSelect(session.id)}
                      sessions={item.sessions}
                      sortBy={sortBy}
                      activeSessionId={activeSessionId}
                      onSessionSelect={onSessionSelect}
                      onChildSessionSelect={onChildSessionSelect}
                      onSessionDelete={onSessionDelete ? handleDeleteSession : undefined}
                      onSessionArchive={handleArchiveSession}
                      onSessionUnarchive={handleUnarchiveSession}
                      onSessionPinToggle={handleSessionPinToggle}
                      onSessionRename={onSessionRename}
                      provider={session.provider}
                      isPinned={session.isPinned}
                      isArchived={session.isArchived}
                      childCount={session.childCount}
                      projectPath={session.projectPath}
                      onWorkstreamArchive={handleArchiveSession}
                      onWorkstreamPinToggle={handleSessionPinToggle}
                    />
                  );
                }
                if (item.type === 'superLoop') {
                  const isSuperExpanded = !collapsedGroups.includes(`super-loop:${item.loop.id}`);
                  const superWorktreeSessions = worktreeGroupsData.get(item.loop.worktreeId);
                  const isSuperActive = superWorktreeSessions
                    ? superWorktreeSessions.sessions.some(s => s.id === activeSessionId)
                    : false;

                  return (
                    <SuperLoopGroup
                      loopId={item.loop.id}
                      loop={item.loop}
                      isExpanded={isSuperExpanded}
                      isActive={isSuperActive}
                      onToggle={() => handleToggleGroup(`super-loop:${item.loop.id}`)}
                      activeSessionId={activeSessionId}
                      onSessionSelect={onSessionSelect}
                      onArchive={() => handleSuperLoopArchive(item.loop)}
                      onRename={(newName) => handleSuperLoopRename(item.loop.id, newName)}
                      onPinToggle={(isPinned) => handleSuperLoopPinToggle(item.loop.id, isPinned)}
                    />
                  );
                }
                // Regular session
                const session = item.session;
                return (
                  <SessionListItem
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
                    isWorkstream={false}
                    isWorktreeSession={item.isWorktreeSession}
                    parentSessionId={session.parentSessionId}
                    projectPath={session.projectPath}
                    uncommittedCount={session.uncommittedCount}
                    branchedAt={session.branchedAt}
                  />
                );
              }}
            />
          ) : null
        )}
      </div>

      {/* Card view context menu */}
      {cardContextMenu && (
        <div
          ref={cardContextMenuRef}
          className="session-card-context-menu fixed z-[1000] min-w-[140px] p-1 bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded-md shadow-[0_4px_12px_rgba(0,0,0,0.15)]"
          style={{
            left: (adjustedCardMenuPosition || cardContextMenu).x,
            top: (adjustedCardMenuPosition || cardContextMenu).y
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Session menu items */}
          {cardContextMenu.type === 'session' && (
            <>
              {onSessionRename && (
                <button
                  className="session-card-context-menu-item flex items-center gap-2 w-full px-2.5 py-2 bg-transparent border-none rounded text-[var(--nim-text)] text-[0.8125rem] cursor-pointer text-left transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] [&_svg]:shrink-0"
                  onClick={handleCardRename}
                >
                  <MaterialSymbol icon="edit" size={14} />
                  Rename
                </button>
              )}
              <button
                className="session-card-context-menu-item flex items-center gap-2 w-full px-2.5 py-2 bg-transparent border-none rounded text-[var(--nim-text)] text-[0.8125rem] cursor-pointer text-left transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] [&_svg]:shrink-0"
                onClick={handleCardPinToggle}
              >
                <MaterialSymbol icon="push_pin" size={14} />
                {cardContextMenu.isPinned ? 'Unpin' : 'Pin'}
              </button>
              {onSessionBranch && (
                <button
                  className="session-card-context-menu-item flex items-center gap-2 w-full px-2.5 py-2 bg-transparent border-none rounded text-[var(--nim-text)] text-[0.8125rem] cursor-pointer text-left transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] [&_svg]:shrink-0"
                  onClick={handleCardBranch}
                >
                  <MaterialSymbol icon="fork_right" size={14} />
                  Branch conversation
                </button>
              )}
              <button
                className="session-card-context-menu-item flex items-center gap-2 w-full px-2.5 py-2 bg-transparent border-none rounded text-[var(--nim-text)] text-[0.8125rem] cursor-pointer text-left transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] [&_svg]:shrink-0"
                onClick={handleCardArchive}
              >
                {cardContextMenu.isArchived ? (
                  <>
                    <MaterialSymbol icon="unarchive" size={14} />
                    Unarchive Session
                  </>
                ) : (
                  <>
                    <MaterialSymbol icon="archive" size={14} />
                    Archive Session
                  </>
                )}
              </button>
              {onSessionDelete && (
                <button
                  className="session-card-context-menu-item destructive flex items-center gap-2 w-full px-2.5 py-2 bg-transparent border-none rounded text-[var(--nim-error)] text-[0.8125rem] cursor-pointer text-left transition-colors duration-150 hover:bg-[var(--nim-error)] hover:text-white [&_svg]:shrink-0"
                  onClick={handleCardDelete}
                >
                  <MaterialSymbol icon="delete" size={14} />
                  Delete
                </button>
              )}
            </>
          )}

          {/* Workstream menu items */}
          {cardContextMenu.type === 'workstream' && (
            <>
              {onSessionRename && (
                <button
                  className="session-card-context-menu-item flex items-center gap-2 w-full px-2.5 py-2 bg-transparent border-none rounded text-[var(--nim-text)] text-[0.8125rem] cursor-pointer text-left transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] [&_svg]:shrink-0"
                  onClick={handleCardRename}
                >
                  <MaterialSymbol icon="edit" size={14} />
                  Rename
                </button>
              )}
              <button
                className="session-card-context-menu-item flex items-center gap-2 w-full px-2.5 py-2 bg-transparent border-none rounded text-[var(--nim-text)] text-[0.8125rem] cursor-pointer text-left transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] [&_svg]:shrink-0"
                onClick={handleCardPinToggle}
              >
                <MaterialSymbol icon="push_pin" size={14} />
                {cardContextMenu.isPinned ? 'Unpin' : 'Pin'}
              </button>
              <button
                className="session-card-context-menu-item flex items-center gap-2 w-full px-2.5 py-2 bg-transparent border-none rounded text-[var(--nim-text)] text-[0.8125rem] cursor-pointer text-left transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] [&_svg]:shrink-0"
                onClick={handleCardArchive}
              >
                {cardContextMenu.isArchived ? (
                  <>
                    <MaterialSymbol icon="unarchive" size={14} />
                    Unarchive Workstream
                  </>
                ) : (
                  <>
                    <MaterialSymbol icon="archive" size={14} />
                    Archive Workstream
                  </>
                )}
              </button>
            </>
          )}

          {/* Worktree menu items */}
          {cardContextMenu.type === 'worktree' && (
            <>
              <button
                className="session-card-context-menu-item flex items-center gap-2 w-full px-2.5 py-2 bg-transparent border-none rounded text-[var(--nim-text)] text-[0.8125rem] cursor-pointer text-left transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] [&_svg]:shrink-0"
                onClick={handleCardRename}
              >
                <MaterialSymbol icon="edit" size={14} />
                Rename
              </button>
              <button
                className="session-card-context-menu-item flex items-center gap-2 w-full px-2.5 py-2 bg-transparent border-none rounded text-[var(--nim-text)] text-[0.8125rem] cursor-pointer text-left transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] [&_svg]:shrink-0"
                onClick={handleCardPinToggle}
              >
                <MaterialSymbol icon="push_pin" size={14} />
                {cardContextMenu.isPinned ? 'Unpin' : 'Pin'}
              </button>
              {onAddSessionToWorktree && (
                <button
                  className="session-card-context-menu-item flex items-center gap-2 w-full px-2.5 py-2 bg-transparent border-none rounded text-[var(--nim-text)] text-[0.8125rem] cursor-pointer text-left transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] [&_svg]:shrink-0"
                  onClick={handleCardAddSession}
                >
                  <MaterialSymbol icon="add" size={14} />
                  Add Session
                </button>
              )}
              {onAddTerminalToWorktree && (
                <button
                  className="session-card-context-menu-item flex items-center gap-2 w-full px-2.5 py-2 bg-transparent border-none rounded text-[var(--nim-text)] text-[0.8125rem] cursor-pointer text-left transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] [&_svg]:shrink-0"
                  onClick={handleCardAddTerminal}
                >
                  <MaterialSymbol icon="terminal" size={14} />
                  Add Terminal
                </button>
              )}
              <button
                className="session-card-context-menu-item flex items-center gap-2 w-full px-2.5 py-2 bg-transparent border-none rounded text-[var(--nim-text)] text-[0.8125rem] cursor-pointer text-left transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] [&_svg]:shrink-0"
                onClick={handleCardCleanGitignored}
              >
                <MaterialSymbol icon="delete_sweep" size={14} />
                Clear Gitignored Files
              </button>
              <div className="session-card-context-menu-divider h-px my-1 bg-[var(--nim-border)]" />
              <button
                className="session-card-context-menu-item destructive flex items-center gap-2 w-full px-2.5 py-2 bg-transparent border-none rounded text-[var(--nim-error)] text-[0.8125rem] cursor-pointer text-left transition-colors duration-150 hover:bg-[rgba(239,68,68,0.1)] [&_svg]:shrink-0"
                onClick={handleCardArchive}
              >
                <MaterialSymbol icon="archive" size={14} />
                Archive Worktree
              </button>
            </>
          )}
        </div>
      )}

      <ArchiveProgress />
      <IndexBuildDialog
        isOpen={showIndexDialog}
        messageCount={indexMessageCount}
        isBuilding={isIndexBuilding}
        onBuild={handleBuildIndex}
        onSkip={handleSkipIndex}
      />

      {/* Archive worktree confirmation dialog */}
      {archiveWorktreeDialogState && (
        <ArchiveWorktreeDialog
          worktreeName={archiveWorktreeDialogState.worktreeName}
          onArchive={handleConfirmArchiveWorktree}
          onKeep={closeArchiveWorktreeDialog}
          hasUncommittedChanges={archiveWorktreeDialogState.hasUncommittedChanges}
          uncommittedFileCount={archiveWorktreeDialogState.uncommittedFileCount}
        />
      )}

      {/* New Super Loop dialog */}
      <NewSuperLoopDialog workspacePath={workspacePath} />

      {/* New dropdown menu - fixed position outside main container */}
      {newDropdownOpen && newDropdownPosition && (
        <div
          ref={newDropdownMenuRef}
          className="session-history-new-menu fixed min-w-40 bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded overflow-hidden z-[1000] shadow-[0_4px_12px_rgba(0,0,0,0.15)] whitespace-nowrap"
          style={{
            right: `${window.innerWidth - newDropdownPosition.x}px`,
            top: `${newDropdownPosition.y}px`
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {onNewSession && (
            <button
              className="session-history-new-option flex items-center w-full px-3 py-2 text-[13px] bg-transparent border-none text-[var(--nim-text)] cursor-pointer transition-colors duration-150 text-left gap-2 hover:bg-[var(--nim-bg-hover)] [&_svg]:shrink-0 [&_svg]:text-[var(--nim-text-muted)] [&>span]:flex-1"
              data-testid="new-session-button"
              onClick={() => { onNewSession(); setNewDropdownOpen(false); setNewDropdownPosition(null); }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <span>New Session</span>
              <span className="session-history-new-option-shortcut flex-none text-[11px] text-[var(--nim-text-muted)] opacity-70">{getShortcutDisplay(KeyboardShortcuts.file.newSession)}</span>
            </button>
          )}
          {onNewWorktreeSession && (
            <button
              className={`session-history-new-option flex items-center w-full px-3 py-2 text-[13px] bg-transparent border-none text-[var(--nim-text)] cursor-pointer transition-colors duration-150 text-left gap-2 hover:bg-[var(--nim-bg-hover)] [&_svg]:shrink-0 [&_svg]:text-[var(--nim-text-muted)] [&>span]:flex-1 ${!isGitRepo ? 'opacity-50 cursor-not-allowed hover:bg-transparent' : ''}`}
              data-testid="new-worktree-session-button"
              onClick={() => { if (isGitRepo) { onNewWorktreeSession(); setNewDropdownOpen(false); setNewDropdownPosition(null); } }}
              disabled={!isGitRepo}
              title={!isGitRepo ? 'Worktrees require a git repository' : undefined}
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
              <span className="session-history-new-option-shortcut flex-none text-[11px] text-[var(--nim-text-muted)] opacity-70">{getShortcutDisplay(KeyboardShortcuts.window.newWorktree)}</span>
            </button>
          )}
          {onNewBlitz && (
            <button
              className={`session-history-new-option flex items-center w-full px-3 py-2 text-[13px] bg-transparent border-none text-[var(--nim-text)] cursor-pointer transition-colors duration-150 text-left gap-2 hover:bg-[var(--nim-bg-hover)] [&_svg]:shrink-0 [&_svg]:text-[var(--nim-text-muted)] [&>span]:flex-1 ${!isGitRepo ? 'opacity-50 cursor-not-allowed hover:bg-transparent' : ''}`}
              data-testid="new-blitz-button"
              onClick={() => { if (isGitRepo) { onNewBlitz(); setNewDropdownOpen(false); setNewDropdownPosition(null); } }}
              disabled={!isGitRepo}
              title={!isGitRepo ? 'Blitz requires a git repository' : undefined}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 2L4 9h4l-1 5 5-7H8l1-5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>New Blitz</span>
            </button>
          )}
          {onNewTerminal && (
            <button
              className="session-history-new-option flex items-center w-full px-3 py-2 text-[13px] bg-transparent border-none text-[var(--nim-text)] cursor-pointer transition-colors duration-150 text-left gap-2 hover:bg-[var(--nim-bg-hover)] [&_svg]:shrink-0 [&_svg]:text-[var(--nim-text-muted)] [&>span]:flex-1"
              data-testid="new-terminal-button"
              onClick={() => { onNewTerminal(); setNewDropdownOpen(false); setNewDropdownPosition(null); }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 5L7 9L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 13H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <span>New Terminal</span>
            </button>
          )}
          {isSuperLoopsAvailable && (
            <button
              className={`session-history-new-option flex items-center w-full px-3 py-2 text-[13px] bg-transparent border-none text-[var(--nim-text)] cursor-pointer transition-colors duration-150 text-left gap-2 hover:bg-[var(--nim-bg-hover)] [&_svg]:shrink-0 [&_svg]:text-[var(--nim-text-muted)] [&>span]:flex-1 ${!isGitRepo ? 'opacity-50 cursor-not-allowed hover:bg-transparent' : ''}`}
              data-testid="new-super-loop-button"
              onClick={() => { if (isGitRepo) { openSuperLoopDialog(); setNewDropdownOpen(false); setNewDropdownPosition(null); } }}
              disabled={!isGitRepo}
              title={!isGitRepo ? 'Super Loops require a git repository' : undefined}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M13 5.5H9.5M13 5.5L10.5 3M13 5.5L10.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M3 10.5H6.5M3 10.5L5.5 8M3 10.5L5.5 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>New Super Loop</span>
            </button>
          )}
        </div>
      )}
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
  if (prevProps.isGitRepo !== nextProps.isGitRepo) return false;

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

  // Callback presence changes (function vs undefined) affect rendered UI
  if (Boolean(prevProps.onNewBlitz) !== Boolean(nextProps.onNewBlitz)) return false;
  if (Boolean(prevProps.onNewWorktreeSession) !== Boolean(nextProps.onNewWorktreeSession)) return false;

  return true; // Props are equal, skip re-render
});
