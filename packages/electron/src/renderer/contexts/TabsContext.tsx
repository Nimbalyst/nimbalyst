/**
 * TabsContext - Manages tab state outside of component tree
 *
 * This context exists to prevent re-render cascades. When tabs change,
 * only components that explicitly subscribe to tabs will re-render,
 * not the entire EditorMode tree.
 */

import React, { createContext, useContext, useRef, useCallback, useSyncExternalStore, useMemo } from 'react';
import { getFileName } from '../utils/pathUtils';
import { isCollabUri } from '../utils/collabUri';
import { store as jotaiStore, editorDirtyAtom, makeEditorKey } from '@nimbalyst/runtime/store';

export interface TabData {
  id: string;
  filePath: string;
  fileName: string;
  content: string;
  isDirty: boolean;
  isPinned: boolean;
  editorState?: any;
  scrollPosition?: number;
  cursorPosition?: {
    line: number;
    column: number;
  };
  lastSaved?: Date;
  contentHash?: string;
  contentLoadedAt?: Date;
  isVirtual?: boolean;
}

interface TabsStore {
  tabs: Map<string, TabData>;
  tabOrder: string[];
  activeTabId: string | null;
  closedTabs: TabData[];
}

interface TabsContextValue {
  // Subscribe to store changes (for useSyncExternalStore)
  subscribe: (callback: () => void) => () => void;
  getSnapshot: () => TabsStore;

  // Actions (don't trigger re-renders in caller)
  addTab: (filePath: string, content?: string, switchToTab?: boolean) => string | null;
  removeTab: (tabId: string) => void;
  switchTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<TabData>) => void;
  togglePin: (tabId: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  findTabByPath: (filePath: string) => TabData | undefined;
  saveTabState: (tabId: string, state: Partial<TabData>) => void;
  getTabState: (tabId: string) => TabData | undefined;
  closeAllTabs: () => void;
  closeSavedTabs: () => void;
  reopenLastClosedTab: (fileSelectFn: (filePath: string) => Promise<void>) => Promise<void>;
}

const TabsContext = createContext<TabsContextValue | null>(null);

// Simple hash function for content validation
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

interface TabsProviderProps {
  children: React.ReactNode;
  workspacePath: string | null;
  onTabClose?: (tab: TabData) => void;
  getNavigationState?: () => any;
  /** If true, tabs are not persisted to/restored from workspace state. Useful for session-specific editors. */
  disablePersistence?: boolean;
}

