import React, { useState, useEffect, useCallback, useRef } from 'react';

export interface ExitPlanModeConfirmationData {
  requestId: string;
  sessionId: string;
  planSummary: string;
  planFilePath?: string;
  timestamp: number;
}

export interface ExitPlanModeResponse {
  approved: boolean;
  clearContext?: boolean;
  feedback?: string;
}

interface ExitPlanModeConfirmationProps {
  data: ExitPlanModeConfirmationData;
  workspacePath?: string;
  worktreeId?: string | null;
  onFileClick?: (filePath: string) => void;
  onApprove: (requestId: string, sessionId: string) => void;
  onStartNewSession: (requestId: string, sessionId: string, planFilePath: string) => void;
  onDeny: (requestId: string, sessionId: string, feedback?: string) => void;
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
  onStartNewSession,
  onDeny
}) => {
  // For worktree sessions, we need to fetch the worktree path
  const [worktreePath, setWorktreePath] = useState<string | null>(null);
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [feedback, setFeedback] = useState('');
  const feedbackInputRef = useRef<HTMLTextAreaElement>(null);

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

  useEffect(() => {
    if (showFeedbackInput && feedbackInputRef.current) {
      feedbackInputRef.current.focus();
    }
  }, [showFeedbackInput]);

  const handleStartNewSession = () => {
    if (data.planFilePath) {
      onStartNewSession(data.requestId, data.sessionId, data.planFilePath);
    } else {
      // Fallback to simple approve if no plan file
      onApprove(data.requestId, data.sessionId);
    }
  };

  const handleApprove = () => {
    onApprove(data.requestId, data.sessionId);
  };

  const handleShowFeedbackInput = () => {
    setShowFeedbackInput(true);
  };

  const handleSubmitFeedback = () => {
    if (feedback.trim()) {
      onDeny(data.requestId, data.sessionId, feedback.trim());
    }
  };

  const handleFeedbackKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmitFeedback();
    } else if (e.key === 'Escape') {
      setShowFeedbackInput(false);
      setFeedback('');
    }
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

      <div className="exit-plan-mode-confirmation-question mb-3 text-[13px] text-nim">
        Would you like to proceed?
      </div>

      <div className="exit-plan-mode-confirmation-actions flex flex-col gap-2">
        <button
          className="exit-plan-mode-confirmation-button w-full px-4 py-2 rounded-md text-[13px] font-medium cursor-pointer border border-nim transition-colors duration-150 hover:bg-nim-hover active:opacity-80 bg-nim-tertiary text-nim text-left"
          onClick={handleStartNewSession}
        >
          <span className="text-nim-muted mr-2">1.</span>
          Yes, start new session to implement
        </button>
        <button
          className="exit-plan-mode-confirmation-button w-full px-4 py-2 rounded-md text-[13px] font-medium cursor-pointer border border-nim transition-colors duration-150 hover:bg-nim-hover active:opacity-80 bg-nim-tertiary text-nim text-left"
          onClick={handleApprove}
        >
          <span className="text-nim-muted mr-2">2.</span>
          Yes
        </button>
        {!showFeedbackInput ? (
          <button
            className="exit-plan-mode-confirmation-button w-full px-4 py-2 rounded-md text-[13px] font-medium cursor-pointer border border-nim transition-colors duration-150 hover:bg-nim-hover active:opacity-80 bg-nim-tertiary text-nim text-left"
            onClick={handleShowFeedbackInput}
          >
            <span className="text-nim-muted mr-2">3.</span>
            Type here to tell Claude what to change
          </button>
        ) : (
          <div className="exit-plan-mode-feedback-container flex flex-col gap-2">
            <textarea
              ref={feedbackInputRef}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={handleFeedbackKeyDown}
              placeholder="Tell Claude what to change in the plan..."
              className="w-full px-3 py-2 rounded-md text-[13px] border border-nim bg-nim-tertiary text-nim placeholder:text-nim-muted resize-none focus:outline-none focus:border-nim-focus"
              rows={3}
            />
            <div className="flex gap-2 justify-end">
              <button
                className="px-3 py-1 rounded-md text-[12px] cursor-pointer border border-nim transition-colors duration-150 hover:bg-nim-hover bg-nim-tertiary text-nim-muted"
                onClick={() => {
                  setShowFeedbackInput(false);
                  setFeedback('');
                }}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1 rounded-md text-[12px] cursor-pointer border-none transition-colors duration-150 hover:opacity-90 bg-nim-primary text-white disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleSubmitFeedback}
                disabled={!feedback.trim()}
              >
                Send Feedback
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
