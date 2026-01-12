/**
 * TabContent - Coordinates multiple TabEditor instances
 *
 * This component manages:
 * - Rendering TabEditor for each tab
 * - Coordinating active tab
 * - Aggregating callbacks from TabEditors to parent
 * - Handling special virtual tabs (Plans, Bugs, etc.)
 *
 * CRITICAL: This component renders ONCE and manages TabEditors imperatively.
 * It must NEVER re-render or it will destroy all TabEditor state.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Provider as JotaiProvider } from 'jotai';
import type { TextReplacement } from 'rexical';
import type { Tab } from '../TabManager/TabManager';
import { TabEditor } from '../TabEditor/TabEditor';
import { TabEditorErrorBoundary } from '../TabEditorErrorBoundary';
import { logger } from '../../utils/logger';
import { useTabsActions, type TabData, notifyDirtyStateChange } from '../../contexts/TabsContext';
import { store, editorDirtyAtom, editorHasUnacceptedChangesAtom, makeEditorKey } from '@nimbalyst/runtime/store';

interface TabContentProps {
  textReplacements?: TextReplacement[];

  // Callbacks to parent
  onManualSaveReady?: (saveFunction: () => Promise<void>) => void;
  onGetContentReady?: (tabId: string, getContentFunction: () => string) => void;
  onSaveComplete?: (filePath: string) => void;
  onSaveTabByIdReady?: (saveTabById: (tabId: string) => Promise<void>) => void;

  // Document action callbacks
  onViewHistory?: () => void;
  onRenameDocument?: () => void;
  onSwitchToAgentMode?: (planDocumentPath?: string, sessionId?: string) => void;
  onOpenSessionInChat?: (sessionId: string) => void;

  // Tab management
  onTabClose?: (tabId: string) => void;

  // Document metadata
  workspaceId?: string;
}

interface TabEditorInstance {
  root: Root;
  element: HTMLDivElement;
  tabData: TabData;
  content: string;
}

export const TabContent: React.FC<TabContentProps> = ({
  textReplacements,
  onManualSaveReady,
  onGetContentReady,
  onSaveComplete,
  onSaveTabByIdReady,
  onViewHistory,
  onRenameDocument,
  onSwitchToAgentMode,
  onOpenSessionInChat,
  onTabClose,
  workspaceId,
}) => {
  // Debug: trace re-renders - THIS SHOULD ONLY LOG ONCE ON MOUNT
  if (import.meta.env.DEV) console.log('[TabContent] render - THIS SHOULD ONLY HAPPEN ONCE');

  // Use actions only - NO subscription that causes re-renders
  const tabsActions = useTabsActions();

  // Container ref for imperative DOM updates
  const containerRef = useRef<HTMLDivElement>(null);

  // All state is in refs - NO useState allowed
  const tabInstancesRef = useRef<Map<string, TabEditorInstance>>(new Map());
  const activeTabIdRef = useRef<string | null>(null);
  const saveFunctionsRef = useRef<Map<string, () => Promise<void>>>(new Map());
  const getContentFunctionsRef = useRef<Map<string, () => string>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());
  // Placeholder elements for unloaded tabs (shown while loading)
  const placeholderElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  // Store props in refs so callbacks can access current values
  const propsRef = useRef({
    textReplacements,
    onManualSaveReady,
    onGetContentReady,
    onSaveComplete,
    onViewHistory,
    onRenameDocument,
    onSwitchToAgentMode,
    onOpenSessionInChat,
    onTabClose,
    workspaceId,
  });
  propsRef.current = {
    textReplacements,
    onManualSaveReady,
    onGetContentReady,
    onSaveComplete,
    onViewHistory,
    onRenameDocument,
    onSwitchToAgentMode,
    onOpenSessionInChat,
    onTabClose,
    workspaceId,
  };

  // Load content for a file
  const loadContent = useCallback(async (filePath: string): Promise<string> => {
    if (filePath.startsWith('virtual://')) {
      if (!window.electronAPI?.documentService) {
        return '';
      }
      try {
        const content = await (window.electronAPI.documentService as any).loadVirtual(filePath);
        return content || '';
      } catch (error) {
        logger.ui.error(`[TabContent] Failed to load virtual document: ${filePath}`, error);
        return '';
      }
    }

    if (!window.electronAPI?.readFileContent) {
      return '';
    }

    try {
      const result = await window.electronAPI.readFileContent(filePath);
      if (result && typeof result === 'object' && 'content' in result) {
        return result.content || '';
      }
      return '';
    } catch (error) {
      logger.ui.error(`[TabContent] Failed to load content for: ${filePath}`, error);
      return '';
    }
  }, []);

  // Inject keyframes for spinner animation (once)
  const spinnerKeyframesInjectedRef = useRef(false);
  useEffect(() => {
    if (spinnerKeyframesInjectedRef.current) return;
    spinnerKeyframesInjectedRef.current = true;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes tab-spinner-spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }, []);

  // Create a placeholder element with loading spinner for lazy-loaded tabs
  const createPlaceholder = useCallback((tabId: string) => {
    if (!containerRef.current) return;
    if (placeholderElementsRef.current.has(tabId)) return;

    const placeholder = document.createElement('div');
    placeholder.className = 'tab-editor-placeholder';
    placeholder.dataset.tabId = tabId;
    placeholder.style.cssText = `
      height: 100%;
      display: none;
      align-items: center;
      justify-content: center;
    `;

    // Add loading spinner
    const spinner = document.createElement('div');
    spinner.className = 'tab-loading-spinner';
    spinner.style.cssText = `
      width: 24px;
      height: 24px;
      border: 2px solid var(--text-color-muted, #666);
      border-top-color: transparent;
      border-radius: 50%;
      animation: tab-spinner-spin 0.8s linear infinite;
    `;
    placeholder.appendChild(spinner);

    containerRef.current.appendChild(placeholder);
    placeholderElementsRef.current.set(tabId, placeholder);
  }, []);

  // Create a TabEditor instance imperatively
  const createTabEditor = useCallback((tab: TabData, content: string) => {
    if (!containerRef.current) return;
    if (tabInstancesRef.current.has(tab.id)) return;

    // Remove placeholder if it exists (editor is replacing it)
    const placeholder = placeholderElementsRef.current.get(tab.id);
    if (placeholder) {
      placeholder.remove();
      placeholderElementsRef.current.delete(tab.id);
    }

    const element = document.createElement('div');
    element.className = 'tab-editor-wrapper';
    element.dataset.tabId = tab.id;
    element.style.height = '100%';
    element.style.display = 'none'; // Start hidden, updateVisibility will show active
    containerRef.current.appendChild(element);

    const root = createRoot(element);

    const handleManualSaveReady = (saveFn: () => Promise<void>) => {
      saveFunctionsRef.current.set(tab.id, saveFn);
      if (tab.id === activeTabIdRef.current && propsRef.current.onManualSaveReady) {
        propsRef.current.onManualSaveReady(saveFn);
      }
    };

    const handleGetContentReady = (getContentFn: () => string) => {
      getContentFunctionsRef.current.set(tab.id, getContentFn);
      if (propsRef.current.onGetContentReady) {
        propsRef.current.onGetContentReady(tab.id, getContentFn);
      }
    };

    // Handle dirty state changes - write to Jotai atom only
    // NOTE: We do NOT call tabsActions.updateTab() here because that would
    // trigger useTabs() subscribers to re-render (the old architecture).
    // With Jotai, only TabDirtyIndicator subscribes to dirty state.
    const handleDirtyChange = (isDirty: boolean) => {
      const editorKey = makeEditorKey(tab.filePath);
      store.set(editorDirtyAtom(editorKey), isDirty);
      // Also notify the legacy subscription system (for backwards compat with save-on-close)
      notifyDirtyStateChange(tab.id, isDirty);
    };

    // Always pass isActive={true} since visibility is controlled by the wrapper element's display style
    // The wrapper is set to display:none for inactive tabs, display:block for active
    const isActiveTab = tab.id === activeTabIdRef.current;

    // Wrap in JotaiProvider so TabEditor can subscribe to theme atom
    // (separate React roots need their own provider to access the shared store)
    root.render(
      <JotaiProvider store={store}>
        <TabEditorErrorBoundary
          filePath={tab.filePath}
          fileName={tab.fileName}
          onRetry={() => {
            // Remove and recreate on retry
            removeTabEditor(tab.id);
            createTabEditor(tab, content);
          }}
          onClose={() => {
            propsRef.current.onTabClose?.(tab.id);
          }}
        >
          <TabEditor
            filePath={tab.filePath}
            fileName={tab.fileName}
            initialContent={content}
            isActive={true}  // Always true - wrapper controls visibility
            textReplacements={isActiveTab ? propsRef.current.textReplacements : undefined}
            onDirtyChange={handleDirtyChange}
            onSaveComplete={propsRef.current.onSaveComplete}
            onManualSaveReady={handleManualSaveReady}
            onGetContentReady={handleGetContentReady}
            onViewHistory={propsRef.current.onViewHistory}
            onRenameDocument={propsRef.current.onRenameDocument}
            onSwitchToAgentMode={propsRef.current.onSwitchToAgentMode}
            onOpenSessionInChat={propsRef.current.onOpenSessionInChat}
            workspaceId={propsRef.current.workspaceId}
          />
        </TabEditorErrorBoundary>
      </JotaiProvider>
    );

    tabInstancesRef.current.set(tab.id, { root, element, tabData: tab, content });
  }, []);

  // Remove a TabEditor instance
  const removeTabEditor = useCallback((tabId: string) => {
    const instance = tabInstancesRef.current.get(tabId);
    if (!instance) return;

    // Clean up Jotai atoms for this tab
    const editorKey = makeEditorKey(instance.tabData.filePath);
    editorDirtyAtom.remove(editorKey);
    editorHasUnacceptedChangesAtom.remove(editorKey);

    instance.root.unmount();
    instance.element.remove();
    tabInstancesRef.current.delete(tabId);
    saveFunctionsRef.current.delete(tabId);
    getContentFunctionsRef.current.delete(tabId);
  }, []);

  // Update visibility of all tab editors and placeholders based on active tab
  const updateVisibility = useCallback(() => {
    const activeId = activeTabIdRef.current;

    // Update editor visibility
    tabInstancesRef.current.forEach((instance, tabId) => {
      const isActive = tabId === activeId;
      instance.element.style.display = isActive ? 'block' : 'none';
    });

    // Update placeholder visibility (for tabs being loaded)
    placeholderElementsRef.current.forEach((placeholder, tabId) => {
      const isActive = tabId === activeId;
      // Use flex display when active to center the spinner
      placeholder.style.display = isActive ? 'flex' : 'none';
    });

    // Update parent's save function
    if (activeId) {
      const saveFn = saveFunctionsRef.current.get(activeId);
      if (saveFn && propsRef.current.onManualSaveReady) {
        propsRef.current.onManualSaveReady(saveFn);
      }
    }
  }, []);

  // Main effect: subscribe to tab changes and manage TabEditors imperatively
  // LAZY LOADING: Only create editors for the active tab; others get placeholders
  useEffect(() => {
    const syncTabs = async () => {
      const snapshot = tabsActions.getSnapshot();
      const currentTabs = snapshot.tabOrder.map(id => snapshot.tabs.get(id)!).filter(Boolean);
      const newActiveTabId = snapshot.activeTabId;

      // Track which tabs we've seen
      const currentTabIds = new Set(currentTabs.map(t => t.id));

      // Remove editors for closed tabs
      for (const tabId of tabInstancesRef.current.keys()) {
        if (!currentTabIds.has(tabId)) {
          removeTabEditor(tabId);
        }
      }

      // Remove placeholders for closed tabs
      for (const tabId of placeholderElementsRef.current.keys()) {
        if (!currentTabIds.has(tabId)) {
          const placeholder = placeholderElementsRef.current.get(tabId);
          placeholder?.remove();
          placeholderElementsRef.current.delete(tabId);
        }
      }

      // LAZY LOADING: Only create editor for the ACTIVE tab
      // Other tabs will get editors when they become active
      for (const tab of currentTabs) {
        const isActiveTab = tab.id === newActiveTabId;
        const hasEditor = tabInstancesRef.current.has(tab.id);
        const isLoading = loadingRef.current.has(tab.id);

        if (isActiveTab && !hasEditor && !isLoading) {
          // Active tab needs an editor - create placeholder while loading
          createPlaceholder(tab.id);
          loadingRef.current.add(tab.id);

          // Load content then create editor
          const content = tab.content || await loadContent(tab.filePath);
          loadingRef.current.delete(tab.id);

          // Check tab still exists after async load
          const freshSnapshot = tabsActions.getSnapshot();
          if (freshSnapshot.tabs.has(tab.id)) {
            createTabEditor(tab, content);
          }
        }
        // Non-active tabs without editors: no action needed
        // They'll get an editor when they become active
      }

      // Update active tab and visibility
      activeTabIdRef.current = newActiveTabId;

      // Always update visibility after syncing tabs (editors may have been added)
      updateVisibility();
    };

    // Initial sync
    syncTabs();

    // Subscribe to changes
    const unsubscribe = tabsActions.subscribe(syncTabs);
    return unsubscribe;
  }, [tabsActions, loadContent, createTabEditor, createPlaceholder, removeTabEditor, updateVisibility]);

  // Handle file-save IPC event from menu (Cmd+S)
  useEffect(() => {
    if (!window.electronAPI) return;

    const handleFileSave = async () => {
      const currentActiveTabId = activeTabIdRef.current;
      if (!currentActiveTabId) return;

      const saveFn = saveFunctionsRef.current.get(currentActiveTabId);
      if (saveFn) {
        await saveFn();
      }
    };

    window.electronAPI.on('file-save', handleFileSave);
    return () => {
      window.electronAPI.off('file-save', handleFileSave);
    };
  }, []);

  // Create saveTabById function and expose to parent
  const saveTabById = useCallback(async (tabId: string): Promise<void> => {
    const saveFn = saveFunctionsRef.current.get(tabId);
    if (saveFn) {
      logger.ui.info(`[TabContent] Saving tab ${tabId} before close`);
      await saveFn();
    }
  }, []);

  useEffect(() => {
    if (onSaveTabByIdReady) {
      onSaveTabByIdReady(saveTabById);
    }
  }, [onSaveTabByIdReady, saveTabById]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clean up editor instances
      tabInstancesRef.current.forEach((instance) => {
        instance.root.unmount();
        instance.element.remove();
      });
      tabInstancesRef.current.clear();

      // Clean up placeholder elements
      placeholderElementsRef.current.forEach((placeholder) => {
        placeholder.remove();
      });
      placeholderElementsRef.current.clear();
    };
  }, []);

  // Render ONLY the container - TabEditors are added imperatively
  return (
    <div
      ref={containerRef}
      className="tab-content-container"
      style={{ height: '100%', overflow: 'hidden' }}
    />
  );
};

