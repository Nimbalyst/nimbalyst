/**
 * EditorContainer - Manages multiple concurrent editor instances
 *
 * Renders a StravuEditor for each open tab, showing only the active one.
 * This preserves editor state (selection, scroll, undo/redo) when switching tabs.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { StravuEditor, TOGGLE_SEARCH_COMMAND } from 'rexical';
import type { ConfigTheme, TextReplacement } from 'rexical';
import type { Tab } from '../TabManager/TabManager';
import { getEditorPool } from '../../services/EditorPool';
import { logger } from '../../utils/logger';
import './EditorContainer.css';

interface EditorContainerProps {
  tabs: Tab[];
  activeTabId: string | null;
  theme: ConfigTheme;
  onGetContent?: (getContentFn: () => string) => void;
  onEditorReady?: (editor: any) => void;
  onContentChange?: (tabId: string, isDirty: boolean) => void;
  onSaveComplete?: (filePath: string) => void; // Called after file is saved (for UI updates)
  onManualSaveReady?: (saveFunction: () => Promise<void>) => void; // Provides manual save function to parent
  textReplacements?: TextReplacement[];
  autosaveInterval?: number; // milliseconds, default 2000
  autosaveDebounce?: number; // milliseconds, default 200
  periodicSnapshotInterval?: number; // milliseconds, default 300000 (5 minutes)
}

export const EditorContainer: React.FC<EditorContainerProps> = ({
  tabs,
  activeTabId,
  theme,
  onGetContent,
  onEditorReady,
  onContentChange,
  onSaveComplete,
  onManualSaveReady,
  textReplacements,
  autosaveInterval = 2000,
  autosaveDebounce = 200,
  periodicSnapshotInterval = 300000, // 5 minutes
}) => {
  console.log('[EditorContainer] RENDER - tabs:', tabs.length, 'activeTabId:', activeTabId);
  const editorPool = getEditorPool();
  const getContentFuncs = useRef<Map<string, () => string>>(new Map());
  const lastSnapshotContent = useRef<Map<string, string>>(new Map()); // Track last snapshot content per file

  // Helper: Save file with history snapshot (encapsulates ALL per-file save logic)
  const saveWithHistory = useCallback(async (
    filePath: string,
    content: string,
    snapshotType: 'auto' | 'manual' = 'auto'
  ) => {
    if (!window.electronAPI) return;

    try {
      // Save to disk
      const result = await window.electronAPI.saveFile(content, filePath);

      if (result) {
        // Create history snapshot for this file
        if (window.electronAPI.history) {
          try {
            const description = snapshotType === 'manual' ? 'Manual save' : 'Auto-save';
            await window.electronAPI.history.createSnapshot(
              result.filePath,
              content,
              snapshotType,
              description
            );
          } catch (error) {
            logger.ui.error(`[EditorContainer] Failed to create history snapshot for ${filePath}:`, error);
            // Don't fail the save if snapshot creation fails
          }
        }

        // Notify parent that save completed
        if (onSaveComplete) {
          onSaveComplete(result.filePath);
        }
      }
    } catch (error) {
      logger.ui.error(`[EditorContainer] Failed to save file ${filePath}:`, error);
      throw error;
    }
  }, [onSaveComplete]);

  // Handle manual save request (Cmd+S or File > Save menu)
  const handleManualSave = useCallback(async () => {
    if (!activeTabId) return;

    const activeTab = tabs.find(t => t.id === activeTabId);
    if (!activeTab) return;

    const getContentFn = getContentFuncs.current.get(activeTabId);
    if (!getContentFn) return;

    const content = getContentFn();
    logger.ui.info(`[EditorContainer] Manual save: ${activeTab.fileName}`);

    await saveWithHistory(activeTab.filePath, content, 'manual');

    // Update instance to mark as clean and track save time
    editorPool.update(activeTab.filePath, {
      isDirty: false,
      initialContent: content,
      lastSaveTime: Date.now(),
    });

    // Notify parent of state change
    onContentChange?.(activeTabId, false);
  }, [activeTabId, tabs, editorPool, saveWithHistory, onContentChange]);

  // Provide manual save function to parent
  useEffect(() => {
    if (onManualSaveReady) {
      onManualSaveReady(handleManualSave);
    }
  }, [handleManualSave, onManualSaveReady]);

  // Create editor instances for all tabs
  useEffect(() => {
    const loadContent = async (filePath: string) => {
      if (!window.electronAPI?.readFileContent) {
        logger.ui.error('[EditorContainer] No electronAPI.readFileContent available');
        return '';
      }

      try {
        const result = await window.electronAPI.readFileContent(filePath);
        // readFileContent returns {content: string} or null
        if (result && typeof result === 'object' && 'content' in result) {
          return result.content || '';
        }
        return '';
      } catch (error) {
        logger.ui.error(`[EditorContainer] Failed to load content for: ${filePath}`, error);
        return '';
      }
    };

    const createEditorInstances = async () => {
      for (const tab of tabs) {
        const existingInstance = editorPool.get(tab.filePath);

        // If instance exists but has no content, we need to recreate it with loaded content
        if (existingInstance && (!existingInstance.content || existingInstance.content.length === 0)) {
          logger.ui.info(`[EditorContainer] Recreating editor with loaded content for: ${tab.fileName}`);
          editorPool.destroy(tab.filePath);
        }

        if (!editorPool.has(tab.filePath)) {
          // If tab has no content (e.g., restored from session), load it from file
          let content = tab.content;

          if (!content || content.length === 0) {
            logger.ui.info(`[EditorContainer] Loading content from file for: ${tab.fileName}`);
            content = await loadContent(tab.filePath);

            // Ensure content is a string
            if (typeof content !== 'string') {
              logger.ui.error(`[EditorContainer] Content is not a string for: ${tab.fileName}`, content);
              content = '';
            }
          }

          // DEBUG: Check if content has blank lines
          // console.log('[EDITOR_CONTAINER_DEBUG] Creating editor with content:');
          // console.log('[EDITOR_CONTAINER_DEBUG] First 200 chars:', JSON.stringify(content.substring(0, 200)));
          // console.log('[EDITOR_CONTAINER_DEBUG] Split by newline:', content.split('\n').slice(0, 10).map((line, i) => `Line ${i}: "${line}"`));

          editorPool.create(tab.filePath, content || '');
          logger.ui.info(`[EditorContainer] Created editor instance for tab: ${tab.fileName}`);
        }
      }
    };

    createEditorInstances();
  }, [tabs, editorPool]);

  // Update visibility when active tab changes - SAVE BEFORE HIDING
  useEffect(() => {
    if (!activeTabId) return;

    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab) return;

    // Save and hide all non-active editors
    const saveAndHide = async () => {
      for (const tab of tabs) {
        if (tab.id === activeTabId) continue; // Skip the active tab

        const instance = editorPool.get(tab.filePath);
        if (!instance) continue;

        // Save if dirty before hiding
        if (instance.isDirty) {
          const getContentFn = getContentFuncs.current.get(tab.id);
          if (getContentFn) {
            try {
              const content = getContentFn();
              logger.ui.info(`[EditorContainer] Auto-saving ${tab.fileName} before hiding`);

              await saveWithHistory(tab.filePath, content);

              // Update instance to mark as clean and track save time
              editorPool.update(tab.filePath, {
                isDirty: false,
                initialContent: content,
                lastSaveTime: Date.now(),
              });

              // Notify parent
              onContentChange?.(tab.id, false);
            } catch (error) {
              logger.ui.error(`[EditorContainer] Failed to save ${tab.fileName} before hiding:`, error);
            }
          }
        }

        // Now hide it
        editorPool.setVisible(tab.filePath, false);
      }

      // Mark active editor as visible
      editorPool.setVisible(activeTab.filePath, true);

      // Pass active tab's getContent function to parent
      const activeGetContent = getContentFuncs.current.get(activeTabId);
      if (activeGetContent && onGetContent) {
        onGetContent(activeGetContent);
      }

      logger.ui.info(`[EditorContainer] Active tab changed to: ${activeTab.fileName}`);
    };

    saveAndHide();
  }, [activeTabId, tabs, editorPool, onGetContent, saveWithHistory, onContentChange]);

  // Set up file watching for all editor instances
  useEffect(() => {
    if (!window.electronAPI) return;

    const handleFileChanged = async (event: any, data: { path: string }) => {
      logger.ui.info(`[EditorContainer] File changed on disk: ${data.path}`);

      // Find the tab for this file
      const tab = tabs.find(t => t.filePath === data.path);
      if (!tab) return;

      const instance = editorPool.get(data.path);
      if (!instance) return;

      // Ignore file changes shortly after we saved (prevents reload loops)
      if (instance.lastSaveTime && Date.now() - instance.lastSaveTime < 1000) {
        logger.ui.info(`[EditorContainer] Ignoring file change (just saved ${tab.fileName})`);
        return;
      }

      // If the editor is dirty, warn the user instead of auto-reloading
      if (instance.isDirty) {
        logger.ui.warn(`[EditorContainer] File changed but editor is dirty: ${tab.fileName}`);
        // TODO: Show user a dialog to choose: reload and lose changes, or keep current
        return;
      }

      // Reload the file content
      try {
        const result = await window.electronAPI.readFileContent(data.path);
        if (result && typeof result === 'object' && 'content' in result) {
          const newContent = result.content || '';

          // Update the editor pool instance
          editorPool.update(data.path, {
            content: newContent,
            initialContent: newContent,
            isDirty: false,
          });

          logger.ui.info(`[EditorContainer] Reloaded ${tab.fileName} after disk change`);

          // Notify parent
          onContentChange?.(tab.id, false);

          // If this is the active tab, we need to recreate the editor to show new content
          if (tab.id === activeTabId) {
            // Force re-render by destroying and recreating
            editorPool.destroy(data.path);
            editorPool.create(data.path, newContent);
          }
        }
      } catch (error) {
        logger.ui.error(`[EditorContainer] Failed to reload ${tab.fileName}:`, error);
      }
    };

    // Listen for file change events
    window.electronAPI.on('file-changed-on-disk', handleFileChanged);

    return () => {
      window.electronAPI.off('file-changed-on-disk', handleFileChanged);
    };
  }, [tabs, editorPool, activeTabId, onContentChange]);

  // Set up autosave for all editor instances
  useEffect(() => {
    tabs.forEach((tab) => {
      const instance = editorPool.get(tab.filePath);
      if (!instance) return;

      // Clear existing timer if any
      if (instance.autosaveTimer) {
        clearInterval(instance.autosaveTimer);
      }

      // Set up new autosave timer
      const timer = setInterval(async () => {
        const currentInstance = editorPool.get(tab.filePath);
        if (!currentInstance) return;

        // Skip if not dirty
        if (!currentInstance.isDirty) return;

        // Skip if not enough time has passed since last change (debounce)
        if (currentInstance.lastChangeTime &&
            Date.now() - currentInstance.lastChangeTime < autosaveDebounce) {
          return;
        }

        try {
          const getContentFn = getContentFuncs.current.get(tab.id);
          if (!getContentFn) return;

          const content = getContentFn();
          logger.ui.info(`[EditorContainer] Auto-saving: ${tab.fileName}`);

          await saveWithHistory(tab.filePath, content);

          // Update instance to mark as clean and track save time
          editorPool.update(tab.filePath, {
            isDirty: false,
            initialContent: content,
            lastSaveTime: Date.now(),
          });

          // Notify parent
          onContentChange?.(tab.id, false);
        } catch (error) {
          logger.ui.error(`[EditorContainer] Autosave failed for ${tab.fileName}:`, error);
        }
      }, autosaveInterval);

      // Store timer in instance
      editorPool.update(tab.filePath, { autosaveTimer: timer });
    });

    // Cleanup function
    return () => {
      tabs.forEach((tab) => {
        const instance = editorPool.get(tab.filePath);
        if (instance?.autosaveTimer) {
          clearInterval(instance.autosaveTimer);
          editorPool.update(tab.filePath, { autosaveTimer: null });
        }
      });
    };
  }, [tabs, editorPool, saveWithHistory, onContentChange, autosaveInterval, autosaveDebounce]);

  // Cleanup when tabs are closed - SAVE BEFORE DESTROYING
  useEffect(() => {
    const currentTabPaths = new Set(tabs.map((t) => t.filePath));
    const currentTabIds = new Set(tabs.map((t) => t.id));
    const poolInstances = editorPool.getAll();

    const saveAndDestroy = async () => {
      // Save and remove editors for closed tabs
      for (const [filePath, instance] of poolInstances) {
        if (!currentTabPaths.has(filePath)) {
          // Save if dirty before destroying
          if (instance.isDirty) {
            // Find the tab ID for this file path
            const tabEntry = Array.from(getContentFuncs.current.entries()).find(([id]) => {
              // We don't have a reverse mapping, so let's check all tabs
              const tab = tabs.find(t => t.id === id);
              return tab?.filePath === filePath;
            });

            if (tabEntry) {
              const [tabId, getContentFn] = tabEntry;
              try {
                const content = getContentFn();
                logger.ui.info(`[EditorContainer] Auto-saving ${filePath.split('/').pop()} before closing`);

                await saveWithHistory(filePath, content);
              } catch (error) {
                logger.ui.error(`[EditorContainer] Failed to save before closing:`, error);
              }
            }
          }

          editorPool.destroy(filePath);
          logger.ui.info(`[EditorContainer] Destroyed editor instance for closed tab: ${filePath}`);
        }
      }

      // Clean up getContent functions for closed tabs
      for (const tabId of getContentFuncs.current.keys()) {
        if (!currentTabIds.has(tabId)) {
          getContentFuncs.current.delete(tabId);
        }
      }
    };

    saveAndDestroy();
  }, [tabs, editorPool, saveWithHistory]);

  // Set up periodic snapshots for all tabs (every 5 minutes)
  useEffect(() => {
    if (!window.electronAPI?.history || periodicSnapshotInterval <= 0) return;

    const timer = setInterval(async () => {
      for (const tab of tabs) {
        const getContentFn = getContentFuncs.current.get(tab.id);
        if (!getContentFn) continue;

        try {
          const content = getContentFn();
          const lastContent = lastSnapshotContent.current.get(tab.filePath);

          // Only create snapshot if content changed since last periodic snapshot
          if (content && content !== lastContent && content !== '') {
            logger.ui.info(`[EditorContainer] Creating periodic snapshot for: ${tab.fileName}`);
            await window.electronAPI.history.createSnapshot(
              tab.filePath,
              content,
              'auto',
              'Periodic auto-save'
            );
            lastSnapshotContent.current.set(tab.filePath, content);
          }
        } catch (error) {
          logger.ui.error(`[EditorContainer] Failed to create periodic snapshot for ${tab.fileName}:`, error);
        }
      }
    }, periodicSnapshotInterval);

    return () => clearInterval(timer);
  }, [tabs, periodicSnapshotInterval]);

  return (
    <div className="multi-editor-container">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const instance = editorPool.get(tab.filePath);

        if (!instance) {
          logger.ui.error(`[EditorContainer] No instance found for tab: ${tab.fileName}`);
          return null;
        }

        // Don't render sleeping editors (state is preserved, but not in DOM)
        if (instance.isSleeping) {
          return null;
        }

        return (
          <div
            key={tab.id}
            className={`multi-editor-instance ${isActive ? 'active' : 'hidden'}`}
            data-active={isActive ? 'true' : 'false'}
            data-file-path={tab.filePath}
          >
            <StravuEditor
              key={`${tab.filePath}-v${instance.reloadVersion ?? 0}-theme-${theme}`}
              config={{
                initialContent: instance.content,
                theme,
                onContentChange: () => {
                  // Get current content and compare to initialContent
                  const getContentFn = getContentFuncs.current.get(tab.id);
                  if (!getContentFn) {
                    return;
                  }

                  const currentContent = getContentFn();
                  const isDirty = currentContent !== instance.initialContent;

                  // Update the EditorPool instance with content, dirty state, and change time
                  // This happens on every edit but is just updating a Map, not triggering React re-renders
                  editorPool.update(tab.filePath, {
                    content: currentContent,
                    isDirty,
                    lastChangeTime: Date.now(), // Track for autosave debouncing
                  });

                  // Notify parent (App.tsx will check if isDirty actually changed)
                  onContentChange?.(tab.id, isDirty);
                },
                onGetContent: (getContentFn) => {
                  // Store this tab's getContent function
                  getContentFuncs.current.set(tab.id, getContentFn);

                  // If this is the active tab, pass it to parent immediately
                  if (isActive && onGetContent) {
                    onGetContent(getContentFn);
                  }
                },
                onEditorReady: (editor) => {
                  if (isActive && onEditorReady) {
                    onEditorReady(editor);
                  }
                },
                onSaveRequest: handleManualSave,
                textReplacements: isActive ? textReplacements : undefined,
              }}
            />
          </div>
        );
      })}
    </div>
  );
};
