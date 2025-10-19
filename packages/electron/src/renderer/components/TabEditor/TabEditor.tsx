/**
 * TabEditor - Fully encapsulated editor component for a single file
 *
 * This component owns ALL state for managing one editor instance:
 * - Content and dirty state
 * - Autosave timer
 * - File watching
 * - Manual save
 * - History snapshots
 *
 * Props are minimal - just what the component needs from parent coordination.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ConfigTheme, TextReplacement } from 'rexical';
import { StravuEditor } from 'rexical';
import { logger } from '../../utils/logger';

interface TabEditorProps {
  // Identification
  filePath: string;
  fileName: string;

  // Initial state
  initialContent: string;

  // Configuration
  theme: ConfigTheme;
  isActive: boolean;

  // Optional features
  textReplacements?: TextReplacement[];
  autosaveInterval?: number; // milliseconds, default 2000
  autosaveDebounce?: number; // milliseconds, default 200
  periodicSnapshotInterval?: number; // milliseconds, default 300000 (5 minutes)

  // Callbacks to parent
  onDirtyChange?: (isDirty: boolean) => void;
  onSaveComplete?: (filePath: string) => void;
  onContentChange?: () => void;

  // External control (exposed via imperative handle)
  onManualSaveReady?: (saveFunction: () => Promise<void>) => void;
  onGetContentReady?: (getContentFunction: () => string) => void;
}

export const TabEditor: React.FC<TabEditorProps> = ({
                                                      filePath,
                                                      fileName,
                                                      initialContent,
                                                      theme,
                                                      isActive,
                                                      textReplacements,
                                                      autosaveInterval = 2000,
                                                      autosaveDebounce = 200,
                                                      periodicSnapshotInterval = 300000,
                                                      onDirtyChange,
                                                      onSaveComplete,
                                                      onContentChange,
                                                      onManualSaveReady,
                                                      onGetContentReady,
                                                    }) => {
  // Internal state - fully owned by this component
  const [content, setContent] = useState(initialContent);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSaveTime, setLastSaveTime] = useState<number | null>(null);
  const [lastSavedContent, setLastSavedContent] = useState(initialContent);
  const [reloadVersion, setReloadVersion] = useState(0);

  // Refs for stable access in timers/callbacks
  const contentRef = useRef(content);
  const isDirtyRef = useRef(isDirty);
  const lastChangeTimeRef = useRef<number>(0);
  const getContentFnRef = useRef<(() => string) | null>(null);
  const editorRef = useRef<any>(null);
  const initialContentRef = useRef(initialContent);
  const lastSaveTimeRef = useRef<number | null>(lastSaveTime);
  const lastSavedContentRef = useRef<string>(lastSavedContent);
  const isSavingRef = useRef<boolean>(false);
  const saveIdRef = useRef<number>(0);
  const pendingSaveIdsRef = useRef<Set<number>>(new Set());
  const instanceIdRef = useRef<number>(Math.floor(Math.random() * 10000));

  // Keep refs in sync with state
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    lastSaveTimeRef.current = lastSaveTime;
  }, [lastSaveTime]);

  useEffect(() => {
    lastSavedContentRef.current = lastSavedContent;
  }, [lastSavedContent]);

  // Helper: Save file with history snapshot
  const saveWithHistory = useCallback(async (
      contentToSave: string,
      snapshotType: 'auto' | 'manual' = 'auto'
  ) => {
    if (!window.electronAPI) return;

    try {
      // Generate a unique save ID to track this specific save operation
      const thisSaveId = ++saveIdRef.current;
      pendingSaveIdsRef.current.add(thisSaveId);

      // Set saving flag BEFORE saving to prevent file watcher from reloading
      isSavingRef.current = true;

      // Update refs BEFORE saving so file watcher can detect it's our own save
      // CRITICAL: Update both ref and state synchronously to ensure file watcher sees the change
      const saveTime = Date.now();
      lastSaveTimeRef.current = saveTime;
      lastSavedContentRef.current = contentToSave;
      setLastSaveTime(saveTime);
      setLastSavedContent(contentToSave);

      logger.ui.info(`[TabEditor] Saving ${fileName}, saveId=${thisSaveId}`);

      // Save to disk with conflict detection
      const result = await window.electronAPI.saveFile(
          contentToSave,
          filePath,
          initialContentRef.current
      );

      if (result) {
        // Check for conflicts
        if (result.conflict) {
          logger.ui.info('[TabEditor] Save conflict detected, prompting user');
          const shouldOverwrite = window.confirm(
              'The file has been modified externally since you opened it.\n\n' +
              'Do you want to overwrite the external changes with your edits?\n\n' +
              'Click OK to overwrite, or Cancel to reload the file from disk.'
          );

          if (shouldOverwrite) {
            // Retry save without conflict checking (force overwrite)
            const forceResult = await window.electronAPI.saveFile(contentToSave, filePath);
            if (forceResult && forceResult.success) {
              initialContentRef.current = contentToSave;
              setLastSaveTime(Date.now());
              setLastSavedContent(contentToSave);
            }
          } else {
            // User chose to reload - update editor with disk content
            // Update editor content programmatically to avoid remount
            if (editorRef.current) {
              try {
                // Import Lexical functions from 'lexical' and rexical functions from 'rexical'
                const { $getRoot } = await import('lexical');
                const { $convertFromEnhancedMarkdownString, getEditorTransformers } = await import('rexical');
                const transformers = getEditorTransformers();

                editorRef.current.update(() => {
                  const root = $getRoot();
                  root.clear();
                  $convertFromEnhancedMarkdownString(result.diskContent, transformers);
                });
              } catch (error) {
                logger.ui.error(`[TabEditor] Failed to update editor content:`, error);
              }
            }

            setContent(result.diskContent);
            initialContentRef.current = result.diskContent;
            setLastSavedContent(result.diskContent);
            setIsDirty(false);
            return;
          }
        }

        // Create history snapshot
        if (window.electronAPI.history) {
          try {
            const description = snapshotType === 'manual' ? 'Manual save' : 'Auto-save';
            const dbSnapshotType = snapshotType === 'manual' ? 'manual' : 'auto-save';
            await window.electronAPI.history.createSnapshot(
                result.filePath,
                contentToSave,
                dbSnapshotType,
                description
            );
          } catch (error) {
            logger.ui.error(`[TabEditor] Failed to create history snapshot for ${filePath}:`, error);
          }
        }

        // Update remaining state (refs were already updated before save)
        initialContentRef.current = contentToSave;
        setIsDirty(false);

        // Notify parent
        onSaveComplete?.(result.filePath);
        onDirtyChange?.(false);

        // Clear this save ID after a delay to ensure file watcher events are processed
        // File watchers can be slow, especially on macOS, so use a generous timeout
        setTimeout(() => {
          pendingSaveIdsRef.current.delete(thisSaveId);
          // Only clear isSaving if no pending saves
          if (pendingSaveIdsRef.current.size === 0) {
            isSavingRef.current = false;
          }
        }, 10000);
      }
    } catch (error) {
      logger.ui.error(`[TabEditor] Failed to save file ${filePath}:`, error);
      // Reset refs on error
      setLastSaveTime(null);
      lastSaveTimeRef.current = null;
      isSavingRef.current = false;
      throw error;
    }
  }, [filePath, fileName, onSaveComplete, onDirtyChange]);

  // Manual save function
  const handleManualSave = useCallback(async () => {
    if (!getContentFnRef.current) {
      logger.ui.warn('[TabEditor] No getContent function available for manual save');
      return;
    }

    const currentContent = getContentFnRef.current();
    await saveWithHistory(currentContent, 'manual');
  }, [saveWithHistory]);

  // Content change handler from editor
  const handleContentChange = useCallback(() => {
    if (!getContentFnRef.current) return;

    const currentContent = getContentFnRef.current();
    const isContentDirty = currentContent !== initialContentRef.current;

    setContent(currentContent);
    setIsDirty(isContentDirty);
    lastChangeTimeRef.current = Date.now();

    // Notify parent
    onDirtyChange?.(isContentDirty);
    onContentChange?.();
  }, [onDirtyChange, onContentChange]);

  // Autosave timer
  useEffect(() => {
    if (autosaveInterval <= 0) return;

    const timer = setInterval(async () => {
      // Skip if not dirty
      if (!isDirtyRef.current) return;

      // Skip if not enough time has passed since last change (debounce)
      if (Date.now() - lastChangeTimeRef.current < autosaveDebounce) {
        return;
      }

      // Skip if no content getter
      if (!getContentFnRef.current) return;

      try {
        const currentContent = getContentFnRef.current();
        logger.ui.info(`[TabEditor] Auto-saving: ${fileName}`);
        await saveWithHistory(currentContent, 'auto');
      } catch (error) {
        logger.ui.error(`[TabEditor] Autosave failed for ${filePath}:`, error);
      }
    }, autosaveInterval);

    return () => clearInterval(timer);
  }, [autosaveInterval, autosaveDebounce, filePath, fileName, saveWithHistory]);

  // Periodic snapshots
  const lastSnapshotContentRef = useRef<string>(initialContent);

  useEffect(() => {
    if (!window.electronAPI?.history || periodicSnapshotInterval <= 0) return;

    const timer = setInterval(async () => {
      if (!getContentFnRef.current) return;

      try {
        const currentContent = getContentFnRef.current();
        const lastContent = lastSnapshotContentRef.current;

        // Only create snapshot if content changed since last periodic snapshot
        if (currentContent && currentContent !== lastContent && currentContent !== '') {
          logger.ui.info(`[TabEditor] Creating periodic snapshot for: ${fileName}`);
          await window.electronAPI.history.createSnapshot(
              filePath,
              currentContent,
              'auto-save',
              'Periodic auto-save'
          );
          lastSnapshotContentRef.current = currentContent;
        }
      } catch (error) {
        logger.ui.error(`[TabEditor] Failed to create periodic snapshot for ${fileName}:`, error);
      }
    }, periodicSnapshotInterval);

    return () => clearInterval(timer);
  }, [periodicSnapshotInterval, filePath, fileName]);

  // File watching
  useEffect(() => {
    if (!window.electronAPI) return;

    const processingChangeRef = { current: false };

    // Create a stable handler function that we can properly clean up
    const handleFileChanged = async (data: { path: string }) => {
      // Only handle changes for this file
      if (data.path !== filePath) {
        return;
      }

      // Skip if already processing
      if (processingChangeRef.current) {
        logger.ui.info(`[TabEditor] Already processing file change for ${fileName}, skipping`);
        return;
      }
      processingChangeRef.current = true;

      try {
        logger.ui.info(`[TabEditor] File changed on disk: ${fileName}`);

        const result = await window.electronAPI.readFileContent(data.path);
        if (!result || typeof result !== 'object' || !('content' in result)) {
          return;
        }

        const newContent = result.content || '';
        const currentContent = contentRef.current;

        // Check if disk content matches current editor content
        if (newContent === currentContent) {
          logger.ui.info(`[TabEditor] Disk content matches editor for ${fileName}, skipping reload`);
          return;
        }

        // CRITICAL: Check if this is content we just saved
        // If the disk content matches what we last saved, this is definitely our own save
        // Don't reload even if the user has typed more since then
        const contentMatchesLastSave = newContent === lastSavedContentRef.current;

        if (contentMatchesLastSave) {
          logger.ui.info(`[TabEditor] Disk content matches last save for ${fileName}, skipping reload`);
          return;
        }

        // Also check time-based heuristic as a fallback
        const timeSinceLastSave = lastSaveTimeRef.current ? Date.now() - lastSaveTimeRef.current : Infinity;
        if (timeSinceLastSave < 3000) {
          logger.ui.info(`[TabEditor] File change within 3s of save for ${fileName}, assuming our own save`);
          return;
        }

        // External change detected
        logger.ui.info(`[TabEditor] External change detected for ${fileName}`);

        const applyReload = async () => {
          // Create history snapshot of external change
          if (window.electronAPI?.history && newContent) {
            try {
              await window.electronAPI.history.createSnapshot(
                  data.path,
                  newContent,
                  'external-change',
                  'File modified externally'
              );
            } catch (error) {
              logger.ui.error(`[TabEditor] Failed to create history snapshot:`, error);
            }
          }

          // Update editor content programmatically using Lexical API
          // This avoids remounting and preserves focus
          if (editorRef.current) {
            try {
              // Import Lexical functions from 'lexical' and rexical functions from 'rexical'
              const { $getRoot } = await import('lexical');
              const { $convertFromEnhancedMarkdownString, getEditorTransformers } = await import('rexical');
              const transformers = getEditorTransformers();

              editorRef.current.update(() => {
                const root = $getRoot();
                root.clear();
                $convertFromEnhancedMarkdownString(newContent, transformers);
              });
            } catch (error) {
              logger.ui.error(`[TabEditor] Failed to update editor content:`, error);
            }
          }

          setContent(newContent);
          initialContentRef.current = newContent;
          setLastSavedContent(newContent);
          setIsDirty(false);

          onDirtyChange?.(false);
        };

        // Protect dirty files from being overwritten
        if (isDirtyRef.current) {
          const shouldReload = window.confirm(
              `The file "${fileName}" has been changed on disk but you have unsaved changes.\n\n` +
              'Do you want to reload the file from disk and lose your changes?\n\n' +
              'Click OK to reload from disk, or Cancel to keep your changes.'
          );

          if (shouldReload) {
            await applyReload();
          }
          return;
        }

        await applyReload();
      } finally {
        // Use a longer timeout to prevent rapid refires
        setTimeout(() => {
          processingChangeRef.current = false;
        }, 1000);
      }
    };

    logger.ui.info(`[TabEditor] Registering file watcher for: ${fileName} (${filePath})`);
    window.electronAPI.on('file-changed-on-disk', handleFileChanged);

    // Cleanup function - CRITICAL: This must remove the exact same function reference
    return () => {
      logger.ui.info(`[TabEditor] Unregistering file watcher for: ${fileName} (${filePath})`);
      window.electronAPI.off('file-changed-on-disk', handleFileChanged);
    };
    // NOTE: onDirtyChange is NOT in dependencies to prevent re-registering listeners
    // We call it directly in handleFileChanged which captures the current value
  }, [filePath, fileName]);

  return (
      <div
          className={`tab-editor multi-editor-instance ${isActive ? 'active' : 'hidden'}`}
          data-active={isActive ? 'true' : 'false'}
          data-file-path={filePath}
          style={{
            display: isActive ? 'block' : 'none',
            height: '100%',
            overflow: 'hidden'
          }}
      >
        <StravuEditor
            key={`${filePath}-theme-${theme}`}
            config={{
              initialContent: content,
              theme,
              onContentChange: handleContentChange,
              onGetContent: (getContentFn) => {
                getContentFnRef.current = getContentFn;
                if (onGetContentReady) {
                  onGetContentReady(getContentFn);
                }
                // Now that we have getContentFn, expose the manual save function
                if (onManualSaveReady) {
                  onManualSaveReady(handleManualSave);
                }
              },
              onEditorReady: (editor) => {
                editorRef.current = editor;
              },
              onSaveRequest: handleManualSave,
              textReplacements: isActive ? textReplacements : undefined,
            }}
        />
      </div>
  );
};
