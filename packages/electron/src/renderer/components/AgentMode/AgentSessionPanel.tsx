/**
 * AgentSessionPanel - Fully encapsulated session view.
 *
 * This component owns ALL state for a single session:
 * - Session data (via sessionStoreAtom)
 * - Draft input (via sessionDraftInputAtom)
 * - Processing state (via sessionProcessingAtom)
 * - Queued prompts, todos, dialogs (local state)
 *
 * For the initial implementation, we delegate to SessionTranscript which already
 * has all the IPC handling and functionality. Later, we may merge the components
 * if needed for further optimization.
 */

import React, { useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { SessionTranscript, SessionTranscriptRef } from '../UnifiedAI/SessionTranscript';
import type { SerializableDocumentContext } from '../../hooks/useDocumentContext';
import { sessionRegistryAtom } from '../../store/atoms/sessions';
import { trackerItemByIdAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerDataAtoms';
import { setWindowModeAtom } from '../../store/atoms/windowMode';
import { setTrackerModeLayoutAtom } from '../../store/atoms/trackers';

export interface AgentSessionPanelRef {
  focusInput: () => void;
}

export interface AgentSessionPanelProps {
  sessionId: string;
  workspacePath: string;
  onFileClick?: (filePath: string) => void;
  onClearAgentSession?: () => void;
  onCreateWorktreeSession?: (worktreeId: string) => Promise<string | null>;
  /** Getter for document context from the workstream editor (for AI file/selection context) */
  getDocumentContext?: () => Promise<SerializableDocumentContext>;
  /** When true, collapse the transcript but keep input and dialogs visible */
  collapseTranscript?: boolean;
}

/**
 * AgentSessionPanel wraps SessionTranscript for now.
 *
 * The key encapsulation benefit is that this component is keyed by sessionId
 * and mounted/unmounted as sessions change. SessionTranscript already handles
 * all the atom subscriptions and IPC events for that session.
 */
export const AgentSessionPanel = forwardRef<AgentSessionPanelRef, AgentSessionPanelProps>(({
  sessionId,
  workspacePath,
  onFileClick,
  onClearAgentSession,
  onCreateWorktreeSession,
  getDocumentContext,
  collapseTranscript = false,
}, ref) => {
  const transcriptRef = useRef<SessionTranscriptRef>(null);

  // Expose focusInput through ref
  useImperativeHandle(ref, () => ({
    focusInput: () => {
      transcriptRef.current?.focusInput();
    },
  }), []);

  const handleFileClick = useCallback((filePath: string) => {
    if (onFileClick) {
      onFileClick(filePath);
    }
  }, [onFileClick]);

  return (
    <div
      className={`agent-session-panel flex flex-col overflow-hidden ${collapseTranscript ? '' : 'h-full min-h-0'}`}
      data-session-id={sessionId}
    >
      <LinkedTrackerBanner sessionId={sessionId} />
      <SessionTranscript
        ref={transcriptRef}
        sessionId={sessionId}
        workspacePath={workspacePath}
        mode="agent"
        hideSidebar={true}
        collapseTranscript={collapseTranscript}
        onFileClick={handleFileClick}
        onClearAgentSession={onClearAgentSession}
        onCreateWorktreeSession={onCreateWorktreeSession}
        getDocumentContext={getDocumentContext}
      />
    </div>
  );
});

AgentSessionPanel.displayName = 'AgentSessionPanel';

/** Shows linked tracker items and files as clickable badges above the transcript */
const LinkedTrackerBanner: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const sessionRegistry = useAtomValue(sessionRegistryAtom);
  const setWindowMode = useSetAtom(setWindowModeAtom);
  const setTrackerLayout = useSetAtom(setTrackerModeLayoutAtom);

  const session = sessionRegistry.get(sessionId);
  const linkedIds = session?.linkedTrackerItemIds;

  if (!linkedIds || linkedIds.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-nim bg-nim text-[11px] overflow-x-auto shrink-0">
      <MaterialSymbol icon="link" size={13} className="text-nim-faint shrink-0" />
      {linkedIds.map((id) => {
        if (id.startsWith('file:')) {
          const filePath = id.slice(5);
          const fileName = filePath.split('/').pop() || filePath;
          return (
            <button
              key={id}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium hover:brightness-125 transition-all cursor-pointer border-none"
              style={{ backgroundColor: '#7c3aed20', color: '#7c3aed' }}
              onClick={() => {
                // Switch to files mode and open the file
                setWindowMode('files');
                const documentService = (window as any).documentService;
                if (documentService?.getDocumentByPath && documentService?.openDocument) {
                  documentService.getDocumentByPath(filePath).then((doc: any) => {
                    if (doc) documentService.openDocument(doc.id);
                  });
                }
              }}
              title={`Open file: ${filePath}`}
            >
              <MaterialSymbol icon="description" size={11} />
              {fileName.replace(/\.(md|txt)$/, '')}
            </button>
          );
        }
        return (
          <TrackerItemBadge key={id} itemId={id} onNavigate={() => {
            setTrackerLayout({ selectedItemId: id });
            setWindowMode('tracker');
          }} />
        );
      })}
    </div>
  );
};

/** Single tracker item badge -- reads from atom for live title/type */
const TrackerItemBadge: React.FC<{ itemId: string; onNavigate: () => void }> = ({ itemId, onNavigate }) => {
  const item = useAtomValue(trackerItemByIdAtom(itemId));
  if (!item) return null;

  const TYPE_COLORS: Record<string, string> = {
    bug: '#dc2626', task: '#2563eb', plan: '#7c3aed', idea: '#ca8a04', decision: '#8b5cf6',
  };
  const color = TYPE_COLORS[item.type] || '#6b7280';

  return (
    <button
      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium hover:brightness-125 transition-all cursor-pointer border-none"
      style={{ backgroundColor: `${color}20`, color }}
      onClick={onNavigate}
      title={`View in Tracker: ${item.title}`}
    >
      {item.type}: {(item.title || 'Untitled').slice(0, 30)}{(item.title || '').length > 30 ? '...' : ''}
    </button>
  );
};
