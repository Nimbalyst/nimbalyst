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
  onSwitchToAgentMode?: (planDocumentPath?: string, sessionId?: string) => void;

  // Document metadata
  workspaceId?: string;
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
                                                      onSwitchToAgentMode,
                                                      workspaceId,
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
  const pendingAIEditTagRef = useRef<{tagId: string, sessionId: string, filePath: string} | null>(null);
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

        // CRITICAL FIX RC7: Check for pending AI edit tags FIRST, even if disk content matches
        // This handles the case where we switch to a file that already has the old content loaded
        let pendingTags: any[] = [];
        try {
          if (window.electronAPI?.history) {
            const allTags = await window.electronAPI.history.getPendingTags(filePath);
            // Only consider tags that haven't been reviewed or rejected
            pendingTags = (allTags || []).filter((tag: any) => tag.status !== 'reviewed' && tag.status !== 'rejected');
          }
        } catch (error) {
          logger.ui.error(`[TabEditor] Failed to check for pending tags on tab activation:`, error);
        }

        // If there are unreviewed pending AI edits, apply diff mode
        if (pendingTags && pendingTags.length > 0) {
          // CRITICAL: Skip if the mount effect already handled pending diffs for this file
          // The mount effect runs synchronously first, so if it found diffs, it's already applying them
          if (mountEffectHandledPendingDiffRef.current) {
            console.log(`[TabEditor] Mount effect already handled pending diff on tab activation, skipping`);
            return;
          }

          // Get the baseline for diff comparison
          // This will be the latest incremental-approval tag if it exists, otherwise the pre-edit tag
          const baseline = await window.electronAPI.invoke('history:get-diff-baseline', filePath);
          const databaseOldContent = baseline ? baseline.content : pendingTags[0].content;

          // Check if this tag is already being shown
          const isAlreadyShowingThisTag = pendingAIEditTagRef.current?.tagId === pendingTags[0].id;

          // CRITICAL FIX: Skip if we're already showing this diff
          // The editor stays mounted during tab switches, so if we've already applied this diff,
          // we don't need to reload it (which causes flashing)
          if (isAlreadyShowingThisTag) {
            console.log(`[TabEditor] Diff already shown for tag ${pendingTags[0].id}, skipping reload`);
            return;
          }

          // LEXICAL-SOURCED APPROACH: Round-trip the database content through Lexical
          // to ensure exact matching. This eliminates normalization mismatches.
          // Uses a headless editor to avoid polluting the visible editor state.
          let oldContent: string = databaseOldContent;
          try {
            const { createHeadlessEditor, $getRoot } = await import('lexical');
            const { $convertFromEnhancedMarkdownString, $convertToEnhancedMarkdownString, getEditorTransformers, PlaygroundNodes } = await import('rexical');
            const transformers = getEditorTransformers();

            // Create a headless editor for normalization (no DOM, no side effects)
            const headlessEditor = createHeadlessEditor({
              nodes: PlaygroundNodes,
              onError: (error: Error) => {
                logger.ui.error('[TabEditor] Headless editor error:', error);
              }
            });

            // Parse database content in headless editor
            headlessEditor.update(() => {
              const root = $getRoot();
              root.clear();
              $convertFromEnhancedMarkdownString(databaseOldContent, transformers);
            });

            // Extract normalized content
            oldContent = headlessEditor.getEditorState().read(() => {
              return $convertToEnhancedMarkdownString(transformers);
            });

            console.log(`[TabEditor] Tab activation: Normalized old content via headless Lexical: database=${databaseOldContent.length}, normalized=${oldContent.length}`);
          } catch (error) {
            logger.ui.warn(`[TabEditor] Failed to normalize old content via Lexical, using database content directly:`, error);
            oldContent = databaseOldContent;
          }

          // If disk content differs from old content, we need to update the diff
          if (diskContent !== oldContent) {
            console.log(`[TabEditor] Applying pending AI edit diff on tab activation - tagged: ${oldContent.length}, new: ${diskContent.length}`);

            // Make sure we're in the right state
            setContent(oldContent);
            contentRef.current = oldContent;

            if (editorRef.current) {
              const editorToUpdate = editorRef.current;
              (async () => {
                // Skip if already applying a diff (prevents infinite recursion from editor updates)
                if (isApplyingDiffRef.current) return;
                isApplyingDiffRef.current = true;
                try {
                  const { $getRoot, SKIP_SCROLL_INTO_VIEW_TAG } = await import('lexical');
                  const { $convertFromEnhancedMarkdownString, getEditorTransformers } = await import('rexical');
                  const transformers = getEditorTransformers();

                  // Load oldContent into the visible editor
                  editorToUpdate.update(() => {
                    const root = $getRoot();
                    root.clear();
                    $convertFromEnhancedMarkdownString(oldContent, transformers);
                  }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });

                  // Wait for editor to finish loading
                  await new Promise(resolve => setTimeout(resolve, 100));

                  // CRITICAL: Verify the editor's serialized content matches our normalized oldContent
                  const { $convertToEnhancedMarkdownString } = await import('rexical');
                  const editorContent = await new Promise<string>((resolve) => {
                    editorToUpdate.getEditorState().read(() => {
                      const markdown = $convertToEnhancedMarkdownString(transformers);
                      resolve(markdown);
                    });
                  });

                  console.log(`[TabEditor] Tab activation: Verifying editor content matches normalized oldContent: editor=${editorContent.length}, oldContent=${oldContent.length}, match=${editorContent === oldContent}`);

                  // Apply the diff replacement using the editor's actual serialized content
                  const { APPLY_MARKDOWN_REPLACE_COMMAND } = await import('rexical');
                  const replacements: TextReplacement[] = [{
                    oldText: editorContent,  // Use editor's serialized content, not our normalized version
                    newText: diskContent
                  }];

                  isApplyingDiffRef.current = true;
                  try {
                    editorToUpdate.dispatchCommand(APPLY_MARKDOWN_REPLACE_COMMAND, replacements);
                    console.log(`[TabEditor] Applied pending AI edit diff on tab activation, waiting for DOM update`);
                  } finally {
                    // Wait significantly longer for DOM to fully render with CSS classes
                    // Lexical's async updates can take time, and we need the final render to include our CSS
                    await new Promise(resolve => setTimeout(resolve, 500));
                    isApplyingDiffRef.current = false;
                  }

                  // Restore the pending tag ref if needed
                  if (!isAlreadyShowingThisTag) {
                    pendingAIEditTagRef.current = {
                      tagId: pendingTags[0].id,
                      sessionId: pendingTags[0].sessionId,
                      filePath: filePath
                    };
                  }
                } catch (error) {
                  logger.ui.error(`[TabEditor] Failed to apply pending AI diff on tab activation:`, error);
                } finally {
                  isApplyingDiffRef.current = false;
                }
              })();
            }
          }
          return;
        }

        // No pending AI edits - proceed with normal disk content checking
        if (diskContent !== currentContent && diskContent !== lastSavedContentRef.current) {
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
  }, [isActive, filePath, fileName, showConflictDialog, showBackgroundChangeDialog]);
  // NOTE: Removed onDirtyChange from dependencies - it's not used in the effect and was causing
  // unnecessary re-runs when parent passed new callback, which would clear and reschedule the setTimeout

  useEffect(() => {
    lastSaveTimeRef.current = lastSaveTime;
  }, [lastSaveTime]);

  useEffect(() => {
    lastSavedContentRef.current = lastSavedContent;
  }, [lastSavedContent]);

  // CRITICAL FIX RC7: On component mount or file path change, check if there are pending AI edits
  // that should show diffs. This handles the case where a tab is closed and reopened.
  // Only restore diffs for tags that haven't been reviewed/approved yet.
  // MERGED WITH MOUNT DIFF APPLICATION: Consolidated into a single effect that both
  // restores the tag ref AND applies the diff in one operation to prevent flashing.
  const hasCheckedForPendingTagsRef = useRef(false);
  const mountEffectHandledPendingDiffRef = useRef(false); // Track if mount effect found pending diffs

  useEffect(() => {
    // Guard against re-running this effect - only run once per filePath change
    if (hasCheckedForPendingTagsRef.current) return;
    if (!window.electronAPI?.history) return;
    if (!editorRef.current) return;

    hasCheckedForPendingTagsRef.current = true;
    // Reset the flag for this file
    mountEffectHandledPendingDiffRef.current = false;

    const checkAndApplyPendingDiffs = async () => {
      try {
        const pendingTags = await window.electronAPI.history.getPendingTags(filePath);
        if (!pendingTags || pendingTags.length === 0) {
          return;
        }

        // Filter out tags that have been reviewed - only show diffs for pending/unreviewed tags
        const unreviewedTags = pendingTags.filter((tag: any) => tag.status !== 'reviewed' && tag.status !== 'rejected');

        if (unreviewedTags.length === 0) {
          return;
        }

        // CRITICAL: Mark that mount effect found pending diffs IMMEDIATELY after we know they exist
        // This flag prevents the tab activation effect (300ms delay) from also applying the same diff
        // Must be set before any await statements that could delay it
        mountEffectHandledPendingDiffRef.current = true;

        const pendingTag = unreviewedTags[0];

        // Get the baseline for diff comparison
        // This will be the latest incremental-approval tag if it exists, otherwise the pre-edit tag
        const baseline = await window.electronAPI.invoke('history:get-diff-baseline', filePath);
        const databaseOldContent = baseline ? baseline.content : pendingTag.content;
        const newContent = contentRef.current; // Use current content ref to get actual disk content

        logger.ui.info(`[TabEditor] Restoring pending AI edit on mount: tagId=${pendingTag.id}, status=${pendingTag.status}`);

        // LEXICAL-SOURCED APPROACH: Round-trip the database content through Lexical
        // to ensure exact matching. This eliminates normalization mismatches.
        // Uses a headless editor to avoid polluting the visible editor state.
        let oldContent: string = databaseOldContent;
        try {
          const { createHeadlessEditor, $getRoot } = await import('lexical');
          const { $convertFromEnhancedMarkdownString, $convertToEnhancedMarkdownString, getEditorTransformers, PlaygroundNodes } = await import('rexical');
          const transformers = getEditorTransformers();

          // Create a headless editor for normalization (no DOM, no side effects)
          const headlessEditor = createHeadlessEditor({
            nodes: PlaygroundNodes,
            onError: (error: Error) => {
              logger.ui.error('[TabEditor] Headless editor error:', error);
            }
          });

          // Parse database content in headless editor
          headlessEditor.update(() => {
            const root = $getRoot();
            root.clear();
            $convertFromEnhancedMarkdownString(databaseOldContent, transformers);
          });

          // Extract normalized content
          oldContent = headlessEditor.getEditorState().read(() => {
            return $convertToEnhancedMarkdownString(transformers);
          });

          console.log(`[TabEditor] Mount effect: Normalized old content via headless Lexical: database=${databaseOldContent.length}, normalized=${oldContent.length}`);
        } catch (error) {
          logger.ui.warn(`[TabEditor] Failed to normalize old content via Lexical, using database content directly:`, error);
          oldContent = databaseOldContent;
        }

        // Set the ref so other parts of the component know we're in diff mode
        pendingAIEditTagRef.current = {
          tagId: pendingTag.id,
          sessionId: pendingTag.sessionId,
          filePath: filePath
        };

        setContent(oldContent);
        contentRef.current = oldContent;

        // If content differs, apply the diff
        if (oldContent !== newContent) {
          // Load oldContent into the visible editor first
          const { $getRoot, SKIP_SCROLL_INTO_VIEW_TAG } = await import('lexical');
          const { $convertFromEnhancedMarkdownString, getEditorTransformers } = await import('rexical');
          const transformers = getEditorTransformers();

          editorRef.current.update(() => {
            const root = $getRoot();
            root.clear();
            $convertFromEnhancedMarkdownString(oldContent, transformers);
          }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });

          // Wait a tick before applying diff
          await new Promise(resolve => setTimeout(resolve, 100));

          // CRITICAL: Verify the editor's serialized content matches our normalized oldContent
          const { $convertToEnhancedMarkdownString } = await import('rexical');
          const editorContent = await new Promise<string>((resolve) => {
            editorRef.current!.getEditorState().read(() => {
              const markdown = $convertToEnhancedMarkdownString(transformers);
              resolve(markdown);
            });
          });

          console.log(`[TabEditor] Mount effect: Verifying editor content matches normalized oldContent: editor=${editorContent.length}, oldContent=${oldContent.length}, match=${editorContent === oldContent}`);

          // Apply the diff
          isApplyingDiffRef.current = true;
          try {
            const replacements: TextReplacement[] = [{
              oldText: editorContent,  // Use editor's serialized content, not our normalized version
              newText: newContent
            }];
            const { APPLY_MARKDOWN_REPLACE_COMMAND } = await import('rexical');
            editorRef.current.dispatchCommand(APPLY_MARKDOWN_REPLACE_COMMAND, replacements);
            console.log(`[TabEditor] Applied pending AI edit diff on mount`);
          } finally {
            setTimeout(() => {
              isApplyingDiffRef.current = false;
            }, 100);
          }
        }
      } catch (error) {
        logger.ui.error(`[TabEditor] Failed to check and apply pending diffs on mount:`, error);
      }
    };

    checkAndApplyPendingDiffs();
  }, [filePath]); // Only depend on filePath, NOT initialContent


  // Helper: Save file with history snapshot
  // skipDiffCheck: Set to true when saving during AI operations (accept/reject/streaming)
  const saveWithHistory = useCallback(async (
      contentToSave: string,
      snapshotType: 'auto' | 'manual' = 'auto',
      skipDiffCheck: boolean = false
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

      logger.ui.info(`[TabEditor] Saving ${fileName}, saveId=${thisSaveId}, skipDiffCheck=${skipDiffCheck}`);
      // console.trace('[TabEditor] saveWithHistory called, stack trace:');

      // Save to disk with conflict detection
      const result = await window.electronAPI.saveFile(
          contentToSave,
          filePath,
          initialContentRef.current
      );

      // console.log(`[TabEditor] saveFile returned for ${fileName}, success=${result?.success}, conflict=${result?.conflict}`);

      // IMMEDIATE: Clear dirty flag as soon as save succeeds
      if (result && result.success) {
        setIsDirty(false);
        isDirtyRef.current = false;
        // Update initialContentRef with current editor content to prevent false dirty flags
        if (getContentFnRef.current) {
          initialContentRef.current = getContentFnRef.current();
        }
        // Notify parent immediately
        onDirtyChange?.(false);
        // console.log(`[TabEditor] Cleared dirty flag immediately after successful save for ${fileName}`);
      }

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

        // Check if we should clear the pending-review tag after save
        // ONLY check for user-initiated saves (manual/autosave), NOT AI operations
        // During AI operations (apply/accept/reject), skipDiffCheck will be true
        if (!skipDiffCheck && editorRef.current && pendingAIEditTagRef.current?.tagId) {
          const { $hasDiffNodes } = await import('rexical');
          const hasDiffs = editorRef.current.getEditorState().read(() => {
            return $hasDiffNodes(editorRef.current!);
          });

          if (!hasDiffs) {
            logger.ui.info('[TabEditor] No diffs remaining after user save, clearing pending tag');
            const { tagId, filePath: tagFilePath } = pendingAIEditTagRef.current!;
            await window.electronAPI.invoke('history:update-tag-status', tagFilePath, tagId, 'reviewed');
            pendingAIEditTagRef.current = null;
          } else {
            logger.ui.info('[TabEditor] Diffs still present after save, keeping pending tag');
          }
        }

        // Notify parent
        onSaveComplete?.(result.filePath);

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

    // Log stack trace to see what's calling this
    // console.trace('[TabEditor] handleManualSave called for:', fileName);

    const currentContent = getContentFnRef.current();
    await saveWithHistory(currentContent, 'manual');
  }, [saveWithHistory, fileName]);

  // Content change handler from editor
  const handleContentChange = useCallback(() => {
    if (!getContentFnRef.current) return;

    const currentContent = getContentFnRef.current();

    // CRITICAL: In diff mode, the editor content includes diff nodes which export
    // to markdown differently than the baseline. This causes false dirty flags.
    // Don't mark as dirty when in diff mode - user must explicitly approve/reject.
    const isContentDirty = pendingAIEditTagRef.current
      ? false
      : currentContent !== initialContentRef.current;

    // const timeNow = Date.now();
    // const timeSinceLastSave = lastSaveTimeRef.current ? timeNow - lastSaveTimeRef.current : Infinity;
    // console.log(`[TabEditor] handleContentChange for ${fileName}, dirty=${isContentDirty}, inDiffMode=${!!pendingAIEditTagRef.current}, currentLength=${currentContent.length}, initialLength=${initialContentRef.current.length}, timeSinceLastSave=${timeSinceLastSave}ms`);
    // if (isContentDirty && currentContent !== initialContentRef.current) {
    //   // Log the actual difference
    //   const diffChars = Math.abs(currentContent.length - initialContentRef.current.length);
    //   console.log(`[TabEditor] Content differs by ${diffChars} characters`);
    //
    //   // Log first 50 chars of each to see the difference
    //   console.log(`[TabEditor] Current: "${currentContent.substring(0, 50)}..."`);
    //   console.log(`[TabEditor] Initial: "${initialContentRef.current.substring(0, 50)}..."`);
    // }

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
      // Log autosave check
      // console.log(`[TabEditor] Autosave timer fired for ${fileName}, isDirty=${isDirtyRef.current}, inDiffMode=${!!pendingAIEditTagRef.current}`);

      // Skip if not dirty
      if (!isDirtyRef.current) {
        // console.log(`[TabEditor] Skipping autosave - not dirty`);
        return;
      }

      // CRITICAL: Skip autosave if we're in diff mode showing AI edits
      // The content is already on disk - autosaving the diff view would cause mismatches
      if (pendingAIEditTagRef.current) {
        logger.ui.info(`[TabEditor] Skipping autosave - diff mode active for ${fileName}`);
        return;
      }

      // Skip if not enough time has passed since last change (debounce)
      if (Date.now() - lastChangeTimeRef.current < autosaveDebounce) {
        // console.log(`[TabEditor] Skipping autosave - debounce not elapsed`);
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

      // Skip if already processing a change or applying a diff
      if (processingFileChangeRef.current || isApplyingDiffRef.current) {
        console.log('[TabEditor] Skipping file-changed event - processing or applying diff');
        return;
      }
      processingFileChangeRef.current = true;
      console.log('[TabEditor] Processing file-changed event for:', data.path);
      console.log('[TabEditor] Processing flag set to true');

      let diffUpdatePromise: Promise<void> | null = null;
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
            const allTags = await window.electronAPI.history.getPendingTags(data.path);
            // Only consider tags that haven't been reviewed or rejected
            pendingTags = (allTags || []).filter((tag: any) => tag.status !== 'reviewed' && tag.status !== 'rejected');
          }
        } catch (error) {
          logger.ui.error(`[TabEditor] Failed to check for pending tags:`, error);
        }

        // If there are unreviewed pending AI edit tags, apply diff mode (skip conflict dialog)
        if (pendingTags && pendingTags.length > 0) {
          // Get the baseline for diff comparison
          // This will be the latest incremental-approval tag if it exists, otherwise the pre-edit tag
          const baseline = await window.electronAPI.invoke('history:get-diff-baseline', data.path);
          const databaseOldContent = baseline ? baseline.content : pendingTags[0].content;

          // LEXICAL-SOURCED APPROACH: Round-trip the database content through Lexical
          // to ensure exact matching. This eliminates normalization mismatches.
          // Uses a headless editor to avoid polluting the visible editor state.
          let oldContent: string = databaseOldContent;
          try {
            const { createHeadlessEditor, $getRoot } = await import('lexical');
            const { $convertFromEnhancedMarkdownString, $convertToEnhancedMarkdownString, getEditorTransformers, PlaygroundNodes } = await import('rexical');
            const transformers = getEditorTransformers();

            // Create a headless editor for normalization (no DOM, no side effects)
            const headlessEditor = createHeadlessEditor({
              nodes: PlaygroundNodes,
              onError: (error: Error) => {
                logger.ui.error('[TabEditor] Headless editor error:', error);
              }
            });

            // Parse database content in headless editor
            headlessEditor.update(() => {
              const root = $getRoot();
              root.clear();
              $convertFromEnhancedMarkdownString(databaseOldContent, transformers);
            });

            // Extract normalized content
            oldContent = headlessEditor.getEditorState().read(() => {
              return $convertToEnhancedMarkdownString(transformers);
            });

            console.log(`[TabEditor] File watcher: Normalized old content via headless Lexical: database=${databaseOldContent.length}, normalized=${oldContent.length}`);
          } catch (error) {
            logger.ui.warn(`[TabEditor] Failed to normalize old content via Lexical, using database content directly:`, error);
            oldContent = databaseOldContent;
          }

          console.log('[TabEditor] FILE WATCHER - Applying diff mode:', {
            fileName,
            baselineType: baseline?.tagType,
            oldContentLength: oldContent.length,
            newContentLength: newContent.length,
            oldHasFirstAI: oldContent.includes('FIRST AI EDIT'),
            oldHasSecondOriginal: oldContent.includes('Second paragraph'),
            oldHasThirdOriginal: oldContent.includes('Third paragraph'),
            oldHasThirdAI: oldContent.includes('THIRD AI EDIT'),
            newHasFirstAI: newContent.includes('FIRST AI EDIT'),
            newHasThirdAI: newContent.includes('THIRD AI EDIT')
          });

          // Check if we're ALREADY in diff mode for this tag
          const alreadyInDiffMode = pendingAIEditTagRef.current?.tagId === pendingTags[0].id;
          console.log(`[TabEditor] Pending tag found. alreadyInDiffMode: ${alreadyInDiffMode}, current tagId: ${pendingAIEditTagRef.current?.tagId}, pending tagId: ${pendingTags[0].id}`);

          if (alreadyInDiffMode) {
            // CRITICAL: Check if the disk content actually changed
            // If the new content matches what we're already showing, skip the reload
            // This prevents flashing when switching tabs or during saves
            if (newContent === lastSavedContentRef.current) {
              console.log('[TabEditor] Diff already showing correct content, skipping reload');
              processingFileChangeRef.current = false;
              return;
            }

            // Already showing diff - reset editor and update with new content
            console.log(`[TabEditor] Updating existing diff with new content - tagged: ${oldContent.length}, new: ${newContent.length}`);

            setContent(oldContent);
            contentRef.current = oldContent;

            // CRITICAL FIX RC2: Create a promise for the diff update and don't release lock until it completes
            diffUpdatePromise = (async () => {
              try {
                // FIRST: Reset editor to old (tagged) content to clear existing diff nodes
                // This is NECESSARY - editor must have oldContent before applyMarkdownReplace can find it
                const { $getRoot, SKIP_SCROLL_INTO_VIEW_TAG } = await import('lexical');
                const { $convertFromEnhancedMarkdownString, getEditorTransformers } = await import('rexical');
                const transformers = getEditorTransformers();

                if (editorRef.current) {
                  editorRef.current.update(() => {
                    const root = $getRoot();
                    root.clear();
                    $convertFromEnhancedMarkdownString(oldContent, transformers);
                  }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });

                  // Wait a tick for the editor to update
                  await new Promise(resolve => setTimeout(resolve, 100));

                  // CRITICAL: Verify the editor's serialized content matches our normalized oldContent
                  const { $convertToEnhancedMarkdownString } = await import('rexical');
                  const editorContent = await new Promise<string>((resolve) => {
                    editorRef.current!.getEditorState().read(() => {
                      const markdown = $convertToEnhancedMarkdownString(transformers);
                      resolve(markdown);
                    });
                  });

                  console.log(`[TabEditor] File watcher (updating): Verifying editor content: editor=${editorContent.length}, oldContent=${oldContent.length}, match=${editorContent === oldContent}`);

                  // Apply the new diff replacement using editor's actual serialized content
                  const replacements: TextReplacement[] = [{
                    oldText: editorContent,  // Use editor's serialized content
                    newText: newContent
                  }];
                }

                // Mark that we're applying a diff programmatically (not a user edit)
                isApplyingDiffRef.current = true;
                try {
                  if (editorRef.current) {
                    const { APPLY_MARKDOWN_REPLACE_COMMAND } = await import('rexical');
                    editorRef.current.dispatchCommand(APPLY_MARKDOWN_REPLACE_COMMAND, replacements);
                    console.log(`[TabEditor] Updated diff with new edits`);
                  }
                } finally {
                  // Wait for DOM to fully render with CSS classes
                  await new Promise(resolve => setTimeout(resolve, 500));
                  isApplyingDiffRef.current = false;
                }
              } catch (error) {
                logger.ui.error(`[TabEditor] Failed to update diff:`, error);
              }
            })();
          } else {
            // First time showing diff for this tag
            logger.ui.info(`[TabEditor] AI edit pending for ${fileName}, applying diff mode (skipping conflict dialog)`);
            console.log(`[TabEditor] AI edit pending - tagged content length: ${oldContent.length}, new content length: ${newContent.length}`);

            setContent(oldContent);
            contentRef.current = oldContent;

            // CRITICAL FIX RC6/RC7: Create a promise for the diff application and ensure proper state sync
            // Load the old content first, then apply diff
            diffUpdatePromise = (async () => {
              try {
                if (editorRef.current) {
                  const { $getRoot, SKIP_SCROLL_INTO_VIEW_TAG } = await import('lexical');
                  const { $convertFromEnhancedMarkdownString, getEditorTransformers } = await import('rexical');
                  const transformers = getEditorTransformers();

                  console.log(`[TabEditor] Loading old content for first-time diff (length: ${oldContent.length})`);

                  // Load the old (tagged) content - this will be the baseline for diff
                  editorRef.current.update(() => {
                    const root = $getRoot();
                    root.clear();
                    $convertFromEnhancedMarkdownString(oldContent, transformers);
                  }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });

                  // Wait longer for the editor to fully process the content load
                  console.log(`[TabEditor] Waiting for content load to complete...`);
                  await new Promise(resolve => setTimeout(resolve, 250));

                  // CRITICAL: Verify the editor's serialized content matches our normalized oldContent
                  const { $convertToEnhancedMarkdownString } = await import('rexical');
                  const editorContent = await new Promise<string>((resolve) => {
                    editorRef.current!.getEditorState().read(() => {
                      const markdown = $convertToEnhancedMarkdownString(transformers);
                      resolve(markdown);
                    });
                  });

                  console.log(`[TabEditor] File watcher (first-time): Verifying editor content: editor=${editorContent.length}, oldContent=${oldContent.length}, match=${editorContent === oldContent}`);

                  // Apply the diff replacement using editor's actual serialized content
                  const replacements: TextReplacement[] = [{
                    oldText: editorContent,  // Use editor's serialized content
                    newText: newContent
                  }];

                  // Mark that we're applying a diff programmatically (not a user edit)
                  isApplyingDiffRef.current = true;
                  try {
                    const { APPLY_MARKDOWN_REPLACE_COMMAND } = await import('rexical');
                    editorRef.current.dispatchCommand(APPLY_MARKDOWN_REPLACE_COMMAND, replacements);
                    console.log(`[TabEditor] Dispatched APPLY_MARKDOWN_REPLACE_COMMAND`);
                  } finally {
                    // Reset flag after a small delay to ensure content change handler has run
                    await new Promise(resolve => setTimeout(resolve, 100));
                    isApplyingDiffRef.current = false;
                  }

                  // CRITICAL FIX RC7: Store tag info ONLY after successful diff application
                  // This ensures pendingAIEditTagRef is synchronized with actual editor state
                  pendingAIEditTagRef.current = {
                    tagId: pendingTags[0].id,
                    sessionId: pendingTags[0].sessionId,
                    filePath: data.path
                  };
                }
              } catch (error) {
                logger.ui.error(`[TabEditor] Failed to apply AI diff:`, error);
              }
            })();
          }

          // Wait for the diff update to complete before releasing the lock
          if (diffUpdatePromise) {
            await diffUpdatePromise;
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
        // CRITICAL FIX RC2: Only release the lock AFTER all async operations complete
        // This ensures that subsequent file change events don't start processing until we're done
        if (diffUpdatePromise) {
          await diffUpdatePromise.catch(err => {
            logger.ui.error('[TabEditor] Error waiting for diff update:', err);
          });
        }
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
    // console.log(`[TabEditor] handleDocumentHeaderContentChange called for ${fileName}, newContentLength=${newContent.length}`);
    // console.trace('[TabEditor] DocumentHeader content change stack trace:');

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
      logger.ui.info('[TabEditor] handleApprove called, pendingAIEditTagRef:', pendingAIEditTagRef.current);
      if (pendingAIEditTagRef.current) {
        const { tagId, filePath } = pendingAIEditTagRef.current;
        try {
          // Mark tag as reviewed
          logger.ui.info('[TabEditor] About to call updateTagStatus from handleApprove:', { tagId, filePath });
          await window.electronAPI.history.updateTagStatus(filePath, tagId, 'reviewed');
          logger.ui.info(`[TabEditor] Successfully marked AI edit tag as reviewed from handleApprove: ${tagId}`);

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

    // Handle incremental approval - create tag for partial accept/reject
    const handleIncrementalApproval = async () => {
      try {
        if (!pendingAIEditTagRef.current) {
          return;
        }

        const { tagId, sessionId, filePath } = pendingAIEditTagRef.current;

        // Get current editor content (includes the accepted/rejected changes)
        if (editorRef.current) {
          const { $convertToEnhancedMarkdownString, getEditorTransformers } = await import('rexical');
          const transformers = getEditorTransformers();

          // Get the APPROVED content (normal export - what's actually in the editor)
          const approvedContent = editorRef.current.getEditorState().read(() => {
            return $convertToEnhancedMarkdownString(transformers);
          });

          // Get the REJECTED content (what-if we rejected all remaining diffs)
          // This becomes the baseline for comparing remaining diffs
          const rejectedContent = editorRef.current.getEditorState().read(() => {
            return $convertToEnhancedMarkdownString(transformers, { rejectMode: true });
          });

          // Save the approved content to disk
          await window.electronAPI.saveFile(approvedContent, filePath);

          // Create incremental-approval tag with the REJECTED version
          // This is the baseline: it shows what we've decided so far (approved + rejected)
          const newTagId = await window.electronAPI.invoke('history:create-incremental-approval-tag',
            filePath,
            rejectedContent,
            sessionId,
            {}  // Can optionally track which groups were accepted/rejected
          );

          logger.ui.info(`[TabEditor] Created incremental-approval tag for session: ${sessionId}, tagId: ${newTagId}`);

          // CRITICAL: Update pendingAIEditTagRef to point to the NEW incremental-approval tag
          // This ensures that when CLEAR_DIFF_TAG_COMMAND is dispatched later, it marks the correct tag as reviewed
          pendingAIEditTagRef.current = {
            tagId: newTagId,
            sessionId,
            filePath
          };

          // Update our state
          setContent(approvedContent);
          contentRef.current = approvedContent;
          setLastSavedContent(approvedContent);
          lastSavedContentRef.current = approvedContent;
        }
      } catch (error) {
        logger.ui.error('[TabEditor] Failed to create incremental-approval tag:', error);
      }
    };

    // Handle clearing diff tag without accept/reject (for incremental operations)
    const handleClearDiffTag = async () => {
      try {
        if (!pendingAIEditTagRef.current) {
          logger.ui.warn('[TabEditor] handleClearDiffTag called but no pendingAIEditTagRef');
          return;
        }

        const { tagId, filePath } = pendingAIEditTagRef.current;
        logger.ui.info('[TabEditor] handleClearDiffTag START:', { tagId, filePath });

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
            await window.electronAPI.invoke('history:create-snapshot', filePath, currentContent, 'manual', 'Incremental diff acceptance');

            // Update our state
            setContent(currentContent);
            contentRef.current = currentContent;
            initialContentRef.current = currentContent;
            setLastSavedContent(currentContent);
            lastSavedContentRef.current = currentContent;
          }

          // Mark the pre-edit tag as reviewed (all diffs processed)
          // When handleClearDiffTag is called, ALL diffs have been cleared (session complete)
          // We do NOT create an incremental-approval tag here because there are no more diffs
          // Incremental-approval tags are only created during partial acceptance (via INCREMENTAL_APPROVAL_COMMAND)
          logger.ui.info('[TabEditor] About to call updateTagStatus:', { filePath, tagId, status: 'reviewed' });
          await window.electronAPI.history.updateTagStatus(filePath, tagId, 'reviewed');
          logger.ui.info(`[TabEditor] Successfully marked AI edit tag as reviewed: ${tagId}`);

          // Clear the pending tag reference (session is complete)
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
    };

    // Register command listeners
    const importCommands = async () => {
      const { APPROVE_DIFF_COMMAND, REJECT_DIFF_COMMAND, CLEAR_DIFF_TAG_COMMAND, INCREMENTAL_APPROVAL_COMMAND } = await import('rexical');
      const { COMMAND_PRIORITY_LOW } = await import('lexical');

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

      const unregisterIncremental = editor.registerCommand(
        INCREMENTAL_APPROVAL_COMMAND,
        () => {
          handleIncrementalApproval().catch(err => {
            logger.ui.error('[TabEditor] Error in handleIncrementalApproval:', err);
          });
          return false; // Let other handlers run
        },
        COMMAND_PRIORITY_LOW
      );

      const unregisterClear = editor.registerCommand(
        CLEAR_DIFF_TAG_COMMAND,
        () => {
          handleClearDiffTag().catch(err => {
            logger.ui.error('[TabEditor] Error in handleClearDiffTag:', err);
          });
          return false; // Let other handlers run
        },
        COMMAND_PRIORITY_LOW
      );

      return () => {
        unregisterApprove();
        unregisterReject();
        unregisterIncremental();
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
              onSwitchToAgentMode,
              filePath,
              workspaceId,
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
