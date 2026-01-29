/**
 * Custom widget for the AskUserQuestion tool (DISPLAY ONLY)
 *
 * This widget displays the questions and answers from a completed AskUserQuestion tool call.
 * The interactive answering happens via AskUserQuestionConfirmation in the electron package,
 * which is shown while the canUseTool callback is waiting for user input.
 *
 * Once the user answers and the tool completes, this widget displays:
 * - The questions that were asked
 * - The answers the user provided
 * - A "Questions Answered" status
 */

import React, { useEffect, useState } from 'react';
import type { CustomToolWidgetProps } from './index';

/**
 * Global store for AskUserQuestion answers.
 * Keyed by question text, stores the answer string.
 * This is populated when answers are submitted via the confirmation dialog.
 */
const askUserQuestionAnswersStore: Map<string, string> = new Map();

/**
 * Global store for pending AskUserQuestion questions.
 * Keyed by questionId, tracks questions waiting for user input.
 * This prevents the widget from rendering as "submitted" while the interactive
 * confirmation dialog is showing.
 */
const pendingQuestionsStore: Map<string, { sessionId: string; questionId: string }> = new Map();

/**
 * Register a pending question (called when ai:askUserQuestion event is received).
 */
export function registerPendingQuestion(questionId: string, sessionId: string): void {
  pendingQuestionsStore.set(questionId, { sessionId, questionId });
}

/**
 * Unregister a pending question (called when question is answered or cancelled).
 */
export function unregisterPendingQuestion(questionId: string): void {
  pendingQuestionsStore.delete(questionId);
}

/**
 * Check if a question is pending (waiting for user input).
 */
export function isQuestionPending(questionId: string): boolean {
  return pendingQuestionsStore.has(questionId);
}

/**
 * Check if a session has any pending questions.
 */
export function sessionHasPendingQuestion(sessionId: string): boolean {
  for (const pending of pendingQuestionsStore.values()) {
    if (pending.sessionId === sessionId) {
      return true;
    }
  }
  return false;
}

/**
 * Store answers for AskUserQuestion.
 * Called from AISessionView when answers are submitted.
 */
export function storeAskUserQuestionAnswers(answers: Record<string, string>): void {
  for (const [question, answer] of Object.entries(answers)) {
    askUserQuestionAnswersStore.set(question, answer);
  }
}

/**
 * Get stored answer for a question.
 */
function getStoredAnswer(question: string): string | undefined {
  return askUserQuestionAnswersStore.get(question);
}

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

/**
 * Parse the tool arguments to extract questions
 */
function parseQuestions(args: any): Question[] {
  if (!args?.questions || !Array.isArray(args.questions)) {
    return [];
  }
  return args.questions;
}

/**
 * Parse existing answers from tool input or result
 * The answers may be in:
 * 1. tool.arguments.answers (if SDK updated the input)
 * 2. tool.result (if the tool returned the answers as its result)
 * 3. tool.result as a string like: 'User has answered: "question"="answer"'
 */
function parseAnswers(args: any, result: any): Record<string, string> {
  // First check arguments
  if (args?.answers && typeof args.answers === 'object') {
    return args.answers;
  }

  // Then check result - it might be a string or object
  if (result) {
    // If result is a string containing the answers
    if (typeof result === 'string') {
      // Try to parse JSON from result
      try {
        const parsed = JSON.parse(result);
        if (parsed?.answers && typeof parsed.answers === 'object') {
          return parsed.answers;
        }
      } catch {
        // Not JSON, try to parse the SDK's string format
        // Format: 'User has answered your questions: "question1"="answer1". ...'
        // or: '"question"="answer"'
        const answers: Record<string, string> = {};
        const regex = /"([^"]+)"="([^"]+)"/g;
        let match;
        while ((match = regex.exec(result)) !== null) {
          answers[match[1]] = match[2];
        }
        if (Object.keys(answers).length > 0) {
          return answers;
        }
      }
    }
    // If result is an object with answers
    if (typeof result === 'object' && result.answers) {
      return result.answers;
    }
  }

  return {};
}

