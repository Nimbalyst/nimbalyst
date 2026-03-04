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
import type { ConfigTheme } from '@nimbalyst/runtime';
import { DocumentPathProvider, MarkdownEditor, MonacoEditor, MonacoCodeEditor } from '@nimbalyst/runtime';
import { useTheme } from '../../hooks/useTheme';
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
} from '@nimbalyst/runtime';
import { $getRoot, $getSelection, $isRangeSelection, SKIP_SCROLL_INTO_VIEW_TAG, COMMAND_PRIORITY_LOW } from 'lexical';
import { DocumentHeaderContainer } from '@nimbalyst/runtime/plugins/TrackerPlugin/documentHeader';
// Side-effect import: registers GenericFrontmatterHeader with DocumentHeaderRegistry
import '@nimbalyst/runtime/plugins/FrontmatterPlugin';
import { setTextSelection, clearTextSelection } from '../UnifiedAI/TextSelectionIndicator';
import { FixedTabHeaderContainer, FixedTabHeaderRegistry } from '@nimbalyst/runtime/plugins/shared/fixedTabHeader';
import { UnifiedDiffHeader, LexicalDiffHeaderAdapter } from '../UnifiedDiffHeader';
import { ImageViewer } from '../ImageViewer';
import { getFileType } from '../../utils/fileTypeDetector';
import { customEditorRegistry, CustomEditorWrapper } from '../CustomEditors';
import { logger } from '../../utils/logger';
import { createEditorHost } from './createEditorHost';
import type { EditorHost, DiffConfig } from '@nimbalyst/runtime';
import { createExtensionStorage } from '@nimbalyst/runtime';
import { store, editorHasUnacceptedChangesAtom, makeEditorKey } from '@nimbalyst/runtime/store';
import { UnifiedEditorHeaderBar } from './UnifiedEditorHeaderBar';

interface TabEditorProps {
  // Identification
  filePath: string;
  fileName: string;

  // Initial state
  initialContent: string;

  // Configuration
  isActive: boolean;

  // Optional features
  textReplacements?: Array<{ oldText?: string; newText: string }>;
  autosaveInterval?: number; // milliseconds, default 2000
  autosaveDebounce?: number; // milliseconds, default 200
  periodicSnapshotInterval?: number; // milliseconds, default 300000 (5 minutes)

