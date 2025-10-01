/**
 * Hook to manage editor pool integration with tabs
 */

import { useCallback, useRef, useEffect } from 'react';
import { getEditorPool } from '../services/EditorPool';
import type { Tab } from '../components/TabManager/TabManager';
import { logger } from '../utils/logger';

interface UseEditorPoolOptions {
  onContentChange?: (tabId: string, content: string, isDirty: boolean) => void;
}

export function useEditorPool(tabs: Tab[], activeTabId: string | null, options: UseEditorPoolOptions = {}) {
  const editorPool = getEditorPool();
  const getContentFuncs = useRef<Map<string, () => string>>(new Map());

  // Initialize editor instances for all tabs
  useEffect(() => {
    tabs.forEach((tab) => {
      if (!editorPool.has(tab.filePath)) {
        editorPool.create(tab.filePath, tab.content);
      }
    });
  }, [tabs, editorPool]);

  // Update visibility when active tab changes
  useEffect(() => {
    if (!activeTabId) return;

    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab) return;

    // Mark all as not visible
    tabs.forEach((tab) => editorPool.setVisible(tab.filePath, false));

    // Mark active as visible
    editorPool.setVisible(activeTab.filePath, true);
  }, [activeTabId, tabs, editorPool]);

  // Cleanup closed tabs
  useEffect(() => {
    const currentTabPaths = new Set(tabs.map((t) => t.filePath));
    const poolInstances = editorPool.getAll();

    for (const [filePath] of poolInstances) {
      if (!currentTabPaths.has(filePath)) {
        editorPool.destroy(filePath);
        getContentFuncs.current.delete(filePath);
      }
    }
  }, [tabs, editorPool]);

  // Handle content changes
  const handleContentChange = useCallback(
    (tabId: string, filePath: string, content: string) => {
      const instance = editorPool.get(filePath);
      if (!instance) return;

      const isDirty = content !== instance.content;
      editorPool.update(filePath, { content, isDirty });

      options.onContentChange?.(tabId, content, isDirty);
    },
    [editorPool, options]
  );

  // Register content getter function for a tab
  const registerContentGetter = useCallback((tabId: string, getContent: () => string) => {
    getContentFuncs.current.set(tabId, getContent);
  }, []);

  // Get content for a specific tab
  const getTabContent = useCallback(
    (tabId: string): string => {
      const getter = getContentFuncs.current.get(tabId);
      return getter ? getter() : '';
    },
    []
  );

  // Get content for the active tab
  const getActiveContent = useCallback((): string => {
    if (!activeTabId) return '';
    return getTabContent(activeTabId);
  }, [activeTabId, getTabContent]);

  return {
    editorPool,
    handleContentChange,
    registerContentGetter,
    getTabContent,
    getActiveContent,
  };
}