/**
 * Check if an option is selected for a question
 */
function isOptionSelected(answer: string | undefined, optionLabel: string, multiSelect: boolean): boolean {
  if (!answer) return false;

  if (multiSelect) {
    const selectedOptions = answer.split(', ').filter(o => o.trim());
    return selectedOptions.includes(optionLabel);
  } else {
    return answer === optionLabel;
  }
}

export const AskUserQuestionWidget: React.FC<CustomToolWidgetProps> = ({
  message,
  sessionId,
}) => {
  // Force re-render when pending questions change
  const [, forceUpdate] = useState({});
  useEffect(() => {
    // Subscribe to changes in pending questions for this session
    // We use a simple polling approach since the global store doesn't have reactive updates
    const interval = setInterval(() => {
      forceUpdate({});
    }, 100);
    return () => clearInterval(interval);
  }, [sessionId]);

  const tool = message.toolCall;
  if (!tool) return null;

  const questions = parseQuestions(tool.arguments);

  // Check if this session has a pending question - if so, don't render the widget
  // The interactive AskUserQuestionConfirmation component handles the pending state
  if (sessionHasPendingQuestion(sessionId)) {
    return null;
  }

  // Try to get answers from multiple sources:
  // 1. tool.arguments.answers (if SDK updated the input)
  // 2. tool.result (if parsed from result string)
  // 3. Global store (populated when user submits via confirmation dialog)
  let answers = parseAnswers(tool.arguments, tool.result);

  // If no answers from tool data, check the global store
  if (Object.keys(answers).length === 0) {
    const storedAnswers: Record<string, string> = {};
    for (const q of questions) {
      const stored = getStoredAnswer(q.question);
      if (stored) {
        storedAnswers[q.question] = stored;
      }
    }
    if (Object.keys(storedAnswers).length > 0) {
      answers = storedAnswers;
    }
  }

  const hasAnswers = Object.keys(answers).length > 0;
  const hasResult = tool.result !== undefined && tool.result !== null && tool.result !== '';

  // Check if the question was cancelled
  // The result will contain "cancelled" or be an error when the user cancels
  const isCancelled = typeof tool.result === 'string' && (
    tool.result.toLowerCase().includes('cancelled') ||
    tool.result.toLowerCase().includes('canceled') ||
    tool.result.toLowerCase().includes('user cancelled')
  );

  // If no questions, show nothing
  if (questions.length === 0) {
    return null;
  }

  // Determine status based on whether we have answers or at least a result
  // hasResult indicates the tool completed even if we can't parse the answers
  const isCompleted = hasAnswers || hasResult;

  // Don't render the widget if the tool hasn't completed yet
  if (!isCompleted) {
    return null;
  }

  const statusText = isCancelled ? 'Question Cancelled' : 'Questions Answered';

  return (
    <div className={`ask-user-question-widget rounded-lg bg-nim-secondary border border-nim overflow-hidden ${isCompleted ? 'opacity-85' : ''}`}>
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
        {isCompleted && !isCancelled && (
          <span className="flex items-center gap-1 text-xs font-medium text-nim-success py-1 px-2 bg-[color-mix(in_srgb,var(--nim-success)_12%,transparent)] rounded-full">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Submitted
          </span>
        )}
        {isCancelled && (
          <span className="flex items-center gap-1 text-xs font-medium text-nim-muted py-1 px-2 bg-nim-tertiary rounded-full">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 3L3 9M3 3l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Cancelled
          </span>
        )}
      </div>

      <div className="p-3 flex flex-col gap-3">
        {questions.map((question, qIndex) => {
          const answer = answers[question.question];

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
                  const isSelected = isOptionSelected(answer, option.label, question.multiSelect);

                  return (
                    <div
                      key={oIndex}
                      className={`flex items-start gap-2 py-2 px-2.5 rounded border transition-all duration-150 cursor-default ${
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
              {/* Show selected answer summary if answered */}
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
};
