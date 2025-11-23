import React from 'react';
import './ExitPlanModeConfirmation.css';

export interface ExitPlanModeConfirmationData {
  requestId: string;
  sessionId: string;
  planSummary: string;
  timestamp: number;
}

interface ExitPlanModeConfirmationProps {
  data: ExitPlanModeConfirmationData;
  onApprove: (requestId: string, sessionId: string) => void;
  onDeny: (requestId: string, sessionId: string) => void;
}

/**
 * Inline confirmation component shown in transcript when agent requests to exit plan mode.
 * Allows user to approve (start coding) or deny (continue planning).
 */
export const ExitPlanModeConfirmation: React.FC<ExitPlanModeConfirmationProps> = ({
  data,
  onApprove,
  onDeny
}) => {
  const handleApprove = () => {
    onApprove(data.requestId, data.sessionId);
  };

  const handleDeny = () => {
    onDeny(data.requestId, data.sessionId);
  };

  return (
    <div className="exit-plan-mode-confirmation">
      <div className="exit-plan-mode-confirmation-header">
        <span className="exit-plan-mode-confirmation-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12.5a5.5 5.5 0 110-11 5.5 5.5 0 010 11z"/>
            <path d="M8 4a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 4zm0 6a1 1 0 100 2 1 1 0 000-2z"/>
          </svg>
        </span>
        <span className="exit-plan-mode-confirmation-title">
          Ready to exit planning mode?
        </span>
      </div>

      {data.planSummary && (
        <div className="exit-plan-mode-confirmation-plan">
          <div className="exit-plan-mode-confirmation-plan-label">Plan summary:</div>
          <div className="exit-plan-mode-confirmation-plan-content">
            {data.planSummary}
          </div>
        </div>
      )}

      <div className="exit-plan-mode-confirmation-actions">
        <button
          className="exit-plan-mode-confirmation-button exit-plan-mode-confirmation-button-primary"
          onClick={handleApprove}
        >
          Start Coding
        </button>
        <button
          className="exit-plan-mode-confirmation-button exit-plan-mode-confirmation-button-secondary"
          onClick={handleDeny}
        >
          Continue Planning
        </button>
      </div>
    </div>
  );
};
