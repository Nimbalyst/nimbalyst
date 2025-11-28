import { useState, useCallback, useRef, useEffect } from 'react';
import { editorRegistry } from '@nimbalyst/runtime/ai/EditorRegistry';
import { getFileName } from '../utils/pathUtils';

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
  // Track the content hash to detect mismatches
  contentHash?: string;
  // Track when content was last loaded from file
  contentLoadedAt?: Date;
  // Virtual document flag
  isVirtual?: boolean;
}

interface UseTabsOptions {
  maxTabs?: number;
  enabled?: boolean;
  onTabChange?: (tab: TabData) => void;
  onTabClose?: (tab: TabData) => void;
  workspacePath?: string | null;
}

interface UseTabsResult {
  tabs: TabData[];
  activeTab: TabData | null;
  activeTabId: string | null;
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

// Simple hash function for content validation
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}

export function useTabs(options: UseTabsOptions & { getNavigationState?: () => any } = {}): UseTabsResult {
  const {
    maxTabs = Infinity, // Unlimited by default - EditorPool manages memory
    enabled = true,
    onTabChange,
    onTabClose,
    getNavigationState,
    workspacePath
  } = options;

  const [tabs, setTabs] = useState<Map<string, TabData>>(new Map());
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [tabOrder, setTabOrder] = useState<string[]>([]);
  const [closedTabs, setClosedTabs] = useState<TabData[]>([]);
  const tabIdCounter = useRef(0);
  const reopeningRef = useRef(false); // Track if we're currently reopening a tab

  const MAX_CLOSED_TAB_HISTORY = 10;

  // Generate unique tab ID
  const generateTabId = useCallback((): string => {
    tabIdCounter.current += 1;
    return `tab-${Date.now()}-${tabIdCounter.current}`;
  }, []);

  // Get active tab
  const activeTab = activeTabId ? tabs.get(activeTabId) || null : null;

  // Remove a tab (defined first because addTab depends on it)
  const removeTab = useCallback((tabId: string): void => {
    // console.log('[useTabs] removeTab called with tabId:', tabId);
    const tab = tabs.get(tabId);
    if (!tab) {
      // console.log('[useTabs] No tab found with id:', tabId);
      return;
    }
    // console.log('[useTabs] Found tab to remove:', tab.fileName);

    // Add to closed tabs history (before removing)
    setClosedTabs(prev => {
      const newClosedTabs = [tab, ...prev].slice(0, MAX_CLOSED_TAB_HISTORY);
      return newClosedTabs;
    });

    // Call onTabClose callback
    onTabClose?.(tab);

    // Stop watching the file (skip virtual files)
    if (window.electronAPI && !tab.filePath.startsWith('virtual://')) {
      window.electronAPI.invoke('stop-watching-file', tab.filePath).catch((err: Error) => {
        console.error('[useTabs] Failed to stop watching file:', err);
      });
    }

    setTabs(prev => {
      const newTabs = new Map(prev);
      newTabs.delete(tabId);
      return newTabs;
    });

    setTabOrder(prev => prev.filter(id => id !== tabId));

    // If removing active tab, switch to another
    if (activeTabId === tabId) {
      const remainingTabs = tabOrder.filter(id => id !== tabId);
      if (remainingTabs.length > 0) {
        const newActiveId = remainingTabs[remainingTabs.length - 1];
        setActiveTabId(newActiveId);
        const newActiveTab = tabs.get(newActiveId);
        if (newActiveTab) {
          onTabChange?.(newActiveTab);
        }
      } else {
        setActiveTabId(null);
      }
    }
  }, [tabs, tabOrder, activeTabId, onTabClose, onTabChange, MAX_CLOSED_TAB_HISTORY]);

  // Add a new tab
  const addTab = useCallback((filePath: string, content: string = '', switchToTab: boolean = true): string | null => {
    console.log('[useTabs] addTab called:', { filePath, enabled, currentTabCount: tabs.size, maxTabs });

    if (!enabled) {
      console.warn('[useTabs] addTab called but tabs are disabled');
      return null;
    }

    // Use ref to store the tab ID that was created or found
    let resultTabId: string | null = null;
    let isNewTab = false;
    let tabToCloseId: string | null = null;

    // Check if tab already exists and add new tab in a single state update
    setTabs(prev => {
      console.log('[useTabs] setTabs prev.size:', prev.size);
      // Check if tab already exists using the LATEST state
      const existingTab = Array.from(prev.values()).find(tab => tab.filePath === filePath);
      if (existingTab) {
        // Tab already exists, don't create a new one
        resultTabId = existingTab.id;
        if (switchToTab) {
          setActiveTabId(existingTab.id);
        }
        return prev; // Return unchanged state
      }

      // Check max tabs limit
      if (prev.size >= maxTabs) {
        console.warn('[useTabs] Max tabs check triggered:', { currentTabs: prev.size, maxTabs });
        // Try to close an unpinned, saved tab
        const unpinnedSavedTabs = Array.from(prev.values()).filter(
          tab => !tab.isPinned && !tab.isDirty
        );

        if (unpinnedSavedTabs.length === 0) {
          console.warn('Cannot add new tab: max tabs reached and all tabs are pinned or dirty');
          resultTabId = null;
          return prev; // Return unchanged state
        }

        // Mark tab for removal (will close it after state update)
        tabToCloseId = unpinnedSavedTabs[0].id;
      }

      // Create new tab
      const tabId = generateTabId();
      const fileName = getFileName(filePath) || 'Untitled';

      const newTab: TabData = {
        id: tabId,
        filePath,
        fileName,
        content,
        isDirty: false,
        isPinned: false,
        lastSaved: new Date(),
        contentHash: simpleHash(content),
        contentLoadedAt: new Date()
      };

      resultTabId = tabId;
      isNewTab = true;
      // console.log('[useTabs] Creating new tab:', { tabId, fileName, filePath });
      return new Map(prev).set(tabId, newTab);
    });

    // Close tab if we hit max limit (do this AFTER state update completes)
    if (tabToCloseId) {
      removeTab(tabToCloseId);
    }

    // Update tab order if we created a new tab
    if (isNewTab && resultTabId) {
      setTabOrder(prev => [...prev, resultTabId!]);
    }

    // Only switch to the new tab if requested
    if (switchToTab && resultTabId) {
      setActiveTabId(resultTabId);
      // console.log('[useTabs] Set activeTabId to:', resultTabId);
    }
    // console.log('[useTabs] About to check file watcher condition');

    // Start watching the file for external changes (skip virtual files)
    // Access window.electronAPI directly to avoid stale closure
    const electronAPI = (window as any).electronAPI;
    // console.log('[useTabs] electronAPI exists?', !!electronAPI, 'filePath:', filePath);

    if (electronAPI && !filePath.startsWith('virtual://')) {
      // console.log('[useTabs] Calling start-watching-file for:', filePath);
      electronAPI.invoke('start-watching-file', filePath).then((result: any) => {
        // console.log('[useTabs] start-watching-file result:', result);
      }).catch((err: Error) => {
        console.error('[useTabs] Failed to start watching file:', err);
      });
    } else {
      // console.log('[useTabs] NOT calling start-watching-file - electronAPI:', !!electronAPI, 'isVirtual:', filePath.startsWith('virtual://'));
    }

    // console.log('[useTabs] After file watcher code');
    console.log('[useTabs] addTab returning:', resultTabId);
    return resultTabId;
  }, [enabled, tabs, maxTabs, generateTabId, onTabChange, removeTab]);

  // Switch to a different tab
  const switchTab = useCallback((tabId: string, fromNavigation: boolean = false): void => {
    const tab = tabs.get(tabId);
    if (!tab) return;

    // onTabChange will be called by the useEffect when activeTabId changes
    setActiveTabId(tabId);
  }, [tabs]);

  // Update tab data
  const updateTab = useCallback((tabId: string, updates: Partial<TabData>): void => {
    setTabs(prev => {
      const newTabs = new Map(prev);
      const tab = newTabs.get(tabId);
      if (tab) {
        newTabs.set(tabId, { ...tab, ...updates });
      }
      return newTabs;
    });
  }, []);

  // Find tab by file path
  const findTabByPath = useCallback((filePath: string): TabData | undefined => {
    return Array.from(tabs.values()).find(tab => tab.filePath === filePath);
  }, [tabs]);

  // Save tab state (for switching tabs)
  const saveTabState = useCallback((tabId: string, state: Partial<TabData>): void => {
    updateTab(tabId, state);
  }, [updateTab]);

  // Get tab state
  const getTabState = useCallback((tabId: string): TabData | undefined => {
    return tabs.get(tabId);
  }, [tabs]);

  // Close all tabs
  const closeAllTabs = useCallback((): void => {
    Array.from(tabs.keys()).forEach(tabId => {
      removeTab(tabId);
    });
  }, [tabs, removeTab]);

  // Close all saved tabs
  const closeSavedTabs = useCallback((): void => {
    Array.from(tabs.values())
      .filter(tab => !tab.isDirty)
      .forEach(tab => removeTab(tab.id));
  }, [tabs, removeTab]);

  // Reopen the last closed tab
  const reopenLastClosedTab = useCallback(async (fileSelectFn: (filePath: string) => Promise<void>): Promise<void> => {
    // Prevent concurrent execution (rapid double-calls)
    if (reopeningRef.current) {
      // console.log('[useTabs] Already reopening a tab, skipping duplicate call');
      return;
    }

    if (closedTabs.length === 0) return;

    reopeningRef.current = true;

    try {
      // Try to find and open a closed tab that isn't currently open
      let tabToReopen: TabData | null = null;
      let newClosedTabs = [...closedTabs];
      let i = 0;

      // Keep trying closed tabs until we successfully open one or run out
      while (i < newClosedTabs.length) {
        const candidateTab = newClosedTabs[i];
        const existingTab = Array.from(tabs.values()).find(tab => tab.filePath === candidateTab.filePath);

        if (!existingTab) {
          // Found a tab that's not currently open - try to open it
          try {
            await fileSelectFn(candidateTab.filePath);
            // Success! Remove this tab and all previous tabs from closed history
            newClosedTabs = newClosedTabs.slice(i + 1);
            setClosedTabs(newClosedTabs);
            return; // Exit successfully
          } catch (error) {
            // File doesn't exist or failed to open - remove it from history and try next
            console.warn(`[useTabs] Failed to reopen tab for ${candidateTab.filePath}:`, error);
            newClosedTabs.splice(i, 1);
            // Don't increment i - we just removed this item, so next item is now at index i
            continue;
          }
        } else {
          // Tab is already open - remove from closed history
          newClosedTabs.splice(i, 1);
          // Don't increment i - we just removed this item
          continue;
        }
      }

      // Update closed tabs if we removed any invalid entries
      if (newClosedTabs.length !== closedTabs.length) {
        setClosedTabs(newClosedTabs);
      }

      // console.log('[useTabs] No valid closed tabs to reopen');
    } finally {
      reopeningRef.current = false;
    }
  }, [closedTabs, tabs]);

  // Toggle pin status and move tab to appropriate position
  const togglePin = useCallback((tabId: string): void => {
    const tab = tabs.get(tabId);
    if (!tab) return;

    const newIsPinned = !tab.isPinned;

    // Update the tab's pinned status
    setTabs(prev => {
      const newTabs = new Map(prev);
      newTabs.set(tabId, { ...tab, isPinned: newIsPinned });
      return newTabs;
    });

    // Reorder tabs based on pin status
    setTabOrder(prev => {
      const currentIndex = prev.indexOf(tabId);
      if (currentIndex === -1) return prev;

      const newOrder = [...prev];
      newOrder.splice(currentIndex, 1); // Remove from current position

      if (newIsPinned) {
        // When pinning: find the last pinned tab and insert after it
        let insertIndex = 0;
        for (let i = 0; i < newOrder.length; i++) {
          const t = tabs.get(newOrder[i]);
          if (t?.isPinned) {
            insertIndex = i + 1;
          } else {
            break; // Stop when we hit the first unpinned tab
          }
        }
        newOrder.splice(insertIndex, 0, tabId);
      } else {
        // When unpinning: find the first unpinned tab and insert there
        let insertIndex = newOrder.length;
        for (let i = 0; i < newOrder.length; i++) {
          const t = tabs.get(newOrder[i]);
          if (!t?.isPinned) {
            insertIndex = i;
            break;
          }
        }
        newOrder.splice(insertIndex, 0, tabId);
      }

      return newOrder;
    });
  }, [tabs]);

  // Reorder tabs
  const reorderTabs = useCallback((fromIndex: number, toIndex: number): void => {
    setTabOrder(prev => {
      const newOrder = [...prev];
      const [removed] = newOrder.splice(fromIndex, 1);
      newOrder.splice(toIndex, 0, removed);
      return newOrder;
    });
  }, []);

  // Track if we've restored tabs (to avoid saving empty state on mount)
  const hasRestoredRef = useRef(false);
  const lastSavedStateRef = useRef<string>('');

  // Save state to Electron store only when it changes
  useEffect(() => {
    if (!enabled || !window.electronAPI?.invoke || !workspacePath) return;

    const saveState = async () => {
      // Don't save empty state before first restoration attempt
      if (!hasRestoredRef.current && tabs.size === 0) {
        return;
      }

      const tabsArray = Array.from(tabs.values()).map(tab => ({
        id: tab.id,
        filePath: tab.filePath,
        fileName: tab.fileName,
        isDirty: tab.isDirty,
        isPinned: tab.isPinned,
        isVirtual: tab.isVirtual,
        lastSaved: tab.lastSaved?.toISOString()
        // Don't save content or editor state
      }));

      const closedTabsArray = closedTabs.map(tab => ({
        id: tab.id,
        filePath: tab.filePath,
        fileName: tab.fileName,
        isDirty: tab.isDirty,
        isPinned: tab.isPinned,
        isVirtual: tab.isVirtual,
        lastSaved: tab.lastSaved?.toISOString()
      }));

      const tabState: any = {
        tabs: tabsArray,
        activeTabId,
        tabOrder,
        closedTabs: closedTabsArray
      };

      // Include navigation state if available
      const navigationHistory = getNavigationState ? getNavigationState() : undefined;

      // Only save if state has actually changed
      const stateString = JSON.stringify(tabState);
      if (stateString !== lastSavedStateRef.current) {
        try {
          await window.electronAPI.invoke('workspace:update-state', workspacePath, {
            tabs: tabState,
            navigationHistory
          });
          lastSavedStateRef.current = stateString;
        } catch (error) {
          console.error('[useTabs] Failed to save tab state:', error);
        }
      }
    };

    // Save immediately when tabs change, even before restoration completes
    // (as long as we have tabs to save)
    if (tabs.size > 0) {
      saveState();
    }

    // Also save periodically in case of crashes
    const interval = setInterval(saveState, 30000); // Every 30 seconds instead of 5

    return () => {
      clearInterval(interval);
    };
  }, [enabled, tabs.size, activeTabId, tabOrder.length, closedTabs.length, getNavigationState, workspacePath]); // Use primitive values instead of objects

  // Store onTabChange in a ref to avoid re-running effect
  const onTabChangeRef = useRef(onTabChange);
  useEffect(() => {
    onTabChangeRef.current = onTabChange;
  }, [onTabChange]);

  // Track previous activeTabId to detect actual changes
  const prevActiveTabIdRef = useRef<string | null>(null);
  const tabsRef = useRef(tabs);

  // Update tabs ref on each render
  tabsRef.current = tabs;

  // Call onTabChange whenever activeTabId changes
  useEffect(() => {
    // Only trigger if activeTabId actually changed
    if (activeTabId === prevActiveTabIdRef.current) {
      return;
    }

    prevActiveTabIdRef.current = activeTabId;
    const currentActiveTab = activeTabId ? tabsRef.current.get(activeTabId) || null : null;
    // // console.log('[useTabs] activeTabId changed:', activeTabId, 'activeTab:', currentActiveTab?.fileName);
    if (activeTabId && currentActiveTab && onTabChangeRef.current) {
      // // console.log('[useTabs] Calling onTabChange for:', currentActiveTab.fileName);
      onTabChangeRef.current(currentActiveTab);
    }

    // Update EditorRegistry with the active file path (only for markdown files)
    if (currentActiveTab && currentActiveTab.filePath.endsWith('.md')) {
      editorRegistry.setActive(currentActiveTab.filePath);
    }
  }, [activeTabId]);


  // Restore state from Electron store on mount (with delay for workspace to load)
  useEffect(() => {
    if (!enabled || !window.electronAPI?.invoke || !workspacePath) {
      return;
    }

    // Add a small delay to ensure workspace is loaded in main process
    const timer = setTimeout(async () => {
      const loadTabState = async () => {
        try {
          const workspaceState = await window.electronAPI.invoke('workspace:get-state', workspacePath);
          const savedState = workspaceState?.tabs;
          hasRestoredRef.current = true; // Mark as restored

          if (savedState && savedState.tabs && savedState.tabs.length > 0) {
            // Restore tabs
            const restoredTabs = new Map<string, TabData>();

            for (const tab of savedState.tabs) {
              // We'll need to load the content when the tab is activated
              const restoredTab: TabData = {
                id: tab.id,
                filePath: tab.filePath,
                fileName: tab.fileName,
                content: '', // Content will be loaded when tab is selected
                isDirty: false, // Reset dirty state on restore
                isPinned: tab.isPinned,
                isVirtual: tab.isVirtual,
                lastSaved: tab.lastSaved ? new Date(tab.lastSaved) : undefined,
                contentHash: undefined,
                contentLoadedAt: undefined
              };
              restoredTabs.set(tab.id, restoredTab);
            }

            // Set all state at once
            setTabs(restoredTabs);
            setTabOrder(savedState.tabOrder || []);

            // Restore closed tabs history if available
            if (savedState.closedTabs && Array.isArray(savedState.closedTabs)) {
              const restoredClosedTabs = savedState.closedTabs.map((tab: any) => ({
                id: tab.id,
                filePath: tab.filePath,
                fileName: tab.fileName,
                content: '',
                isDirty: false,
                isPinned: tab.isPinned,
                isVirtual: tab.isVirtual,
                lastSaved: tab.lastSaved ? new Date(tab.lastSaved) : undefined,
                contentHash: undefined,
                contentLoadedAt: undefined
              }));
              setClosedTabs(restoredClosedTabs);
            }

            // Start watching all restored tabs (skip virtual files)
            if (window.electronAPI) {
              for (const tab of restoredTabs.values()) {
                if (!tab.filePath.startsWith('virtual://')) {
                  window.electronAPI.invoke('start-watching-file', tab.filePath).catch((err: Error) => {
                    console.error('[TABS] Failed to start watching restored tab:', tab.filePath, err);
                  });
                }
              }
            }

            // Restore the active tab if it exists
            if (savedState.activeTabId && restoredTabs.has(savedState.activeTabId)) {
              setActiveTabId(savedState.activeTabId);
            }

            console.log('[TABS] Restored', restoredTabs.size, 'tabs, active:', savedState.activeTabId);
          } else {
            console.log('[TABS] No saved tabs to restore');
          }
        } catch (error) {
          console.error('[TABS] Failed to restore tab state:', error);
        }
      };

      loadTabState();
    }, 500); // Wait 500ms for workspace to be loaded in main process

    return () => clearTimeout(timer);
  }, [enabled, workspacePath]); // Run when workspace path changes

  const result = {
    tabs: tabOrder.map(id => tabs.get(id)!).filter(Boolean),
    activeTab,
    activeTabId,
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

  return result;
}
