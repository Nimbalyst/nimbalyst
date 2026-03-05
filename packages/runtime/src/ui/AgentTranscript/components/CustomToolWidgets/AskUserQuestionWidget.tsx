/**
 * AskUserQuestionWidget
 *
 * Interactive widget for the AskUserQuestion tool.
 * Renders questions from Claude and allows user to select answers.
 *
 * Uses InteractiveWidgetHost for operations that require access to atoms, callbacks, and analytics.
 * The host is read from interactiveWidgetHostAtom(sessionId) - no prop drilling needed.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import type { CustomToolWidgetProps } from './index';
import { interactiveWidgetHostAtom } from '../../../../store/atoms/interactiveWidgetHost';

// ============================================================
// Types
// ============================================================

interface QuestionOption {
  label: string;
  description: string;
}

interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

// ============================================================
// Helper Functions
// ============================================================

function parseQuestions(args: any): Question[] {
  if (!args?.questions || !Array.isArray(args.questions)) {
    return [];
  }
  return args.questions;
}

function parseAnswers(args: any, result: any): Record<string, string> {
  // Check arguments first
  if (args?.answers && typeof args.answers === 'object') {
    return args.answers;
  }

  const parseFromUnknown = (value: unknown): Record<string, string> => {
    if (!value) return {};

    if (typeof value === 'string') {
      try {
        return parseFromUnknown(JSON.parse(value));
      } catch {
        // Try SDK string format: "question"="answer"
        const answers: Record<string, string> = {};
        const regex = /"([^"]+)"="([^"]+)"/g;
        let match;
        while ((match = regex.exec(value)) !== null) {
          answers[match[1]] = match[2];
        }
        return answers;
      }
    }

    if (Array.isArray(value) || typeof value !== 'object') {
      return {};
    }

    const record = value as Record<string, unknown>;
    if (record.answers && typeof record.answers === 'object' && !Array.isArray(record.answers)) {
      const answers: Record<string, string> = {};
      for (const [key, rawValue] of Object.entries(record.answers as Record<string, unknown>)) {
        if (typeof rawValue === 'string') {
          answers[key] = rawValue;
        }
      }
      if (Object.keys(answers).length > 0) {
        return answers;
      }
    }

    if (record.result !== undefined) {
      const nested = parseFromUnknown(record.result);
      if (Object.keys(nested).length > 0) {
        return nested;
      }
    }

    if (record.content !== undefined) {
      const nested = parseFromUnknown(record.content);
      if (Object.keys(nested).length > 0) {
        return nested;
      }
    }

    if (record.text !== undefined) {
      const nested = parseFromUnknown(record.text);
      if (Object.keys(nested).length > 0) {
        return nested;
      }
    }

    return {};
  };

  const parsed = parseFromUnknown(result);
  if (Object.keys(parsed).length > 0) {
    return parsed;
  }

  return {};
}

function parseCancelledResult(result: unknown): boolean {
  if (!result) return false;

  if (typeof result === 'string') {
    try {
      return parseCancelledResult(JSON.parse(result));
    } catch {
      return result.toLowerCase().includes('cancelled') || result.toLowerCase().includes('canceled');
    }
  }

  if (Array.isArray(result) || typeof result !== 'object') {
    return false;
  }

  const record = result as Record<string, unknown>;
  if (record.cancelled === true || record.canceled === true) {
    return true;
  }

  if (record.result !== undefined && parseCancelledResult(record.result)) {
    return true;
  }

  if (record.content !== undefined && parseCancelledResult(record.content)) {
    return true;
  }

  if (record.text !== undefined && parseCancelledResult(record.text)) {
    return true;
  }

  return false;
}

// ============================================================
// Widget Component
// ============================================================

export const AskUserQuestionWidget: React.FC<CustomToolWidgetProps> = ({
  message,
  sessionId,
}) => {
  const toolCall = message.toolCall;
  if (!toolCall) return null;

  // Get host from atom (set by SessionTranscript)
  const host = useAtomValue(interactiveWidgetHostAtom(sessionId));

  const questions = parseQuestions(toolCall.arguments);
  const questionId = toolCall.id || '';

  // Parse result to determine completion state
  const rawResult = toolCall.result;
  const parsedAnswers = useMemo(() => parseAnswers(toolCall.arguments, rawResult), [toolCall.arguments, rawResult]);
  const hasResult = rawResult !== undefined && rawResult !== null && rawResult !== '';

  // Check if cancelled
  const isCancelled = useMemo(() => {
    return parseCancelledResult(rawResult);
  }, [rawResult]);

  const isCompleted = hasResult;
  const isPending = !isCompleted;

  // Local state for selections
  const [selections, setSelections] = useState<Record<string, string[]>>(() => {
    // Initialize from parsed answers if available
    const initial: Record<string, string[]> = {};
    for (const q of questions) {
      const answer = parsedAnswers[q.question];
      if (answer) {
        initial[q.question] = q.multiSelect ? answer.split(', ').filter(a => a.trim()) : [answer];
      } else {
        initial[q.question] = [];
      }
    }
    return initial;
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasResponded, setHasResponded] = useState(false);
  const [localResult, setLocalResult] = useState<{ answers: Record<string, string>; cancelled?: boolean } | null>(null);

  // Handle option toggle
  const handleOptionToggle = useCallback((question: Question, optionLabel: string) => {
    if (!isPending || hasResponded) return;

    setSelections(prev => {
      const current = prev[question.question] || [];
      if (question.multiSelect) {
        if (current.includes(optionLabel)) {
          return { ...prev, [question.question]: current.filter(o => o !== optionLabel) };
        } else {
          return { ...prev, [question.question]: [...current, optionLabel] };
        }
      } else {
        return { ...prev, [question.question]: [optionLabel] };
      }
    });
  }, [isPending, hasResponded]);

  // Handle submit
  const handleSubmit = useCallback(async () => {
    if (!host || hasResponded || !isPending) return;

    // Build answers object
    const answers: Record<string, string> = {};
    for (const q of questions) {
      const selected = selections[q.question] || [];
      if (selected.length > 0) {
        answers[q.question] = q.multiSelect ? selected.join(', ') : selected[0];
      }
    }

    // Validate all questions have answers
    const unanswered = questions.filter(q => !answers[q.question]);
    if (unanswered.length > 0) {
      // Don't submit if not all questions answered
      return;
    }

    setIsSubmitting(true);
    setLocalResult({ answers });
    setHasResponded(true);

    try {
      await host.askUserQuestionSubmit(questionId, answers);
    } catch (error) {
      console.error('[AskUserQuestionWidget] Failed to submit:', error);
      setLocalResult(null);
      setHasResponded(false);
    } finally {
      setIsSubmitting(false);
    }
  }, [host, questionId, questions, selections, hasResponded, isPending]);

  // Handle cancel
  const handleCancel = useCallback(async () => {
    if (!host || hasResponded || !isPending) return;

    setIsSubmitting(true);
    setLocalResult({ answers: {}, cancelled: true });
    setHasResponded(true);

    try {
      await host.askUserQuestionCancel(questionId);
    } catch (error) {
      console.error('[AskUserQuestionWidget] Failed to cancel:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [host, questionId, hasResponded, isPending]);

  // If no questions, show nothing
  if (questions.length === 0) {
    return null;
  }

  // Determine display result (local takes precedence while waiting)
  const displayResult = localResult || (isCompleted ? { answers: parsedAnswers, cancelled: isCancelled } : null);
  const displayAnswers = displayResult?.answers || {};
  const displayCancelled = displayResult?.cancelled || false;

  // Check if all questions have selections (for enabling submit button)
  const allAnswered = questions.every(q => (selections[q.question] || []).length > 0);

  // Show completed state
  if (displayResult || hasResponded) {
    const statusText = displayCancelled ? 'Question Cancelled' : 'Questions Answered';

    return (
      <div
        data-testid="ask-user-question-widget"
        data-state={displayCancelled ? 'cancelled' : 'completed'}
        className={`ask-user-question-widget rounded-lg bg-nim-secondary border border-nim overflow-hidden opacity-85`}
      >
        <div className="flex items-center gap-2 py-3 px-4 border-b border-nim bg-nim-tertiary">
          <div className="w-5 h-5 text-nim-primary shrink-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
              <path d="M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M6.06 6a2 2 0 0 1 3.88.67c0 1.33-2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="text-sm font-semibold text-nim flex-1">
            {statusText}
          </span>
          {!displayCancelled && (
            <span
              data-testid="ask-user-question-completed"
              className="flex items-center gap-1 text-xs font-medium text-nim-success py-1 px-2 bg-[color-mix(in_srgb,var(--nim-success)_12%,transparent)] rounded-full"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Submitted
            </span>
          )}
          {displayCancelled && (
            <span
              data-testid="ask-user-question-cancelled"
              className="flex items-center gap-1 text-xs font-medium text-nim-muted py-1 px-2 bg-nim-tertiary rounded-full"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 3L3 9M3 3l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Cancelled
            </span>
          )}
        </div>

        <div className="p-3 flex flex-col gap-3">
          {questions.map((question, qIndex) => {
            const answer = displayAnswers[question.question];

            return (
              <div key={qIndex} className="bg-nim border border-nim rounded-md p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-nim-primary bg-[color-mix(in_srgb,var(--nim-primary)_12%,transparent)] py-0.5 px-2 rounded-full">{question.header}</span>
                  {question.multiSelect && (
                    <span className="text-[0.6875rem] text-nim-faint italic">Multiple selection</span>
                  )}
                </div>
                <div className="text-sm text-nim leading-normal mb-3">
                  {question.question}
                </div>
                <div className="flex flex-col gap-1.5">
                  {question.options.map((option, oIndex) => {
                    const isSelected = question.multiSelect
                      ? (answer?.split(', ') || []).includes(option.label)
                      : answer === option.label;

                    return (
                      <div
                        key={oIndex}
                        className={`flex items-start gap-2 py-2 px-2.5 rounded border cursor-default ${
                          isSelected
                            ? 'border-nim-primary bg-[color-mix(in_srgb,var(--nim-primary)_8%,var(--nim-bg-secondary))]'
                            : 'border-nim bg-nim-secondary'
                        }`}
                      >
                        <div className={`w-4 h-4 mt-0.5 shrink-0 border rounded-sm flex items-center justify-center ${
                          isSelected
                            ? 'bg-nim-primary border-nim-primary text-white'
                            : 'bg-nim border-nim text-nim-primary'
                        }`}>
                          {isSelected && (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M8.5 2.5L3.75 7.25L1.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </div>
                        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                          <span className="text-[0.8125rem] font-medium text-nim leading-snug">{option.label}</span>
                          {option.description && (
                            <span className="text-xs text-nim-muted leading-snug">{option.description}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {answer && (
                  <div className="mt-2 pt-2 border-t border-nim text-xs text-nim-muted italic">
                    Selected: {answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // If no host available, show non-interactive pending state
  if (!host) {
    return (
      <div
        data-testid="ask-user-question-widget"
        data-state="pending"
        className="ask-user-question-widget rounded-lg bg-nim-secondary border border-nim-primary overflow-hidden"
      >
        <div className="flex items-center gap-2 py-3 px-4 bg-nim-tertiary">
          <div className="w-5 h-5 text-nim-primary shrink-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
              <path d="M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M6.06 6a2 2 0 0 1 3.88.67c0 1.33-2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="text-sm font-semibold text-nim flex-1">
            Questions from Claude
          </span>
          <span data-testid="ask-user-question-pending" className="text-xs text-nim-muted">Waiting...</span>
        </div>
      </div>
    );
  }

  // Show interactive UI for pending request
  return (
    <div
      data-testid="ask-user-question-widget"
      data-state="pending"
      className="ask-user-question-widget rounded-lg bg-nim-secondary border border-nim-primary overflow-hidden"
    >
      <div className="flex items-center gap-2 py-3 px-4 border-b border-nim bg-nim-tertiary">
        <div className="w-5 h-5 text-nim-primary shrink-0">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
            <path d="M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6.06 6a2 2 0 0 1 3.88.67c0 1.33-2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <span className="text-sm font-semibold text-nim flex-1">
          Questions from Claude
        </span>
      </div>

      <div className="p-3 flex flex-col gap-3">
        {questions.map((question, qIndex) => {
          const selectedOptions = selections[question.question] || [];

          return (
            <div key={qIndex} className="bg-nim border border-nim rounded-md p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-nim-primary bg-[color-mix(in_srgb,var(--nim-primary)_12%,transparent)] py-0.5 px-2 rounded-full">{question.header}</span>
                {question.multiSelect && (
                  <span className="text-[0.6875rem] text-nim-faint italic">Select multiple</span>
                )}
              </div>
              <div className="text-sm text-nim leading-normal mb-3">
                {question.question}
              </div>
              <div className="flex flex-col gap-1.5">
                {question.options.map((option, oIndex) => {
                  const isSelected = selectedOptions.includes(option.label);

                  return (
                    <button
                      key={oIndex}
                      type="button"
                      data-testid="ask-user-question-option"
                      data-option-label={option.label}
                      data-selected={isSelected}
                      onClick={() => handleOptionToggle(question, option.label)}
                      disabled={isSubmitting}
                      className={`flex items-start gap-2 py-2 px-2.5 rounded border transition-all duration-150 cursor-pointer text-left bg-transparent disabled:opacity-50 disabled:cursor-not-allowed ${
                        isSelected
                          ? 'border-nim-primary bg-[color-mix(in_srgb,var(--nim-primary)_8%,var(--nim-bg-secondary))]'
                          : 'border-nim bg-nim-secondary hover:bg-nim-hover'
                      }`}
                    >
                      <div className={`w-4 h-4 mt-0.5 shrink-0 border rounded-sm flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'bg-nim-primary border-nim-primary text-white'
                          : 'bg-nim border-nim text-nim-primary'
                      }`}>
                        {isSelected && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M8.5 2.5L3.75 7.25L1.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                        <span className="text-[0.8125rem] font-medium text-nim leading-snug">{option.label}</span>
                        {option.description && (
                          <span className="text-xs text-nim-muted leading-snug">{option.description}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Action buttons */}
        <div className="flex gap-2 justify-end pt-2 border-t border-nim">
          <button
            type="button"
            data-testid="ask-user-question-cancel"
            onClick={handleCancel}
            disabled={isSubmitting}
            className="px-3 py-1.5 rounded-md text-[13px] cursor-pointer border border-nim transition-colors duration-150 hover:bg-nim-hover bg-nim-tertiary text-nim-muted disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="ask-user-question-submit"
            onClick={handleSubmit}
            disabled={!allAnswered || isSubmitting}
            className="px-4 py-1.5 rounded-md text-[13px] font-medium cursor-pointer border-none transition-colors duration-150 hover:opacity-90 bg-nim-primary text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
};
