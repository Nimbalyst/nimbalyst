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

import React, { useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { SessionTranscript, SessionTranscriptRef } from '../UnifiedAI/SessionTranscript';

export interface AgentSessionPanelRef {
  focusInput: () => void;
}

export interface AgentSessionPanelProps {
  sessionId: string;
  workspacePath: string;
  onFileClick?: (filePath: string) => void;
  onClearAgentSession?: () => void;
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
    <div className="agent-session-panel flex flex-col h-full min-h-0 overflow-hidden [&>div]:flex-1 [&>div]:min-h-0">
      <SessionTranscript
        ref={transcriptRef}
        sessionId={sessionId}
        workspacePath={workspacePath}
        mode="agent"
        hideSidebar={true}
        onFileClick={handleFileClick}
        onClearAgentSession={onClearAgentSession}
      />
    </div>
  );
});

AgentSessionPanel.displayName = 'AgentSessionPanel';
