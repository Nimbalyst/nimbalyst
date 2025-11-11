/**
 * TabContent - Coordinates multiple TabEditor instances
 *
 * This component manages:
 * - Rendering TabEditor for each tab
 * - Coordinating active tab
 * - Aggregating callbacks from TabEditors to parent
 * - Handling special virtual tabs (Plans, Bugs, etc.)
 *
 * Does NOT manage tab metadata (TabManager handles that).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ConfigTheme, TextReplacement } from 'rexical';
import type { Tab } from '../TabManager/TabManager';
import { TabEditor } from '../TabEditor/TabEditor';
import { logger } from '../../utils/logger';

interface TabContentProps {
  tabs: Tab[];
  activeTabId: string | null;
  theme: ConfigTheme;
  textReplacements?: TextReplacement[];

  // Callbacks to parent
  onTabDirtyChange?: (tabId: string, isDirty: boolean) => void;
  onManualSaveReady?: (saveFunction: () => Promise<void>) => void;
  onGetContentReady?: (tabId: string, getContentFunction: () => string) => void;
  onSaveComplete?: (filePath: string) => void;

  // Document action callbacks
  onViewHistory?: () => void;
  onRenameDocument?: () => void;
  onSwitchToAgentMode?: (planDocumentPath?: string, sessionId?: string) => void;

  // Document metadata
  workspaceId?: string;
}

export const TabContent: React.FC<TabContentProps> = ({
  tabs,
  activeTabId,
  theme,
  textReplacements,
  onTabDirtyChange,
  onManualSaveReady,
  onGetContentReady,
  onSaveComplete,
  onViewHistory,
  onRenameDocument,
  onSwitchToAgentMode,
  workspaceId,
}) => {
  // Track manual save functions for each tab
  const saveFunctionsRef = useRef<Map<string, () => Promise<void>>>(new Map());

  // Track getContent functions for each tab
  const getContentFunctionsRef = useRef<Map<string, () => string>>(new Map());

  // Update manual save function for parent when active tab changes
  useEffect(() => {
    if (!activeTabId || !onManualSaveReady) return;

    const activeTab = tabs.find(t => t.id === activeTabId);
    if (!activeTab) return;

    const saveFn = saveFunctionsRef.current.get(activeTab.id);
    if (saveFn) {
      onManualSaveReady(saveFn);
    }
  }, [activeTabId, tabs, onManualSaveReady]);

  // Handle file-save IPC event from menu (Cmd+S)
  useEffect(() => {
    if (!window.electronAPI) return;

    const handleFileSave = async () => {
      if (!activeTabId) return;

      const saveFn = saveFunctionsRef.current.get(activeTabId);
      if (saveFn) {
        await saveFn();
      }
    };

    window.electronAPI.on('file-save', handleFileSave);

    return () => {
      window.electronAPI.off('file-save', handleFileSave);
    };
  }, [activeTabId]);

  // Handle manual save ready from TabEditor
  const handleManualSaveReady = useCallback((tabId: string, saveFn: () => Promise<void>) => {
    saveFunctionsRef.current.set(tabId, saveFn);

    // If this is the active tab, notify parent immediately
    if (tabId === activeTabId && onManualSaveReady) {
      onManualSaveReady(saveFn);
    }
  }, [activeTabId, onManualSaveReady]);

  // Handle getContent ready from TabEditor
  const handleGetContentReady = useCallback((tabId: string, getContentFn: () => string) => {
    getContentFunctionsRef.current.set(tabId, getContentFn);

    // Notify parent
    if (onGetContentReady) {
      onGetContentReady(tabId, getContentFn);
    }
  }, [onGetContentReady]);

  // Load content for physical or virtual files
  const loadContent = useCallback(async (filePath: string): Promise<string> => {
    // Check if this is a virtual document
    if (filePath.startsWith('virtual://')) {
      if (!window.electronAPI?.documentService) {
        logger.ui.error('[TabContent] No documentService available for virtual document');
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

    // Load physical file
    if (!window.electronAPI?.readFileContent) {
      logger.ui.error('[TabContent] No electronAPI.readFileContent available');
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

  // Track loaded content for tabs
  const [tabContents, setTabContents] = useState<Map<string, string>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());
  const hmrRestoredTabsRef = useRef<Set<string>>(new Set()); // Track which tabs were HMR-restored

  // HMR: Save current content before unmount to preserve unsaved changes
  useEffect(() => {
    if (import.meta.hot) {
      import.meta.hot.dispose(() => {
        // Save all current tab contents to sessionStorage, keyed by filePath
        const contentsToSave: Record<string, string> = {};

        // Get ACTUAL current content from editors, not just initial content
        tabs.forEach(tab => {
          // Try to get current content from editor's getContent function
          const getContentFn = getContentFunctionsRef.current.get(tab.id);
          if (getContentFn) {
            try {
              const currentContent = getContentFn();
              contentsToSave[tab.filePath] = currentContent;
            } catch (error) {
              logger.ui.error(`[TabContent HMR] Failed to get content for ${tab.fileName}:`, error);
              // Fall back to cached content if available
              const cachedContent = tabContents.get(tab.id);
              if (cachedContent !== undefined) {
                contentsToSave[tab.filePath] = cachedContent;
              }
            }
          } else {
            // Editor not ready yet, use cached content if available
            const cachedContent = tabContents.get(tab.id);
            if (cachedContent !== undefined) {
              contentsToSave[tab.filePath] = cachedContent;
            }
          }
        });

        if (Object.keys(contentsToSave).length > 0) {
          try {
            sessionStorage.setItem('hmr-tab-contents', JSON.stringify(contentsToSave));
            logger.ui.info(`[TabContent HMR] Saved ${Object.keys(contentsToSave).length} tab contents`);
          } catch (error) {
            logger.ui.error('[TabContent HMR] Failed to save contents:', error);
          }
        }
      });
    }
  }, [tabs, tabContents]); // Still depend on tabContents for fallback

  // HMR: Restore content when tabs are available
  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (import.meta.hot && !hasRestoredRef.current && tabs.length > 0) {
      try {
        const saved = sessionStorage.getItem('hmr-tab-contents');
        if (saved) {
          const savedContents = JSON.parse(saved) as Record<string, string>;

          // Map restored content from filePath back to current tab IDs
          const restoredMap = new Map<string, string>();
          tabs.forEach(tab => {
            const restoredContent = savedContents[tab.filePath];
            if (restoredContent !== undefined) {
              restoredMap.set(tab.id, restoredContent);
              hmrRestoredTabsRef.current.add(tab.id); // Mark as HMR-restored
            }
          });

          if (restoredMap.size > 0) {
            setTabContents(restoredMap);
            logger.ui.info(`[TabContent HMR] Restored ${restoredMap.size} tab contents`);
          }

          // Clear after restoration
          sessionStorage.removeItem('hmr-tab-contents');
          hasRestoredRef.current = true;
        }
      } catch (error) {
        logger.ui.error('[TabContent HMR] Failed to restore contents:', error);
      }
    }
  }, [tabs]); // Run when tabs change

  // Load content for tabs that don't have it yet
  useEffect(() => {
    const loadMissingContent = async () => {
      for (const tab of tabs) {
        // Skip if we already have content (including HMR-restored content)
        if (tabContents.has(tab.id)) {
          continue;
        }

        // Skip if already loading
        if (loadingRef.current.has(tab.id)) {
          continue;
        }

        // Skip if this tab was restored from HMR (redundant check, but explicit)
        if (hmrRestoredTabsRef.current.has(tab.id)) {
          continue;
        }

        // Skip if tab already has content
        if (tab.content && tab.content.length > 0) {
          setTabContents(prev => new Map(prev).set(tab.id, tab.content));
          continue;
        }

        // Mark as loading
        loadingRef.current.add(tab.id);
        logger.ui.info(`[TabContent] Loading content for tab: ${tab.fileName} (${tab.filePath})`);

        // Load content
        const content = await loadContent(tab.filePath);
        logger.ui.info(`[TabContent] Loaded content for ${tab.fileName}, length: ${content.length}`);
        setTabContents(prev => new Map(prev).set(tab.id, content));

        // Mark as done loading
        loadingRef.current.delete(tab.id);
      }
    };

    loadMissingContent();
  }, [tabs, loadContent]);

  // Cleanup content for closed tabs
  useEffect(() => {
    const currentTabIds = new Set(tabs.map(t => t.id));

    setTabContents(prev => {
      const next = new Map(prev);
      for (const tabId of next.keys()) {
        if (!currentTabIds.has(tabId)) {
          next.delete(tabId);
        }
      }
      return next;
    });

    // Cleanup save functions
    for (const tabId of saveFunctionsRef.current.keys()) {
      if (!currentTabIds.has(tabId)) {
        saveFunctionsRef.current.delete(tabId);
      }
    }

    // Cleanup getContent functions
    for (const tabId of getContentFunctionsRef.current.keys()) {
      if (!currentTabIds.has(tabId)) {
        getContentFunctionsRef.current.delete(tabId);
      }
    }
  }, [tabs]);

  return (
    <div className="tab-content-container" style={{ height: '100%', overflow: 'hidden' }}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;

        // Regular editor tab
        const content = tabContents.get(tab.id) ?? tab.content ?? '';

        // Don't render editor until we have content loaded
        // Check if content has been loaded (including empty files)
        // Use .has() to distinguish between "not loaded" vs "loaded but empty"
        const hasContent = tabContents.has(tab.id);
        if (!hasContent) {
          return (
            <div
              key={tab.id}
              className="tab-editor-loading"
              style={{
                display: isActive ? 'flex' : 'none',
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <div>Loading {tab.fileName}...</div>
            </div>
          );
        }

        return (
          <TabEditor
            key={tab.id}
            filePath={tab.filePath}
            fileName={tab.fileName}
            initialContent={content}
            theme={theme}
            isActive={isActive}
            textReplacements={isActive ? textReplacements : undefined}
            onDirtyChange={(isDirty) => {
              if (onTabDirtyChange) {
                onTabDirtyChange(tab.id, isDirty);
              }
            }}
            onSaveComplete={onSaveComplete}
            onManualSaveReady={(saveFn) => handleManualSaveReady(tab.id, saveFn)}
            onGetContentReady={(getContentFn) => handleGetContentReady(tab.id, getContentFn)}
            onViewHistory={onViewHistory}
            onRenameDocument={onRenameDocument}
            onSwitchToAgentMode={onSwitchToAgentMode}
            workspaceId={workspaceId}
          />
        );
      })}
    </div>
  );
};
