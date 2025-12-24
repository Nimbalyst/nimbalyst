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

import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { usePostHog } from 'posthog-js/react';
import type { ConfigTheme, TextReplacement } from 'rexical';
import { DocumentPathProvider } from '@nimbalyst/runtime';
import {
  StravuEditor,
  $convertFromEnhancedMarkdownString,
  $convertToEnhancedMarkdownString,
  getEditorTransformers,
  APPLY_MARKDOWN_REPLACE_COMMAND,
  APPROVE_DIFF_COMMAND,
  REJECT_DIFF_COMMAND,
  CLEAR_DIFF_TAG_COMMAND,
  INCREMENTAL_APPROVAL_COMMAND,
  $hasDiffNodes
} from 'rexical';
import { $getRoot, $getSelection, $isRangeSelection, SKIP_SCROLL_INTO_VIEW_TAG, COMMAND_PRIORITY_LOW } from 'lexical';
import { DocumentHeaderContainer } from '@nimbalyst/runtime/plugins/TrackerPlugin/documentHeader';
import { setTextSelection, clearTextSelection } from '../UnifiedAI/TextSelectionIndicator';
import { FixedTabHeaderContainer, FixedTabHeaderRegistry } from '@nimbalyst/runtime/plugins/shared/fixedTabHeader';
import { MonacoCodeEditor } from '../MonacoCodeEditor';
import { MonacoDiffApprovalBar } from '../MonacoDiffApprovalBar';
import { ImageViewer } from '../ImageViewer';
import { MockupDiffViewer } from '../CustomEditors/MockupEditor/MockupDiffViewer';
import { getFileType } from '../../utils/fileTypeDetector';
import { customEditorRegistry } from '../CustomEditors';
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
  onOpenSessionInChat?: (sessionId: string) => void;

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
                                                      onOpenSessionInChat,
                                                      workspaceId,
                                                    }) => {
  const posthog = usePostHog();

  // Subscribe to custom editor registry changes to re-evaluate file type
  // when extensions finish loading (handles race condition on startup)
  const [registryVersion, setRegistryVersion] = useState(0);
  useEffect(() => {
    const unsubscribe = customEditorRegistry.onChange(() => {
      setRegistryVersion(v => v + 1);
    });
    return unsubscribe;
  }, []);

  // Detect file type (markdown vs code vs image vs custom)
  // Re-computed when registry changes (registryVersion dependency)
  const fileType = useMemo(() => {
    // Extract extension and check if custom editor is registered
    // Handle compound extensions like .mockup.html by checking multiple levels
    const checkCustomEditor = (ext: string): boolean => {
      const lastDot = filePath.lastIndexOf('.');
      if (lastDot <= 0) return false;

      const singleExt = filePath.substring(lastDot).toLowerCase();

      // Check single extension first (e.g., .html)
      if (customEditorRegistry.hasEditor(singleExt)) {
        return true;
      }

      // Check compound extension (e.g., .mockup.html)
      const secondLastDot = filePath.lastIndexOf('.', lastDot - 1);
      if (secondLastDot > 0) {
        const compoundExt = filePath.substring(secondLastDot).toLowerCase();
        if (customEditorRegistry.hasEditor(compoundExt)) {
          return true;
        }
      }

      return false;
    };

    return getFileType(filePath, checkCustomEditor);
  }, [filePath, registryVersion]);

  const isMarkdown = fileType === 'markdown';
  const isImage = fileType === 'image';
  const isCustom = fileType === 'custom';
  const isMockupFile = isCustom && filePath.toLowerCase().endsWith('.mockup.html');

  // View mode state for markdown files (lexical = rich text editor, monaco = raw markdown)
  const [markdownViewMode, setMarkdownViewMode] = useState<'lexical' | 'monaco'>('lexical');
  const [viewModeVersion, setViewModeVersion] = useState(0);

  // Internal state - fully owned by this component
  const [content, setContent] = useState(initialContent);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSaveTime, setLastSaveTime] = useState<number | null>(null);
  const [lastSavedContent, setLastSavedContent] = useState(initialContent);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [conflictDialogContent, setConflictDialogContent] = useState<string>('');
  const [showMonacoDiffBar, setShowMonacoDiffBar] = useState(false); // For Monaco diff approval bar
  const [isEditorReady, setIsEditorReady] = useState(false); // Track when editor is mounted and ready
  const [mockupDiffData, setMockupDiffData] = useState<{ oldContent: string; newContent: string } | null>(null);
  const [mockupDiffAction, setMockupDiffAction] = useState<'idle' | 'accept' | 'reject'>('idle');

  // Track editor type usage when file is opened
  const hasTrackedOpenRef = useRef<string | null>(null);
  useEffect(() => {
    // Only track once per file path when it becomes active
    if (isActive && isEditorReady && hasTrackedOpenRef.current !== filePath) {
      hasTrackedOpenRef.current = filePath;

      // Determine the editor type for tracking
      let editorType = 'monaco'; // default for code files
      let hasMermaid = false;
      let hasDataModel = false;

      if (isMarkdown) {
        editorType = 'markdown';
        // Check if markdown contains Mermaid diagrams
        if (initialContent.includes('```mermaid') || initialContent.includes('~~~mermaid')) {
          hasMermaid = true;
        }
        // Check if markdown contains DataModel references
        if (initialContent.includes('```datamodel') || initialContent.includes('datamodel:')) {
          hasDataModel = true;
        }
      } else if (isImage) {
        editorType = 'image';
      } else if (isCustom) {
        // Check for specific custom editor types
        const ext = filePath.toLowerCase();
        if (ext.endsWith('.mockup.html')) {
          editorType = 'mockup';
        } else if (ext.endsWith('.datamodel.json') || ext.endsWith('.datamodel')) {
          editorType = 'datamodel';
        } else {
          editorType = 'custom';
        }
      }

      posthog?.capture('editor_type_opened', {
        editorType,
        fileExtension: filePath.substring(filePath.lastIndexOf('.')).toLowerCase(),
        hasMermaid,
        hasDataModel,
      });
    }
  }, [isActive, isEditorReady, filePath, isMarkdown, isImage, isCustom, posthog, initialContent]);

  // Track current file path to abort operations when switching files
  const currentFilePathRef = useRef(filePath);

  useEffect(() => {
    currentFilePathRef.current = filePath;
    setMockupDiffData(null);
    setMockupDiffAction('idle');
  }, [filePath]);

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
  const customEditorReloadRef = useRef<((newContent: string) => void) | null>(null); // Callback to reload custom editor content

  // Keep refs in sync with state
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  // NOTE: The old "check disk content on tab activation" polling logic has been removed.
  // File watchers are now active for all open tabs, so changes are detected in real-time
  // via the 'file-changed-on-disk' event handler below. This eliminates the redundant
  // "File Changed While Inactive" dialog that would appear on tab switch.

  useEffect(() => {
    lastSaveTimeRef.current = lastSaveTime;
  }, [lastSaveTime]);

  useEffect(() => {
    lastSavedContentRef.current = lastSavedContent;
  }, [lastSavedContent]);

  // Clear Lexical editor selection when tab becomes inactive
  // This ensures no stale visual selection when switching back to the tab
  // Note: Monaco handles this internally via the isActive prop
  useEffect(() => {
    if (!isActive && isEditorReady && editorRef.current) {
      // Clear Lexical editor selection
      if (isMarkdown && markdownViewMode === 'lexical') {
        const editor = editorRef.current;
        if (editor?.update) {
          editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              // Collapse selection to start (removes visual selection)
              selection.anchor.set(selection.anchor.key, selection.anchor.offset, selection.anchor.type);
              selection.focus.set(selection.anchor.key, selection.anchor.offset, selection.anchor.type);
            }
          }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });
        }
      }
    }
  }, [isActive, isEditorReady, isMarkdown, markdownViewMode]);

  // Track text selection for AI context
  // This updates window globals when user selects text in the editor
  // Important: We only UPDATE selection when user selects text, but we DON'T clear it
  // when focus leaves the editor (so user can select text, then click into AI chat)
  useEffect(() => {
    // Clear selection when tab becomes inactive (switching to different file)
    if (!isActive) {
      clearTextSelection();
      return undefined;
    }

    // Wait for editor to be ready
    if (!isEditorReady || !editorRef.current) {
      return undefined;
    }

    // Debounce timer for selection updates
    let debounceTimer: NodeJS.Timeout | null = null;

    // For Lexical editor (markdown in lexical mode)
    if (isMarkdown && markdownViewMode === 'lexical') {
      const editor = editorRef.current;
      if (editor?.registerUpdateListener) {
        // When tab becomes active, clear any stale selection state
        // The Lexical SelectionAlwaysOnDisplay plugin may show a visual selection,
        // but we want a clean slate - user must re-select to use "+ selection" feature
        clearTextSelection();

        const unregister = editor.registerUpdateListener(() => {
          // Only update selection if the editor has focus
          // This prevents clearing selection when user clicks into AI chat
          const editorElement = editor.getRootElement();
          const hasFocus = editorElement?.contains(document.activeElement) ||
                           document.activeElement === editorElement;

          if (!hasFocus) {
            // Editor doesn't have focus - don't update selection state
            return;
          }

          // Clear any pending debounce
          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }

          // Debounce selection updates to reduce performance impact
          debounceTimer = setTimeout(() => {
            editor.getEditorState().read(() => {
              const selection = $getSelection();
              if ($isRangeSelection(selection) && !selection.isCollapsed()) {
                const selectedText = selection.getTextContent();
                if (selectedText && selectedText.trim().length > 0) {
                  setTextSelection(selectedText, filePath);
                } else {
                  clearTextSelection();
                }
              } else {
                // User clicked in editor without selection - clear it
                clearTextSelection();
              }
            });
          }, 150); // 150ms debounce
        });
        return () => {
          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }
          unregister();
          clearTextSelection();
        };
      }
      return undefined;
    }

    // For Monaco editor (code files or markdown in monaco mode)
    if (!isMarkdown || markdownViewMode === 'monaco') {
      const monacoEditor = editorRef.current?.editor;
      if (monacoEditor?.onDidChangeCursorSelection) {
        // When tab becomes active, clear any stale selection state
        clearTextSelection();

        const disposable = monacoEditor.onDidChangeCursorSelection(() => {
          // Only update selection if the editor has focus
          const hasFocus = monacoEditor.hasTextFocus();

          if (!hasFocus) {
            // Editor doesn't have focus - don't update selection state
            return;
          }

          // Clear any pending debounce
          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }

          // Debounce selection updates to reduce performance impact
          debounceTimer = setTimeout(() => {
            const selection = monacoEditor.getSelection();
            if (selection && !selection.isEmpty()) {
              const model = monacoEditor.getModel();
              if (model) {
                const selectedText = model.getValueInRange(selection);
                if (selectedText && selectedText.trim().length > 0) {
                  setTextSelection(selectedText, filePath);
                } else {
                  clearTextSelection();
                }
              }
            } else {
              // User clicked in editor without selection - clear it
              clearTextSelection();
            }
          }, 150); // 150ms debounce
        });
        return () => {
          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }
          disposable.dispose();
          clearTextSelection();
        };
      }
    }
    return undefined;
  }, [isActive, isEditorReady, isMarkdown, markdownViewMode, filePath]);

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
    // Wait for editor to be ready before checking pending diffs
    if (!isEditorReady) return;
    if (!editorRef.current && !isMockupFile) return;

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
        const oldContent = baseline ? baseline.content : pendingTag.content;
        const newContent = contentRef.current; // Use current content ref to get actual disk content

        logger.ui.info(`[TabEditor] Restoring pending AI edit on mount: tagId=${pendingTag.id}, status=${pendingTag.status}`);

        // Set the ref so other parts of the component know we're in diff mode
        pendingAIEditTagRef.current = {
          tagId: pendingTag.id,
          sessionId: pendingTag.sessionId,
          filePath: filePath
        };

        // If content differs, apply the diff
        if (oldContent !== newContent) {
          if (isMockupFile) {
            setMockupDiffData({ oldContent, newContent });
            setContent(oldContent);
            contentRef.current = oldContent;
            initialContentRef.current = oldContent;
            setIsDirty(false);
            isDirtyRef.current = false;
            onDirtyChange?.(false);
            return;
          }

          // For code files, use Monaco diff mode
          if (!isMarkdown) {
            logger.ui.info(`[TabEditor] Applying Monaco diff mode for code file on mount`);
            if (editorRef.current.showDiff) {
              editorRef.current.showDiff(oldContent, newContent);
              setShowMonacoDiffBar(true);
            } else {
              logger.ui.warn(`[TabEditor] Monaco editor doesn't have showDiff method`);
            }
            return;
          }

          // For markdown files, use Lexical diff mode
          // Reset editor to old (tagged) content first
          const transformers = getEditorTransformers();

          editorRef.current.update(() => {
            const root = $getRoot();
            root.clear();
            $convertFromEnhancedMarkdownString(oldContent, transformers);
          }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });

          setContent(oldContent);
          contentRef.current = oldContent;

          // Wait a tick before applying diff
          await new Promise(resolve => setTimeout(resolve, 100));

          // Apply the diff
          // Don't pass oldText - let the command handler extract it from the editor
          // This handles normalization differences (tables, spacing, etc.)
          isApplyingDiffRef.current = true;
          try {
            const replacements: TextReplacement[] = [{
              newText: newContent
            }];
            editorRef.current.dispatchCommand(APPLY_MARKDOWN_REPLACE_COMMAND, replacements);
            console.log(`[TabEditor] Applied pending AI edit diff on mount`);
          } finally {
            setTimeout(() => {
              isApplyingDiffRef.current = false;

              // Reset dirty state after diff application - user hasn't made any changes
              // This prevents false-positive autosaves from WYSIWYG rendering differences
              setIsDirty(false);
              isDirtyRef.current = false;
              onDirtyChange?.(false);
            }, 100);
          }
        }
      } catch (error) {
        logger.ui.error(`[TabEditor] Failed to check and apply pending diffs on mount:`, error);
      }
    };

    checkAndApplyPendingDiffs();
  }, [filePath, isMarkdown, isEditorReady, isMockupFile, onDirtyChange]); // Wait for editor to be ready before checking pending diffs


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

    // Update content ref to track current editor state
    // This is critical for file watcher comparisons
    contentRef.current = currentContent;

    // Check if content has changed from initial state
    // In diff mode, we still track dirty state so manual edits can be autosaved
    const isContentDirty = currentContent !== initialContentRef.current;

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

      // Skip if in diff mode - user should approve/reject AI changes first
      // This prevents false-positive autosaves from WYSIWYG rendering differences
      if (pendingAIEditTagRef.current) {
        return;
      }

      // Skip if not dirty
      if (!isDirtyRef.current) {
        // console.log(`[TabEditor] Skipping autosave - not dirty`);
        return;
      }

      // Skip if not enough time has passed since last change (debounce)
      if (Date.now() - lastChangeTimeRef.current < autosaveDebounce) {
        console.log(`[TabEditor] Skipping autosave - debounce not elapsed`);
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
        // console.log('[TabEditor] Skipping file-changed event - processing or applying diff');
        return;
      }
      processingFileChangeRef.current = true;
      // console.log('[TabEditor] Processing file-changed event for:', data.path);
      // console.log('[TabEditor] Processing flag set to true');

      let diffUpdatePromise: Promise<void> | null = null;
      try {
        const result = await window.electronAPI.readFileContent(data.path);
        if (!result || typeof result !== 'object' || !('content' in result)) {
          processingFileChangeRef.current = false;
          return;
        }

        const newContent = result.content || '';
        const currentContent = contentRef.current;

        // CRITICAL FIX: For code files (Monaco), don't skip based on contentRef comparison
        // Monaco updates contentRef synchronously via onDidChangeModelContent, but we still need
        // to call setContent to update the Monaco editor itself. The setContent call is idempotent.
        // For markdown files, we can safely skip if content matches.
        if (isMarkdown && newContent === currentContent) {
          // console.log('[TabEditor] Skipping - disk content matches current editor content', {
          //   fileName,
          //   diskLength: newContent.length,
          //   editorLength: currentContent.length,
          //   firstDiff: newContent.length > 0 ? newContent.substring(0, 100) : '(empty)',
          // });
          processingFileChangeRef.current = false;
          return;
        }

        // console.log('[TabEditor] File content differs - will update editor', {
        //   fileName,
        //   diskLength: newContent.length,
        //   editorLength: currentContent.length,
        //   diskPreview: newContent.substring(0, 100),
        //   editorPreview: currentContent.substring(0, 100),
        // });

        // CRITICAL: Check for pending AI edit tags FIRST before other heuristics
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

        // For custom editors with pending AI tags, skip the "matches last saved" check
        // because the AI edit IS the new content that needs to be shown
        const hasPendingAIEditForCustomEditor = isCustom && pendingTags.length > 0;

        // CRITICAL: Check if this is content we just saved
        // If the disk content matches what we last saved, this is definitely our own save
        // Don't reload even if the user has typed more since then
        // BUT: Skip this check for custom editors with pending AI edits
        const contentMatchesLastSave = newContent === lastSavedContentRef.current;

        if (contentMatchesLastSave && !hasPendingAIEditForCustomEditor) {
          // console.log('[TabEditor] Skipping - disk content matches last saved content');
          processingFileChangeRef.current = false;
          return;
        }

        // If there are unreviewed pending AI edit tags, apply diff mode (skip conflict dialog)
        const supportsMockupDiff = isCustom && isMockupFile;
        if (pendingTags && pendingTags.length > 0 && (!isCustom || supportsMockupDiff)) {
          // Get the baseline for diff comparison
          // This will be the latest incremental-approval tag if it exists, otherwise the pre-edit tag
          const baseline = await window.electronAPI.invoke('history:get-diff-baseline', data.path);
          const oldContent = baseline ? baseline.content : pendingTags[0].content;

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

          const tagInfo = {
            tagId: pendingTags[0].id,
            sessionId: pendingTags[0].sessionId,
            filePath: data.path
          };

          if (isMockupFile) {
            diffUpdatePromise = (async () => {
              pendingAIEditTagRef.current = tagInfo;
              setMockupDiffData({ oldContent, newContent });
              setContent(oldContent);
              contentRef.current = oldContent;
              initialContentRef.current = oldContent;
              setIsDirty(false);
              isDirtyRef.current = false;
              onDirtyChange?.(false);
            })();
          } else if (alreadyInDiffMode) {
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
                if (isMarkdown) {
                  // Markdown files: Use Lexical diff nodes
                  // FIRST: Reset editor to old (tagged) content to clear existing diff nodes
                  // This is NECESSARY - editor must have oldContent before applyMarkdownReplace can find it
                  const transformers = getEditorTransformers();

                  if (editorRef.current) {
                    editorRef.current.update(() => {
                      const root = $getRoot();
                      root.clear();
                      $convertFromEnhancedMarkdownString(oldContent, transformers);
                    }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });
                  }

                  // THEN: Apply the new diff replacement
                  // Don't pass oldText - let the command handler extract it from the editor
                  // This handles normalization differences (tables, spacing, etc.)
                  const replacements: TextReplacement[] = [{
                    newText: newContent
                  }];

                  // Wait a tick for the editor to update
                  await new Promise(resolve => setTimeout(resolve, 100));

                  // Mark that we're applying a diff programmatically (not a user edit)
                  isApplyingDiffRef.current = true;
                  try {
                    if (editorRef.current) {
                      editorRef.current.dispatchCommand(APPLY_MARKDOWN_REPLACE_COMMAND, replacements);
                      console.log(`[TabEditor] Updated diff with new edits`);
                    }
                  } finally {
                    // Wait for DOM to fully render with CSS classes
                    await new Promise(resolve => setTimeout(resolve, 500));
                    isApplyingDiffRef.current = false;

                    // Reset dirty state after diff application - user hasn't made any changes
                    // This prevents false-positive autosaves from WYSIWYG rendering differences
                    setIsDirty(false);
                    isDirtyRef.current = false;
                    onDirtyChange?.(false);
                  }
                } else {
                  // Code files: Use Monaco's built-in diff editor
                  if (editorRef.current && editorRef.current.showDiff) {
                    console.log(`[TabEditor] Showing Monaco diff - old: ${oldContent.length}, new: ${newContent.length}`);
                    editorRef.current.showDiff(oldContent, newContent);
                    setShowMonacoDiffBar(true);
                  }
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
                  if (isMarkdown) {
                    // Markdown files: Use Lexical diff nodes
                    const transformers = getEditorTransformers();

                    console.log(`[TabEditor] Loading old content for first-time diff (length: ${oldContent.length})`);

                    // Load the old (tagged) content - this will be the baseline for diff
                    editorRef.current.update(() => {
                      const root = $getRoot();
                      root.clear();
                      $convertFromEnhancedMarkdownString(oldContent, transformers);
                    }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });

                    // THEN: Apply the diff replacement to show changes from old to new
                    // Don't pass oldText - let the command handler extract it from the editor
                    // This handles normalization differences (tables, spacing, etc.)
                    const replacements: TextReplacement[] = [{
                      newText: newContent
                    }];

                    // Wait longer for the editor to fully process the content load
                    console.log(`[TabEditor] Waiting for content load to complete...`);
                    await new Promise(resolve => setTimeout(resolve, 250));

                    // Mark that we're applying a diff programmatically (not a user edit)
                    isApplyingDiffRef.current = true;
                    try {
                      editorRef.current.dispatchCommand(APPLY_MARKDOWN_REPLACE_COMMAND, replacements);
                      console.log(`[TabEditor] Dispatched APPLY_MARKDOWN_REPLACE_COMMAND`);
                    } finally {
                      // Reset flag after a small delay to ensure content change handler has run
                      await new Promise(resolve => setTimeout(resolve, 100));
                      isApplyingDiffRef.current = false;

                      // Reset dirty state after diff application - user hasn't made any changes
                      // This prevents false-positive autosaves from WYSIWYG rendering differences
                      setIsDirty(false);
                      isDirtyRef.current = false;
                      onDirtyChange?.(false);
                    }
                  } else {
                    // Code files: Use Monaco's built-in diff editor
                    if (editorRef.current.showDiff) {
                      console.log(`[TabEditor] Showing Monaco diff (first time) - old: ${oldContent.length}, new: ${newContent.length}`);
                      editorRef.current.showDiff(oldContent, newContent);
                      setShowMonacoDiffBar(true);
                    }
                  }

                  // CRITICAL FIX RC7: Store tag info ONLY after successful diff application
                  // This ensures pendingAIEditTagRef is synchronized with actual editor state
                  pendingAIEditTagRef.current = tagInfo;
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

        // Apply time-based heuristic to avoid reloading after own save
        // BUT: Skip this for custom editors with pending AI edits (they need to reload)
        const timeSinceLastSave = lastSaveTimeRef.current ? Date.now() - lastSaveTimeRef.current : Infinity;
        if (timeSinceLastSave < 2000 && !hasPendingAIEditForCustomEditor) {
          // console.log(`[TabEditor] Skipping - recent save (${timeSinceLastSave}ms ago)`);
          processingFileChangeRef.current = false;
          return;
        }

        const applyReload = async () => {
          // For custom editors: Just notify them of the file change, don't update our state
          // The custom editor owns its content - it will compare and decide whether to reload
          // If it does reload, it will call onDirtyChange/onContentChange to update us
          if (isCustom && customEditorReloadRef.current) {
            // Create history snapshot of external change for custom editors too
            if (window.electronAPI?.history && newContent) {
              try {
                await window.electronAPI.history.createSnapshot(
                    data.path,
                    newContent,
                    'external-change',
                    'File modified externally'
                );
              } catch (error) {
                logger.ui.error(`[TabEditor] Failed to create history snapshot for custom editor:`, error);
              }
            }

            try {
              logger.ui.info(`[TabEditor] Notifying custom editor of file change for ${fileName}`);
              customEditorReloadRef.current(newContent);
              // Update lastSavedContent to reflect what's on disk, but don't touch other state
              // The editor will report its state via callbacks if it actually updates
              lastSavedContentRef.current = newContent;
              setLastSavedContent(newContent);
            } catch (error) {
              logger.ui.error(`[TabEditor] Failed to notify custom editor of file change:`, error);
            }
            return;
          }

          // For built-in editors (markdown/code): Handle normally
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

          // Update editor content programmatically
          // Works for both active and inactive tabs since editor is still mounted
          if (editorRef.current) {
            try {
              if (isMarkdown) {
                // Update Lexical editor for markdown files
                const transformers = getEditorTransformers();

                editorRef.current.update(() => {
                  const root = $getRoot();
                  root.clear();
                  $convertFromEnhancedMarkdownString(newContent, transformers);
                }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });
              } else {
                // Update Monaco editor for code files
                if (editorRef.current.setContent) {
                  editorRef.current.setContent(newContent);
                }
              }
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
        // console.log('[TabEditor] Finished processing file-changed event - processing flag set to false');
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
        if (isMarkdown) {
          const transformers = getEditorTransformers();

          editorRef.current.update(() => {
            const root = $getRoot();
            root.clear();
            $convertFromEnhancedMarkdownString(newContent, transformers);
          }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });
        } else {
          // Update Monaco editor
          if (editorRef.current.setContent) {
            editorRef.current.setContent(newContent);
          }
        }
      } catch (error) {
        logger.ui.error(`[TabEditor] Failed to update editor content:`, error);
      }
    }
  }, [conflictDialogContent, fileName, onDirtyChange, isMarkdown]);

  const handleKeepLocalChanges = useCallback(() => {
    setShowConflictDialog(false);
    setConflictDialogContent('');
  }, []);

  // Handle content change from document header
  const handleDocumentHeaderContentChange = useCallback((newContent: string) => {
    // console.log(`[TabEditor] handleDocumentHeaderContentChange called for ${fileName}, newContentLength=${newContent.length}`);
    // console.trace('[TabEditor] DocumentHeader content change stack trace:');

    // Update editor content programmatically
    if (editorRef.current) {
      (async () => {
        try {
          if (isMarkdown) {
            const transformers = getEditorTransformers();

            editorRef.current.update(() => {
              const root = $getRoot();
              root.clear();
              $convertFromEnhancedMarkdownString(newContent, transformers);
            }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });
          } else {
            // Update Monaco editor
            if (editorRef.current.setContent) {
              editorRef.current.setContent(newContent);
            }
          }

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
  }, [onDirtyChange, onContentChange, isMarkdown]);

  // PHASE 5: Listen for diff approve/reject commands to update tag status
  useEffect(() => {
    if (!editorRef.current) return;

    const editor = editorRef.current;

    // NOTE: handleApprove and handleReject have been removed.
    // APPROVE_DIFF_COMMAND and REJECT_DIFF_COMMAND are now handled solely by DiffPlugin in rexical.
    // TabEditor only handles CLEAR_DIFF_TAG_COMMAND which is dispatched by DiffPlugin after all diffs are processed.

    // Handle incremental approval - create tag for partial accept/reject
    const handleIncrementalApproval = async () => {
      try {
        if (!pendingAIEditTagRef.current) {
          return;
        }

        const { tagId, sessionId, filePath } = pendingAIEditTagRef.current;

        // Get current editor content (includes the accepted/rejected changes)
        if (editorRef.current) {
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

    // Safety check - editor must have registerCommand method
    if (!editor || typeof editor.registerCommand !== 'function') {
      logger.ui.warn('[TabEditor] Editor instance is invalid, skipping command registration');
      return;
    }

    // Register command listeners
    // NOTE: APPROVE_DIFF_COMMAND and REJECT_DIFF_COMMAND are handled by DiffPlugin in rexical.
    // TabEditor only handles CLEAR_DIFF_TAG_COMMAND which is dispatched by DiffPlugin
    // after all diffs have been processed. This avoids duplicate handlers fighting over state.

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
      unregisterIncremental();
      unregisterClear();
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

  // Monaco diff mode accept/reject handlers
  const handleMockupDiffAccept = useCallback(async () => {
    if (!mockupDiffData || !pendingAIEditTagRef.current) {
      logger.ui.warn('[TabEditor] Cannot accept mockup diff - missing data or tag');
      return;
    }

    const operationFilePath = filePath;
    setMockupDiffAction('accept');

    try {
      const newContent = mockupDiffData.newContent;
      await window.electronAPI.saveFile(newContent, operationFilePath);

      // Check if file path changed during async operation - if so, abort
      if (currentFilePathRef.current !== operationFilePath) {
        logger.ui.info('[TabEditor] Mockup diff accept aborted - file path changed');
        return;
      }

      if (window.electronAPI.history) {
        await window.electronAPI.history.updateTagStatus(
          operationFilePath,
          pendingAIEditTagRef.current.tagId,
          'reviewed'
        );
      }

      // Final check before applying state changes
      if (currentFilePathRef.current !== operationFilePath) {
        logger.ui.info('[TabEditor] Mockup diff accept aborted - file path changed');
        return;
      }

      // Track analytics event for accepting mockup diff
      posthog?.capture('ai_diff_accepted', {
        acceptType: 'all',
        replacementCount: 1,
        fileType: 'mockup'
      });

      pendingAIEditTagRef.current = null;
      setMockupDiffData(null);
      setContent(newContent);
      contentRef.current = newContent;
      initialContentRef.current = newContent;
      setLastSavedContent(newContent);
      lastSavedContentRef.current = newContent;
      setIsDirty(false);
      isDirtyRef.current = false;
      onDirtyChange?.(false);
    } catch (error) {
      logger.ui.error('[TabEditor] Error accepting mockup diff:', error);
    } finally {
      // Only reset action if we're still on the same file
      if (currentFilePathRef.current === operationFilePath) {
        setMockupDiffAction('idle');
      }
    }
  }, [mockupDiffData, filePath, onDirtyChange, posthog]);

  const handleMockupDiffReject = useCallback(async () => {
    if (!mockupDiffData || !pendingAIEditTagRef.current) {
      logger.ui.warn('[TabEditor] Cannot reject mockup diff - missing data or tag');
      return;
    }

    const operationFilePath = filePath;
    setMockupDiffAction('reject');

    try {
      const oldContent = mockupDiffData.oldContent;
      await window.electronAPI.saveFile(oldContent, operationFilePath);

      // Check if file path changed during async operation - if so, abort
      if (currentFilePathRef.current !== operationFilePath) {
        logger.ui.info('[TabEditor] Mockup diff reject aborted - file path changed');
        return;
      }

      if (window.electronAPI.history) {
        await window.electronAPI.history.updateTagStatus(
          operationFilePath,
          pendingAIEditTagRef.current.tagId,
          'reviewed'
        );
      }

      // Final check before applying state changes
      if (currentFilePathRef.current !== operationFilePath) {
        logger.ui.info('[TabEditor] Mockup diff reject aborted - file path changed');
        return;
      }

      // Track analytics event for rejecting mockup diff
      posthog?.capture('ai_diff_rejected', {
        rejectType: 'all',
        replacementCount: 1,
        fileType: 'mockup'
      });

      pendingAIEditTagRef.current = null;
      setMockupDiffData(null);
      setContent(oldContent);
      contentRef.current = oldContent;
      initialContentRef.current = oldContent;
      setLastSavedContent(oldContent);
      lastSavedContentRef.current = oldContent;
      setIsDirty(false);
      isDirtyRef.current = false;
      onDirtyChange?.(false);
    } catch (error) {
      logger.ui.error('[TabEditor] Error rejecting mockup diff:', error);
    } finally {
      // Only reset action if we're still on the same file
      if (currentFilePathRef.current === operationFilePath) {
        setMockupDiffAction('idle');
      }
    }
  }, [mockupDiffData, filePath, onDirtyChange, posthog]);

  // Monaco diff mode accept/reject handlers
  const handleMonacoDiffAccept = useCallback(async () => {
    console.log('[TabEditor] !!!!! handleMonacoDiffAccept CALLED !!!!!');
    console.log('[TabEditor] editorRef.current:', !!editorRef.current);
    console.log('[TabEditor] editorRef.current.acceptDiff:', !!editorRef.current?.acceptDiff);
    console.log('[TabEditor] pendingAIEditTagRef.current:', !!pendingAIEditTagRef.current);

    if (!editorRef.current?.acceptDiff || !pendingAIEditTagRef.current) {
      logger.ui.warn('[TabEditor] Cannot accept Monaco diff - no editor or pending tag', {
        hasEditor: !!editorRef.current,
        hasAcceptDiff: !!editorRef.current?.acceptDiff,
        hasPendingTag: !!pendingAIEditTagRef.current
      });
      return;
    }

    console.log('[TabEditor] PASSED THE CHECK, ABOUT TO ENTER TRY BLOCK');

    try {
      console.log('[TabEditor] INSIDE TRY BLOCK');
      logger.ui.info('[TabEditor] Accepting Monaco diff', {
        tagId: pendingAIEditTagRef.current.tagId,
        filePath
      });

      console.log('[TabEditor] ABOUT TO CALL acceptDiff');
      // Get the new content from Monaco diff editor
      const newContent = editorRef.current.acceptDiff();
      console.log('[TabEditor] acceptDiff RETURNED:', newContent.length);

      console.log('[TabEditor] ABOUT TO WRITE TO DISK');
      // Write to disk - use saveFile with (content, filePath) parameter order
      try {
        await window.electronAPI.saveFile(newContent, filePath);
        console.log('[TabEditor] WROTE TO DISK SUCCESSFULLY');
      } catch (writeError) {
        console.error('[TabEditor] ERROR WRITING TO DISK:', writeError);
        throw writeError;
      }

      // Mark tag as reviewed (must pass filePath, tagId, status)
      if (window.electronAPI.history) {
        console.log('[TabEditor] About to call updateTagStatus', {
          filePath,
          tagId: pendingAIEditTagRef.current.tagId,
          status: 'reviewed'
        });

        await window.electronAPI.history.updateTagStatus(
          filePath,
          pendingAIEditTagRef.current.tagId,
          'reviewed'
        );

        console.log('[TabEditor] Successfully marked tag as reviewed');
      } else {
        console.warn('[TabEditor] No history API available');
      }

      // Exit diff mode
      console.log('[TabEditor] ABOUT TO EXIT DIFF MODE');
      editorRef.current.exitDiffMode();
      console.log('[TabEditor] EXIT DIFF MODE CALLED');

      // Clear pending tag ref
      pendingAIEditTagRef.current = null;

      // Hide the diff approval bar
      setShowMonacoDiffBar(false);

      // Update content and saved state
      setContent(newContent);
      setLastSavedContent(newContent);
      lastSavedContentRef.current = newContent;
      contentRef.current = newContent;
      setIsDirty(false);

      // CRITICAL: Update Monaco editor's content after exiting diff mode
      // Without this, Monaco will revert to the old content when it switches back to normal mode
      if (editorRef.current.setContent) {
        console.log('[TabEditor] Updating Monaco editor content after diff acceptance');
        editorRef.current.setContent(newContent);
      }

      logger.ui.info('[TabEditor] Monaco diff accepted successfully');
    } catch (error) {
      logger.ui.error('[TabEditor] Error accepting Monaco diff:', error);
    }
  }, [filePath]);

  const handleMonacoDiffReject = useCallback(async () => {
    if (!editorRef.current?.rejectDiff || !pendingAIEditTagRef.current) {
      logger.ui.warn('[TabEditor] Cannot reject Monaco diff - no editor or pending tag');
      return;
    }

    try {
      logger.ui.info('[TabEditor] Rejecting Monaco diff');

      // Get the old content from Monaco diff editor
      const oldContent = editorRef.current.rejectDiff();

      // Write to disk - use saveFile with (content, filePath) parameter order
      await window.electronAPI.saveFile(oldContent, filePath);

      // Mark tag as reviewed (must pass filePath, tagId, status)
      if (window.electronAPI.history) {
        await window.electronAPI.history.updateTagStatus(
          filePath,
          pendingAIEditTagRef.current.tagId,
          'reviewed'
        );
      }

      // Exit diff mode
      editorRef.current.exitDiffMode();

      // Clear pending tag ref
      pendingAIEditTagRef.current = null;

      // Hide the diff approval bar
      setShowMonacoDiffBar(false);

      // Update content and saved state
      setContent(oldContent);
      setLastSavedContent(oldContent);
      lastSavedContentRef.current = oldContent;
      contentRef.current = oldContent;
      setIsDirty(false);

      logger.ui.info('[TabEditor] Monaco diff rejected successfully');
    } catch (error) {
      logger.ui.error('[TabEditor] Error rejecting Monaco diff:', error);
    }
  }, [filePath]);

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
          {isCustom ? (() => {
            if (isMockupFile && mockupDiffData) {
              return (
                <MockupDiffViewer
                  originalHtml={mockupDiffData.oldContent}
                  updatedHtml={mockupDiffData.newContent}
                  fileName={fileName}
                  onAccept={handleMockupDiffAccept}
                  onReject={handleMockupDiffReject}
                  isAccepting={mockupDiffAction === 'accept'}
                  isRejecting={mockupDiffAction === 'reject'}
                />
              );
            }

            // Render custom editor if one is registered for this file type
            // Check for compound extensions like .mockup.html
            const lastDot = filePath.lastIndexOf('.');
            let CustomEditor = null;

            if (lastDot > 0) {
              // Try single extension first
              const singleExt = filePath.substring(lastDot).toLowerCase();
              CustomEditor = customEditorRegistry.getEditor(singleExt);

              // Try compound extension if single didn't match
              if (!CustomEditor) {
                const secondLastDot = filePath.lastIndexOf('.', lastDot - 1);
                if (secondLastDot > 0) {
                  const compoundExt = filePath.substring(secondLastDot).toLowerCase();
                  CustomEditor = customEditorRegistry.getEditor(compoundExt);
                }
              }
            }

            if (CustomEditor) {
              return (
                <CustomEditor
                  key={filePath}
                  filePath={filePath}
                  fileName={fileName}
                  initialContent={content}
                  theme={theme}
                  isActive={isActive}
                  workspaceId={workspaceId}
                  onContentChange={handleContentChange}
                  onDirtyChange={(isDirty: boolean) => {
                    setIsDirty(isDirty);
                    isDirtyRef.current = isDirty;
                    onDirtyChange?.(isDirty);
                  }}
                  onGetContentReady={(getContentFn: () => string) => {
                    // Store the getContent function for TabEditor's save machinery
                    getContentFnRef.current = getContentFn;
                    // Notify parent
                    onGetContentReady?.(getContentFn);
                    // Expose the manual save function
                    onManualSaveReady?.(handleManualSave);
                    // Mark editor as ready
                    setIsEditorReady(true);
                  }}
                  onReloadContent={(callback) => {
                    // Store the reload callback for file watcher to call
                    customEditorReloadRef.current = callback;
                  }}
                  onViewHistory={onViewHistory}
                  onRenameDocument={onRenameDocument}
                />
              );
            }

            // Fallback if custom editor is not found (shouldn't happen)
            return (
              <div style={{ padding: '20px', color: 'var(--text-primary)' }}>
                <p>No custom editor found for file type: {ext}</p>
              </div>
            );
          })() : isImage ? (
            <ImageViewer
              key={filePath}
              filePath={filePath}
              fileName={fileName}
            />
          ) : isMarkdown && markdownViewMode === 'lexical' ? (
              <div className="tab-editor-wrapper" style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
              <DocumentPathProvider documentPath={filePath}>
                <StravuEditor
                  key={`${filePath}-lexical-v${viewModeVersion}`}
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
                      setIsEditorReady(true);
                      // Force FixedTabHeaderRegistry to re-evaluate after editor remounts
                      // This ensures DiffApprovalBar appears when switching back from Monaco mode
                      setTimeout(() => {
                        FixedTabHeaderRegistry.getInstance().notifyChange();
                      }, 150);
                    },
                    onSaveRequest: handleManualSave,
                    onViewHistory,
                    onRenameDocument,
                    onSwitchToAgentMode,
                    onOpenSessionInChat,
                    onToggleMarkdownMode: () => {
                      // Get current content from Lexical editor before switching
                      if (getContentFnRef.current) {
                        const currentContent = getContentFnRef.current();
                        setContent(currentContent);
                      }
                  // Track markdown view mode switch
                  posthog?.capture('markdown_view_mode_switched', {
                    fromMode: 'lexical',
                    toMode: 'monaco',
                  });
                      setMarkdownViewMode('monaco');
                      setViewModeVersion(v => v + 1);
                    },
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
              </DocumentPathProvider>
              </div>
          ) : isMarkdown && markdownViewMode === 'monaco' ? (
            <>
              <div className="monaco-markdown-toolbar" style={{
                padding: '8px 16px',
                borderBottom: '1px solid var(--border-primary)',
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: '8px',
                background: 'var(--surface-secondary)',
              }}>
                <span style={{
                  marginRight: 'auto',
                  fontSize: '13px',
                  color: 'var(--text-secondary)'
                }}>
                  Raw Markdown Mode
                </span>
                <button
                  onClick={() => {
                    // Get current content from Monaco editor before switching
                    if (getContentFnRef.current) {
                      const currentContent = getContentFnRef.current();
                      setContent(currentContent);
                    }
                    // Track markdown view mode switch
                    posthog?.capture('markdown_view_mode_switched', {
                      fromMode: 'monaco',
                      toMode: 'lexical',
                    });
                    setMarkdownViewMode('lexical');
                    setViewModeVersion(v => v + 1);
                  }}
                  style={{
                    padding: '4px 12px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    background: 'var(--surface-primary)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: '4px',
                    color: 'var(--text-primary)',
                  }}
                >
                  Switch to Rich Text Editor
                </button>
              </div>
              <MonacoCodeEditor
                key={`${filePath}-monaco`}
                filePath={filePath}
                fileName={fileName}
                initialContent={content}
                theme={theme}
                isActive={isActive}
                onContentChange={handleContentChange}
                onGetContent={(getContentFn) => {
                  getContentFnRef.current = getContentFn;
                  if (onGetContentReady) {
                    onGetContentReady(getContentFn);
                  }
                  // Expose the manual save function
                  if (onManualSaveReady) {
                    onManualSaveReady(handleManualSave);
                  }
                  // Sync content once when editor is ready
                  if (!hasInitialContentSyncRef.current) {
                    hasInitialContentSyncRef.current = true;
                    const currentContent = getContentFn();
                    setContent(currentContent);
                  }
                }}
                onEditorReady={(editorWrapper) => {
                  // For Monaco, we get a wrapper with editor, setContent, getContent
                  editorRef.current = editorWrapper;
                  setIsEditorReady(true);
                }}
              />
            </>
          ) : (
            <>
              {!isMarkdown && showMonacoDiffBar && (
                <MonacoDiffApprovalBar
                  fileName={fileName}
                  onAcceptAll={handleMonacoDiffAccept}
                  onRejectAll={handleMonacoDiffReject}
                />
              )}
              <MonacoCodeEditor
                key={filePath}
                filePath={filePath}
                fileName={fileName}
                initialContent={initialContent}
                theme={theme}
                isActive={isActive}
                onContentChange={handleContentChange}
                onGetContent={(getContentFn) => {
                  getContentFnRef.current = getContentFn;
                  if (onGetContentReady) {
                    onGetContentReady(getContentFn);
                  }
                  // Expose the manual save function
                  if (onManualSaveReady) {
                    onManualSaveReady(handleManualSave);
                  }
                  // Sync content once when editor is ready
                  if (!hasInitialContentSyncRef.current) {
                    hasInitialContentSyncRef.current = true;
                    const currentContent = getContentFn();
                    setContent(currentContent);
                  }
                }}
                onEditorReady={(editorWrapper) => {
                  // For Monaco, we get a wrapper with editor, setContent, getContent, showDiff, etc.
                  editorRef.current = editorWrapper;
                  setIsEditorReady(true);
                }}
              />
            </>
          )}


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

      </div>
  );
};
