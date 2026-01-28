import React, { useState, useEffect, useCallback } from 'react';

export interface ExitPlanModeConfirmationData {
  requestId: string;
  sessionId: string;
  planSummary: string;
  planFilePath?: string;
  timestamp: number;
}

interface ExitPlanModeConfirmationProps {
  data: ExitPlanModeConfirmationData;
  workspacePath?: string;
  worktreeId?: string | null;
  onFileClick?: (filePath: string) => void;
  onApprove: (requestId: string, sessionId: string) => void;
  onDeny: (requestId: string, sessionId: string) => void;
}

/**
 * Inline confirmation component shown in transcript when agent requests to exit plan mode.
 * Allows user to approve (start coding) or deny (continue planning).
 */
export const ExitPlanModeConfirmation: React.FC<ExitPlanModeConfirmationProps> = ({
  data,
  workspacePath,
  worktreeId,
  onFileClick,
  onApprove,
  onDeny
}) => {
  // For worktree sessions, we need to fetch the worktree path
  const [worktreePath, setWorktreePath] = useState<string | null>(null);

  useEffect(() => {
    if (!worktreeId) {
      setWorktreePath(null);
      return;
    }

    // Fetch worktree path from worktree ID
    window.electronAPI.invoke('worktree:get', worktreeId)
      .then((result: { success: boolean; worktree?: { path: string } }) => {
        if (result?.success && result.worktree?.path) {
          setWorktreePath(result.worktree.path);
        }
      })
      .catch((error: Error) => {
        console.error('[ExitPlanModeConfirmation] Failed to fetch worktree path:', error);
      });
  }, [worktreeId]);

  const handleApprove = () => {
    onApprove(data.requestId, data.sessionId);
  };

  const handleDeny = () => {
    onDeny(data.requestId, data.sessionId);
  };

  const handleOpenPlanFile = useCallback(() => {
    if (!data.planFilePath || !onFileClick) return;

    // Use worktree path if available, otherwise workspace path
    const basePath = worktreePath || workspacePath;
    if (!basePath) return;

    // Construct absolute path from base + relative plan file path
    // The planFilePath from the agent is relative (e.g., "plans/add-dark-mode.md")
    const absolutePath = data.planFilePath.startsWith('/')
      ? data.planFilePath
      : `${basePath}/${data.planFilePath}`;

    // Use the same file click handler as the files edited sidebar
    onFileClick(absolutePath);
  }, [data.planFilePath, worktreePath, workspacePath, onFileClick]);

  return (
    <div className="exit-plan-mode-confirmation mx-4 my-3 p-4 bg-nim-secondary border border-nim rounded-lg">
      <div className="exit-plan-mode-confirmation-header flex items-center gap-2 mb-3">
        <span className="exit-plan-mode-confirmation-icon flex items-center justify-center text-nim-accent">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12.5a5.5 5.5 0 110-11 5.5 5.5 0 010 11z"/>
            <path d="M8 4a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 4zm0 6a1 1 0 100 2 1 1 0 000-2z"/>
          </svg>
        </span>
        <span className="exit-plan-mode-confirmation-title font-semibold text-sm text-nim-primary">
          Ready to exit planning mode?
        </span>
      </div>

      {data.planFilePath && (
        <div className="exit-plan-mode-confirmation-file mb-3 p-2 bg-nim-tertiary rounded-md text-[13px]">
          <span className="text-nim-muted">Plan file: </span>
          <button
            onClick={handleOpenPlanFile}
            className="text-nim-link hover:text-nim-link-hover hover:underline cursor-pointer bg-transparent border-none p-0 font-mono text-[13px]"
          >
            {data.planFilePath}
          </button>
        </div>
      )}

      {data.planSummary && (
        <div className="exit-plan-mode-confirmation-plan mb-4 p-3 bg-nim-tertiary rounded-md text-[13px]">
          <div className="exit-plan-mode-confirmation-plan-label font-medium text-nim-muted mb-2">Plan summary:</div>
          <div className="exit-plan-mode-confirmation-plan-content text-nim-primary whitespace-pre-wrap max-h-[200px] overflow-y-auto">
            {data.planSummary}
          </div>
        </div>
      )}

      <div className="exit-plan-mode-confirmation-actions flex gap-2">
        <button
          className="exit-plan-mode-confirmation-button exit-plan-mode-confirmation-button-primary flex-1 px-4 py-2 rounded-md text-[13px] font-medium cursor-pointer border-none transition-opacity duration-150 hover:opacity-90 active:opacity-80 bg-nim-accent text-white"
          onClick={handleApprove}
        >
          Start Coding
        </button>
        <button
          className="exit-plan-mode-confirmation-button exit-plan-mode-confirmation-button-secondary flex-1 px-4 py-2 rounded-md text-[13px] font-medium cursor-pointer border border-nim transition-opacity duration-150 hover:opacity-90 hover:bg-nim-hover active:opacity-80 bg-nim-tertiary text-nim-primary"
          onClick={handleDeny}
        >
          Continue Planning
        </button>
      </div>
    </div>
  );
};
