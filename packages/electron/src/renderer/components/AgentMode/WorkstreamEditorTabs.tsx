/**
 * WorkstreamEditorTabs - File editor tabs at the workstream level.
 *
 * This component manages open files for the entire workstream (not per-session).
 * Files edited by any session in the workstream appear here.
 *
 * Uses TabsProvider + TabManager + TabContent pattern like SessionEditorArea,
 * but scoped to the workstream rather than a single session.
 *
 * Tab state is persisted to workspace state using a custom key per workstream.
 */

import React, { useCallback, useRef, forwardRef, useImperativeHandle, useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { TabsProvider, useTabs, useTabsActions } from '../../contexts/TabsContext';
import { TabManager } from '../TabManager/TabManager';
import { TabContent } from '../TabContent/TabContent';
import { setSessionTabCountAtom } from '../../store';
import { workstreamStateAtom } from '../../store/atoms/workstreamState';

// Current tab state - always kept up to date for sync flush on unmount
const currentTabState = new Map<string, {
  workspacePath: string;
  tabs: Array<{ filePath: string; id: string }>;
  activeTabId: string | null;
}>();

// Debounce timer for persisting tabs
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Actually perform the persist to workspace state.
 */
async function doPersist(workstreamId: string): Promise<void> {
  const data = currentTabState.get(workstreamId);
  if (!data) return;

  persistTimers.delete(workstreamId);

  try {
    const workspaceState = await window.electronAPI.invoke('workspace:get-state', data.workspacePath);
    const existingStates = workspaceState?.workstreamEditorStates ?? {};

    await window.electronAPI.invoke('workspace:update-state', data.workspacePath, {
      workstreamEditorStates: {
        ...existingStates,
        [workstreamId]: {
          openTabs: data.tabs.map(t => ({
            filePath: t.filePath,
            isActive: t.id === data.activeTabId,
          })),
        },
      },
    });
    console.log('[WorkstreamEditorTabs] Persisted to workspace state:', workstreamId, data.tabs.length, 'tabs');
  } catch (err) {
    console.error('[WorkstreamEditorTabs] Failed to persist tabs:', err);
  }
}

/**
 * Update current tab state and schedule persist to workspace state.
 * Debounced to avoid excessive IPC calls.
 */
function updateTabState(
  workstreamId: string,
  workspacePath: string,
  tabs: Array<{ filePath: string; id: string }>,
  activeTabId: string | null
): void {
  // Always keep current state up to date (for sync flush on unmount)
  currentTabState.set(workstreamId, { workspacePath, tabs, activeTabId });

  // Clear existing timer
  const existingTimer = persistTimers.get(workstreamId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Schedule persistence to workspace state
  const timer = setTimeout(() => doPersist(workstreamId), 500);
  persistTimers.set(workstreamId, timer);
}

/**
 * Flush current tab state to sessionStorage synchronously on unmount.
 * This ensures tabs are available immediately when switching back.
 */
function flushToSessionStorage(workstreamId: string): void {
  // Cancel any pending async persist
  const existingTimer = persistTimers.get(workstreamId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    persistTimers.delete(workstreamId);
  }

  const data = currentTabState.get(workstreamId);
  if (!data || data.tabs.length === 0) {
    console.log('[WorkstreamEditorTabs] Nothing to flush for:', workstreamId);
    return;
  }

  // Store in sessionStorage synchronously
  const key = `workstream-tabs-${workstreamId}`;
  const value = JSON.stringify({
    openTabs: data.tabs.map(t => ({
      filePath: t.filePath,
      isActive: t.id === data.activeTabId,
    })),
  });
  sessionStorage.setItem(key, value);
  console.log('[WorkstreamEditorTabs] Flushed to sessionStorage:', workstreamId, data.tabs.length, 'tabs');

  // Fire async persist with the data BEFORE deleting from currentTabState
  // This ensures workspace state also gets updated
  const dataCopy = { ...data };
  currentTabState.delete(workstreamId);

  // Persist to workspace state asynchronously (won't block unmount)
  (async () => {
    try {
      const workspaceState = await window.electronAPI.invoke('workspace:get-state', dataCopy.workspacePath);
      const existingStates = workspaceState?.workstreamEditorStates ?? {};

      await window.electronAPI.invoke('workspace:update-state', dataCopy.workspacePath, {
        workstreamEditorStates: {
          ...existingStates,
          [workstreamId]: {
            openTabs: dataCopy.tabs.map(t => ({
              filePath: t.filePath,
              isActive: t.id === dataCopy.activeTabId,
            })),
          },
        },
      });
      console.log('[WorkstreamEditorTabs] Async persisted on unmount:', workstreamId);
    } catch (err) {
      console.error('[WorkstreamEditorTabs] Failed to persist on unmount:', err);
    }
  })();
}

/**
 * Load persisted workstream tabs.
 * First checks sessionStorage (sync backup), then workspace state.
 */
async function loadWorkstreamTabs(
  workstreamId: string,
  workspacePath: string
): Promise<{ filePath: string; isActive: boolean }[] | null> {
  // First check sessionStorage (synchronous backup from flush)
  const sessionKey = `workstream-tabs-${workstreamId}`;
  const sessionData = sessionStorage.getItem(sessionKey);
  if (sessionData) {
    try {
      const parsed = JSON.parse(sessionData);
      if (parsed?.openTabs?.length > 0) {
        console.log('[WorkstreamEditorTabs] Loaded from sessionStorage:', workstreamId);
        // Clear it after loading so workspace state takes over next time
        sessionStorage.removeItem(sessionKey);
        return parsed.openTabs;
      }
    } catch (e) {
      console.error('[WorkstreamEditorTabs] Failed to parse sessionStorage:', e);
    }
  }

  // Fall back to workspace state
  try {
    const workspaceState = await window.electronAPI.invoke('workspace:get-state', workspacePath);
    const saved = workspaceState?.workstreamEditorStates?.[workstreamId];
    if (saved?.openTabs) {
      console.log('[WorkstreamEditorTabs] Loaded from workspace state:', workstreamId);
      return saved.openTabs;
    }
  } catch (err) {
    console.error('[WorkstreamEditorTabs] Failed to load tabs:', err);
  }
  return null;
}

export interface WorkstreamEditorTabsRef {
  openFile: (filePath: string) => void;
  hasTabs: () => boolean;
  getActiveFilePath: () => string | null;
  closeActiveTab: () => void;
  /** Get the active tab's full data including content */
  getActiveTab: () => { filePath: string; content: string } | null;
}

interface WorkstreamEditorTabsProps {
  workstreamId: string;
  workspacePath: string;
  basePath?: string; // Optional base path for file operations (defaults to workspacePath). Used for worktrees.
  isActive?: boolean;
}

/**
 * Inner component that uses TabsContext.
 * Must be wrapped in TabsProvider.
 */
interface WorkstreamEditorTabsInnerProps {
  workstreamId: string;
  workspacePath: string;
  basePath: string; // Base path for TabContent (workspacePath or worktreePath)
  isActive: boolean;
}

const WorkstreamEditorTabsInner = forwardRef<WorkstreamEditorTabsRef, WorkstreamEditorTabsInnerProps>(
  function WorkstreamEditorTabsInner({ workstreamId, workspacePath, basePath, isActive }, ref) {
    const { tabs, activeTabId } = useTabs();
    const tabsActions = useTabsActions();
    const setTabCount = useSetAtom(setSessionTabCountAtom);
    const workstreamState = useAtomValue(workstreamStateAtom(workstreamId));
    const setWorkstreamState = useSetAtom(workstreamStateAtom(workstreamId));
    const prevTabCountRef = useRef(tabs.length);
    // Track restore state: 'pending' -> 'restoring' -> 'done'
    const restoreStateRef = useRef<'pending' | 'restoring' | 'done'>('pending');

    // Restore tabs from workstream state on mount
    useEffect(() => {
      if (restoreStateRef.current !== 'pending') {
        console.log('[WorkstreamEditorTabs] Skipping restore, state:', restoreStateRef.current);
        return;
      }
      restoreStateRef.current = 'restoring';
      console.log('[WorkstreamEditorTabs] Starting restore for workstream:', workstreamId);

      // Restore from workstream state (unified source of truth)
      const { openFilePaths, activeFilePath } = workstreamState;
      console.log('[WorkstreamEditorTabs] Restoring from workstream state:', openFilePaths.length, 'files, active:', activeFilePath);

      if (openFilePaths.length > 0) {
        // Add all tabs
        for (const filePath of openFilePaths) {
          console.log('[WorkstreamEditorTabs] Adding tab:', filePath);
          tabsActions.addTab(filePath);
        }

        // Switch to the active tab
        if (activeFilePath) {
          const foundTab = tabsActions.findTabByPath(activeFilePath);
          if (foundTab) {
            tabsActions.switchTab(foundTab.id);
          }
        }
      }

      // Mark restore complete - now we can persist changes
      restoreStateRef.current = 'done';
      console.log('[WorkstreamEditorTabs] Restore complete');
    }, [workstreamId, workstreamState, tabsActions]);

    // Sync tab count to Jotai atom and persist tabs when they change
    useEffect(() => {
      console.log('[WorkstreamEditorTabs] Persist effect running, tabs:', tabs.length, 'restoreState:', restoreStateRef.current);

      if (tabs.length !== prevTabCountRef.current) {
        prevTabCountRef.current = tabs.length;
        setTabCount({ sessionId: workstreamId, count: tabs.length });
      }

      // Always sync to workstream state atom (even during restore)
      const activeFilePath = activeTabId ? tabs.find(t => t.id === activeTabId)?.filePath || null : null;
      setWorkstreamState({
        openFilePaths: tabs.map(t => t.filePath),
        activeFilePath,
      });
      console.log('[WorkstreamEditorTabs] Synced workstream state:', tabs.length, 'tabs');

      // Only persist to IPC after restore is complete to avoid overwriting saved state
      if (restoreStateRef.current === 'done') {
        console.log('[WorkstreamEditorTabs] Persisting tabs to workspace state:', tabs.map(t => t.filePath), 'active:', activeTabId);
        updateTabState(workstreamId, workspacePath, tabs, activeTabId);
      } else {
        console.log('[WorkstreamEditorTabs] Skipping IPC persist (still restoring), state:', restoreStateRef.current);
      }
    }, [tabs, tabs.length, activeTabId, workstreamId, workspacePath, setTabCount, setWorkstreamState]);

    // Flush pending persist on unmount to ensure tabs are saved before switching workstreams
    useEffect(() => {
      return () => {
        console.log('[WorkstreamEditorTabs] Unmounting, flushing persist for:', workstreamId);
        flushToSessionStorage(workstreamId);
      };
    }, [workstreamId]);

    // Expose current document path and workspace path to window for plugins (e.g., MockupPlatformService)
    // This mirrors what EditorMode does, but for workstream editor tabs
    // basePath can be either workspacePath (main project) or worktreePath (for worktree sessions)
    useEffect(() => {
      const activeFilePath = activeTabId ? tabs.find(t => t.id === activeTabId)?.filePath || null : null;
      (window as any).__currentDocumentPath = activeFilePath;
      (window as any).__workspacePath = basePath;
      // Also set the legacy property for compatibility
      (window as any).workspacePath = basePath;
    }, [activeTabId, tabs, basePath]);

    // Expose methods via ref
    useImperativeHandle(
      ref,
      () => ({
        openFile: (filePath: string) => {
          // Check if tab already exists
          const existing = tabsActions.findTabByPath(filePath);
          if (existing) {
            tabsActions.switchTab(existing.id);
            return;
          }

          // Add new tab
          tabsActions.addTab(filePath);
          // Workstream state will be synced via the tabs useEffect
        },
        hasTabs: () => tabs.length > 0,
        getActiveFilePath: () => {
          if (!activeTabId) return null;
          const activeTab = tabs.find((t) => t.id === activeTabId);
          return activeTab?.filePath || null;
        },
        closeActiveTab: () => {
          if (activeTabId) {
            tabsActions.removeTab(activeTabId);
          }
        },
        getActiveTab: () => {
          if (!activeTabId) return null;
          const tabState = tabsActions.getTabState(activeTabId);
          if (!tabState) return null;
          return {
            filePath: tabState.filePath,
            content: tabState.content || '',
          };
        },
      }),
      [tabs, activeTabId, tabsActions]
    );

    const handleTabClose = useCallback((tabId: string) => {
      tabsActions.removeTab(tabId);
    }, [tabsActions]);

    const handleNewTab = useCallback(() => {
      // No-op for now - files are opened via file clicks
    }, []);

    // Don't render anything if no tabs
    if (tabs.length === 0) {
      return null;
    }

    return (
      <div className="workstream-editor-tabs flex flex-col h-full overflow-hidden">
        <div className="workstream-editor-header shrink-0">
          <TabManager
            onTabClose={handleTabClose}
            onNewTab={handleNewTab}
            hideTabBar={false}
            isActive={isActive}
          >
            <></>
          </TabManager>
        </div>
        <div className="workstream-editor-tabs-content flex-1 min-h-0 overflow-hidden">
          <TabContent workspaceId={basePath} />
        </div>
      </div>
    );
  }
);

/**
 * WorkstreamEditorTabs - wraps inner component with TabsProvider.
 *
 * Each workstream gets its own TabsProvider context, isolating file tabs
 * from the main workspace tabs.
 *
 * Tab state is persisted to workstreamEditorStates in workspace state.
 */
export const WorkstreamEditorTabs = forwardRef<WorkstreamEditorTabsRef, WorkstreamEditorTabsProps>(
  function WorkstreamEditorTabs({ workstreamId, workspacePath, basePath, isActive = true }, ref) {
    const innerRef = useRef<WorkstreamEditorTabsRef>(null);
    // Use basePath if provided, otherwise fall back to workspacePath
    const effectiveBasePath = basePath || workspacePath;

    // Forward ref to inner component
    useImperativeHandle(ref, () => ({
      openFile: (filePath: string) => innerRef.current?.openFile(filePath),
      hasTabs: () => innerRef.current?.hasTabs() ?? false,
      getActiveFilePath: () => innerRef.current?.getActiveFilePath() ?? null,
      closeActiveTab: () => innerRef.current?.closeActiveTab(),
      getActiveTab: () => innerRef.current?.getActiveTab() ?? null,
    }), []);

    return (
      <TabsProvider workspacePath={effectiveBasePath} disablePersistence>
        <WorkstreamEditorTabsInner
          ref={innerRef}
          workstreamId={workstreamId}
          workspacePath={workspacePath}
          basePath={effectiveBasePath}
          isActive={isActive}
        />
      </TabsProvider>
    );
  }
);

WorkstreamEditorTabs.displayName = 'WorkstreamEditorTabs';
