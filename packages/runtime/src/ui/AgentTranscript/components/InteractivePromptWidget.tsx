/**
 * Interactive Prompt Widget
 *
 * Renders interactive permission requests and ask user question prompts
 * directly in the transcript. These are persisted as special messages
 * and can be responded to from any device (desktop or mobile).
 *
 * This component handles:
 * - Permission requests (tool approval prompts)
 * - Ask user question requests
 * - Showing pending/resolved state
 * - Submitting responses that sync to the provider
 */

import React, { useState, useCallback } from 'react';
import type {
  PermissionRequestContent,
  PermissionResponseContent,
  AskUserQuestionRequestContent,
  AskUserQuestionResponseContent,
} from '../../../ai/server/types';
import './InteractivePromptWidget.css';

// ============================================================================
// Types
// ============================================================================

export interface InteractivePromptWidgetProps {
  /** The type of prompt */
  promptType: 'permission_request' | 'ask_user_question_request';
  /** The parsed prompt content */
  content: PermissionRequestContent | AskUserQuestionRequestContent;
  /** Callback when user submits a response */
  onSubmitResponse: (response: PermissionResponseContent | AskUserQuestionResponseContent) => void;
  /** Whether this is being rendered on mobile */
  isMobile?: boolean;
  /** Whether the prompt is being submitted */
  isSubmitting?: boolean;
}

// ============================================================================
// Permission Request Widget
// ============================================================================

interface PermissionRequestWidgetProps {
  content: PermissionRequestContent;
  onSubmit: (decision: 'allow' | 'deny', scope: 'once' | 'session' | 'always') => void;
  isSubmitting?: boolean;
}

