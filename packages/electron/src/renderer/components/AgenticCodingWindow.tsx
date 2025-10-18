import React from 'react';
import { AgenticPanel } from './UnifiedAI';

interface AgenticCodingWindowProps {
  sessionId?: string;
  workspacePath: string;
  planDocumentPath?: string;
}

/**
 * AgenticCodingWindow - Separate window for agentic coding sessions
 *
 * This is a thin wrapper around AgenticPanel configured for agent mode.
 * Used when opening agentic coding in a separate window (vs integrated in main window).
 */
export const AgenticCodingWindow: React.FC<AgenticCodingWindowProps> = ({
  sessionId,
  workspacePath,
  planDocumentPath
}) => {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AgenticPanel
        mode="agent"
        workspacePath={workspacePath}
        initialSessionId={sessionId}
        planDocumentPath={planDocumentPath}
      />
    </div>
  );
};
