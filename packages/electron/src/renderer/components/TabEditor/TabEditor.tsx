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
import { DocumentHeaderContainer } from '@nimbalyst/runtime/plugins/TrackerPlugin/documentHeader';
import { FixedTabHeaderContainer } from '@nimbalyst/runtime/plugins/shared/fixedTabHeader';
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

  // Document action callbacks
  onViewHistory?: () => void;
  onRenameDocument?: () => void;
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
                                                      onViewHistory,
                                                      onRenameDocument,
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
  const hasInitialContentSyncRef = useRef<boolean>(false);
  const pendingAIEditTagRef = useRef<{tagId: string, filePath: string} | null>(null);
  const isApplyingDiffRef = useRef<boolean>(false); // Track programmatic diff application

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
          // CRITICAL: Check for pending AI edit tags FIRST
          let pendingTags: any[] = [];
          try {
            if (window.electronAPI?.history) {
              pendingTags = await window.electronAPI.history.getPendingTags(filePath);
            }
          } catch (error) {
            logger.ui.error(`[TabEditor] Failed to check for pending tags on tab activation:`, error);
          }

          // If this is an AI edit, don't show background dialog - the file watcher will handle it
          if (pendingTags && pendingTags.length > 0) {
            console.log(`[TabEditor] AI edit detected on tab activation - skipping background dialog`);
            return;
          }

          // If there are unsaved changes, show dialog
          if (isDirtyRef.current) {
            console.log(`[TabEditor] TAB ACTIVATION: Showing background change dialog`);
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
                const { $getRoot, SKIP_SCROLL_INTO_VIEW_TAG } = await import('lexical');
                const { $convertFromEnhancedMarkdownString, getEditorTransformers } = await import('rexical');
                const transformers = getEditorTransformers();

                editorRef.current.update(() => {
                  const root = $getRoot();
                  root.clear();
                  $convertFromEnhancedMarkdownString(diskContent, transformers);
                }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });
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
                const { $getRoot, SKIP_SCROLL_INTO_VIEW_TAG } = await import('lexical');
                const { $convertFromEnhancedMarkdownString, getEditorTransformers } = await import('rexical');
                const transformers = getEditorTransformers();

                editorRef.current.update(() => {
                  const root = $getRoot();
                  root.clear();
                  $convertFromEnhancedMarkdownString(result.diskContent, transformers);
                }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });
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

    // CRITICAL: If user manually edits during diff mode, clear the pending tag
    // This means they've modified the AI's changes, so it's no longer a "pure" AI diff
    // and we should allow autosave to prevent data loss
    // Only do this for ACTUAL user edits, not:
    // - Programmatic diff application (isApplyingDiffRef)
    // - Content changes from file watcher reloads
    // The safest check: Only clear if user is actively typing (currentContent != lastChangeTimeRef content)
    // For now, DISABLE this clearing entirely - let user approve/reject handle it
    if (false && pendingAIEditTagRef.current && !isApplyingDiffRef.current) {
      logger.ui.info(`[TabEditor] User edited during diff mode - clearing pending tag for ${fileName}`);
      const tagInfo = pendingAIEditTagRef.current;
      pendingAIEditTagRef.current = null;

      // Mark the tag as reviewed since user has manually intervened
      if (window.electronAPI?.history) {
        window.electronAPI.history.updateTagStatus(tagInfo.filePath, tagInfo.tagId, 'reviewed')
          .catch(error => {
            logger.ui.error(`[TabEditor] Failed to mark tag as reviewed after user edit:`, error);
          });
      }
    }

    // Notify parent
    onDirtyChange?.(isContentDirty);
    onContentChange?.();
  }, [fileName, onDirtyChange, onContentChange]);


  // Autosave timer
  useEffect(() => {
    if (autosaveInterval <= 0) return;

    const timer = setInterval(async () => {
      // Skip if not dirty
      if (!isDirtyRef.current) return;

      // CRITICAL: Skip autosave if we're in diff mode showing AI edits
      // The content is already on disk - autosaving the diff view would cause mismatches
      if (pendingAIEditTagRef.current) {
        logger.ui.info(`[TabEditor] Skipping autosave - diff mode active for ${fileName}`);
        return;
      }

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

      // Skip periodic snapshots if we're in diff mode
      if (pendingAIEditTagRef.current) {
        logger.ui.info(`[TabEditor] Skipping periodic snapshot - diff mode active for ${fileName}`);
        return;
      }

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

  // Check for pending AI edit tags on mount
  const hasCheckedForPendingTagsRef = useRef(false);

  useEffect(() => {
    if (hasCheckedForPendingTagsRef.current) return;
    if (!window.electronAPI?.history) return;
    if (!editorRef.current) return;

    hasCheckedForPendingTagsRef.current = true;

    const checkForPendingTags = async () => {
      try {
        const pendingTags = await window.electronAPI.history.getPendingTags(filePath);

        if (pendingTags && pendingTags.length > 0) {
          console.log(`[TabEditor] Found pending AI edit tag on mount - restoring diff mode`);

          // Load the tagged (old) content first
          const oldContent = pendingTags[0].content;
          const newContent = initialContent; // Current disk content

          setContent(oldContent);
          contentRef.current = oldContent;

          // Update editor with old content
          const { $getRoot, SKIP_SCROLL_INTO_VIEW_TAG } = await import('lexical');
          const { $convertFromEnhancedMarkdownString, getEditorTransformers } = await import('rexical');
          const transformers = getEditorTransformers();

          editorRef.current.update(() => {
            const root = $getRoot();
            root.clear();
            $convertFromEnhancedMarkdownString(oldContent, transformers);
          }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });

          // Apply the diff
          const replacements: TextReplacement[] = [{
            oldText: oldContent,
            newText: newContent
          }];

          await new Promise(resolve => setTimeout(resolve, 100));

          // Mark that we're applying a diff programmatically (not a user edit)
          isApplyingDiffRef.current = true;
          try {
            const { APPLY_MARKDOWN_REPLACE_COMMAND } = await import('rexical');
            editorRef.current.dispatchCommand(APPLY_MARKDOWN_REPLACE_COMMAND, replacements);
          } finally {
            // Reset flag after a small delay to ensure content change handler has run
            setTimeout(() => {
              isApplyingDiffRef.current = false;
            }, 100);
          }

          // Store tag info for approval
          pendingAIEditTagRef.current = {
            tagId: pendingTags[0].id,
            filePath: filePath
          };

          console.log(`[TabEditor] Restored diff mode on mount`);
        }
      } catch (error) {
        logger.ui.error(`[TabEditor] Failed to check for pending tags on mount:`, error);
      }
    };

    checkForPendingTags();
  }, [filePath, initialContent]);

  // File watching - use ref to ensure we only register once
  const fileWatcherRegisteredRef = useRef(false);
  // Track if we're currently processing a file change (prevent duplicate processing)
  const processingFileChangeRef = useRef(false);

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }

    // Only register once per component instance
    if (fileWatcherRegisteredRef.current) {
      return;
    }

    fileWatcherRegisteredRef.current = true;

    // Create a stable handler function that we can properly clean up
    const handleFileChanged = async (data: { path: string }) => {
      // Only handle changes for this file
      if (data.path !== filePath) {
        return;
      }

      // Skip if already processing a change
      // This prevents duplicate processing when chokidar fires multiple events
      if (processingFileChangeRef.current) {
        console.log('[TabEditor] Skipping duplicate file-changed event - another change is already processing');
        return;
      }
      processingFileChangeRef.current = true;
      console.log('[TabEditor] Processing file-changed event for:', data.path);
      console.log('[TabEditor] Processing flag set to true');

      try {
        const result = await window.electronAPI.readFileContent(data.path);
        if (!result || typeof result !== 'object' || !('content' in result)) {
          processingFileChangeRef.current = false;
          return;
        }

        const newContent = result.content || '';
        const currentContent = contentRef.current;

        // Check if disk content matches current editor content
        if (newContent === currentContent) {
          console.log('[TabEditor] Skipping - disk content matches current editor content');
          processingFileChangeRef.current = false;
          return;
        }

        // CRITICAL: Check if this is content we just saved
        // If the disk content matches what we last saved, this is definitely our own save
        // Don't reload even if the user has typed more since then
        const contentMatchesLastSave = newContent === lastSavedContentRef.current;

        if (contentMatchesLastSave) {
          console.log('[TabEditor] Skipping - disk content matches last saved content');
          processingFileChangeRef.current = false;
          return;
        }

        // CRITICAL: Check for pending AI edit tags FIRST before applying time-based heuristic
        // We need to process AI edits even if they happen shortly after a save
        let pendingTags: any[] = [];
        try {
          if (window.electronAPI?.history) {
            pendingTags = await window.electronAPI.history.getPendingTags(data.path);
          }
        } catch (error) {
          logger.ui.error(`[TabEditor] Failed to check for pending tags:`, error);
        }

        // If there are pending AI edit tags, apply diff mode (skip conflict dialog)
        if (pendingTags && pendingTags.length > 0) {
          const oldContent = pendingTags[0].content;

          // Check if we're ALREADY in diff mode for this tag
          const alreadyInDiffMode = pendingAIEditTagRef.current?.tagId === pendingTags[0].id;
          console.log(`[TabEditor] Pending tag found. alreadyInDiffMode: ${alreadyInDiffMode}, current tagId: ${pendingAIEditTagRef.current?.tagId}, pending tagId: ${pendingTags[0].id}`);

          if (alreadyInDiffMode) {
            // Already showing diff - reset editor and update with new content
            console.log(`[TabEditor] Updating existing diff with new content - tagged: ${oldContent.length}, new: ${newContent.length}`);

            setContent(oldContent);
            contentRef.current = oldContent;

            // Schedule the diff update asynchronously to avoid holding the processing lock
            if (editorRef.current) {
              const editorToUpdate = editorRef.current;
              setTimeout(async () => {
                try {
                  // FIRST: Reset editor to old (tagged) content to clear existing diff nodes
                  const { $getRoot, SKIP_SCROLL_INTO_VIEW_TAG } = await import('lexical');
                  const { $convertFromEnhancedMarkdownString, getEditorTransformers } = await import('rexical');
                  const transformers = getEditorTransformers();

                  editorToUpdate.update(() => {
                    const root = $getRoot();
                    root.clear();
                    $convertFromEnhancedMarkdownString(oldContent, transformers);
                  }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });

                  // THEN: Apply the new diff replacement
                  const replacements: TextReplacement[] = [{
                    oldText: oldContent,
                    newText: newContent
                  }];

                  // Wait a tick for the editor to update
                  await new Promise(resolve => setTimeout(resolve, 100));

                  // Mark that we're applying a diff programmatically (not a user edit)
                  isApplyingDiffRef.current = true;
                  try {
                    const { APPLY_MARKDOWN_REPLACE_COMMAND } = await import('rexical');
                    editorToUpdate.dispatchCommand(APPLY_MARKDOWN_REPLACE_COMMAND, replacements);
                    console.log(`[TabEditor] Updated diff with new edits`);
                  } finally {
                    // Reset flag after a small delay to ensure content change handler has run
                    setTimeout(() => {
                      isApplyingDiffRef.current = false;
                    }, 100);
                  }
                } catch (error) {
                  logger.ui.error(`[TabEditor] Failed to update diff:`, error);
                }
              }, 0);
            }
          } else {
            // First time showing diff for this tag
            logger.ui.info(`[TabEditor] AI edit pending for ${fileName}, applying diff mode (skipping conflict dialog)`);
            console.log(`[TabEditor] AI edit pending - tagged content length: ${oldContent.length}, new content length: ${newContent.length}`);

            setContent(oldContent);
            contentRef.current = oldContent;

            // Update editor with old content
            if (editorRef.current) {
              try {
                const { $getRoot, SKIP_SCROLL_INTO_VIEW_TAG } = await import('lexical');
                const { $convertFromEnhancedMarkdownString, getEditorTransformers } = await import('rexical');
                const transformers = getEditorTransformers();

                editorRef.current.update(() => {
                  const root = $getRoot();
                  root.clear();
                  $convertFromEnhancedMarkdownString(oldContent, transformers);
                }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });

                // THEN: Apply the diff replacement
                const replacements: TextReplacement[] = [{
                  oldText: oldContent,
                  newText: newContent
                }];

                // Wait a tick for the editor to update
                await new Promise(resolve => setTimeout(resolve, 100));

                // Mark that we're applying a diff programmatically (not a user edit)
                isApplyingDiffRef.current = true;
                try {
                  const { APPLY_MARKDOWN_REPLACE_COMMAND } = await import('rexical');
                  editorRef.current.dispatchCommand(APPLY_MARKDOWN_REPLACE_COMMAND, replacements);
                  console.log(`[TabEditor] Dispatched APPLY_MARKDOWN_REPLACE_COMMAND`);
                } finally {
                  // Reset flag after a small delay to ensure content change handler has run
                  setTimeout(() => {
                    isApplyingDiffRef.current = false;
                  }, 100);
                }

                // Store tag info so we can mark it as reviewed when user approves
                pendingAIEditTagRef.current = {
                  tagId: pendingTags[0].id,
                  filePath: data.path
                };
              } catch (error) {
                logger.ui.error(`[TabEditor] Failed to apply AI diff:`, error);
              }
            }
          }

          // AI edit applied successfully - don't show any dialog, just return
          return;
        }

        // No pending AI edit tags - apply time-based heuristic to avoid reloading after own save
        const timeSinceLastSave = lastSaveTimeRef.current ? Date.now() - lastSaveTimeRef.current : Infinity;
        if (timeSinceLastSave < 2000) {
          console.log(`[TabEditor] Skipping - recent save (${timeSinceLastSave}ms ago) and no pending AI edits`);
          processingFileChangeRef.current = false;
          return;
        }

        const applyReload = async () => {
          // No pending tags - handle as normal file change
          if (false) {  // This block is now dead code - will be cleaned up
            // Dead code placeholder - can be removed in cleanup
            return;
          }

          // No pending tags - normal file change (user edit or external change)
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
              const { $getRoot, SKIP_SCROLL_INTO_VIEW_TAG } = await import('lexical');
              const { $convertFromEnhancedMarkdownString, getEditorTransformers } = await import('rexical');
              const transformers = getEditorTransformers();

              editorRef.current.update(() => {
                const root = $getRoot();
                root.clear();
                $convertFromEnhancedMarkdownString(newContent, transformers);
              }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });
            } catch (error) {
              logger.ui.error(`[TabEditor] Failed to update editor content:`, error);
            }
          }
        };

        // Protect dirty files from being overwritten
        // BUT: Skip this check if there's a pending AI edit tag - the diff mode handles it
        if (isDirtyRef.current && (!pendingTags || pendingTags.length === 0)) {
          // Store the new content and show dialog
          console.log(`[TabEditor] FILE WATCHER: Showing conflict dialog (isDirty=${isDirtyRef.current}, pendingTags=${pendingTags.length})`);
          setConflictDialogContent(newContent);
          setShowConflictDialog(true);
          // Don't reset flag yet - let finally block handle it
          return;
        }

        await applyReload();
      } finally {
        // Release the lock after processing is complete
        processingFileChangeRef.current = false;
        console.log('[TabEditor] Finished processing file-changed event - processing flag set to false');
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
        const { $getRoot, SKIP_SCROLL_INTO_VIEW_TAG } = await import('lexical');
        const { $convertFromEnhancedMarkdownString, getEditorTransformers } = await import('rexical');
        const transformers = getEditorTransformers();

        editorRef.current.update(() => {
          const root = $getRoot();
          root.clear();
          $convertFromEnhancedMarkdownString(newContent, transformers);
        }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });
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
        const { $getRoot, SKIP_SCROLL_INTO_VIEW_TAG } = await import('lexical');
        const { $convertFromEnhancedMarkdownString, getEditorTransformers } = await import('rexical');
        const transformers = getEditorTransformers();

        editorRef.current.update(() => {
          const root = $getRoot();
          root.clear();
          $convertFromEnhancedMarkdownString(diskContent, transformers);
        }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });
      } catch (error) {
        logger.ui.error(`[TabEditor] Failed to update editor content:`, error);
      }
    }
  }, [backgroundChangeContent, fileName, onDirtyChange]);

  const handleKeepEditorContent = useCallback(() => {
    setShowBackgroundChangeDialog(false);
    setBackgroundChangeContent('');
  }, []);

  // Handle content change from document header
  const handleDocumentHeaderContentChange = useCallback((newContent: string) => {
    // Update editor content programmatically
    if (editorRef.current) {
      (async () => {
        try {
          const { $getRoot, SKIP_SCROLL_INTO_VIEW_TAG } = await import('lexical');
          const { $convertFromEnhancedMarkdownString, getEditorTransformers } = await import('rexical');
          const transformers = getEditorTransformers();

          editorRef.current.update(() => {
            const root = $getRoot();
            root.clear();
            $convertFromEnhancedMarkdownString(newContent, transformers);
          }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });

          // Update React state and mark as dirty so autosave will persist
          setContent(newContent);
          contentRef.current = newContent;
          setIsDirty(true);
          isDirtyRef.current = true;

          // Notify parent that content changed and is dirty
          onDirtyChange?.(true);
          onContentChange?.();
        } catch (error) {
          logger.ui.error(`[TabEditor] Failed to update content from document header:`, error);
        }
      })();
    }
  }, [onDirtyChange, onContentChange]);

  // PHASE 5: Listen for diff approve/reject commands to update tag status
  useEffect(() => {
    if (!editorRef.current) return;

    const editor = editorRef.current;

    const handleApprove = async () => {
      if (pendingAIEditTagRef.current) {
        const { tagId, filePath } = pendingAIEditTagRef.current;
        try {
          // Mark tag as reviewed
          await window.electronAPI.history.updateTagStatus(filePath, tagId, 'reviewed');
          logger.ui.info(`[TabEditor] Marked AI edit tag as reviewed: ${tagId}`);

          // Clear the pending tag reference
          pendingAIEditTagRef.current = null;

          // Exit diff mode - reload the editor with current disk content
          const result = await window.electronAPI.readFileContent(filePath);
          if (result && result.content) {
            const currentContent = result.content;
            setContent(currentContent);
            contentRef.current = currentContent;
            initialContentRef.current = currentContent;
            setLastSavedContent(currentContent);
            lastSavedContentRef.current = currentContent;

            // Update editor to show final content (no diff)
            if (editorRef.current) {
              const { $getRoot, SKIP_SCROLL_INTO_VIEW_TAG } = await import('lexical');
              const { $convertFromEnhancedMarkdownString, getEditorTransformers } = await import('rexical');
              const transformers = getEditorTransformers();

              editorRef.current.update(() => {
                const root = $getRoot();
                root.clear();
                $convertFromEnhancedMarkdownString(currentContent, transformers);
              }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });
            }
          }
        } catch (error) {
          logger.ui.error(`[TabEditor] Failed to update tag status:`, error);
        }
      }
    };

    const handleReject = async () => {
      if (pendingAIEditTagRef.current) {
        const { tagId, filePath } = pendingAIEditTagRef.current;
        try {
          // Get the tagged (original) content
          const tag = await window.electronAPI.history.getTag(filePath, tagId);
          if (!tag) {
            logger.ui.warn(`[TabEditor] Tag not found for rejection: ${tagId}`);
            return;
          }

          // Mark tag as reviewed (user rejected, so we're done with it)
          await window.electronAPI.history.updateTagStatus(filePath, tagId, 'reviewed');
          logger.ui.info(`[TabEditor] Marked rejected AI edit tag as reviewed: ${tagId}`);

          // Clear the pending tag reference
          pendingAIEditTagRef.current = null;

          // Restore the original (tagged) content - reject the AI edits
          const originalContent = tag.content;
          setContent(originalContent);
          contentRef.current = originalContent;
          initialContentRef.current = originalContent;
          setLastSavedContent(originalContent);
          lastSavedContentRef.current = originalContent;

          // Write original content back to disk
          await window.electronAPI.saveFile(originalContent, filePath);

          // Update editor to show original content (no diff)
          if (editorRef.current) {
            const { $getRoot, SKIP_SCROLL_INTO_VIEW_TAG } = await import('lexical');
            const { $convertFromEnhancedMarkdownString, getEditorTransformers } = await import('rexical');
            const transformers = getEditorTransformers();

            editorRef.current.update(() => {
              const root = $getRoot();
              root.clear();
              $convertFromEnhancedMarkdownString(originalContent, transformers);
            }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });
          }
        } catch (error) {
          logger.ui.error(`[TabEditor] Failed to reject edits:`, error);
        }
      }
    };

    // Handle clearing diff tag without accept/reject (for incremental operations)
    const handleClearDiffTag = async () => {
      if (pendingAIEditTagRef.current) {
        const { tagId, filePath } = pendingAIEditTagRef.current;
        try {
          // CRITICAL: Save current editor state to disk FIRST
          // This preserves all the incremental accept/reject decisions the user made
          if (editorRef.current) {
            const { $convertToEnhancedMarkdownString, getEditorTransformers } = await import('rexical');
            const transformers = getEditorTransformers();

            const currentContent = editorRef.current.getEditorState().read(() => {
              return $convertToEnhancedMarkdownString(transformers);
            });

            // Save to disk
            await window.electronAPI.saveFile(currentContent, filePath);

            // Create history snapshot for this incremental save
            // This ensures history accurately reflects what's on disk after user's decisions
            if (window.electronAPI.history) {
              await window.electronAPI.history.addSnapshot(
                filePath,
                currentContent,
                'manual',
                'Incremental diff acceptance'
              );
            }

            // Update our state
            setContent(currentContent);
            contentRef.current = currentContent;
            initialContentRef.current = currentContent;
            setLastSavedContent(currentContent);
            lastSavedContentRef.current = currentContent;
          }

          // Mark tag as reviewed (all diffs processed incrementally)
          await window.electronAPI.history.updateTagStatus(filePath, tagId, 'reviewed');
          logger.ui.info(`[TabEditor] Marked AI edit tag as reviewed after incremental operations: ${tagId}`);

          // Clear the pending tag reference
          pendingAIEditTagRef.current = null;

          // Reload editor to exit diff mode and show clean final state
          const result = await window.electronAPI.readFileContent(filePath);
          if (result && result.content) {
            const finalContent = result.content;

            // Update editor to show final content (no diff)
            if (editorRef.current) {
              const { $getRoot, SKIP_SCROLL_INTO_VIEW_TAG } = await import('lexical');
              const { $convertFromEnhancedMarkdownString, getEditorTransformers } = await import('rexical');
              const transformers = getEditorTransformers();

              editorRef.current.update(() => {
                const root = $getRoot();
                root.clear();
                $convertFromEnhancedMarkdownString(finalContent, transformers);
              }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });
            }
          }
        } catch (error) {
          logger.ui.error(`[TabEditor] Failed to clear diff tag:`, error);
        }
      }
    };

    // Register command listeners
    const importCommands = async () => {
      const { APPROVE_DIFF_COMMAND, REJECT_DIFF_COMMAND } = await import('rexical');
      const { COMMAND_PRIORITY_LOW } = await import('lexical');
      const { CLEAR_DIFF_TAG_COMMAND } = await import('../../commands/diffCommands');

      const unregisterApprove = editor.registerCommand(
        APPROVE_DIFF_COMMAND,
        () => {
          handleApprove();
          return false; // Let other handlers run
        },
        COMMAND_PRIORITY_LOW
      );

      const unregisterReject = editor.registerCommand(
        REJECT_DIFF_COMMAND,
        () => {
          handleReject();
          return false; // Let other handlers run
        },
        COMMAND_PRIORITY_LOW
      );

      const unregisterClear = editor.registerCommand(
        CLEAR_DIFF_TAG_COMMAND,
        () => {
          handleClearDiffTag();
          return false; // Let other handlers run
        },
        COMMAND_PRIORITY_LOW
      );

      return () => {
        unregisterApprove();
        unregisterReject();
        unregisterClear();
      };
    };

    let cleanup: (() => void) | undefined;
    importCommands().then(fn => { cleanup = fn; });

    return () => {
      if (cleanup) cleanup();
    };
  }, [filePath]);

  // Image interaction callbacks
  const handleImageDoubleClick = useCallback(async (src: string, nodeKey: string) => {
    try {
      const result = await window.electronAPI.openImageInDefaultApp(src);
      if (!result.success) {
        logger.ui.error(`[TabEditor] Failed to open image:`, result.error);
      }
    } catch (error) {
      logger.ui.error(`[TabEditor] Error opening image:`, error);
    }
  }, []);

  const handleImageDragStart = useCallback(async (src: string, event: DragEvent) => {
    try {
      // The main process will handle the native drag operation
      await window.electronAPI.startImageDrag(src);
    } catch (error) {
      logger.ui.error(`[TabEditor] Error starting image drag:`, error);
    }
  }, []);

  return (
      <div
          className={`tab-editor multi-editor-instance ${isActive ? 'active' : 'hidden'}`}
          data-active={isActive ? 'true' : 'false'}
          data-file-path={filePath}
          style={{
            display: isActive ? 'flex' : 'none',
            flexDirection: 'column',
            height: '100%',
            overflow: 'hidden',
            position: 'relative'
          }}
      >
        <FixedTabHeaderContainer
          filePath={filePath}
          fileName={fileName}
          editor={editorRef.current}
        />
        <div className="tab-editor-scrollable" style={{ flex: 1, overflow: 'auto' }}>
          <StravuEditor
            key={filePath}
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
                // Sync content once when editor is ready to ensure DocumentHeaderContainer
                // detects frontmatter on initial load
                if (!hasInitialContentSyncRef.current) {
                  hasInitialContentSyncRef.current = true;
                  const currentContent = getContentFn();
                  setContent(currentContent);
                }
              },
              onEditorReady: (editor) => {
                editorRef.current = editor;
              },
              onSaveRequest: handleManualSave,
              onViewHistory,
              onRenameDocument,
              onImageDoubleClick: handleImageDoubleClick,
              onImageDragStart: handleImageDragStart,
              textReplacements: isActive ? textReplacements : undefined,
              documentHeader: (
                <DocumentHeaderContainer
                  filePath={filePath}
                  fileName={fileName}
                  content={content}
                  onContentChange={handleDocumentHeaderContentChange}
                  editor={editorRef.current}
                />
              ),
            }}
        />
        </div>

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
