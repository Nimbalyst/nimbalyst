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
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [conflictDialogContent, setConflictDialogContent] = useState<string>('');
  const [showBackgroundChangeDialog, setShowBackgroundChangeDialog] = useState(false);
  const [backgroundChangeContent, setBackgroundChangeContent] = useState<string>('');

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

  // Check if file changed on disk when tab becomes active
  useEffect(() => {
    if (!isActive || !window.electronAPI) return;

    const checkDiskContent = async () => {
      // Don't check if we're already showing a conflict dialog
      if (showConflictDialog || showBackgroundChangeDialog) {
        return;
      }

      try {
        const result = await window.electronAPI.readFileContent(filePath);
        if (!result || typeof result !== 'object' || !('content' in result)) {
          return;
        }

        const diskContent = result.content || '';
        const currentContent = contentRef.current;

        if (diskContent !== currentContent && diskContent !== lastSavedContentRef.current) {
          // If there are unsaved changes, show dialog
          if (isDirtyRef.current) {
            setBackgroundChangeContent(diskContent);
            setShowBackgroundChangeDialog(true);
          } else {
            // No unsaved changes - just auto-reload
            setContent(diskContent);
            initialContentRef.current = diskContent;
            setLastSavedContent(diskContent);
            lastSavedContentRef.current = diskContent;
            contentRef.current = diskContent;

            // Update via Lexical API
            if (editorRef.current) {
              try {
                const { $getRoot } = await import('lexical');
                const { $convertFromEnhancedMarkdownString, getEditorTransformers } = await import('rexical');
                const transformers = getEditorTransformers();

                editorRef.current.update(() => {
                  const root = $getRoot();
                  root.clear();
                  $convertFromEnhancedMarkdownString(diskContent, transformers);
                });
              } catch (error) {
                logger.ui.error(`[TabEditor] Failed to update editor:`, error);
              }
            }
          }
        }
      } catch (error) {
        console.error(`[TabEditor ${fileName}] Error checking disk content:`, error);
      }
    };

    // Small delay to let the tab switch animation complete
    const timer = setTimeout(checkDiskContent, 300);
    return () => clearTimeout(timer);
  }, [isActive, filePath, fileName, onDirtyChange, showConflictDialog, showBackgroundChangeDialog]);

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

  // File watching - use ref to ensure we only register once
  const fileWatcherRegisteredRef = useRef(false);

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }

    // Only register once per component instance
    if (fileWatcherRegisteredRef.current) {
      return;
    }

    fileWatcherRegisteredRef.current = true;

    const processingChangeRef = { current: false };

    // Create a stable handler function that we can properly clean up
    const handleFileChanged = async (data: { path: string }) => {
      // Only handle changes for this file
      if (data.path !== filePath) {
        return;
      }

      // Skip if already processing THIS SPECIFIC CHANGE
      // Don't use a long timeout - we want to process subsequent changes
      if (processingChangeRef.current) {
        return;
      }
      processingChangeRef.current = true;

      try {
        const result = await window.electronAPI.readFileContent(data.path);
        if (!result || typeof result !== 'object' || !('content' in result)) {
          processingChangeRef.current = false;
          return;
        }

        const newContent = result.content || '';
        const currentContent = contentRef.current;

        // Check if disk content matches current editor content
        if (newContent === currentContent) {
          processingChangeRef.current = false;
          return;
        }

        // CRITICAL: Check if this is content we just saved
        // If the disk content matches what we last saved, this is definitely our own save
        // Don't reload even if the user has typed more since then
        const contentMatchesLastSave = newContent === lastSavedContentRef.current;

        if (contentMatchesLastSave) {
          processingChangeRef.current = false;
          return;
        }

        // Also check time-based heuristic as a fallback
        const timeSinceLastSave = lastSaveTimeRef.current ? Date.now() - lastSaveTimeRef.current : Infinity;
        if (timeSinceLastSave < 2000) {
          processingChangeRef.current = false;
          return;
        }

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

          // Update state
          setContent(newContent);
          initialContentRef.current = newContent;
          setLastSavedContent(newContent);
          lastSavedContentRef.current = newContent;
          contentRef.current = newContent;
          setIsDirty(false);
          isDirtyRef.current = false;
          onDirtyChange?.(false);

          // Update editor content programmatically using Lexical API
          // Works for both active and inactive tabs since editor is still mounted
          if (editorRef.current) {
            try {
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
        };

        // Protect dirty files from being overwritten
        if (isDirtyRef.current) {
          // Store the new content and show dialog
          setConflictDialogContent(newContent);
          setShowConflictDialog(true);
          processingChangeRef.current = false;
          return;
        }

        await applyReload();
      } finally {
        // Release the lock immediately after processing
        // This allows rapid successive changes to be processed
        processingChangeRef.current = false;
      }
    };

    window.electronAPI.on('file-changed-on-disk', handleFileChanged);

    // Cleanup function - CRITICAL: This must remove the exact same function reference
    return () => {
      window.electronAPI.off('file-changed-on-disk', handleFileChanged);
      // Reset the ref so it can be re-registered if needed
      fileWatcherRegisteredRef.current = false;
    };
    // NOTE: onDirtyChange is NOT in dependencies to prevent re-registering listeners
    // We call it directly in handleFileChanged which captures the current value
  }, [filePath, fileName]);

  // Handle conflict dialog actions
  const handleReloadFromDisk = useCallback(async () => {
    const newContent = conflictDialogContent;
    setShowConflictDialog(false);
    setConflictDialogContent('');

    // Apply the reload
    setContent(newContent);
    initialContentRef.current = newContent;
    setLastSavedContent(newContent);
    lastSavedContentRef.current = newContent;
    contentRef.current = newContent;
    setIsDirty(false);
    isDirtyRef.current = false;
    onDirtyChange?.(false);

    // Update editor content
    if (editorRef.current) {
      try {
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
  }, [conflictDialogContent, fileName, onDirtyChange]);

  const handleKeepLocalChanges = useCallback(() => {
    setShowConflictDialog(false);
    setConflictDialogContent('');
  }, []);

  // Handle background change dialog actions
  const handleReloadFromBackground = useCallback(async () => {
    const diskContent = backgroundChangeContent;
    setShowBackgroundChangeDialog(false);
    setBackgroundChangeContent('');

    // Apply the reload
    setContent(diskContent);
    initialContentRef.current = diskContent;
    setLastSavedContent(diskContent);
    lastSavedContentRef.current = diskContent;
    contentRef.current = diskContent;
    setIsDirty(false);
    isDirtyRef.current = false;
    onDirtyChange?.(false);

    // Update editor content
    if (editorRef.current) {
      try {
        const { $getRoot } = await import('lexical');
        const { $convertFromEnhancedMarkdownString, getEditorTransformers } = await import('rexical');
        const transformers = getEditorTransformers();

        editorRef.current.update(() => {
          const root = $getRoot();
          root.clear();
          $convertFromEnhancedMarkdownString(diskContent, transformers);
        });
      } catch (error) {
        logger.ui.error(`[TabEditor] Failed to update editor content:`, error);
      }
    }
  }, [backgroundChangeContent, fileName, onDirtyChange]);

  const handleKeepEditorContent = useCallback(() => {
    setShowBackgroundChangeDialog(false);
    setBackgroundChangeContent('');
  }, []);

  return (
      <div
          className={`tab-editor multi-editor-instance ${isActive ? 'active' : 'hidden'}`}
          data-active={isActive ? 'true' : 'false'}
          data-file-path={filePath}
          style={{
            display: isActive ? 'block' : 'none',
            height: '100%',
            overflow: 'hidden',
            position: 'relative'
          }}
      >
        <StravuEditor
            key={`${filePath}-theme-${theme}`}
            config={{
              initialContent,
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

        {showConflictDialog && (
          <div
            className="file-conflict-dialog-overlay"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000
            }}
          >
            <div
              className="file-conflict-dialog"
              style={{
                backgroundColor: 'var(--surface-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '8px',
                padding: '24px',
                maxWidth: '500px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
              }}
            >
              <h3 style={{ marginTop: 0, color: 'var(--text-primary)' }}>File Changed on Disk</h3>
              <p style={{ color: 'var(--text-secondary)' }}>
                The file "{fileName}" has been changed on disk but you have unsaved changes.
              </p>
              <p style={{ color: 'var(--text-secondary)' }}>
                Do you want to reload the file from disk and lose your changes?
              </p>
              <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'flex-end' }}>
                <button
                  onClick={handleKeepLocalChanges}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: 'var(--surface-secondary)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: '4px',
                    color: 'var(--text-primary)',
                    cursor: 'pointer'
                  }}
                >
                  Keep My Changes
                </button>
                <button
                  onClick={handleReloadFromDisk}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: 'var(--primary-color)',
                    border: 'none',
                    borderRadius: '4px',
                    color: 'white',
                    cursor: 'pointer'
                  }}
                >
                  Reload from Disk
                </button>
              </div>
            </div>
          </div>
        )}

        {showBackgroundChangeDialog && (
          <div
            className="file-background-change-dialog-overlay"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000
            }}
          >
            <div
              className="file-background-change-dialog"
              style={{
                backgroundColor: 'var(--surface-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '8px',
                padding: '24px',
                maxWidth: '500px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
              }}
            >
              <h3 style={{ marginTop: 0, color: 'var(--text-primary)' }}>File Changed While Inactive</h3>
              <p style={{ color: 'var(--text-secondary)' }}>
                The file "{fileName}" has changed on disk while this tab was in the background.
              </p>
              <p style={{ color: 'var(--text-secondary)' }}>
                Do you want to reload the file from disk?
              </p>
              <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'flex-end' }}>
                <button
                  onClick={handleKeepEditorContent}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: 'var(--surface-secondary)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: '4px',
                    color: 'var(--text-primary)',
                    cursor: 'pointer'
                  }}
                >
                  Keep Current Content
                </button>
                <button
                  onClick={handleReloadFromBackground}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: 'var(--primary-color)',
                    border: 'none',
                    borderRadius: '4px',
                    color: 'white',
                    cursor: 'pointer'
                  }}
                >
                  Reload from Disk
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
  );
};
