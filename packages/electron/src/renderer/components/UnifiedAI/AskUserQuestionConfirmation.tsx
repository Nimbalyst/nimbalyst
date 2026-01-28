import React, { useState, useCallback } from 'react';

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
    <div className="ask-user-question-confirmation w-[90%] mx-auto my-4 p-4 flex flex-col max-h-[400px] rounded-lg border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]">
      <div className="ask-user-question-confirmation-header flex items-center gap-2 mb-3 shrink-0">
        <span className="ask-user-question-confirmation-icon flex items-center justify-center text-[var(--nim-primary)]">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6.06 6a2 2 0 0 1 3.88.67c0 1.33-2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
        <span className="ask-user-question-confirmation-title font-semibold text-sm text-[var(--nim-text)]">
          Questions from Claude
        </span>
      </div>

      <div className="ask-user-question-confirmation-questions flex flex-col gap-3 mb-4 overflow-y-auto flex-1 min-h-0">
        {data.questions.map((question, qIndex) => (
          <div key={qIndex} className="ask-user-question-confirmation-card p-3 rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg)]">
            <div className="ask-user-question-confirmation-question-header flex items-center gap-2 mb-2">
              <span className="ask-user-question-confirmation-chip text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full text-[var(--nim-primary)] bg-[color-mix(in_srgb,var(--nim-primary)_12%,transparent)]">{question.header}</span>
              {question.multiSelect && (
                <span className="ask-user-question-confirmation-multi-hint text-[11px] italic text-[var(--nim-text-faint)]">Select multiple</span>
              )}
            </div>
            <div className="ask-user-question-confirmation-question-text text-[13px] leading-relaxed mb-2.5 text-[var(--nim-text)]">
              {question.question}
            </div>
            <div className="ask-user-question-confirmation-options flex flex-col gap-1.5">
              {question.options.map((option, oIndex) => {
                const isSelected = isOptionSelected(question, option.label);
                const inputType = question.multiSelect ? 'checkbox' : 'radio';

                return (
                  <div
                    key={oIndex}
                    className={`ask-user-question-confirmation-option flex items-start gap-2 py-2 px-2.5 rounded border cursor-pointer transition-all duration-150 ${
                      isSelected
                        ? 'border-[var(--nim-primary)] bg-[color-mix(in_srgb,var(--nim-primary)_8%,var(--nim-bg-secondary))]'
                        : 'border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] hover:border-[var(--nim-primary)] hover:bg-[color-mix(in_srgb,var(--nim-primary)_5%,var(--nim-bg-secondary))]'
                    }`}
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
                      className="w-4 h-4 m-0 mt-0.5 shrink-0 cursor-pointer accent-[var(--nim-primary)]"
                    />
                    <div className="ask-user-question-confirmation-option-content flex flex-col gap-0.5 flex-1 min-w-0">
                      <span className="ask-user-question-confirmation-option-label text-[13px] font-medium leading-snug text-[var(--nim-text)]">{option.label}</span>
                      {option.description && (
                        <span className="ask-user-question-confirmation-option-description text-xs leading-snug text-[var(--nim-text-muted)]">{option.description}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="ask-user-question-confirmation-actions flex gap-2 shrink-0">
        <button
          className="nim-btn-primary flex-1 py-2 px-4 text-[13px]"
          onClick={handleSubmit}
          disabled={!allAnswered}
        >
          Submit Answers
        </button>
        <button
          className="nim-btn-secondary flex-1 py-2 px-4 text-[13px]"
          onClick={handleCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
