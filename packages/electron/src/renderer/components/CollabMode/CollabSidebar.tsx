/**
 * CollabSidebar - Sidebar for the Shared Documents mode.
 *
 * Shows the list of documents that have been shared to the team,
 * synced in real-time from the TeamRoom Durable Object.
 * Clicking an item opens it as a collaborative tab in the main area.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { sharedDocumentsAtom, removeSharedDocument, type SharedDocument } from '../../store/atoms/collabDocuments';

interface CollabSidebarProps {
  onDocumentSelect: (doc: SharedDocument) => void;
  selectedDocumentId?: string | null;
}

export const CollabSidebar: React.FC<CollabSidebarProps> = ({
  onDocumentSelect,
  selectedDocumentId,
}) => {
  const sharedDocuments = useAtomValue(sharedDocumentsAtom);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; doc: SharedDocument } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu on click outside or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent, doc: SharedDocument) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, doc });
  }, []);

  const handleDelete = useCallback(() => {
    if (!contextMenu) return;
    const { doc } = contextMenu;
    if (window.confirm(`Delete shared document "${doc.title}"?`)) {
      removeSharedDocument(doc.documentId);
    }
    setContextMenu(null);
  }, [contextMenu]);

  const formatDate = useCallback((timestamp: number) => {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString();
    } catch {
      return '';
    }
  }, []);

  const iconForType = useCallback((documentType: string) => {
    switch (documentType) {
      case 'spreadsheet': return 'table_chart';
      case 'diagram': return 'draw';
      case 'code': return 'code';
      default: return 'description';
    }
  }, []);

  return (
    <div
      className="collab-sidebar w-full h-full flex flex-col bg-nim-secondary border-r border-nim overflow-hidden"
      data-testid="collab-sidebar"
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-nim">
        <h2 className="text-xs font-semibold text-nim-muted uppercase tracking-wider m-0">
          Shared Documents
        </h2>
      </div>

      {/* Document list */}
      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        {sharedDocuments.length === 0 ? (
          <div className="px-2 py-4 text-center">
            <MaterialSymbol icon="cloud_sync" size={32} className="text-nim-faint mb-2" />
            <p className="text-xs text-nim-faint m-0">
              No shared documents yet.
            </p>
            <p className="text-xs text-nim-faint mt-1 m-0">
              Right-click a file and select "Share to Team" to collaborate.
            </p>
          </div>
        ) : (
          sharedDocuments.map((doc) => (
            <button
              key={doc.documentId}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left ${
                selectedDocumentId === doc.documentId
                  ? 'bg-nim-active text-nim'
                  : 'text-nim-muted hover:bg-nim-tertiary hover:text-nim'
              }`}
              onClick={() => onDocumentSelect(doc)}
              onContextMenu={(e) => handleContextMenu(e, doc)}
              title={doc.title}
            >
              <MaterialSymbol icon={iconForType(doc.documentType)} size={16} className="shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="truncate">{doc.title}</div>
                <div className="text-[10px] text-nim-faint truncate">
                  {formatDate(doc.updatedAt)}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed p-1 min-w-[160px] rounded-md z-[10000] text-[13px] backdrop-blur-[10px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.5)]"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            background: 'var(--nim-bg)',
            border: '1px solid var(--nim-border)',
          }}
        >
          <div
            className="flex items-center gap-2.5 px-3 py-1.5 rounded cursor-pointer transition-colors text-[var(--nim-error)] hover:bg-[var(--nim-error-subtle)]"
            onClick={handleDelete}
          >
            <MaterialSymbol icon="delete" size={18} />
            <span>Delete</span>
          </div>
        </div>
      )}
    </div>
  );
};