  // Callbacks to parent
  onDirtyChange?: (isDirty: boolean) => void; // Used by custom editors to update tab store
  onSaveComplete?: (filePath: string) => void;

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
                                                      isActive,
                                                      textReplacements,
                                                      autosaveInterval = 2000,
                                                      autosaveDebounce = 200,
                                                      periodicSnapshotInterval = 300000,
                                                      onDirtyChange,
                                                      onSaveComplete,
                                                      onManualSaveReady,
                                                      onGetContentReady,
                                                      onViewHistory,
                                                      onRenameDocument,
                                                      onSwitchToAgentMode,
                                                      onOpenSessionInChat,
                                                      workspaceId,
                                                    }) => {
  // Use theme hook directly so we get live updates when theme changes
  // (TabContent creates each TabEditor in a separate React root, so prop updates don't work)
  const { theme, themeId } = useTheme();

  // Debug: log every render to verify isDirty changes don't cause re-renders
  console.log('[TabEditor] render', fileName);

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

  // Get the custom editor registration for this file (used for source mode and storage)
  const customEditorRegistration = useMemo(() => {
    if (!isCustom) return null;

    // Try to find the editor registration for this file
    const lastDot = filePath.lastIndexOf('.');
    if (lastDot <= 0) return null;

    // Try single extension first
    const singleExt = filePath.substring(lastDot).toLowerCase();
    let registration = customEditorRegistry.getRegistration(singleExt);

    // Try compound extension if single didn't match
    if (!registration) {
      const secondLastDot = filePath.lastIndexOf('.', lastDot - 1);
      if (secondLastDot > 0) {
        const compoundExt = filePath.substring(secondLastDot).toLowerCase();
        registration = customEditorRegistry.getRegistration(compoundExt);
      }
    }

    return registration;
  }, [isCustom, filePath, registryVersion]);

  // Check if the custom editor supports source mode (from registry)
  const customEditorSupportsSourceMode = customEditorRegistration?.supportsSourceMode || false;

  // Source mode state - unified for both markdown and custom editors
  // When true, shows Monaco with raw content; when false, shows rich editor (Lexical or custom)
  const [sourceMode, setSourceMode] = useState(false);

  // NOTE: content state has been removed. Editors own their content.
  // TabEditor extracts content via getContentFnRef.current() when needed for saves, diffs, etc.
  // contentRef tracks the working copy, lastSavedContentRef tracks what was saved to disk.
  // NOTE: isDirty is tracked via ref only, not state, to avoid re-renders when dirty state changes.
  // The parent is notified via onDirtyChange callback.
  // NOTE: lastSaveTime and lastSavedContent are refs, not state, to avoid re-renders on save
  // They're only used for file watcher comparison, not for rendering
  const [reloadVersion, setReloadVersion] = useState(0);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [conflictDialogContent, setConflictDialogContent] = useState<string>('');
  const [showMonacoDiffBar, setShowMonacoDiffBar] = useState(false); // For Monaco diff approval bar
  const [showCustomEditorDiffBar, setShowCustomEditorDiffBar] = useState(false); // For custom editor diff approval bar
  const [isEditorReady, setIsEditorReady] = useState(false); // Track when editor is mounted and ready
  const [diffSessionInfo, setDiffSessionInfo] = useState<{sessionId: string; sessionTitle?: string; editedAt?: number; provider?: string} | null>(null); // Session info for diff approval bar
  const [monacoDiffChangeCount, setMonacoDiffChangeCount] = useState(0); // Number of changes in Monaco diff mode
  const [showTreeView, setShowTreeView] = useState(false); // Debug tree view for Lexical (dev mode only)

  // Track editor type usage when file is opened
  const hasTrackedOpenRef = useRef<string | null>(null);
  useEffect(() => {
    // Only track once per file path when it becomes active
    if (isActive && isEditorReady && hasTrackedOpenRef.current !== filePath) {
      hasTrackedOpenRef.current = filePath;

      // Determine file extension for tracking (handles compound extensions like .mockup.html)
      const lowerPath = filePath.toLowerCase();
      let fileExtension: string;

      // Check for compound extensions first
      if (lowerPath.endsWith('.mockup.html')) {
        fileExtension = '.mockup.html';
      } else {
        // Standard single extension
        const lastDot = filePath.lastIndexOf('.');
        fileExtension = lastDot >= 0 ? filePath.substring(lastDot).toLowerCase() : '';
      }

      // Determine editor category
      let editorCategory = 'monaco'; // default for code files
      let hasMermaid = false;
      let hasDataModel = false;

      if (isMarkdown) {
        editorCategory = 'markdown';
        // Check if markdown contains Mermaid diagrams
        if (initialContent.includes('```mermaid') || initialContent.includes('~~~mermaid')) {
          hasMermaid = true;
        }
        // Check if markdown contains DataModel references
        if (initialContent.includes('```datamodel') || initialContent.includes('datamodel:')) {
          hasDataModel = true;
        }
      } else if (isImage) {
        editorCategory = 'image';
      } else if (isCustom) {
        // Use the registered editor name (e.g., "Spreadsheet Editor", "PDF Viewer")
        const registration = customEditorRegistry.getRegistration(fileExtension);
        editorCategory = registration?.name || 'custom';
      }

      posthog?.capture('editor_type_opened', {
        editorCategory,
        fileExtension,
        hasMermaid,
        hasDataModel,
      });
    }
  }, [isActive, isEditorReady, filePath, isMarkdown, isImage, isCustom, posthog, initialContent]);

  // Track current file path to abort operations when switching files
  const currentFilePathRef = useRef(filePath);

  useEffect(() => {
    currentFilePathRef.current = filePath;
    setSourceMode(false); // Reset source mode when switching files
  }, [filePath]);

  // Refs for stable access in timers/callbacks
  const contentRef = useRef(initialContent);
  const isDirtyRef = useRef(false);
  const lastChangeTimeRef = useRef<number>(0);
  const getContentFnRef = useRef<(() => string) | null>(null);
  const editorRef = useRef<any>(null);
  const initialContentRef = useRef(initialContent);
  const lastSaveTimeRef = useRef<number | null>(null);
  const lastSavedContentRef = useRef<string>(initialContent);
  const isSavingRef = useRef<boolean>(false);
  const saveIdRef = useRef<number>(0);
  const pendingSaveIdsRef = useRef<Set<number>>(new Set());
  const instanceIdRef = useRef<number>(Math.floor(Math.random() * 10000));
  const hasInitialContentSyncRef = useRef<boolean>(false);
  const pendingAIEditTagRef = useRef<{tagId: string, sessionId: string, filePath: string} | null>(null);
  const isApplyingDiffRef = useRef<boolean>(false); // Track programmatic diff application
  const editorHostFileChangeCallbackRef = useRef<((newContent: string) => void) | null>(null); // For EditorHost file change subscription
  const diffRequestCallbackRef = useRef<((config: DiffConfig) => void) | null>(null); // For EditorHost diff request subscription
  const diffClearedCallbackRef = useRef<(() => void) | null>(null); // For EditorHost diff cleared subscription
  const editorHostSaveRequestCallbackRef = useRef<(() => void | Promise<void>) | null>(null); // For EditorHost save request subscription
  const sourceModeChangedCallbackRef = useRef<((isSourceMode: boolean) => void) | null>(null); // For EditorHost source mode subscription
  const themeChangeCallbackRef = useRef<((theme: string) => void) | null>(null); // For EditorHost theme change subscription

  // State for extension-contributed menu items
  const [extensionMenuItems, setExtensionMenuItems] = useState<Array<{ label: string; icon?: string; onClick: () => void }>>([]);

  // Helper to update pending AI edit state - updates both ref and Jotai atom
  const editorKey = useMemo(() => makeEditorKey(filePath), [filePath]);
  const setPendingAIEditTag = useCallback((tag: {tagId: string, sessionId: string, filePath: string} | null) => {
    pendingAIEditTagRef.current = tag;
    // Update Jotai atom so tab indicator subscribes to it
    store.set(editorHasUnacceptedChangesAtom(editorKey), tag !== null);
  }, [editorKey]);

  // Refs for EditorHost stability - these allow editorHost to access current values without recreating
  const themeRef = useRef(theme);
  const isActiveRef = useRef(isActive);
  const sourceModeRef = useRef(sourceMode);
  // Whether current editor supports source mode toggle (markdown or custom editors that declare it)
  const supportsSourceModeRef = useRef(isMarkdown || customEditorSupportsSourceMode);
  const onViewHistoryRef = useRef(onViewHistory);

  // CRITICAL: Update themeRef SYNCHRONOUSLY during render, not in an effect.
  // Effects run AFTER render, so custom editors would get the stale value if we used an effect.
  // This ensures host.theme returns the current value immediately.
  themeRef.current = theme;

  // NOTE: The old "check disk content on tab activation" polling logic has been removed.
  // File watchers are now active for all open tabs, so changes are detected in real-time
  // via the 'file-changed-on-disk' event handler below. This eliminates the redundant
  // "File Changed While Inactive" dialog that would appear on tab switch.

  // Helper function to fetch session info for diff approval bar
  const fetchDiffSessionInfo = useCallback(async (sessionId: string, editedAt?: number) => {
    try {
      // Try to load session info
      if (window.electronAPI?.aiLoadSession) {
        const sessionData = await window.electronAPI.aiLoadSession(sessionId, workspaceId);
        if (sessionData) {
          setDiffSessionInfo({
            sessionId,
            sessionTitle: sessionData.title || 'AI Session',
            editedAt: editedAt || Date.now(),
            provider: sessionData.provider
          });
          return;
        }
      }
    } catch (error) {
      logger.ui.warn('[TabEditor] Failed to fetch session info for diff bar:', error);
    }
    // Fallback - just set session ID without title
    setDiffSessionInfo({
      sessionId,
      editedAt: editedAt || Date.now()
    });
  }, [workspaceId]);

  // Handler for "Go to Session" button
  const handleGoToSession = useCallback((sessionId: string) => {
    if (onOpenSessionInChat) {
      onOpenSessionInChat(sessionId);
    }
  }, [onOpenSessionInChat]);

  // Notify custom editors of theme changes (themeRef is updated synchronously above)
  useEffect(() => {
    if (themeChangeCallbackRef.current) {
      themeChangeCallbackRef.current(theme);
    }
  }, [theme]);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);
  useEffect(() => { sourceModeRef.current = sourceMode; }, [sourceMode]);
  useEffect(() => { supportsSourceModeRef.current = isMarkdown || customEditorSupportsSourceMode; }, [isMarkdown, customEditorSupportsSourceMode]);
  useEffect(() => { onViewHistoryRef.current = onViewHistory; }, [onViewHistory]);

  // Clear Lexical editor selection when tab becomes inactive
  // This ensures no stale visual selection when switching back to the tab
  // Note: Monaco handles this internally via the isActive prop
  useEffect(() => {
    if (!isActive && isEditorReady && editorRef.current) {
      // Clear Lexical editor selection
      if (isMarkdown && !sourceMode) {
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
  }, [isActive, isEditorReady, isMarkdown, sourceMode]);

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

    // For Lexical editor (markdown in rich text mode)
    if (isMarkdown && !sourceMode) {
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

    // For Monaco editor (code files or markdown/custom editor in source mode)
    if (!isMarkdown || sourceMode) {
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
  }, [isActive, isEditorReady, isMarkdown, sourceMode, filePath]);

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
    if (!editorRef.current && !isCustom) return;
    // Skip pending diff check when in source mode - source mode is for raw editing
    if (sourceMode) return;

    hasCheckedForPendingTagsRef.current = true;
    // Reset the flag for this file
    mountEffectHandledPendingDiffRef.current = false;

    const checkAndApplyPendingDiffs = async () => {
      // For custom editors, wait a tick for their useEffect to register diff callbacks
      // This ensures diffRequestCallbackRef is set before we try to use it
      if (isCustom) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
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
        logger.ui.info(`[TabEditor] Diff content check: oldContentLength=${oldContent?.length}, newContentLength=${newContent?.length}, baseline=${!!baseline}, pendingTagContent=${pendingTag.content?.length}`);

        // If content differs, apply the diff
        if (oldContent !== newContent) {
          // Route through EditorHost callback if custom editor has subscribed to diff requests
          if (diffRequestCallbackRef.current) {
            // Set the ref so other parts of the component know we're in diff mode
            setPendingAIEditTag({
              tagId: pendingTag.id,
              sessionId: pendingTag.sessionId,
              filePath: filePath
            });
            setShowCustomEditorDiffBar(true);
            // Fetch session info for the diff approval bar
            fetchDiffSessionInfo(pendingTag.sessionId, pendingTag.createdAt ? new Date(pendingTag.createdAt).getTime() : Date.now());
            diffRequestCallbackRef.current({
              originalContent: oldContent,
              modifiedContent: newContent,
              tagId: pendingTag.id,
              sessionId: pendingTag.sessionId,
            });
            contentRef.current = oldContent;
            initialContentRef.current = oldContent;
            isDirtyRef.current = false;
            onDirtyChange?.(false);
            return;
          }

          // Custom editors that don't support diff mode: skip diff mode entirely
          // The new content is already on disk, just don't enter diff mode
          if (isCustom) {
            logger.ui.info(`[TabEditor] Custom editor doesn't support diff mode, skipping: ${fileName}`);
            return;
          }

          // Set the ref so other parts of the component know we're in diff mode
          setPendingAIEditTag({
            tagId: pendingTag.id,
            sessionId: pendingTag.sessionId,
            filePath: filePath
          });

          // For code files, use Monaco diff mode
          if (!isMarkdown) {
            logger.ui.info(`[TabEditor] Applying Monaco diff mode for code file on mount`);
            if (editorRef.current.showDiff) {
              editorRef.current.showDiff(oldContent, newContent);
              setShowMonacoDiffBar(true);
              // Fetch session info for the diff approval bar
              fetchDiffSessionInfo(pendingTag.sessionId, pendingTag.createdAt ? new Date(pendingTag.createdAt).getTime() : Date.now());
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

          contentRef.current = oldContent;

          // Wait a tick before applying diff
          await new Promise(resolve => setTimeout(resolve, 100));

          // Apply the diff
          // Don't pass oldText - let the command handler extract it from the editor
          // This handles normalization differences (tables, spacing, etc.)
          isApplyingDiffRef.current = true;
          try {
            const replacements = [{
              newText: newContent
            }];
            editorRef.current.dispatchCommand(APPLY_MARKDOWN_REPLACE_COMMAND, replacements);
            console.log(`[TabEditor] Applied pending AI edit diff on mount`);
            // Fetch session info for the diff approval bar (for Lexical)
            fetchDiffSessionInfo(pendingTag.sessionId, pendingTag.createdAt ? new Date(pendingTag.createdAt).getTime() : Date.now());
          } finally {
            setTimeout(() => {
              isApplyingDiffRef.current = false;

              // Reset dirty state after diff application - user hasn't made any changes
              // This prevents false-positive autosaves from WYSIWYG rendering differences
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
  }, [filePath, isMarkdown, isEditorReady, isCustom, sourceMode]); // Wait for editor to be ready before checking pending diffs


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
      lastSaveTimeRef.current = saveTime;
      lastSavedContentRef.current = contentToSave;

      logger.ui.info(`[TabEditor] Saving ${fileName}, saveId=${thisSaveId}, skipDiffCheck=${skipDiffCheck}`);
      // console.trace('[TabEditor] saveWithHistory called, stack trace:');

      // Save to disk with conflict detection
      const result = await window.electronAPI.saveFile(
          contentToSave,
          filePath
      );

      // console.log(`[TabEditor] saveFile returned for ${fileName}, success=${result?.success}, conflict=${result?.conflict}`);

      // IMMEDIATE: Clear dirty flag as soon as save succeeds
      if (result && result.success) {
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
              lastSaveTimeRef.current = Date.now();
              lastSavedContentRef.current = contentToSave;
            }
          } else if (result.diskContent) {
            // User chose to reload - update editor with disk content
            // Update editor content programmatically to avoid remount
            const diskContent = result.diskContent;
            if (editorRef.current) {
              try {
                // Import Lexical functions from 'lexical' and editor functions from '@nimbalyst/runtime'
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

            contentRef.current = diskContent;
            initialContentRef.current = diskContent;
            lastSavedContentRef.current = diskContent;
            isDirtyRef.current = false;
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
        // Only check for Lexical editors (markdown) - Monaco/custom editors don't have getEditorState
        if (!skipDiffCheck && editorRef.current && pendingAIEditTagRef.current?.tagId && typeof editorRef.current.getEditorState === 'function') {
          const hasDiffs = editorRef.current.getEditorState().read(() => {
            return $hasDiffNodes(editorRef.current!);
          });

          if (!hasDiffs) {
            logger.ui.info('[TabEditor] No diffs remaining after user save, clearing pending tag');
            const { tagId, filePath: tagFilePath } = pendingAIEditTagRef.current!;
            await window.electronAPI.invoke('history:update-tag-status', tagFilePath, tagId, 'reviewed');
            setPendingAIEditTag(null);
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
      lastSaveTimeRef.current = null;
      lastSaveTimeRef.current = null;
      isSavingRef.current = false;
      throw error;
    }
  }, [filePath, fileName, onSaveComplete]);

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

      // Skip if we're in the process of applying a diff
      // This catches the window between starting diff application and setting pendingAIEditTagRef
      if (isApplyingDiffRef.current) {
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

      // For custom editors using EditorHost: tell them to save
      if (editorHostSaveRequestCallbackRef.current) {
        try {
          logger.ui.info(`[TabEditor] Requesting save from custom editor: ${fileName}`);
          await editorHostSaveRequestCallbackRef.current();
        } catch (error) {
          logger.ui.error(`[TabEditor] Custom editor save request failed for ${filePath}:`, error);
        }
        return;
      }

      // For built-in editors: use getContentFn
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
  // Track if a file change arrived while we were processing (needs re-check after done)
  const pendingFileChangeRef = useRef(false);

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }

    // Only register once per component instance
    if (fileWatcherRegisteredRef.current) {
      return;
    }

    fileWatcherRegisteredRef.current = true;

    // Normalize a file path for comparison (trailing slashes, separators)
    const normalizePath = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');

    // Create a stable handler function that we can properly clean up
    const handleFileChanged = async (data: { path: string }) => {
      // Only handle changes for this file
      if (normalizePath(data.path) !== normalizePath(filePath)) {
        return;
      }

      // If already processing a change or applying a diff, mark as pending and return
      // We'll re-check for changes after the current processing completes
      if (processingFileChangeRef.current || isApplyingDiffRef.current) {
        console.log('[TabEditor] File change during processing - marking as pending');
        pendingFileChangeRef.current = true;
        return;
      }
      processingFileChangeRef.current = true;
      pendingFileChangeRef.current = false; // Clear any pending flag since we're processing now
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

        // NOTE: We no longer compare against contentRef for markdown files.
        // With onDirtyChange (no serialization on keystroke), contentRef may be stale.
        // The lastSavedContentRef comparison below is more reliable - it detects our own saves.
        // External edits will be processed and editors will decide whether to reload.

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

        // If a pending tag exists, we must process diff mode even when disk content
        // matches lastSavedContentRef (the original watcher event may have arrived
        // before tag persistence).
        const hasPendingAIEdit = pendingTags.length > 0;

        // CRITICAL: Check if this is content we just saved
        // If the disk content matches what we last saved, this is definitely our own save
        // Don't reload even if the user has typed more since then
        // BUT: Skip this check whenever pending AI tags exist
        const contentMatchesLastSave = newContent === lastSavedContentRef.current;
        // console.log(`[TabEditor] File change for ${fileName}: contentMatchesLastSave=${contentMatchesLastSave}, isCustom=${isCustom}`);

        if (contentMatchesLastSave && !hasPendingAIEdit) {
          // console.log(`[TabEditor] Skipping file change - content matches last save`);
          processingFileChangeRef.current = false;
          return;
        }

        // If there are unreviewed pending AI edit tags, apply diff mode (skip conflict dialog)
        // Custom editors that subscribe to onDiffRequested can also handle diff mode
        const customEditorSupportsDiff = isCustom && diffRequestCallbackRef.current !== null;
        if (pendingTags && pendingTags.length > 0 && (!isCustom || customEditorSupportsDiff)) {
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

          // Route through EditorHost callback if custom editor has subscribed to diff requests
          if (diffRequestCallbackRef.current) {
            // Set isApplyingDiffRef before async work to protect against autosave race
            isApplyingDiffRef.current = true;
            diffUpdatePromise = (async () => {
              try {
                setPendingAIEditTag(tagInfo);
                setShowCustomEditorDiffBar(true);
                // Fetch session info for the diff approval bar
                fetchDiffSessionInfo(pendingTags[0].sessionId, pendingTags[0].createdAt ? new Date(pendingTags[0].createdAt).getTime() : Date.now());
                diffRequestCallbackRef.current!({
                  originalContent: oldContent,
                  modifiedContent: newContent,
                  tagId: pendingTags[0].id,
                  sessionId: pendingTags[0].sessionId,
                });
                contentRef.current = oldContent;
                initialContentRef.current = oldContent;
                isDirtyRef.current = false;
                onDirtyChange?.(false);
                // Signal content changed so document headers re-read
                setReloadVersion(v => v + 1);
              } finally {
                isApplyingDiffRef.current = false;
              }
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

            contentRef.current = oldContent;

            // Set isApplyingDiffRef before async work for consistency
            // (pendingAIEditTagRef should already be set, but this is belt-and-suspenders)
            isApplyingDiffRef.current = true;

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
                  const replacements = [{
                    newText: newContent
                  }];

                  // Wait a tick for the editor to update
                  await new Promise(resolve => setTimeout(resolve, 100));

                  // Apply diff (isApplyingDiffRef was set before async work started)
                  if (editorRef.current) {
                    editorRef.current.dispatchCommand(APPLY_MARKDOWN_REPLACE_COMMAND, replacements);
                    console.log(`[TabEditor] Updated diff with new edits`);
                    // Fetch session info for the diff approval bar (for Lexical)
                    fetchDiffSessionInfo(tagInfo.sessionId, pendingTags[0].createdAt?.getTime?.() || Date.now());
                  }

                  // Wait for DOM to fully render with CSS classes
                  await new Promise(resolve => setTimeout(resolve, 500));

                  // Reset dirty state after diff application - user hasn't made any changes
                  // This prevents false-positive autosaves from WYSIWYG rendering differences
                  isDirtyRef.current = false;
                  onDirtyChange?.(false);

                  // Signal content changed so document headers re-read
                  setReloadVersion(v => v + 1);
                } else {
                  // Code files: Use Monaco's built-in diff editor
                  if (editorRef.current && editorRef.current.showDiff) {
                    console.log(`[TabEditor] Showing Monaco diff - old: ${oldContent.length}, new: ${newContent.length}`);
                    editorRef.current.showDiff(oldContent, newContent);
                    setShowMonacoDiffBar(true);
                    // Fetch session info for the diff approval bar
                    fetchDiffSessionInfo(tagInfo.sessionId, pendingTags[0].createdAt?.getTime?.() || Date.now());
                    // Signal content changed so document headers re-read
                    setReloadVersion(v => v + 1);
                  }
                }
              } catch (error) {
                logger.ui.error(`[TabEditor] Failed to update diff:`, error);
              } finally {
                // Clear isApplyingDiffRef whether success or failure
                isApplyingDiffRef.current = false;
              }
            })();
          } else {
            // First time showing diff for this tag
            logger.ui.info(`[TabEditor] AI edit pending for ${fileName}, applying diff mode (skipping conflict dialog)`);
            console.log(`[TabEditor] AI edit pending - tagged content length: ${oldContent.length}, new content length: ${newContent.length}`);

            contentRef.current = oldContent;

            // CRITICAL: Set isApplyingDiffRef BEFORE starting async work
            // This prevents autosave from firing during diff application
            // (pendingAIEditTagRef is set after diff completes, but we need protection during)
            isApplyingDiffRef.current = true;

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
                    const replacements = [{
                      newText: newContent
                    }];

                    // Wait longer for the editor to fully process the content load
                    console.log(`[TabEditor] Waiting for content load to complete...`);
                    await new Promise(resolve => setTimeout(resolve, 250));

                    // Apply diff (isApplyingDiffRef was set before async work started)
                    editorRef.current.dispatchCommand(APPLY_MARKDOWN_REPLACE_COMMAND, replacements);
                    console.log(`[TabEditor] Dispatched APPLY_MARKDOWN_REPLACE_COMMAND`);
                    // Fetch session info for the diff approval bar (for Lexical)
                    fetchDiffSessionInfo(tagInfo.sessionId, pendingTags[0].createdAt?.getTime?.() || Date.now());

                    // Wait for content change handler to process
                    await new Promise(resolve => setTimeout(resolve, 100));
                  } else {
                    // Code files: Use Monaco's built-in diff editor
                    if (editorRef.current.showDiff) {
                      console.log(`[TabEditor] Showing Monaco diff (first time) - old: ${oldContent.length}, new: ${newContent.length}`);
                      editorRef.current.showDiff(oldContent, newContent);
                      setShowMonacoDiffBar(true);
                      // Fetch session info for the diff approval bar
                      fetchDiffSessionInfo(tagInfo.sessionId, pendingTags[0].createdAt?.getTime?.() || Date.now());
                    }
                  }

                  // CRITICAL FIX RC7: Store tag info ONLY after successful diff application
                  // This ensures pendingAIEditTagRef is synchronized with actual editor state
                  setPendingAIEditTag(tagInfo);

                  // Reset dirty state after diff application - user hasn't made any changes
                  // This prevents false-positive autosaves from WYSIWYG rendering differences
                  isDirtyRef.current = false;
                  onDirtyChange?.(false);

                  // Signal content changed so document headers re-read
                  setReloadVersion(v => v + 1);
                }
              } catch (error) {
                logger.ui.error(`[TabEditor] Failed to apply AI diff:`, error);
              } finally {
                // CRITICAL: Clear isApplyingDiffRef whether success or failure
                // This was set before the async work started to protect against autosave race
                isApplyingDiffRef.current = false;
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

        // Keep a recent-save timestamp for conflict handling below.
        // Do not suppress external reloads based on time alone; legitimate AI edits
        // can happen immediately after a save and must still be applied.
        const timeSinceLastSave = lastSaveTimeRef.current ? Date.now() - lastSaveTimeRef.current : Infinity;

        const applyReload = async () => {
          // For custom editors using EditorHost: Just notify them of the file change
          // The custom editor owns its content - it will compare and decide whether to reload
          if (isCustom && editorHostFileChangeCallbackRef.current) {
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
              editorHostFileChangeCallbackRef.current(newContent);
              // Update lastSavedContent to reflect what's on disk, but don't touch other state
              // The editor will report its state via callbacks if it actually updates
              lastSavedContentRef.current = newContent;
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
          contentRef.current = newContent;
          initialContentRef.current = newContent;
          lastSavedContentRef.current = newContent;
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
              // Signal that content was reloaded externally so document headers can re-read
              setReloadVersion(v => v + 1);
            } catch (error) {
              logger.ui.error(`[TabEditor] Failed to update editor content:`, error);
            }
          }
        };

        // Protect dirty files from being overwritten
        // BUT: Skip this check if there's a pending AI edit tag - the diff mode handles it
        // Also skip if this is an echo from our own recent save (within 2s AND content matches)
        if (isDirtyRef.current && (!pendingTags || pendingTags.length === 0)) {
          // Check if this is an echo from our own save - need BOTH time AND content match
          // to avoid false positives where content happens to match for other reasons
          if (timeSinceLastSave < 2000 && newContent === lastSavedContentRef.current) {
            // This is our own save coming back - ignore it completely (don't clear dirty)
            processingFileChangeRef.current = false;
            return;
          }
          // Store the new content and show dialog
          logger.ui.info(`[TabEditor] FILE WATCHER: Showing conflict dialog for ${fileName}`);
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

        // If another file change arrived while we were processing, re-process
        // This ensures we don't miss updates (e.g., second AI edit while processing first)
        if (pendingFileChangeRef.current) {
          console.log('[TabEditor] Re-processing pending file change');
          pendingFileChangeRef.current = false;
          // Use setTimeout to avoid deep recursion and allow React to process
          setTimeout(() => {
            handleFileChanged(data);
          }, 0);
        }
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

  // Listen for "Clear All Pending" event to exit diff mode when this file's pending tag is cleared
  useEffect(() => {
    if (!window.electronAPI?.history?.onPendingCleared) {
      return;
    }

    const normalizeForCompare = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
    const unsubscribe = window.electronAPI.history.onPendingCleared((data: { workspacePath: string; clearedFiles: string[] }) => {
      // Check if this file was in the list of cleared files
      const normalizedFilePath = normalizeForCompare(filePath);
      if (data.clearedFiles.some(f => normalizeForCompare(f) === normalizedFilePath)) {
        logger.ui.info('[TabEditor] Pending tag cleared for this file, exiting diff mode:', filePath);

        // Clear pending tag ref
        setPendingAIEditTag(null);

        // Hide the diff approval bar and clear session info
        setShowMonacoDiffBar(false);
        setDiffSessionInfo(null);

        // Reload from disk to get the content that was kept (AI already wrote to disk)
        // This is needed for both Monaco and Lexical to sync editor content with disk
        window.electronAPI.readFileContent(filePath).then((result) => {
          if (result?.success && result.content !== undefined) {
            const newContent = result.content;
            contentRef.current = newContent;
            initialContentRef.current = newContent;
            lastSavedContentRef.current = newContent;
            isDirtyRef.current = false;
            onDirtyChange?.(false);

            if (isMarkdown && editorRef.current) {
              // For Lexical (markdown), we need to clear diff nodes and reload content
              const transformers = getEditorTransformers();
              editorRef.current?.update(() => {
                const root = $getRoot();
                root.clear();
                $convertFromEnhancedMarkdownString(newContent, transformers);
              }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });
            } else if (!isMarkdown && editorRef.current) {
              // For Monaco, exit diff mode and update content
              if (editorRef.current.exitDiffMode) {
                editorRef.current.exitDiffMode();
              }
              // Update Monaco editor content to match what's on disk
              if (editorRef.current.setContent) {
                editorRef.current.setContent(newContent, { force: true });
              }
            }
          }
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [filePath, isMarkdown]);

  // Handle conflict dialog actions
  const handleReloadFromDisk = useCallback(async () => {
    const newContent = conflictDialogContent;
    setShowConflictDialog(false);
    setConflictDialogContent('');

    // Apply the reload
    contentRef.current = newContent;
    initialContentRef.current = newContent;
    lastSavedContentRef.current = newContent;
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
  }, [conflictDialogContent, fileName, isMarkdown]);

  const handleKeepLocalChanges = useCallback(() => {
    setShowConflictDialog(false);
    setConflictDialogContent('');
  }, []);

  // Stable callback to get content for DocumentHeaderContainer
  // Uses refs to avoid recreating the callback and causing unnecessary re-renders
  const getDocumentHeaderContent = useCallback((): string => {
    return getContentFnRef.current?.() ?? '';
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

          // Update working copy ref and mark as dirty so autosave will persist
          contentRef.current = newContent;
          isDirtyRef.current = true;

          // Notify parent that content changed and is dirty
          onDirtyChange?.(true);
        } catch (error) {
          logger.ui.error(`[TabEditor] Failed to update content from document header:`, error);
        }
      })();
    }
  }, [isMarkdown]);

  // PHASE 5: Listen for diff approve/reject commands to update tag status
  useEffect(() => {
    if (!editorRef.current) return;

    const editor = editorRef.current;

    // NOTE: handleApprove and handleReject have been removed.
    // APPROVE_DIFF_COMMAND and REJECT_DIFF_COMMAND are now handled solely by DiffPlugin.
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

          // Advance the Codex cache so subsequent edits use the approved state as baseline
          window.electronAPI.invoke('ai:advance-diff-baseline', sessionId, filePath, approvedContent);

          // CRITICAL: Update pendingAIEditTagRef to point to the NEW incremental-approval tag
          // This ensures that when CLEAR_DIFF_TAG_COMMAND is dispatched later, it marks the correct tag as reviewed
          setPendingAIEditTag({
            tagId: newTagId,
            sessionId,
            filePath
          });

          // Update our state
          contentRef.current = approvedContent;
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

        const { tagId, sessionId: clearSessionId, filePath } = pendingAIEditTagRef.current;
        logger.ui.info('[TabEditor] handleClearDiffTag START:', { tagId, filePath });

        // CRITICAL: Mark tag as reviewed BEFORE saving to disk
        // This prevents the file watcher from re-entering diff mode when it detects the save
        logger.ui.info('[TabEditor] About to call updateTagStatus:', { filePath, tagId, status: 'reviewed' });
        await window.electronAPI.history.updateTagStatus(filePath, tagId, 'reviewed', workspaceId);
        logger.ui.info(`[TabEditor] Successfully marked AI edit tag as reviewed: ${tagId}`);

        // Clear the pending tag reference immediately so file watcher won't re-enter diff mode
        setPendingAIEditTag(null);

        // Now save current editor state to disk
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

            // Advance the Codex cache so subsequent AI edits diff against post-review state
            if (clearSessionId) {
              window.electronAPI.invoke('ai:advance-diff-baseline', clearSessionId, filePath, currentContent);
            }

            // Update our state
            contentRef.current = currentContent;
            initialContentRef.current = currentContent;
            lastSavedContentRef.current = currentContent;
          }

          // Reload editor to exit diff mode and show clean final state
          const result = await window.electronAPI.readFileContent(filePath);
          if (result && result.success) {
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
    // NOTE: APPROVE_DIFF_COMMAND and REJECT_DIFF_COMMAND are handled by DiffPlugin.
    // DiffPlugin dispatches CLEAR_DIFF_TAG_COMMAND when all diffs are processed.
    // handleClearDiffTag then saves the content to disk and clears the pending tag.
    // DO NOT clear pendingAIEditTagRef in these handlers - handleClearDiffTag needs it.

      // Handle APPROVE_DIFF_COMMAND - let DiffPlugin handle it
      const unregisterApprove = editor.registerCommand(
        APPROVE_DIFF_COMMAND,
        () => {
          // Let DiffPlugin handle the approval, then CLEAR_DIFF_TAG_COMMAND will save
          return false;
        },
        COMMAND_PRIORITY_LOW
      );

      // Handle REJECT_DIFF_COMMAND - let DiffPlugin handle it
      const unregisterReject = editor.registerCommand(
        REJECT_DIFF_COMMAND,
        () => {
          // Let DiffPlugin handle the rejection, then CLEAR_DIFF_TAG_COMMAND will save
          return false;
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
  }, [filePath, isEditorReady]);

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

      // Mark tag as reviewed (must pass filePath, tagId, status, workspacePath)
      if (window.electronAPI.history) {
        console.log('[TabEditor] About to call updateTagStatus', {
          filePath,
          tagId: pendingAIEditTagRef.current.tagId,
          status: 'reviewed',
          workspaceId
        });

        await window.electronAPI.history.updateTagStatus(
          filePath,
          pendingAIEditTagRef.current.tagId,
          'reviewed',
          workspaceId
        );

        console.log('[TabEditor] Successfully marked tag as reviewed');
      } else {
        console.warn('[TabEditor] No history API available');
      }

      // Create a history snapshot of the accepted content so future baseline
      // recovery (recoverBaselineFromHistory) finds it instead of older states.
      // Also advance the Codex FileSnapshotCache so subsequent AI edits diff
      // against the accepted state, not the pre-first-edit state.
      await window.electronAPI.invoke('history:create-snapshot', filePath, newContent, 'manual', 'Diff accepted');
      const acceptedSessionId = pendingAIEditTagRef.current?.sessionId;
      if (acceptedSessionId) {
        window.electronAPI.invoke('ai:advance-diff-baseline', acceptedSessionId, filePath, newContent);
      }

      // Exit diff mode
      console.log('[TabEditor] ABOUT TO EXIT DIFF MODE');
      editorRef.current.exitDiffMode();
      console.log('[TabEditor] EXIT DIFF MODE CALLED');

      // Clear pending tag ref
      setPendingAIEditTag(null);

      // Hide the diff approval bar and clear session info
      setShowMonacoDiffBar(false);
      setDiffSessionInfo(null);
      setMonacoDiffChangeCount(0);

      // Update content and saved state
      contentRef.current = newContent;
      lastSavedContentRef.current = newContent;
      isDirtyRef.current = false;

      // CRITICAL: Update Monaco editor's content after exiting diff mode
      // Without this, Monaco will revert to the old content when it switches back to normal mode
      // Use force: true because Monaco's disk tracker already has this content from acceptDiff()
      if (editorRef.current.setContent) {
        console.log('[TabEditor] Updating Monaco editor content after diff acceptance');
        editorRef.current.setContent(newContent, { force: true });
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

      // Mark tag as reviewed (must pass filePath, tagId, status, workspacePath)
      if (window.electronAPI.history) {
        await window.electronAPI.history.updateTagStatus(
          filePath,
          pendingAIEditTagRef.current.tagId,
          'reviewed',
          workspaceId
        );
      }

      // Create a history snapshot of the rejected-to (original) content and advance
      // the Codex cache so subsequent AI edits diff against the post-rejection state.
      await window.electronAPI.invoke('history:create-snapshot', filePath, oldContent, 'manual', 'Diff rejected');
      const rejectedSessionId = pendingAIEditTagRef.current?.sessionId;
      if (rejectedSessionId) {
        window.electronAPI.invoke('ai:advance-diff-baseline', rejectedSessionId, filePath, oldContent);
      }

      // Exit diff mode
      editorRef.current.exitDiffMode();

      // Clear pending tag ref
      setPendingAIEditTag(null);

      // Hide the diff approval bar and clear session info
      setShowMonacoDiffBar(false);
      setDiffSessionInfo(null);
      setMonacoDiffChangeCount(0);

      // Update content and saved state
      contentRef.current = oldContent;
      lastSavedContentRef.current = oldContent;
      isDirtyRef.current = false;

      // CRITICAL: Update Monaco editor's content after exiting diff mode
      // Without this, Monaco will show the modified content when it switches back to normal mode
      // Use force: true because Monaco's disk tracker already has this content from rejectDiff()
      if (editorRef.current.setContent) {
        editorRef.current.setContent(oldContent, { force: true });
      }

      logger.ui.info('[TabEditor] Monaco diff rejected successfully');
    } catch (error) {
      logger.ui.error('[TabEditor] Error rejecting Monaco diff:', error);
    }
  }, [filePath]);

  // Custom editor diff mode accept/reject handlers
  const handleCustomEditorDiffAccept = useCallback(async () => {
    if (!pendingAIEditTagRef.current) {
      logger.ui.warn('[TabEditor] Cannot accept custom editor diff - no pending tag');
      return;
    }

    try {
      logger.ui.info('[TabEditor] Accepting custom editor diff', {
        tagId: pendingAIEditTagRef.current.tagId,
        filePath
      });

      // The custom editor already has the modified content displayed
      // We just need to save it (it's already on disk from the AI edit)
      // and mark the tag as reviewed

      // Mark tag as reviewed
      if (window.electronAPI.history) {
        await window.electronAPI.history.updateTagStatus(
          filePath,
          pendingAIEditTagRef.current.tagId,
          'reviewed',
          workspaceId
        );
      }

      // Read current disk content to snapshot and advance cache baseline
      const currentResult = await window.electronAPI.readFileContent(filePath);
      if (currentResult?.success && currentResult.content) {
        await window.electronAPI.invoke('history:create-snapshot', filePath, currentResult.content, 'manual', 'Diff accepted');
        const acceptedSessionId = pendingAIEditTagRef.current?.sessionId;
        if (acceptedSessionId) {
          window.electronAPI.invoke('ai:advance-diff-baseline', acceptedSessionId, filePath, currentResult.content);
        }
      }

      // Clear pending tag ref
      setPendingAIEditTag(null);

      // Hide the diff approval bar and clear session info
      setShowCustomEditorDiffBar(false);
      setDiffSessionInfo(null);

      // Notify the custom editor that diff mode has ended
      // The editor will reload content from disk via host.loadContent()
      diffClearedCallbackRef.current?.();

      logger.ui.info('[TabEditor] Custom editor diff accepted successfully');
    } catch (error) {
      logger.ui.error('[TabEditor] Error accepting custom editor diff:', error);
    }
  }, [filePath, workspaceId]);

  const handleCustomEditorDiffReject = useCallback(async () => {
    if (!pendingAIEditTagRef.current) {
      logger.ui.warn('[TabEditor] Cannot reject custom editor diff - no pending tag');
      return;
    }

    try {
      logger.ui.info('[TabEditor] Rejecting custom editor diff');

      // Get the original content from the pending tag
      const baseline = await window.electronAPI.invoke('history:get-diff-baseline', filePath);
      if (!baseline) {
        logger.ui.error('[TabEditor] Cannot reject - no baseline found');
        return;
      }

      // Write original content back to disk
      await window.electronAPI.saveFile(baseline.content, filePath);

      // Mark tag as reviewed
      if (window.electronAPI.history) {
        await window.electronAPI.history.updateTagStatus(
          filePath,
          pendingAIEditTagRef.current.tagId,
          'reviewed',
          workspaceId
        );
      }

      // Snapshot the restored content and advance the Codex cache baseline
      await window.electronAPI.invoke('history:create-snapshot', filePath, baseline.content, 'manual', 'Diff rejected');
      const rejectedSessionId = pendingAIEditTagRef.current?.sessionId;
      if (rejectedSessionId) {
        window.electronAPI.invoke('ai:advance-diff-baseline', rejectedSessionId, filePath, baseline.content);
      }

      // Clear pending tag ref
      setPendingAIEditTag(null);

      // Hide the diff approval bar and clear session info
      setShowCustomEditorDiffBar(false);
      setDiffSessionInfo(null);

      // Notify the custom editor that diff mode has ended
      // The editor will reload content from disk via host.loadContent()
      diffClearedCallbackRef.current?.();

      logger.ui.info('[TabEditor] Custom editor diff rejected successfully');
    } catch (error) {
      logger.ui.error('[TabEditor] Error rejecting custom editor diff:', error);
    }
  }, [filePath, workspaceId]);

  // Create extension storage for custom editors
  // Uses the extension ID from the registered custom editor (if any)
  const extensionStorage = useMemo(() => {
    const extensionId = customEditorRegistration?.extensionId;
    if (!extensionId) {
      // Return a no-op storage for non-extension editors
      return {
        get: () => undefined,
        set: async () => {},
        delete: async () => {},
        getGlobal: () => undefined,
        setGlobal: async () => {},
        deleteGlobal: async () => {},
        getSecret: async () => undefined,
        setSecret: async () => {},
        deleteSecret: async () => {},
      };
    }
    return createExtensionStorage(extensionId);
  }, [customEditorRegistration?.extensionId]);

  // Create EditorHost for custom editors
  // This is memoized and uses refs for changing values to stay stable across renders
  // Only recreate when filePath or workspaceId changes (genuinely new file/workspace)
  const editorHost = useMemo<EditorHost>(() => {
    return createEditorHost({
      filePath,
      fileName,
      // Theme access via function - reads from ref so always current
      getTheme: () => themeRef.current,
      // Subscribe to theme changes
      subscribeToThemeChanges: (callback: (t: string) => void): (() => void) => {
        themeChangeCallbackRef.current = callback;
        return () => {
          themeChangeCallbackRef.current = null;
        };
      },
      // Use getter that accesses ref for value that can change but shouldn't recreate host
      get isActive() { return isActiveRef.current; },
      workspaceId,

      // Read file content from disk (text)
      readFile: async (path: string): Promise<string> => {
        // console.log('[TabEditor] readFile called for:', path);
        const result = await window.electronAPI.readFileContent(path);
        // console.log('[TabEditor] readFile result:', { success: result?.success, contentLength: result?.content?.length, first100: result?.content?.substring(0, 100) });
        if (!result || !result.success) return '';
        return result.content;
      },

      // Read file content from disk (binary)
      readBinaryFile: async (path: string): Promise<ArrayBuffer> => {
        const result = await window.electronAPI.readFileContent(path, { binary: true });
        if (!result || !result.success) {
          const errorMsg = result && !result.success ? result.error : 'Failed to read binary file';
          throw new Error(errorMsg);
        }
        // Convert base64 to ArrayBuffer
        const binaryString = atob(result.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
      },

      // Subscribe to file changes
      // The actual file watcher is handled by TabEditor's main effect
      // We just wire up the callback so it gets called when files change
      subscribeToFileChanges: (callback: (newContent: string) => void): (() => void) => {
        editorHostFileChangeCallbackRef.current = callback;
        return () => {
          editorHostFileChangeCallbackRef.current = null;
        };
      },

      // Report dirty state change
      onDirtyChange: (isDirty: boolean) => {
        if (isDirtyRef.current !== isDirty) {
          isDirtyRef.current = isDirty;
          // Update tab dirty indicator via DOM (no React state cascade)
          onDirtyChange?.(isDirty);
          // Update macOS window dirty indicator if this is the active tab
          if (isActive && window.electronAPI?.setDocumentEdited) {
            window.electronAPI.setDocumentEdited(isDirty);
          }
        }
      },

      // Save content to disk
      saveContent: async (content: string | ArrayBuffer): Promise<void> => {
        // CRITICAL: Update tracking refs BEFORE the await to prevent race conditions
        // with the file watcher. The file watcher can fire before saveFile returns,
        // so we need lastSaveTimeRef and lastSavedContentRef set beforehand.
        if (typeof content === 'string') {
          lastSavedContentRef.current = content;
        }
        lastSaveTimeRef.current = Date.now();

        // Write to disk
        if (typeof content === 'string') {
          await window.electronAPI.saveFile(content, filePath);
        } else {
          // TODO: Handle binary content
          throw new Error('Binary content saving not yet implemented');
        }

        // Create history snapshot
        if (window.electronAPI.history && typeof content === 'string') {
          await window.electronAPI.history.createSnapshot(filePath, content, 'auto-save', 'Auto-save');
        }

        // Mark clean
        isDirtyRef.current = false;
        onDirtyChange?.(false);
      },

      // Subscribe to save requests from host (autosave timer, manual save)
      subscribeToSaveRequests: (callback: () => void): (() => void) => {
        editorHostSaveRequestCallbackRef.current = callback;
        return () => {
          editorHostSaveRequestCallbackRef.current = null;
        };
      },

      // Open history dialog
      openHistory: () => {
        onViewHistoryRef.current?.();
      },

      // Subscribe to diff requests (optional - for editors that support diff mode)
      subscribeToDiffRequests: (callback: (config: DiffConfig) => void): (() => void) => {
        diffRequestCallbackRef.current = callback;
        return () => {
          diffRequestCallbackRef.current = null;
        };
      },

      // Report diff result
      reportDiffResult: async (result): Promise<void> => {
        if (!pendingAIEditTagRef.current) return;

        // Save the resulting content
        await window.electronAPI.saveFile(result.content, filePath);

        // Update tag status
        if (window.electronAPI.history) {
          await window.electronAPI.history.updateTagStatus(
            filePath,
            pendingAIEditTagRef.current.tagId,
            'reviewed',
            workspaceId
          );
        }

        // Clear pending tag
        setPendingAIEditTag(null);

        // Update state
        contentRef.current = result.content;
        lastSavedContentRef.current = result.content;
        isDirtyRef.current = false;
        onDirtyChange?.(false);
      },

      // Check if diff mode is active
      isDiffModeActive: () => {
        return pendingAIEditTagRef.current !== null;
      },

      // Subscribe to diff being cleared externally (accept/reject from unified header)
      subscribeToDiffCleared: (callback: () => void): (() => void) => {
        diffClearedCallbackRef.current = callback;
        return () => {
          diffClearedCallbackRef.current = null;
        };
      },

      // ============ SOURCE MODE ============
      // Unified source mode handling for both markdown and custom editors
      // Source mode = Monaco with raw content; Rich mode = Lexical or custom editor

      // Whether this editor supports source mode toggle (markdown or custom editors that declare it)
      get supportsSourceMode() { return supportsSourceModeRef.current; },

      // Toggle source mode - works for both markdown and custom editors
      toggleSourceMode: async () => {
        const currentlyInSourceMode = sourceModeRef.current;

        if (currentlyInSourceMode) {
          // Switching FROM source mode (Monaco) TO rich editor (Lexical or custom)
          // Save Monaco's content to disk first so rich editor loads fresh data
          if (getContentFnRef.current && isDirtyRef.current) {
            const monacoContent = getContentFnRef.current();
            logger.ui.info(`[TabEditor] Saving source mode content before switching to rich editor: ${fileName}`);
            await window.electronAPI.saveFile(monacoContent, filePath);
            // Update our tracking
            lastSavedContentRef.current = monacoContent;
            contentRef.current = monacoContent;
            isDirtyRef.current = false;
            onDirtyChange?.(false);
          }
          // Reload content from disk so rich editor has fresh data
          try {
            const result = await window.electronAPI.readFileContent(filePath);
            if (result && result.success) {
              contentRef.current = result.content;
              lastSavedContentRef.current = result.content;
            }
          } catch (error) {
            logger.ui.error(`[TabEditor] Failed to load content for rich editor: ${filePath}`, error);
          }
        } else {
          // Switching TO source mode (Monaco) FROM rich editor (Lexical or custom)
          // First, save rich editor's content if dirty
          if (isDirtyRef.current) {
            if (editorHostSaveRequestCallbackRef.current) {
              // Custom editor - use EditorHost callback
              logger.ui.info(`[TabEditor] Saving custom editor content before switching to source mode: ${fileName}`);
              editorHostSaveRequestCallbackRef.current();
            } else if (getContentFnRef.current) {
              // Lexical - use getContent function
              logger.ui.info(`[TabEditor] Saving Lexical content before switching to source mode: ${fileName}`);
              const lexicalContent = getContentFnRef.current();
              await window.electronAPI.saveFile(lexicalContent, filePath);
              lastSavedContentRef.current = lexicalContent;
              contentRef.current = lexicalContent;
              isDirtyRef.current = false;
              onDirtyChange?.(false);
            }
            // Give the save a moment to complete
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          // Reload content from disk so Monaco has fresh data
          try {
            const result = await window.electronAPI.readFileContent(filePath);
            if (result && result.success) {
              contentRef.current = result.content;
              lastSavedContentRef.current = result.content;
            }
          } catch (error) {
            logger.ui.error(`[TabEditor] Failed to load content for source mode: ${filePath}`, error);
          }
        }

        // Reset editor ready state so the pending diff check can run after new editor mounts
        setIsEditorReady(false);
        // Reset the pending tags check flag so it runs again after the new editor mounts
        hasCheckedForPendingTagsRef.current = false;
        setSourceMode(!currentlyInSourceMode);
        // Notify subscribers
        sourceModeChangedCallbackRef.current?.(!currentlyInSourceMode);
      },

      // Subscribe to source mode changes
      subscribeToSourceModeChanges: (callback: (isSourceMode: boolean) => void): (() => void) => {
        sourceModeChangedCallbackRef.current = callback;
        return () => {
          sourceModeChangedCallbackRef.current = null;
        };
      },

      // Check if source mode is active
      isSourceModeActive: () => {
        return sourceModeRef.current;
      },

      // ============ STORAGE ============
      storage: extensionStorage,

      // ============ MENU ITEMS ============
      onMenuItemsChanged: (items) => {
        setExtensionMenuItems(items);
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, fileName, workspaceId, extensionStorage]); // Recreate when file, workspace, or storage changes (theme accessed via themeRef)

  // Register manual save function for custom editors
  // This ensures saveTabById works when closing dirty custom editor tabs
  // Skip when in source mode - Monaco handles its own save registration
  useEffect(() => {
    if (!isCustom || !onManualSaveReady || sourceMode) return;

    // Register a save function that triggers the EditorHost callback
    const customEditorSave = async () => {
      if (editorHostSaveRequestCallbackRef.current) {
        logger.ui.info(`[TabEditor] Triggering custom editor save on close: ${fileName}`);
        await editorHostSaveRequestCallbackRef.current();
      }
    };
    onManualSaveReady(customEditorSave);
  }, [isCustom, onManualSaveReady, fileName, sourceMode]);

  // Note: isActive prop is always true (visibility controlled by parent wrapper)
  // The parent sets display:none on the wrapper for inactive tabs
  // So we don't use isActive for styling - we're always "active" when visible
  return (
      <div
          className="tab-editor multi-editor-instance flex flex-col h-full overflow-hidden relative"
          data-file-path={filePath}
      >
        <UnifiedEditorHeaderBar
          filePath={filePath}
          fileName={fileName}
          workspaceId={workspaceId}
          isMarkdown={isMarkdown}
          isCustomEditor={isCustom}
          extensionId={customEditorRegistration?.extensionId}
          lexicalEditor={isMarkdown && !sourceMode ? editorRef.current : undefined}
          onViewHistory={onViewHistory}
          onToggleSourceMode={() => editorHost.toggleSourceMode?.()}
          supportsSourceMode={isMarkdown || customEditorSupportsSourceMode}
          isSourceModeActive={sourceMode}
          onDirtyChange={(isDirty) => {
            isDirtyRef.current = isDirty;
            onDirtyChange?.(isDirty);
          }}
          onSwitchToAgentMode={onSwitchToAgentMode}
          onOpenSessionInChat={onOpenSessionInChat}
          extensionMenuItems={extensionMenuItems}
          onToggleDebugTree={() => setShowTreeView(prev => !prev)}
          onContentChanged={() => setReloadVersion(v => v + 1)}
        />
        <FixedTabHeaderContainer
          filePath={filePath}
          fileName={fileName}
          editor={editorRef.current}
        />
          {isCustom ? (() => {
            // Source mode: render Monaco instead of custom editor
            if (sourceMode) {
              return (
                <>
                  <div className="custom-editor-source-toolbar py-2 px-4 border-b border-nim flex justify-end items-center gap-2 bg-nim-secondary">
                    <span className="mr-auto text-[13px] text-nim-muted">
                      Source Mode
                    </span>
                    <button
                      onClick={() => editorHost.toggleSourceMode?.()}
                      className="py-1 px-3 text-[13px] cursor-pointer bg-nim border border-nim rounded text-nim"
                    >
                      Editor
                    </button>
                  </div>
                  <MonacoEditor
                    key={`${filePath}-source`}
                    host={editorHost}
                    fileName={fileName}
                    config={{
                      theme,
                      extensionThemeId: themeId,
                      isActive,
                    }}
                    onGetContent={(getContentFn) => {
                      getContentFnRef.current = getContentFn;
                      if (onGetContentReady) {
                        onGetContentReady(getContentFn);
                      }
                      if (onManualSaveReady) {
                        onManualSaveReady(handleManualSave);
                      }
                    }}
                    onEditorReady={(editorWrapper) => {
                      editorRef.current = editorWrapper;
                      setIsEditorReady(true);
                    }}
                  />
                </>
              );
            }

            // Render custom editor if one is registered for this file type
            // Check for compound extensions like .mockup.html
            const lastDot = filePath.lastIndexOf('.');
            let registration = null;

            if (lastDot > 0) {
              // Try single extension first
              const singleExt = filePath.substring(lastDot).toLowerCase();
              registration = customEditorRegistry.getRegistration(singleExt);

              // Try compound extension if single didn't match
              if (!registration) {
                const secondLastDot = filePath.lastIndexOf('.', lastDot - 1);
                if (secondLastDot > 0) {
                  const compoundExt = filePath.substring(secondLastDot).toLowerCase();
                  registration = customEditorRegistry.getRegistration(compoundExt);
                }
              }
            }

            if (registration) {
              // Mark editor as ready when custom editor mounts
              // The editor will call host.loadContent() on mount
              if (!isEditorReady) {
                setIsEditorReady(true);
              }

              // Wrap extension-provided editors with protection
              // Built-in editors (no extensionId) are rendered directly
              if (registration.extensionId) {
                return (
                  <div className="custom-editor-container flex flex-col flex-1 min-h-0 overflow-hidden">
                    <DocumentHeaderContainer
                      filePath={filePath}
                      fileName={fileName}
                      getContent={getDocumentHeaderContent}
                      contentVersion={reloadVersion}
                      onContentChange={handleDocumentHeaderContentChange}
                    />
                    {showCustomEditorDiffBar && (
                      <UnifiedDiffHeader
                        filePath={filePath}
                        fileName={fileName}
                        capabilities={{
                          onAcceptAll: handleCustomEditorDiffAccept,
                          onRejectAll: handleCustomEditorDiffReject,
                        }}
                        sessionInfo={diffSessionInfo || undefined}
                        onGoToSession={onOpenSessionInChat ? handleGoToSession : undefined}
                        editorType="custom"
                      />
                    )}
                    <CustomEditorWrapper
                      key={filePath}
                      component={registration.component}
                      host={editorHost}
                      extensionId={registration.extensionId}
                      componentName={registration.componentName}
                    />
                  </div>
                );
              }

              // Built-in custom editors (e.g., mockup editor) rendered directly
              const CustomEditor = registration.component;
              return (
                <div className="custom-editor-container flex flex-col flex-1 min-h-0 overflow-hidden">
                  <DocumentHeaderContainer
                    filePath={filePath}
                    fileName={fileName}
                    getContent={getDocumentHeaderContent}
                    contentVersion={reloadVersion}
                    onContentChange={handleDocumentHeaderContentChange}
                  />
                  {showCustomEditorDiffBar && (
                    <UnifiedDiffHeader
                      filePath={filePath}
                      fileName={fileName}
                      capabilities={{
                        onAcceptAll: handleCustomEditorDiffAccept,
                        onRejectAll: handleCustomEditorDiffReject,
                      }}
                      sessionInfo={diffSessionInfo || undefined}
                      onGoToSession={onOpenSessionInChat ? handleGoToSession : undefined}
                      editorType="custom"
                    />
                  )}
                  <CustomEditor
                    key={filePath}
                    host={editorHost}
                  />
                </div>
              );
            }

            // Fallback if custom editor is not found (shouldn't happen)
            const fileExt = filePath.substring(filePath.lastIndexOf('.'));
            return (
              <div className="p-5 text-nim">
                <p>No custom editor found for file type: {fileExt}</p>
              </div>
            );
          })() : isImage ? (
            <ImageViewer
              key={filePath}
              filePath={filePath}
              fileName={fileName}
            />
          ) : isMarkdown && !sourceMode ? (
              <>
              <LexicalDiffHeaderAdapter
                editor={editorRef.current as any}
                filePath={filePath}
                fileName={fileName}
                sessionInfo={diffSessionInfo || undefined}
                onGoToSession={onOpenSessionInChat ? handleGoToSession : undefined}
              />
              <div className="tab-editor-wrapper flex-1 overflow-hidden relative">
              <DocumentPathProvider documentPath={filePath}>
                <MarkdownEditor
                  key={`${filePath}-lexical`}
                  host={editorHost}
                  config={{
                    theme,
                    onRenameDocument,
                    onSwitchToAgentMode,
                    onOpenSessionInChat,
                    onToggleMarkdownMode: () => editorHost.toggleSourceMode?.(),
                    onImageDoubleClick: handleImageDoubleClick,
                    onImageDragStart: handleImageDragStart,
                    showTreeView, // Debug tree view (dev mode)
                    documentHeader: (
                      <DocumentHeaderContainer
                        filePath={filePath}
                        fileName={fileName}
                        getContent={getDocumentHeaderContent}
                        contentVersion={reloadVersion}
                        onContentChange={handleDocumentHeaderContentChange}
                        editor={editorRef.current}
                      />
                    ),
                  }}
                  onEditorReady={(editor) => {
                    editorRef.current = editor;
                    setIsEditorReady(true);
                    // Force FixedTabHeaderRegistry to re-evaluate after editor remounts
                    setTimeout(() => {
                      FixedTabHeaderRegistry.getInstance().notifyChange();
                    }, 150);
                    // Expose manual save function
                    if (onManualSaveReady) {
                      onManualSaveReady(handleManualSave);
                    }
                  }}
                  onGetContent={(getContentFn) => {
                    getContentFnRef.current = getContentFn;
                    if (onGetContentReady) {
                      onGetContentReady(getContentFn);
                    }
                  }}
                />
              </DocumentPathProvider>
              </div>
              </>
          ) : isMarkdown && sourceMode ? (
            <>
              <div className="monaco-markdown-toolbar py-2 px-4 border-b border-nim flex justify-end items-center gap-2 bg-nim-secondary">
                <span className="mr-auto text-[13px] text-nim-muted">
                  Source Mode
                </span>
                <button
                  onClick={() => editorHost.toggleSourceMode?.()}
                  className="py-1 px-3 text-[13px] cursor-pointer bg-nim border border-nim rounded text-nim"
                >
                  Rich Text
                </button>
              </div>
              <MonacoEditor
                key={`${filePath}-monaco`}
                host={editorHost}
                fileName={fileName}
                config={{
                  theme,
                  extensionThemeId: themeId,
                  isActive,
                }}
                onGetContent={(getContentFn) => {
                  getContentFnRef.current = getContentFn;
                  if (onGetContentReady) {
                    onGetContentReady(getContentFn);
                  }
                  // Expose the manual save function
                  if (onManualSaveReady) {
                    onManualSaveReady(handleManualSave);
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
              {!isMarkdown && (
                <DocumentHeaderContainer
                  filePath={filePath}
                  fileName={fileName}
                  getContent={getDocumentHeaderContent}
                  contentVersion={reloadVersion}
                  onContentChange={handleDocumentHeaderContentChange}
                />
              )}
              {!isMarkdown && showMonacoDiffBar && (
                <UnifiedDiffHeader
                  filePath={filePath}
                  fileName={fileName}
                  capabilities={{
                    onAcceptAll: handleMonacoDiffAccept,
                    onRejectAll: handleMonacoDiffReject,
                    changeGroups: monacoDiffChangeCount > 0 ? {
                      count: monacoDiffChangeCount,
                      currentIndex: null, // Monaco doesn't track current index reliably
                      onNavigatePrevious: () => editorRef.current?.goToPreviousDiff?.(),
                      onNavigateNext: () => editorRef.current?.goToNextDiff?.(),
                      // Monaco doesn't support per-change accept/reject
                      supportsPerChangeActions: false,
                    } : undefined,
                  }}
                  sessionInfo={diffSessionInfo || undefined}
                  onGoToSession={onOpenSessionInChat ? handleGoToSession : undefined}
                  editorType="monaco"
                />
              )}
              <MonacoEditor
                key={filePath}
                host={editorHost}
                fileName={fileName}
                config={{
                  theme,
                  extensionThemeId: themeId,
                  isActive,
                }}
                onGetContent={(getContentFn) => {
                  getContentFnRef.current = getContentFn;
                  if (onGetContentReady) {
                    onGetContentReady(getContentFn);
                  }
                  // Expose the manual save function
                  if (onManualSaveReady) {
                    onManualSaveReady(handleManualSave);
                  }
                }}
                onEditorReady={(editorWrapper) => {
                  // For Monaco, we get a wrapper with editor, setContent, getContent, showDiff, etc.
                  editorRef.current = editorWrapper;
                  setIsEditorReady(true);
                }}
                onDiffChangeCountUpdate={(count) => {
                  setMonacoDiffChangeCount(count);
                }}
              />
            </>
          )}


        {showConflictDialog && (
          <div
            className="file-conflict-dialog-overlay absolute inset-0 bg-black/50 flex items-center justify-center z-[1000]"
          >
            <div
              className="file-conflict-dialog bg-nim border border-nim rounded-lg p-6 max-w-[500px] shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
            >
              <h3 className="mt-0 text-nim">File Changed on Disk</h3>
              <p className="text-nim-muted">
                The file "{fileName}" has been changed on disk but you have unsaved changes.
              </p>
              <p className="text-nim-muted">
                Do you want to reload the file from disk and lose your changes?
              </p>
              <div className="flex gap-3 mt-6 justify-end">
                <button
                  onClick={handleKeepLocalChanges}
                  className="py-2 px-4 bg-nim-secondary border border-nim rounded text-nim cursor-pointer"
                >
                  Keep My Changes
                </button>
                <button
                  onClick={handleReloadFromDisk}
                  className="py-2 px-4 bg-nim-primary border-none rounded text-white cursor-pointer"
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
