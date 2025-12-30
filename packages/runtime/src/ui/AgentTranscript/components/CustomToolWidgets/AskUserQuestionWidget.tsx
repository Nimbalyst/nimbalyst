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
import './AskUserQuestionWidget.css';

/**
 * Global store for AskUserQuestion answers.
 * Keyed by question text, stores the answer string.
 * This is populated when answers are submitted via the confirmation dialog.
 */
const askUserQuestionAnswersStore: Map<string, string> = new Map();

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
}) => {
  const tool = message.toolCall;
  if (!tool) return null;

  const questions = parseQuestions(tool.arguments);

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
  // The interactive AskUserQuestionConfirmation component handles the pending state
  if (!isCompleted) {
    return null;
  }

  const statusText = isCancelled ? 'Question Cancelled' : 'Questions Answered';

  return (
    <div className={`ask-user-question-widget ${isCompleted ? 'ask-user-question-widget--submitted' : ''}`}>
      <div className="ask-user-question-widget__header">
        <div className="ask-user-question-widget__icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6.06 6a2 2 0 0 1 3.88.67c0 1.33-2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <span className="ask-user-question-widget__title">
          {statusText}
        </span>
        {isCompleted && !isCancelled && (
          <span className="ask-user-question-widget__status">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Submitted
          </span>
        )}
        {isCancelled && (
          <span className="ask-user-question-widget__status ask-user-question-widget__status--cancelled">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 3L3 9M3 3l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Cancelled
          </span>
        )}
      </div>

      <div className="ask-user-question-widget__questions">
        {questions.map((question, qIndex) => {
          const answer = answers[question.question];

          return (
            <div key={qIndex} className="ask-user-question-widget__question-card">
              <div className="ask-user-question-widget__question-header">
                <span className="ask-user-question-widget__question-chip">{question.header}</span>
                {question.multiSelect && (
                  <span className="ask-user-question-widget__multi-select-hint">Multiple selection</span>
                )}
              </div>
              <div className="ask-user-question-widget__question-text">
                {question.question}
              </div>
              <div className="ask-user-question-widget__options">
                {question.options.map((option, oIndex) => {
                  const isSelected = isOptionSelected(answer, option.label, question.multiSelect);

                  return (
                    <div
                      key={oIndex}
                      className={`ask-user-question-widget__option ${isSelected ? 'ask-user-question-widget__option--selected' : ''}`}
                    >
                      <div className={`ask-user-question-widget__option-indicator ${isSelected ? 'ask-user-question-widget__option-indicator--selected' : ''}`}>
                        {isSelected && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M8.5 2.5L3.75 7.25L1.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                      <div className="ask-user-question-widget__option-content">
                        <span className="ask-user-question-widget__option-label">{option.label}</span>
                        {option.description && (
                          <span className="ask-user-question-widget__option-description">{option.description}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Show selected answer summary if answered */}
              {answer && (
                <div className="ask-user-question-widget__answer-summary">
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