export function TabsProvider({
  children,
  workspacePath,
  onTabClose,
  getNavigationState,
  disablePersistence = false
}: TabsProviderProps) {
  if (import.meta.env.DEV) console.log('[TabsProvider] render');
  // Store state in refs to avoid re-renders
  // We keep mutable state in storeRef and create immutable snapshots for useSyncExternalStore
  const storeRef = useRef<TabsStore>({
    tabs: new Map(),
    tabOrder: [],
    activeTabId: null,
    closedTabs: []
  });

  // Immutable snapshot for useSyncExternalStore - only updated when notify() is called
  const snapshotRef = useRef<TabsStore>(storeRef.current);

  const listenersRef = useRef<Set<() => void>>(new Set());
  const tabIdCounter = useRef(0);
  const onTabCloseRef = useRef(onTabClose);
  const getNavigationStateRef = useRef(getNavigationState);
  const hasRestoredRef = useRef(false);
  const lastSavedStateRef = useRef<string>('');
  const reopeningRef = useRef(false);
  const prevActiveTabIdRef = useRef<string | null>(null);

  // Keep refs updated
  onTabCloseRef.current = onTabClose;
  getNavigationStateRef.current = getNavigationState;

  const MAX_CLOSED_TAB_HISTORY = 10;

  // Notify all subscribers - creates a new snapshot so useSyncExternalStore detects the change
  const notify = useCallback(() => {
    console.log('[TABS] notify() called');
    // Create a new snapshot object so reference comparison detects the change
    snapshotRef.current = {
      tabs: new Map(storeRef.current.tabs),
      tabOrder: [...storeRef.current.tabOrder],
      activeTabId: storeRef.current.activeTabId,
      closedTabs: [...storeRef.current.closedTabs]
    };
    listenersRef.current.forEach(listener => listener());
  }, []);

  // Subscribe function for useSyncExternalStore
  const subscribe = useCallback((callback: () => void) => {
    listenersRef.current.add(callback);
    return () => {
      listenersRef.current.delete(callback);
    };
  }, []);

  // Get current snapshot - returns the immutable snapshot
  const getSnapshot = useCallback(() => snapshotRef.current, []);

  // Generate unique tab ID
  const generateTabId = useCallback((): string => {
    tabIdCounter.current += 1;
    return `tab-${Date.now()}-${tabIdCounter.current}`;
  }, []);

  // Remove a tab
  const removeTab = useCallback((tabId: string): void => {
    const store = storeRef.current;
    const tab = store.tabs.get(tabId);
    if (!tab) return;

    // Add to closed tabs history
    store.closedTabs = [tab, ...store.closedTabs].slice(0, MAX_CLOSED_TAB_HISTORY);

    // Call onTabClose callback
    onTabCloseRef.current?.(tab);

    // Get the index BEFORE removing from tabOrder
    const currentIndex = store.tabOrder.indexOf(tabId);

    // Remove from tabs
    store.tabs.delete(tabId);
    store.tabOrder = store.tabOrder.filter(id => id !== tabId);

    // Stop watching file (skip virtual and collaborative documents)
    if (window.electronAPI && !tab.filePath.startsWith('virtual://') && !isCollabUri(tab.filePath)) {
      window.electronAPI.invoke('stop-watching-file', tab.filePath).catch(() => {});
    }

    // Update active tab if needed
    if (store.activeTabId === tabId) {
      if (store.tabOrder.length > 0) {
        // Select the tab at the same index, or the last tab if we were at the end
        const newIndex = Math.min(currentIndex, store.tabOrder.length - 1);
        store.activeTabId = store.tabOrder[newIndex] || null;
      } else {
        store.activeTabId = null;
      }
    }

    notify();
  }, [notify]);

  // Add a tab
  const addTab = useCallback((filePath: string, content: string = '', switchToTab: boolean = true): string | null => {
    const store = storeRef.current;

    // Check if tab already exists
    const existingTab = Array.from(store.tabs.values()).find(tab => tab.filePath === filePath);
    if (existingTab) {
      if (switchToTab && store.activeTabId !== existingTab.id) {
        store.activeTabId = existingTab.id;
        notify();
      }
      return existingTab.id;
    }

    const tabId = generateTabId();
    const fileName = getFileName(filePath);

    const newTab: TabData = {
      id: tabId,
      filePath,
      fileName,
      content,
      isDirty: false,
      isPinned: false,
      contentHash: simpleHash(content),
      contentLoadedAt: new Date()
    };

    store.tabs.set(tabId, newTab);

    // Add new tabs to the end of the tab order
    store.tabOrder.push(tabId);

    if (switchToTab) {
      store.activeTabId = tabId;
    }

    // Start watching file (skip virtual and collaborative documents)
    if (window.electronAPI && !filePath.startsWith('virtual://') && !isCollabUri(filePath)) {
      window.electronAPI.invoke('start-watching-file', filePath).catch(() => {});
    }

    notify();

    return tabId;
  }, [generateTabId, notify]);

  // Switch to a tab
  const switchTab = useCallback((tabId: string): void => {
    const store = storeRef.current;
    if (!store.tabs.has(tabId) || store.activeTabId === tabId) return;

    store.activeTabId = tabId;
    notify();
  }, [notify]);

  // Update a tab
  // Only notifies subscribers if structural changes occurred (filePath, fileName changed)
  // Metadata changes (isDirty, lastSaved, content) don't trigger re-renders
  const updateTab = useCallback((tabId: string, updates: Partial<TabData>): void => {
    const store = storeRef.current;
    const tab = store.tabs.get(tabId);
    if (!tab) return;

    // Check if this is a structural change that affects rendering
    const isStructuralChange =
      updates.filePath !== undefined && updates.filePath !== tab.filePath ||
      updates.fileName !== undefined && updates.fileName !== tab.fileName;

    store.tabs.set(tabId, { ...tab, ...updates });

    // Only notify for structural changes - metadata changes don't need re-renders
    if (isStructuralChange) {
      notify();
    }
  }, [notify]);

  // Toggle pin status
  const togglePin = useCallback((tabId: string): void => {
    const store = storeRef.current;
    const tab = store.tabs.get(tabId);
    if (!tab) return;

    const newIsPinned = !tab.isPinned;
    store.tabs.set(tabId, { ...tab, isPinned: newIsPinned });

    // Reorder tabs
    const currentIndex = store.tabOrder.indexOf(tabId);
    if (currentIndex === -1) return;

    const newOrder = [...store.tabOrder];
    newOrder.splice(currentIndex, 1);

    if (newIsPinned) {
      let insertIndex = 0;
      for (let i = 0; i < newOrder.length; i++) {
        const t = store.tabs.get(newOrder[i]);
        if (t?.isPinned) {
          insertIndex = i + 1;
        } else {
          break;
        }
      }
      newOrder.splice(insertIndex, 0, tabId);
    } else {
      let insertIndex = newOrder.length;
      for (let i = 0; i < newOrder.length; i++) {
        const t = store.tabs.get(newOrder[i]);
        if (!t?.isPinned) {
          insertIndex = i;
          break;
        }
      }
      newOrder.splice(insertIndex, 0, tabId);
    }

    store.tabOrder = newOrder;
    notify();
  }, [notify]);

  // Reorder tabs
  const reorderTabs = useCallback((fromIndex: number, toIndex: number): void => {
    const store = storeRef.current;
    if (fromIndex === toIndex) return;

    const newOrder = [...store.tabOrder];
    const [movedTab] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, movedTab);

    store.tabOrder = newOrder;
    notify();
  }, [notify]);

  // Find tab by path
  const findTabByPath = useCallback((filePath: string): TabData | undefined => {
    return Array.from(storeRef.current.tabs.values()).find(tab => tab.filePath === filePath);
  }, []);

  // Save tab state
  const saveTabState = useCallback((tabId: string, state: Partial<TabData>): void => {
    updateTab(tabId, state);
  }, [updateTab]);

  // Get tab state
  const getTabState = useCallback((tabId: string): TabData | undefined => {
    return storeRef.current.tabs.get(tabId);
  }, []);

  // Close all tabs
  const closeAllTabs = useCallback((): void => {
    const store = storeRef.current;
    Array.from(store.tabs.keys()).forEach(tabId => {
      removeTab(tabId);
    });
  }, [removeTab]);

  // Close saved tabs (checks Jotai atoms for dirty state - source of truth)
  const closeSavedTabs = useCallback((): void => {
    const store = storeRef.current;
    Array.from(store.tabs.values())
      .filter(tab => {
        const editorKey = makeEditorKey(tab.filePath);
        const isDirty = jotaiStore.get(editorDirtyAtom(editorKey));
        return !isDirty;
      })
      .forEach(tab => removeTab(tab.id));
  }, [removeTab]);

  // Reopen last closed tab
  const reopenLastClosedTab = useCallback(async (fileSelectFn: (filePath: string) => Promise<void>): Promise<void> => {
    if (reopeningRef.current) return;

    const store = storeRef.current;
    if (store.closedTabs.length === 0) return;

    reopeningRef.current = true;

    try {
      let newClosedTabs = [...store.closedTabs];
      let i = 0;

      while (i < newClosedTabs.length) {
        const candidateTab = newClosedTabs[i];
        const existingTab = Array.from(store.tabs.values()).find(tab => tab.filePath === candidateTab.filePath);

        if (!existingTab) {
          try {
            await fileSelectFn(candidateTab.filePath);
            newClosedTabs = newClosedTabs.slice(i + 1);
            store.closedTabs = newClosedTabs;
            notify();
            return;
          } catch {
            newClosedTabs.splice(i, 1);
            continue;
          }
        }
        i++;
      }

      if (newClosedTabs.length !== store.closedTabs.length) {
        store.closedTabs = newClosedTabs;
        notify();
      }
    } finally {
      reopeningRef.current = false;
    }
  }, [notify]);

  // Restore tabs from storage on mount
  React.useEffect(() => {
    if (disablePersistence || !workspacePath || !window.electronAPI?.invoke) return;

    const timer = setTimeout(async () => {
      try {
        const workspaceState = await window.electronAPI!.invoke('workspace:get-state', workspacePath);
        const savedState = workspaceState?.tabs;

        if (savedState?.tabs?.length > 0) {
          hasRestoredRef.current = true;

          const store = storeRef.current;
          const restoredTabs = new Map<string, TabData>();
          const restoredOrder: string[] = [];

          for (const tabData of savedState.tabs) {
            // Skip collab tabs -- they need fresh auth/crypto config
            // that only exists in-memory from openCollabDocument()
            if (isCollabUri(tabData.filePath)) continue;

            restoredTabs.set(tabData.id, {
              ...tabData,
              content: '',
              lastSaved: tabData.lastSaved ? new Date(tabData.lastSaved) : undefined,
              contentHash: undefined,
              contentLoadedAt: undefined
            });
            restoredOrder.push(tabData.id);
          }

          store.tabs = restoredTabs;
          store.tabOrder = restoredOrder;

          if (savedState.closedTabs?.length > 0) {
            store.closedTabs = savedState.closedTabs.map((tabData: any) => ({
              ...tabData,
              content: '',
              lastSaved: tabData.lastSaved ? new Date(tabData.lastSaved) : undefined,
              contentHash: undefined,
              contentLoadedAt: undefined
            }));
          }

          // Start watching all restored tabs (skip virtual and collaborative documents)
          if (window.electronAPI) {
            for (const tab of restoredTabs.values()) {
              if (!tab.filePath.startsWith('virtual://') && !isCollabUri(tab.filePath)) {
                window.electronAPI.invoke('start-watching-file', tab.filePath).catch(() => {});
              }
            }
          }

          if (savedState.activeTabId && restoredTabs.has(savedState.activeTabId)) {
            store.activeTabId = savedState.activeTabId;
          }

          notify();

          console.log('[TABS] Restored', restoredTabs.size, 'tabs, active:', savedState.activeTabId);
        }
      } catch (error) {
        console.error('[TABS] Failed to restore tab state:', error);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [disablePersistence, workspacePath, notify]);

  // Save tabs to storage when they change
  React.useEffect(() => {
    if (disablePersistence || !workspacePath || !window.electronAPI?.invoke) return;

    const saveState = async () => {
      const store = storeRef.current;

      if (!hasRestoredRef.current && store.tabs.size === 0) return;

      const tabsArray = store.tabOrder
        .map(id => store.tabs.get(id))
        .filter((tab): tab is TabData => tab !== undefined)
        // Skip collab tabs -- they can't be restored without crypto keys
        .filter(tab => !isCollabUri(tab.filePath))
        .map(tab => ({
          id: tab.id,
          filePath: tab.filePath,
          fileName: tab.fileName,
          isDirty: tab.isDirty,
          isPinned: tab.isPinned,
          isVirtual: tab.isVirtual,
          lastSaved: tab.lastSaved?.toISOString()
        }));

      const closedTabsArray = store.closedTabs.map(tab => ({
        id: tab.id,
        filePath: tab.filePath,
        fileName: tab.fileName,
        isDirty: tab.isDirty,
        isPinned: tab.isPinned,
        isVirtual: tab.isVirtual,
        lastSaved: tab.lastSaved?.toISOString()
      }));

      const navigationState = getNavigationStateRef.current?.();

      const stateToSave = {
        tabs: tabsArray,
        activeTabId: store.activeTabId,
        tabOrder: store.tabOrder,
        closedTabs: closedTabsArray,
        navigationState
      };

      const stateString = JSON.stringify(stateToSave);
      if (stateString !== lastSavedStateRef.current) {
        try {
          await window.electronAPI!.invoke('workspace:update-state', workspacePath, {
            tabs: stateToSave,
            navigationHistory: stateToSave.navigationState
          });
          lastSavedStateRef.current = stateString;
        } catch (error) {
          console.error('[TABS] Failed to save tab state:', error);
        }
      }
    };

    // Subscribe to changes for saving
    const unsubscribe = subscribe(() => {
      if (storeRef.current.tabs.size > 0) {
        saveState();
      }
    });

    // Also save periodically
    const interval = setInterval(saveState, 30000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [disablePersistence, workspacePath, subscribe]);

  const contextValue: TabsContextValue = {
    subscribe,
    getSnapshot,
    addTab,
    removeTab,
    switchTab,
    updateTab,
    togglePin,
    reorderTabs,
    findTabByPath,
    saveTabState,
    getTabState,
    closeAllTabs,
    closeSavedTabs,
    reopenLastClosedTab
  };

  return (
    <TabsContext.Provider value={contextValue}>
      {children}
    </TabsContext.Provider>
  );
}

// Hook to get tabs data (subscribes to changes)
export function useTabs() {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('useTabs must be used within a TabsProvider');
  }

  const store = useSyncExternalStore(
    context.subscribe,
    context.getSnapshot
  );

  // Memoize derived values to prevent unnecessary re-renders
  const tabs = useMemo(
    () => store.tabOrder.map(id => store.tabs.get(id)!).filter(Boolean),
    [store.tabOrder, store.tabs]
  );

  const activeTab = useMemo(
    () => store.activeTabId ? store.tabs.get(store.activeTabId) || null : null,
    [store.activeTabId, store.tabs]
  );

  return {
    tabs,
    activeTab,
    activeTabId: store.activeTabId,
    addTab: context.addTab,
    removeTab: context.removeTab,
    switchTab: context.switchTab,
    updateTab: context.updateTab,
    togglePin: context.togglePin,
    reorderTabs: context.reorderTabs,
    findTabByPath: context.findTabByPath,
    saveTabState: context.saveTabState,
    getTabState: context.getTabState,
    closeAllTabs: context.closeAllTabs,
    closeSavedTabs: context.closeSavedTabs,
    reopenLastClosedTab: context.reopenLastClosedTab
  };
}

// Hook to get ONLY tab actions (doesn't subscribe to changes - no re-renders)
export function useTabsActions() {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('useTabsActions must be used within a TabsProvider');
  }

  return {
    addTab: context.addTab,
    removeTab: context.removeTab,
    switchTab: context.switchTab,
    updateTab: context.updateTab,
    togglePin: context.togglePin,
    reorderTabs: context.reorderTabs,
    findTabByPath: context.findTabByPath,
    saveTabState: context.saveTabState,
    getTabState: context.getTabState,
    closeAllTabs: context.closeAllTabs,
    closeSavedTabs: context.closeSavedTabs,
    reopenLastClosedTab: context.reopenLastClosedTab,
    // Also expose getSnapshot for components that need to read state imperatively
    getSnapshot: context.getSnapshot,
    // Expose subscribe for components that need custom subscription logic
    subscribe: context.subscribe
  };
}

// Hook to check if there's an active tab (minimal subscription for conditional rendering)
export function useHasActiveTab(): boolean {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('useHasActiveTab must be used within a TabsProvider');
  }

  const store = useSyncExternalStore(
    context.subscribe,
    context.getSnapshot
  );

  return store.activeTabId !== null;
}

// Dirty state subscription system - allows individual tabs to subscribe to their dirty state
// without causing the entire tab bar to re-render
const dirtyStateListeners = new Map<string, Set<(isDirty: boolean) => void>>();

export function subscribeToDirtyState(tabId: string, callback: (isDirty: boolean) => void): () => void {
  if (!dirtyStateListeners.has(tabId)) {
    dirtyStateListeners.set(tabId, new Set());
  }
  dirtyStateListeners.get(tabId)!.add(callback);

  return () => {
    const listeners = dirtyStateListeners.get(tabId);
    if (listeners) {
      listeners.delete(callback);
      if (listeners.size === 0) {
        dirtyStateListeners.delete(tabId);
      }
    }
  };
}

export function notifyDirtyStateChange(tabId: string, isDirty: boolean): void {
  const listeners = dirtyStateListeners.get(tabId);
  if (listeners) {
    listeners.forEach(callback => callback(isDirty));
  }
}

// Hook to subscribe to a specific tab's dirty state
export function useTabDirtyState(tabId: string, initialDirty: boolean = false): boolean {
  const [isDirty, setIsDirty] = React.useState(initialDirty);

  React.useEffect(() => {
    const unsubscribe = subscribeToDirtyState(tabId, setIsDirty);
    return unsubscribe;
  }, [tabId]);

  return isDirty;
}
