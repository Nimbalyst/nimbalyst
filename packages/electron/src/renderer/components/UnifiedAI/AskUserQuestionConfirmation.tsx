import React, { useState, useCallback } from 'react';
import './AskUserQuestionConfirmation.css';

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

export interface AskUserQuestionData {
  questionId: string;
  sessionId: string;
  questions: Question[];
  timestamp: number;
}

interface AskUserQuestionConfirmationProps {
  data: AskUserQuestionData;
  onSubmit: (questionId: string, sessionId: string, answers: Record<string, string>) => void;
  onCancel: (questionId: string, sessionId: string) => void;
}

/**
 * Inline confirmation component shown in transcript when Claude asks questions.
 * Displays question cards with radio/checkbox options for user to answer.
 */
export const AskUserQuestionConfirmation: React.FC<AskUserQuestionConfirmationProps> = ({
  data,
  onSubmit,
  onCancel
}) => {
  // State for collecting answers
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const q of data.questions) {
      initial[q.question] = '';
    }
    return initial;
  });

  // Check if all questions have answers
  const allAnswered = data.questions.every(q => {
    const answer = answers[q.question];
    return answer && answer.trim().length > 0;
  });

  /**
   * Handle option selection for a question
   */
  const handleOptionSelect = useCallback((question: Question, optionLabel: string) => {
    setAnswers(prev => {
      const newAnswers = { ...prev };

      if (question.multiSelect) {
        // For multi-select, toggle the option in the comma-separated list
        const currentOptions = prev[question.question]
          ? prev[question.question].split(', ').filter(o => o.trim())
          : [];

        const optionIndex = currentOptions.indexOf(optionLabel);
        if (optionIndex >= 0) {
          // Remove option
          currentOptions.splice(optionIndex, 1);
        } else {
          // Add option
          currentOptions.push(optionLabel);
        }

        newAnswers[question.question] = currentOptions.join(', ');
      } else {
        // For single-select, just set the value
        newAnswers[question.question] = optionLabel;
      }

      return newAnswers;
    });
  }, []);

  /**
   * Check if an option is selected for a question
   */
  const isOptionSelected = useCallback((question: Question, optionLabel: string): boolean => {
    const answer = answers[question.question];
    if (!answer) return false;

    if (question.multiSelect) {
      const selectedOptions = answer.split(', ').filter(o => o.trim());
      return selectedOptions.includes(optionLabel);
    } else {
      return answer === optionLabel;
    }
  }, [answers]);

  const handleSubmit = () => {
    if (allAnswered) {
      onSubmit(data.questionId, data.sessionId, answers);
    }
  };

  const handleCancel = () => {
    onCancel(data.questionId, data.sessionId);
  };

  return (
    <div className="ask-user-question-confirmation">
      <div className="ask-user-question-confirmation-header">
        <span className="ask-user-question-confirmation-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6.06 6a2 2 0 0 1 3.88.67c0 1.33-2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
        <span className="ask-user-question-confirmation-title">
          Questions from Claude
        </span>
      </div>

      <div className="ask-user-question-confirmation-questions">
        {data.questions.map((question, qIndex) => (
          <div key={qIndex} className="ask-user-question-confirmation-card">
            <div className="ask-user-question-confirmation-question-header">
              <span className="ask-user-question-confirmation-chip">{question.header}</span>
              {question.multiSelect && (
                <span className="ask-user-question-confirmation-multi-hint">Select multiple</span>
              )}
            </div>
            <div className="ask-user-question-confirmation-question-text">
              {question.question}
            </div>
            <div className="ask-user-question-confirmation-options">
              {question.options.map((option, oIndex) => {
                const isSelected = isOptionSelected(question, option.label);
                const inputType = question.multiSelect ? 'checkbox' : 'radio';

                return (
                  <div
                    key={oIndex}
                    className={`ask-user-question-confirmation-option ${isSelected ? 'ask-user-question-confirmation-option--selected' : ''}`}
                    onClick={() => handleOptionSelect(question, option.label)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleOptionSelect(question, option.label);
                      }
                    }}
                  >
                    <input
                      type={inputType}
                      name={`question-${qIndex}`}
                      checked={isSelected}
                      readOnly // Visual only, clicks handled by parent div
                    />
                    <div className="ask-user-question-confirmation-option-content">
                      <span className="ask-user-question-confirmation-option-label">{option.label}</span>
                      {option.description && (
                        <span className="ask-user-question-confirmation-option-description">{option.description}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="ask-user-question-confirmation-actions">
        <button
          className="ask-user-question-confirmation-button ask-user-question-confirmation-button-primary"
          onClick={handleSubmit}
          disabled={!allAnswered}
        >
          Submit Answers
        </button>
        <button
          className="ask-user-question-confirmation-button ask-user-question-confirmation-button-secondary"
          onClick={handleCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