const PermissionRequestWidget: React.FC<PermissionRequestWidgetProps> = ({
  content,
  onSubmit,
  isSubmitting,
}) => {
  const [showDetails, setShowDetails] = useState(false);

  if (content.status !== 'pending') {
    return (
      <div className="interactive-prompt interactive-prompt--resolved">
        <div className="interactive-prompt__header">
          <span className="interactive-prompt__icon interactive-prompt__icon--resolved">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M13 4L6 11L3 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
          <span className="interactive-prompt__title">Permission Resolved</span>
        </div>
        <div className="interactive-prompt__command">
          <code>{content.rawCommand || content.toolName}</code>
        </div>
      </div>
    );
  }

  return (
    <div className={`interactive-prompt interactive-prompt--pending ${content.isDestructive ? 'interactive-prompt--destructive' : ''}`}>
      <div className="interactive-prompt__header">
        <span className={`interactive-prompt__icon ${content.isDestructive ? 'interactive-prompt__icon--destructive' : ''}`}>
          {content.isDestructive ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 5.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M6.86 2.573L1.21 12.15c-.478.813.119 1.85 1.07 1.85h11.44c.951 0 1.548-1.037 1.07-1.85L9.14 2.573c-.477-.812-1.663-.812-2.14 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12.5 7H3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M5.5 4L3.5 7l2 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
          )}
        </span>
        <span className="interactive-prompt__title">Allow this tool?</span>
        <button
          className="interactive-prompt__details-toggle"
          onClick={() => setShowDetails(!showDetails)}
        >
          {showDetails ? 'Hide details' : 'Show details'}
        </button>
      </div>

      {/* Warnings */}
      {content.warnings && content.warnings.length > 0 && (
        <div className="interactive-prompt__warnings">
          {content.warnings.map((warning, i) => (
            <div key={i} className="interactive-prompt__warning">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M8 5.5v3M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}

      {/* Command */}
      <div className="interactive-prompt__command">
        <code>{content.rawCommand || content.toolName}</code>
      </div>

      {/* Details */}
      {showDetails && (
        <div className="interactive-prompt__details">
          <div className="interactive-prompt__detail-row">
            <span className="interactive-prompt__detail-label">Tool:</span>
            <span className="interactive-prompt__detail-value">{content.toolName}</span>
          </div>
          <div className="interactive-prompt__detail-row">
            <span className="interactive-prompt__detail-label">Pattern:</span>
            <span className="interactive-prompt__detail-value">{content.patternDisplayName}</span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="interactive-prompt__actions">
        <button
          className="interactive-prompt__button interactive-prompt__button--deny"
          onClick={() => onSubmit('deny', 'once')}
          disabled={isSubmitting}
        >
          Deny
        </button>
        <button
          className="interactive-prompt__button interactive-prompt__button--allow"
          onClick={() => onSubmit('allow', 'once')}
          disabled={isSubmitting}
        >
          Allow Once
        </button>
        <div className="interactive-prompt__separator" />
        <button
          className="interactive-prompt__button interactive-prompt__button--session"
          onClick={() => onSubmit('allow', 'session')}
          disabled={isSubmitting}
          title={`Allow ${content.patternDisplayName} for this session`}
        >
          Session
        </button>
        <button
          className="interactive-prompt__button interactive-prompt__button--always"
          onClick={() => onSubmit('allow', 'always')}
          disabled={isSubmitting}
          title={`Save ${content.patternDisplayName} to settings`}
        >
          Always
        </button>
      </div>

      {/* Pattern info */}
      <div className="interactive-prompt__pattern-info">
        Session/Always will allow: <span className="interactive-prompt__pattern-badge">{content.patternDisplayName}</span>
      </div>
    </div>
  );
};

// ============================================================================
// Ask User Question Widget
// ============================================================================

interface AskUserQuestionWidgetProps {
  content: AskUserQuestionRequestContent;
  onSubmit: (answers: Record<string, string>) => void;
  isSubmitting?: boolean;
}

const AskUserQuestionWidgetInteractive: React.FC<AskUserQuestionWidgetProps> = ({
  content,
  onSubmit,
  isSubmitting,
}) => {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const handleOptionSelect = useCallback((questionText: string, optionLabel: string, multiSelect: boolean) => {
    setAnswers(prev => {
      if (multiSelect) {
        const current = prev[questionText] || '';
        const selected = current.split(', ').filter(o => o.trim());
        const newSelected = selected.includes(optionLabel)
          ? selected.filter(o => o !== optionLabel)
          : [...selected, optionLabel];
        return { ...prev, [questionText]: newSelected.join(', ') };
      }
      return { ...prev, [questionText]: optionLabel };
    });
  }, []);

  const handleSubmit = useCallback(() => {
    onSubmit(answers);
  }, [answers, onSubmit]);

  const allAnswered = content.questions.every(q => answers[q.question]);

  if (content.status !== 'pending') {
    return (
      <div className="interactive-prompt interactive-prompt--resolved">
        <div className="interactive-prompt__header">
          <span className="interactive-prompt__icon interactive-prompt__icon--resolved">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M13 4L6 11L3 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
          <span className="interactive-prompt__title">Questions Answered</span>
        </div>
      </div>
    );
  }

  return (
    <div className="interactive-prompt interactive-prompt--pending interactive-prompt--question">
      <div className="interactive-prompt__header">
        <span className="interactive-prompt__icon">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M6.06 6a2 2 0 0 1 3.88.67c0 1.33-2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
        <span className="interactive-prompt__title">Claude has questions for you</span>
      </div>

      <div className="interactive-prompt__questions">
        {content.questions.map((question, qIndex) => (
          <div key={qIndex} className="interactive-prompt__question-card">
            <div className="interactive-prompt__question-header">
              <span className="interactive-prompt__question-chip">{question.header}</span>
              {question.multiSelect && (
                <span className="interactive-prompt__multi-hint">Select multiple</span>
              )}
            </div>
            <div className="interactive-prompt__question-text">
              {question.question}
            </div>
            <div className="interactive-prompt__options">
              {question.options.map((option, oIndex) => {
                const currentAnswer = answers[question.question] || '';
                const isSelected = question.multiSelect
                  ? currentAnswer.split(', ').includes(option.label)
                  : currentAnswer === option.label;

                return (
                  <button
                    key={oIndex}
                    className={`interactive-prompt__option ${isSelected ? 'interactive-prompt__option--selected' : ''}`}
                    onClick={() => handleOptionSelect(question.question, option.label, question.multiSelect)}
                    disabled={isSubmitting}
                  >
                    <div className={`interactive-prompt__option-indicator ${isSelected ? 'interactive-prompt__option-indicator--selected' : ''}`}>
                      {isSelected && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M8.5 2.5L3.75 7.25L1.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <div className="interactive-prompt__option-content">
                      <span className="interactive-prompt__option-label">{option.label}</span>
                      {option.description && (
                        <span className="interactive-prompt__option-description">{option.description}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="interactive-prompt__actions interactive-prompt__actions--centered">
        <button
          className="interactive-prompt__button interactive-prompt__button--submit"
          onClick={handleSubmit}
          disabled={isSubmitting || !allAnswered}
        >
          {isSubmitting ? 'Submitting...' : 'Submit Answers'}
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// Main Widget
// ============================================================================

export const InteractivePromptWidget: React.FC<InteractivePromptWidgetProps> = ({
  promptType,
  content,
  onSubmitResponse,
  isMobile = false,
  isSubmitting = false,
}) => {
  const handlePermissionSubmit = useCallback((decision: 'allow' | 'deny', scope: 'once' | 'session' | 'always') => {
    const permissionContent = content as PermissionRequestContent;
    const response: PermissionResponseContent = {
      type: 'permission_response',
      requestId: permissionContent.requestId,
      decision,
      scope,
      respondedAt: Date.now(),
      respondedBy: isMobile ? 'mobile' : 'desktop',
    };
    onSubmitResponse(response);
  }, [content, isMobile, onSubmitResponse]);

  const handleQuestionSubmit = useCallback((answers: Record<string, string>) => {
    const questionContent = content as AskUserQuestionRequestContent;
    const response: AskUserQuestionResponseContent = {
      type: 'ask_user_question_response',
      questionId: questionContent.questionId,
      answers,
      respondedAt: Date.now(),
      respondedBy: isMobile ? 'mobile' : 'desktop',
    };
    onSubmitResponse(response);
  }, [content, isMobile, onSubmitResponse]);

  if (promptType === 'permission_request') {
    return (
      <PermissionRequestWidget
        content={content as PermissionRequestContent}
        onSubmit={handlePermissionSubmit}
        isSubmitting={isSubmitting}
      />
    );
  }

  if (promptType === 'ask_user_question_request') {
    return (
      <AskUserQuestionWidgetInteractive
        content={content as AskUserQuestionRequestContent}
        onSubmit={handleQuestionSubmit}
        isSubmitting={isSubmitting}
      />
    );
  }

  return null;
};

export default InteractivePromptWidget;
