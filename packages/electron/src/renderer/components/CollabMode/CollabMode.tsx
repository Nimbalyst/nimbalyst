/**
 * CollabMode - Shared Documents mode.
 *
 * Top-level mode for browsing and editing collaborative documents
 * shared with the team. Layout: sidebar (doc list) + main area (collab tabs).
 *
 * Follows the same always-mounted, CSS-display-toggled pattern as
 * EditorMode, AgentMode, and TrackerMode.
 */

import React, { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { store } from '@nimbalyst/runtime/store';
import { CollabSidebar } from './CollabSidebar';
import { TabsProvider, useTabsActions, useTabs } from '../../contexts/TabsContext';
import { TabManager } from '../TabManager/TabManager';
import { TabContent } from '../TabContent/TabContent';
import { ChatSidebar } from '../ChatSidebar';
import { openCollabDocumentViaIPC } from '../../utils/collabDocumentOpener';
import { initSharedDocuments, destroyTeamSync, pendingCollabDocumentAtom, sharedDocumentsAtom, type SharedDocument } from '../../store/atoms/collabDocuments';
import { isCollabUri, parseCollabUri } from '../../utils/collabUri';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { getCollabNodeName } from './collabTree';
import { errorNotificationService } from '../../services/ErrorNotificationService';

interface CollabModeProps {
  workspacePath: string;
  isActive: boolean;
  onFileOpen: (path: string) => void;
}

export const CollabMode: React.FC<CollabModeProps> = ({
  workspacePath,
  isActive,
  onFileOpen,
}) => {
  // Initialize shared documents sync from TeamRoom.
  // Retry when user activates collab mode, in case the initial attempt
  // failed (e.g., encryption key not yet available, admin hadn't shared keys).
  useEffect(() => {
    initSharedDocuments(workspacePath);
    return () => {
      destroyTeamSync();
    };
  }, [workspacePath]);

  useEffect(() => {
    if (isActive) {
      initSharedDocuments(workspacePath);
    }
  }, [isActive, workspacePath]);

  return (
    <TabsProvider workspacePath={workspacePath} disablePersistence>
      <CollabModeInner
        workspacePath={workspacePath}
        isActive={isActive}
        onFileOpen={onFileOpen}
      />
    </TabsProvider>
  );
};

// ---------------------------------------------------------------------------
// Persist open collab document IDs and layout in workspace state.
// ---------------------------------------------------------------------------

const COLLAB_SIDEBAR_DEFAULT = 220;
const COLLAB_SIDEBAR_MIN = 150;
const COLLAB_SIDEBAR_MAX = 400;
const COLLAB_CHAT_DEFAULT = 350;

interface CollabLayout {
  sidebarWidth: number;
  chatWidth: number;
}

/** Save the list of open collab document IDs to workspace state. */
async function persistOpenCollabDocs(workspacePath: string, documentIds: string[]): Promise<void> {
  try {
    await window.electronAPI?.invoke?.('workspace:update-state', workspacePath, {
      openCollabDocumentIds: documentIds,
    });
  } catch (err) {
    console.warn('[CollabMode] Failed to persist open collab docs:', err);
  }
}

/** Load the list of open collab document IDs from workspace state. */
async function loadOpenCollabDocs(workspacePath: string): Promise<string[]> {
  try {
    const state = await window.electronAPI?.invoke?.('workspace:get-state', workspacePath);
    return state?.openCollabDocumentIds ?? [];
  } catch {
    return [];
  }
}

let layoutPersistTimer: ReturnType<typeof setTimeout> | null = null;

/** Save collab layout to workspace state (debounced). */
function persistCollabLayout(workspacePath: string, layout: CollabLayout): void {
  if (layoutPersistTimer) clearTimeout(layoutPersistTimer);
  layoutPersistTimer = setTimeout(async () => {
    try {
      await window.electronAPI?.invoke?.('workspace:update-state', workspacePath, {
        collabLayout: layout,
      });
    } catch (err) {
      console.warn('[CollabMode] Failed to persist layout:', err);
    }
  }, 500);
}

/** Load collab layout from workspace state. */
async function loadCollabLayout(workspacePath: string): Promise<CollabLayout> {
  try {
    const state = await window.electronAPI?.invoke?.('workspace:get-state', workspacePath);
    return {
      sidebarWidth: state?.collabLayout?.sidebarWidth ?? COLLAB_SIDEBAR_DEFAULT,
      chatWidth: state?.collabLayout?.chatWidth ?? COLLAB_CHAT_DEFAULT,
    };
  } catch {
    return { sidebarWidth: COLLAB_SIDEBAR_DEFAULT, chatWidth: COLLAB_CHAT_DEFAULT };
  }
}

/**
 * Inner component that has access to TabsProvider context.
 */
const CollabModeInner: React.FC<CollabModeProps> = ({
  workspacePath,
  isActive,
  onFileOpen,
}) => {
  const tabsActions = useTabsActions();
  const { tabs, activeTabId } = useTabs();
  const pendingDoc = useAtomValue(pendingCollabDocumentAtom);
  const sharedDocuments = useAtomValue(sharedDocumentsAtom);
  const [restored, setRestored] = useState(false);

  // --- Resizable panel state ---
  const [sidebarWidth, setSidebarWidth] = useState(COLLAB_SIDEBAR_DEFAULT);
  const [chatWidth, setChatWidth] = useState(COLLAB_CHAT_DEFAULT);

  // Refs for sidebar resize drag (avoids re-renders during drag)
  const sidebarDragRef = useRef({ isDragging: false, startX: 0, startWidth: 0 });

  // Load persisted layout on mount
  useEffect(() => {
    let cancelled = false;
    loadCollabLayout(workspacePath).then((layout) => {
      if (cancelled) return;
      setSidebarWidth(layout.sidebarWidth);
      setChatWidth(layout.chatWidth);
    });
    return () => { cancelled = true; };
  }, [workspacePath]);

  // --- Sidebar resize handlers ---
  const handleSidebarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    sidebarDragRef.current = { isDragging: true, startX: e.clientX, startWidth: sidebarWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - sidebarDragRef.current.startX;
      const newWidth = Math.max(COLLAB_SIDEBAR_MIN, Math.min(COLLAB_SIDEBAR_MAX, sidebarDragRef.current.startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      sidebarDragRef.current.isDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      // Persist after drag ends
      setSidebarWidth((w) => {
        persistCollabLayout(workspacePath, { sidebarWidth: w, chatWidth });
        return w;
      });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [sidebarWidth, chatWidth, workspacePath]);

  // --- Chat sidebar resize handler (via ChatSidebar's onWidthChange) ---
  const handleChatWidthChange = useCallback((newWidth: number) => {
    setChatWidth(newWidth);
    persistCollabLayout(workspacePath, { sidebarWidth, chatWidth: newWidth });
  }, [workspacePath, sidebarWidth]);

  const handleDocumentSelect = useCallback(async (doc: SharedDocument, initialContent?: string) => {
    // Check if already open as a tab
    const existingTab = tabs.find((tab) => {
      if (!isCollabUri(tab.filePath)) return false;
      try {
        return parseCollabUri(tab.filePath).documentId === doc.documentId;
      } catch {
        return false;
      }
    });
    if (existingTab) {
      tabsActions.switchTab(existingTab.id);
      const nextName = getCollabNodeName(doc.title || doc.documentId);
      if (existingTab.fileName !== nextName) {
        tabsActions.updateTab(existingTab.id, { fileName: nextName });
      }
      return;
    }

    // Open as collab tab
    try {
      const tabId = await openCollabDocumentViaIPC({
        workspacePath,
        documentId: doc.documentId,
        title: doc.title,
        initialContent,
        addTab: tabsActions.addTab,
      });
      tabsActions.updateTab(tabId, { fileName: getCollabNodeName(doc.title || doc.documentId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[CollabMode] Failed to open shared document:', {
        documentId: doc.documentId,
        title: doc.title,
        error,
      });
      errorNotificationService.showError(
        'Failed to open shared document',
        message,
        { details: doc.title || doc.documentId }
      );
    }
  }, [workspacePath, tabs, tabsActions]);

  const activeCollabDocumentId = useMemo(() => {
    if (!activeTabId) return null;
    const activeTab = tabs.find(tab => tab.id === activeTabId);
    if (!activeTab || !isCollabUri(activeTab.filePath)) return null;

    try {
      return parseCollabUri(activeTab.filePath).documentId;
    } catch {
      return null;
    }
  }, [activeTabId, tabs]);

  useEffect(() => {
    for (const tab of tabs) {
      if (!isCollabUri(tab.filePath)) continue;

      let documentId: string;
      try {
        documentId = parseCollabUri(tab.filePath).documentId;
      } catch {
        continue;
      }

      const document = sharedDocuments.find(doc => doc.documentId === documentId);
      if (!document) continue;

      const nextName = getCollabNodeName(document.title || document.documentId);
      if (tab.fileName !== nextName) {
        tabsActions.updateTab(tab.id, { fileName: nextName });
      }
    }
  }, [sharedDocuments, tabs, tabsActions]);

  // Persist open document IDs whenever tabs change
  useEffect(() => {
    if (!restored) return; // Don't persist until we've finished restoring
    const docIds = tabs
      .filter(t => isCollabUri(t.filePath))
      .map(t => {
        try { return parseCollabUri(t.filePath).documentId; }
        catch { return null; }
      })
      .filter((id): id is string => id !== null);
    persistOpenCollabDocs(workspacePath, docIds);
  }, [tabs, workspacePath, restored]);

  // Restore previously open collab documents on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const savedDocIds = await loadOpenCollabDocs(workspacePath);
      if (cancelled || savedDocIds.length === 0) {
        setRestored(true);
        return;
      }

      // Open each saved document. We don't need to wait for sharedDocumentsAtom
      // because openCollabDocumentViaIPC resolves auth/keys via IPC directly.
      // Use the documentId as both documentId and title (title is only for display).
      for (const docId of savedDocIds) {
        if (cancelled) break;
        try {
          await openCollabDocumentViaIPC({
            workspacePath,
            documentId: docId,
            title: docId,
            addTab: tabsActions.addTab,
          });
        } catch (err) {
          console.warn('[CollabMode] Failed to restore collab document:', docId, err);
        }
      }
      setRestored(true);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]); // Only run on mount (tabsActions is stable ref-based)

  // Auto-open a pending document (set by "Share to Team" action)
  useEffect(() => {
    if (!pendingDoc || !isActive) return;

    // Find the document in the shared documents atom
    const docs = store.get(sharedDocumentsAtom);
    const doc = docs.find(d => d.documentId === pendingDoc.documentId);
    if (doc) {
      // Clear the pending flag before opening to avoid re-triggering
      store.set(pendingCollabDocumentAtom, null);
      handleDocumentSelect(doc, pendingDoc.initialContent);
    }
  }, [pendingDoc, isActive, handleDocumentSelect]);

  const handleTabClose = useCallback((tabId: string) => {
    tabsActions.removeTab(tabId);
  }, [tabsActions]);

  const hasTabs = tabs.length > 0;

  return (
    <div className="collab-mode flex-1 flex flex-row overflow-hidden min-h-0">
      {/* Left: Document sidebar (resizable) */}
      <div style={{ width: sidebarWidth, minWidth: COLLAB_SIDEBAR_MIN, maxWidth: COLLAB_SIDEBAR_MAX }} className="shrink-0">
        <CollabSidebar
          workspacePath={workspacePath}
          onDocumentSelect={handleDocumentSelect}
          activeDocumentId={activeCollabDocumentId}
        />
      </div>

      {/* Left resize handle */}
      <div
        onMouseDown={handleSidebarMouseDown}
        className="w-1 cursor-col-resize shrink-0 relative z-10 bg-nim-secondary"
      >
        <div className="w-0.5 h-full mx-auto bg-nim-border transition-colors duration-200 hover:bg-nim-accent" />
      </div>

      {/* Center: Tabs + editor */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {hasTabs ? (
          <TabManager
            onTabClose={handleTabClose}
            onNewTab={() => {}}
            isActive={isActive}
          >
            <TabContent
              onTabClose={handleTabClose}
            />
          </TabManager>
        ) : (
          /* Empty state when no tabs open */
          <div className="flex-1 flex items-center justify-center text-nim-muted">
            <div className="text-center">
              <MaterialSymbol icon="cloud_sync" size={48} className="text-nim-faint mb-3" />
              <p className="text-base m-0">Select a shared document</p>
              <p className="text-sm text-nim-faint mt-1 m-0">
                Choose a document from the sidebar to start collaborating
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Right: AI Chat sidebar (resizable via ChatSidebar built-in handle) */}
      {hasTabs && (
        <ChatSidebar
          workspacePath={workspacePath}
          onFileOpen={async (filePath) => onFileOpen(filePath)}
          width={chatWidth}
          onWidthChange={handleChatWidthChange}
        />
      )}
    </div>
  );
};
