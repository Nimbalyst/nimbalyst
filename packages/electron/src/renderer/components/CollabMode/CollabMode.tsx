/**
 * CollabMode - Shared Documents mode.
 *
 * Top-level mode for browsing and editing collaborative documents
 * shared with the team. Layout: sidebar (doc list) + main area (collab tabs).
 *
 * Follows the same always-mounted, CSS-display-toggled pattern as
 * EditorMode, AgentMode, and TrackerMode.
 */

import React, { useCallback, useState, useEffect } from 'react';
import { useAtomValue } from 'jotai';
import { store } from '@nimbalyst/runtime/store';
import { CollabSidebar } from './CollabSidebar';
import { TabsProvider, useTabsActions, useTabs } from '../../contexts/TabsContext';
import { TabManager } from '../TabManager/TabManager';
import { TabContent } from '../TabContent/TabContent';
import { ChatSidebar } from '../ChatSidebar';
import { openCollabDocumentViaIPC } from '../../utils/collabDocumentOpener';
import { initSharedDocuments, destroyTeamSync, pendingCollabDocumentAtom, sharedDocumentsAtom, type SharedDocument } from '../../store/atoms/collabDocuments';
import { MaterialSymbol } from '@nimbalyst/runtime';

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
  // Initialize shared documents sync from TeamRoom
  useEffect(() => {
    initSharedDocuments(workspacePath);
    return () => {
      destroyTeamSync();
    };
  }, [workspacePath]);

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
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const pendingDocId = useAtomValue(pendingCollabDocumentAtom);

  const handleDocumentSelect = useCallback(async (doc: SharedDocument) => {
    setSelectedDocId(doc.documentId);

    // Check if already open as a tab
    const existingTab = tabs.find(
      t => t.filePath.includes(doc.documentId)
    );
    if (existingTab) {
      tabsActions.switchTab(existingTab.id);
      return;
    }

    // Open as collab tab
    await openCollabDocumentViaIPC({
      workspacePath,
      documentId: doc.documentId,
      title: doc.title,
      addTab: tabsActions.addTab,
    });
  }, [workspacePath, tabs, tabsActions]);

  // Auto-open a pending document (set by "Share to Team" action)
  useEffect(() => {
    if (!pendingDocId || !isActive) return;

    // Find the document in the shared documents atom
    const docs = store.get(sharedDocumentsAtom);
    const doc = docs.find(d => d.documentId === pendingDocId);
    if (doc) {
      // Clear the pending flag before opening to avoid re-triggering
      store.set(pendingCollabDocumentAtom, null);
      handleDocumentSelect(doc);
    }
  }, [pendingDocId, isActive, handleDocumentSelect]);

  const handleTabClose = useCallback((tabId: string) => {
    tabsActions.removeTab(tabId);
  }, [tabsActions]);

  const hasTabs = tabs.length > 0;

  return (
    <div className="collab-mode flex-1 flex flex-row overflow-hidden min-h-0">
      {/* Left: Document sidebar */}
      <CollabSidebar
        onDocumentSelect={handleDocumentSelect}
        selectedDocumentId={selectedDocId}
      />

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

      {/* Right: AI Chat sidebar */}
      {hasTabs && (
        <div className="w-[350px] min-w-[280px] max-w-[500px] flex flex-col border-l border-nim overflow-hidden">
          <ChatSidebar
            workspacePath={workspacePath}
            onFileOpen={async (filePath) => onFileOpen(filePath)}
          />
        </div>
      )}
    </div>
  );
};
