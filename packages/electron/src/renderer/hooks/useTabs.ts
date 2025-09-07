import { useState, useCallback, useRef, useEffect } from 'react';

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
}

interface UseTabsOptions {
  maxTabs?: number;
  enabled?: boolean;
  onTabChange?: (tab: TabData) => void;
  onTabClose?: (tab: TabData) => void;
}

interface UseTabsResult {
  tabs: TabData[];
  activeTab: TabData | null;
  activeTabId: string | null;
  addTab: (filePath: string, content?: string) => string | null;
  removeTab: (tabId: string) => void;
  switchTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<TabData>) => void;
  findTabByPath: (filePath: string) => TabData | undefined;
  saveTabState: (tabId: string, state: Partial<TabData>) => void;
  getTabState: (tabId: string) => TabData | undefined;
  closeAllTabs: () => void;
  closeSavedTabs: () => void;
}

export function useTabs(options: UseTabsOptions = {}): UseTabsResult {
  const {
    maxTabs = 10,
    enabled = true,
    onTabChange,
    onTabClose
  } = options;

  const [tabs, setTabs] = useState<Map<string, TabData>>(new Map());
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [tabOrder, setTabOrder] = useState<string[]>([]);
  const tabIdCounter = useRef(0);

  // Generate unique tab ID
  const generateTabId = useCallback((): string => {
    tabIdCounter.current += 1;
    return `tab-${Date.now()}-${tabIdCounter.current}`;
  }, []);

  // Get active tab
  const activeTab = activeTabId ? tabs.get(activeTabId) || null : null;

  // Add a new tab
  const addTab = useCallback((filePath: string, content: string = ''): string | null => {
    if (!enabled) return null;

    // Check if tab already exists
    const existingTab = Array.from(tabs.values()).find(tab => tab.filePath === filePath);
    if (existingTab) {
      // Directly set active tab instead of calling switchTab to avoid circular dependency
      setActiveTabId(existingTab.id);
      onTabChange?.(existingTab);
      return existingTab.id;
    }

    // Check max tabs limit
    if (tabs.size >= maxTabs) {
      // Try to close an unpinned, saved tab
      const unpinnedSavedTabs = Array.from(tabs.values()).filter(
        tab => !tab.isPinned && !tab.isDirty
      );
      
      if (unpinnedSavedTabs.length === 0) {
        console.warn('Cannot add new tab: max tabs reached and all tabs are pinned or dirty');
        return null;
      }

      // Close the oldest unpinned saved tab
      const tabToClose = unpinnedSavedTabs[0];
      removeTab(tabToClose.id);
    }

    // Create new tab
    const tabId = generateTabId();
    const fileName = filePath.split('/').pop() || 'Untitled';
    
    const newTab: TabData = {
      id: tabId,
      filePath,
      fileName,
      content,
      isDirty: false,
      isPinned: false,
      lastSaved: new Date()
    };

    setTabs(prev => new Map(prev).set(tabId, newTab));
    setTabOrder(prev => [...prev, tabId]);
    setActiveTabId(tabId);

    return tabId;
  }, [enabled, tabs, maxTabs, generateTabId, onTabChange]);

  // Remove a tab
  const removeTab = useCallback((tabId: string): void => {
    const tab = tabs.get(tabId);
    if (!tab) return;

    // Call onTabClose callback
    onTabClose?.(tab);

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
  }, [tabs, tabOrder, activeTabId, onTabClose, onTabChange]);

  // Switch to a different tab
  const switchTab = useCallback((tabId: string): void => {
    const tab = tabs.get(tabId);
    if (!tab) return;

    setActiveTabId(tabId);
    onTabChange?.(tab);
  }, [tabs, onTabChange]);

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

  // Track if we've restored tabs (to avoid saving empty state on mount)
  const hasRestoredRef = useRef(false);
  
  // Save state to Electron store periodically
  useEffect(() => {
    if (!enabled || !window.electronAPI?.saveProjectTabState) return;

    const saveState = () => {
      // Don't save if we haven't restored yet and tabs are empty
      if (!hasRestoredRef.current && tabs.size === 0) {
        console.log('[TABS] Skipping save - not restored yet and tabs are empty');
        return;
      }
      
      const tabsArray = Array.from(tabs.values()).map(tab => ({
        id: tab.id,
        filePath: tab.filePath,
        fileName: tab.fileName,
        isDirty: tab.isDirty,
        isPinned: tab.isPinned,
        lastSaved: tab.lastSaved?.toISOString()
        // Don't save content or editor state
      }));

      const tabState = {
        tabs: tabsArray,
        activeTabId,
        tabOrder
      };

      window.electronAPI.saveProjectTabState(tabState);
      console.log('[TABS] Saved tab state to store:', {
        numTabs: tabsArray.length,
        activeTabId,
        tabOrder
      });
    };

    // Save every 5 seconds and when tabs change (but not on initial mount)
    const interval = setInterval(saveState, 5000);
    
    // Save when tabs change, but wait a bit on mount to allow restoration
    const saveTimer = setTimeout(() => {
      saveState();
    }, 1000); // Wait 1 second before first save (restoration happens at 500ms)
    
    return () => {
      clearInterval(interval);
      clearTimeout(saveTimer);
    };
  }, [enabled, tabs, activeTabId, tabOrder]);

  // Store onTabChange in a ref to avoid re-running effect
  const onTabChangeRef = useRef(onTabChange);
  useEffect(() => {
    onTabChangeRef.current = onTabChange;
  }, [onTabChange]);

  // Restore state from Electron store on mount (with delay for project to load)
  useEffect(() => {
    console.log('[TABS] Tab restoration effect triggered, enabled:', enabled, 'hasAPI:', !!window.electronAPI?.getProjectTabState);
    if (!enabled || !window.electronAPI?.getProjectTabState) {
      console.log('[TABS] Skipping restoration - not enabled or no API');
      return;
    }

    // Add a small delay to ensure project is loaded in main process
    const timer = setTimeout(async () => {
      console.log('[TABS] Timer fired, attempting to restore tabs...');
      const loadTabState = async () => {
        try {
          console.log('[TABS] Calling getProjectTabState...');
          const savedState = await window.electronAPI.getProjectTabState();
          console.log('[TABS] Received saved state:', savedState);
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
                lastSaved: tab.lastSaved ? new Date(tab.lastSaved) : undefined
              };
              restoredTabs.set(tab.id, restoredTab);
            }
            
            // Set all state at once
            setTabs(restoredTabs);
            setTabOrder(savedState.tabOrder || []);
            
            // Restore the active tab if it exists
            if (savedState.activeTabId && restoredTabs.has(savedState.activeTabId)) {
              console.log('[TABS] Setting active tab to:', savedState.activeTabId);
              setActiveTabId(savedState.activeTabId);
              
              // Don't call onTabChange here - let the App component handle it
              // when it sees the activeTab has changed
              const activeTab = restoredTabs.get(savedState.activeTabId);
              console.log('[TABS] Active tab data:', activeTab);
            } else {
              console.log('[TABS] No active tab to restore or tab not found in restored tabs');
            }
            
            console.log('[TABS] Restored', restoredTabs.size, 'tabs, active tab should be:', savedState.activeTabId);
          } else {
            console.log('[TABS] No saved tabs to restore');
          }
        } catch (error) {
          console.error('[TABS] Failed to restore tab state:', error);
        }
      };

      loadTabState();
    }, 500); // Wait 500ms for project to be loaded in main process
    
    return () => clearTimeout(timer);
  }, [enabled]); // Only run once on mount when enabled

  const result = {
    tabs: Array.from(tabs.values()),
    activeTab,
    activeTabId,
    addTab,
    removeTab,
    switchTab,
    updateTab,
    findTabByPath,
    saveTabState,
    getTabState,
    closeAllTabs,
    closeSavedTabs
  };
  
  // Log current state periodically
  useEffect(() => {
    const logInterval = setInterval(() => {
      console.log('[TABS] Current hook state:', {
        numTabs: tabs.size,
        tabIds: Array.from(tabs.keys()),
        activeTabId,
        activeTab: activeTab ? { id: activeTab.id, file: activeTab.filePath } : null,
        enabled
      });
    }, 3000);
    return () => clearInterval(logInterval);
  }, [tabs, activeTabId, activeTab, enabled]);
  
  return result;
}