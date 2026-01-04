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
import type { TextReplacement } from 'rexical';
import type { Tab } from '../TabManager/TabManager';
import { TabEditor } from '../TabEditor/TabEditor';
import { TabEditorErrorBoundary } from '../TabEditorErrorBoundary';
import { logger } from '../../utils/logger';
import { useTabsActions, type TabData, notifyDirtyStateChange } from '../../contexts/TabsContext';

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

  // Create a TabEditor instance imperatively
  const createTabEditor = useCallback((tab: TabData, content: string) => {
    if (!containerRef.current) return;
    if (tabInstancesRef.current.has(tab.id)) return;

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

    // Handle dirty state changes - update tab store and notify subscribers
    const handleDirtyChange = (isDirty: boolean) => {
      tabsActions.updateTab(tab.id, { isDirty });
      // Notify the dirty state subscription system so TabItem can re-render
      notifyDirtyStateChange(tab.id, isDirty);
    };

    // Always pass isActive={true} since visibility is controlled by the wrapper element's display style
    // The wrapper is set to display:none for inactive tabs, display:block for active
    const isActiveTab = tab.id === activeTabIdRef.current;

    root.render(
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
    );

    tabInstancesRef.current.set(tab.id, { root, element, tabData: tab, content });
  }, []);

  // Remove a TabEditor instance
  const removeTabEditor = useCallback((tabId: string) => {
    const instance = tabInstancesRef.current.get(tabId);
    if (!instance) return;

    instance.root.unmount();
    instance.element.remove();
    tabInstancesRef.current.delete(tabId);
    saveFunctionsRef.current.delete(tabId);
    getContentFunctionsRef.current.delete(tabId);
  }, []);

  // Update visibility of all tab editors based on active tab
  const updateVisibility = useCallback(() => {
    const activeId = activeTabIdRef.current;

    tabInstancesRef.current.forEach((instance, tabId) => {
      const isActive = tabId === activeId;
      instance.element.style.display = isActive ? 'block' : 'none';
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

      // Add editors for new tabs
      for (const tab of currentTabs) {
        if (!tabInstancesRef.current.has(tab.id) && !loadingRef.current.has(tab.id)) {
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
      }

      // Update active tab and visibility
      const activeChanged = activeTabIdRef.current !== newActiveTabId;
      activeTabIdRef.current = newActiveTabId;

      // Always update visibility after syncing tabs (editors may have been added)
      updateVisibility();
    };

    // Initial sync
    syncTabs();

    // Subscribe to changes
    const unsubscribe = tabsActions.subscribe(syncTabs);
    return unsubscribe;
  }, [tabsActions, loadContent, createTabEditor, removeTabEditor, updateVisibility]);

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
      tabInstancesRef.current.forEach((instance) => {
        instance.root.unmount();
        instance.element.remove();
      });
      tabInstancesRef.current.clear();
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

