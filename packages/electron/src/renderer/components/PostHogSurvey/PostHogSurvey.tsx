/**
 * PostHogSurvey Component
 *
 * A custom survey renderer for PostHog surveys with full dark mode support.
 * Uses API mode to fetch and display surveys with Nimbalyst's theme system.
 *
 * Key features:
 * - Automatic dark mode support via CSS variables
 * - Renders survey questions based on type (open, rating, single/multiple choice)
 * - Tracks survey shown/dismissed/sent events for PostHog analytics
 * - Prevents duplicate displays using localStorage
 */

import React, { useState, useEffect, useCallback } from 'react';
import { usePostHog } from 'posthog-js/react';
import type { Survey, SurveyQuestion } from 'posthog-js';
import { MaterialSymbol } from '@nimbalyst/runtime';

interface PostHogSurveyProps {
  /**
   * Called when the survey is closed (submitted or dismissed)
   */
  onClose?: () => void;
}

const SURVEY_STORAGE_KEY = 'nimbalyst_posthog_surveys';

/**
 * Get the dismissed/completed survey IDs from localStorage
 */
function getCompletedSurveys(): string[] {
  try {
    const stored = localStorage.getItem(SURVEY_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Mark a survey as completed in localStorage
 */
function markSurveyCompleted(surveyId: string): void {
  const completed = getCompletedSurveys();
  if (!completed.includes(surveyId)) {
    completed.push(surveyId);
    localStorage.setItem(SURVEY_STORAGE_KEY, JSON.stringify(completed));
  }
}

/**
 * Check if a survey has been completed
 */
function isSurveyCompleted(surveyId: string): boolean {
  return getCompletedSurveys().includes(surveyId);
}

// The feedback survey ID configured in PostHog
const FEEDBACK_SURVEY_ID = '019aad12-f478-0000-9fdb-18041da422b4';

export const PostHogSurvey: React.FC<PostHogSurveyProps> = ({
  onClose,
}) => {
  const posthog = usePostHog();
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [responses, setResponses] = useState<Record<number, string | string[] | number>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Email field state
  const [email, setEmail] = useState('');
  const [existingEmail, setExistingEmail] = useState<string | null>(null);
  const hasExistingEmail = !!existingEmail;

  // Fetch existing email from onboarding state on mount
  useEffect(() => {
    const loadExistingEmail = async () => {
      try {
        const state = await window.electronAPI.invoke('onboarding:get');
        if (state.userEmail) {
          setExistingEmail(state.userEmail);
          setEmail(state.userEmail);
        }
      } catch (err) {
        console.error('Failed to load existing email:', err);
      }
    };
    loadExistingEmail();
  }, []);

  // Fetch the specific feedback survey on mount
  // Since this is triggered by explicit user action (clicking feedback button),
  // we always show the survey regardless of completion status
  useEffect(() => {
    if (!posthog) {
      setError('Analytics not available');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    // Use getSurveys to fetch surveys directly, then find our specific one
    posthog.getSurveys((surveys) => {
      setIsLoading(false);

      const feedbackSurvey = surveys.find((s) => s.id === FEEDBACK_SURVEY_ID);

      if (feedbackSurvey) {
        setSurvey(feedbackSurvey);
        setIsVisible(true);

        // Track survey shown event
        posthog.capture('survey shown', {
          $survey_id: feedbackSurvey.id,
          $survey_name: feedbackSurvey.name,
        });
      } else {
        setError('Feedback survey not found');
      }
    });
  }, [posthog]);

  const handleDismiss = useCallback(() => {
    if (survey && posthog) {
      posthog.capture('survey dismissed', {
        $survey_id: survey.id,
        $survey_name: survey.name,
      });
      // Don't mark as completed - user explicitly clicked feedback button,
      // so they should be able to submit feedback again later
    }
    setIsVisible(false);
    onClose?.();
  }, [survey, posthog, onClose]);

  const handleSubmit = useCallback(async () => {
    if (!survey || !posthog) return;

    // Build the response object with question ID-based keys
    const responsePayload: Record<string, string | string[] | number> = {};
    survey.questions.forEach((_, index) => {
      const response = responses[index];
      if (response !== undefined) {
        // PostHog expects $survey_response for single question, $survey_response_X for multiple
        if (survey.questions.length === 1) {
          responsePayload['$survey_response'] = response;
        } else {
          responsePayload[`$survey_response_${index}`] = response;
        }
      }
    });

    // Capture the survey sent event
    posthog.capture('survey sent', {
      $survey_id: survey.id,
      $survey_name: survey.name,
      ...responsePayload,
    });

    // Save email if provided and not already stored
    // Uses the same storage mechanism as onboarding for consistency
    if (email && !hasExistingEmail) {
      try {
        // Store email in app settings via onboarding:update
        await window.electronAPI.invoke('onboarding:update', {
          userEmail: email,
        });
        // Also send to PostHog as a person property (same as onboarding does)
        posthog.people.set({ email });
      } catch (err) {
        console.error('Failed to save email:', err);
      }
    }

    // Don't mark as completed - user explicitly clicked feedback button,
    // so they should be able to submit feedback again later
    setIsSubmitted(true);
  }, [survey, posthog, responses, email, hasExistingEmail]);

  const handleClose = useCallback(() => {
    setIsVisible(false);
    onClose?.();
  }, [onClose]);

  const currentQuestion = survey?.questions[currentQuestionIndex];
  const isLastQuestion = currentQuestionIndex === (survey?.questions.length ?? 1) - 1;
  const hasResponse = responses[currentQuestionIndex] !== undefined;

  const handleNextQuestion = () => {
    if (isLastQuestion) {
      handleSubmit();
    } else {
      setCurrentQuestionIndex((prev) => prev + 1);
    }
  };

  const handlePreviousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex((prev) => prev - 1);
    }
  };

  const handleResponseChange = (value: string | string[] | number) => {
    setResponses((prev) => ({
      ...prev,
      [currentQuestionIndex]: value,
    }));
  };

  // Show loading state
  if (isLoading) {
    return (
      <div className="posthog-survey-overlay nim-overlay bg-black/60 nim-animate-fade-in" onClick={onClose}>
        <div className="posthog-survey relative p-0 w-[480px] max-w-[90vw] max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--nim-border)] bg-[var(--nim-bg)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] nim-animate-slide-up" onClick={(e) => e.stopPropagation()}>
          <div className="posthog-survey-content posthog-survey-loading p-8 text-center py-12">
            <p className="posthog-survey-description m-0 mb-6 text-sm leading-relaxed text-[var(--nim-text-muted)]">Loading survey...</p>
          </div>
        </div>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="posthog-survey-overlay nim-overlay bg-black/60 nim-animate-fade-in" onClick={onClose}>
        <div className="posthog-survey relative p-0 w-[480px] max-w-[90vw] max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--nim-border)] bg-[var(--nim-bg)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] nim-animate-slide-up" onClick={(e) => e.stopPropagation()}>
          <button
            className="posthog-survey-close absolute top-4 right-4 z-[1] flex items-center justify-center p-2 bg-transparent border-none rounded-md cursor-pointer leading-none text-[var(--nim-text-muted)] transition-colors duration-200 hover:text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)]"
            onClick={onClose}
            aria-label="Close"
          >
            <MaterialSymbol icon="close" size={20} />
          </button>
          <div className="posthog-survey-content posthog-survey-error p-8 text-center py-12">
            <div className="posthog-survey-icon mb-4 text-[var(--nim-text-faint)]">
              <MaterialSymbol icon="info" size={48} />
            </div>
            <h2 className="posthog-survey-title m-0 mb-3 text-xl font-semibold leading-snug pr-10 text-[var(--nim-text)]">No Survey Available</h2>
            <p className="posthog-survey-description m-0 mb-6 text-sm leading-relaxed text-[var(--nim-text-muted)]">
              There is no feedback survey available at the moment.
            </p>
            <button
              className="posthog-survey-button posthog-survey-button-primary nim-btn-primary px-6 py-3 rounded-lg text-sm font-semibold whitespace-nowrap transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isVisible || !survey) return null;

  // Render thank you message after submission
  if (isSubmitted) {
    return (
      <div className="posthog-survey-overlay nim-overlay bg-black/60 nim-animate-fade-in" onClick={handleClose}>
        <div className="posthog-survey relative p-0 w-[480px] max-w-[90vw] max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--nim-border)] bg-[var(--nim-bg)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] nim-animate-slide-up" onClick={(e) => e.stopPropagation()}>
          <button
            className="posthog-survey-close absolute top-4 right-4 z-[1] flex items-center justify-center p-2 bg-transparent border-none rounded-md cursor-pointer leading-none text-[var(--nim-text-muted)] transition-colors duration-200 hover:text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)]"
            onClick={handleClose}
            aria-label="Close"
          >
            <MaterialSymbol icon="close" size={20} />
          </button>

          <div className="posthog-survey-content posthog-survey-thank-you p-8 text-center py-12">
            <div className="posthog-survey-icon mb-4 text-[var(--nim-success)]">
              <MaterialSymbol icon="check_circle" size={48} fill />
            </div>
            <h2 className="posthog-survey-title m-0 mb-3 text-xl font-semibold leading-snug pr-10 text-[var(--nim-text)]">
              {survey.appearance?.thankYouMessageHeader || 'Thank you!'}
            </h2>
            <p className="posthog-survey-description m-0 mb-6 text-sm leading-relaxed text-[var(--nim-text-muted)]">
              {survey.appearance?.thankYouMessageDescription ||
                'Your feedback helps us improve Nimbalyst.'}
            </p>
            <button
              className="posthog-survey-button posthog-survey-button-primary nim-btn-primary px-6 py-3 rounded-lg text-sm font-semibold whitespace-nowrap transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleClose}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="posthog-survey-overlay nim-overlay bg-black/60 nim-animate-fade-in" onClick={handleDismiss}>
      <div className="posthog-survey relative p-0 w-[480px] max-w-[90vw] max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--nim-border)] bg-[var(--nim-bg)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] nim-animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <button
          className="posthog-survey-close absolute top-4 right-4 z-[1] flex items-center justify-center p-2 bg-transparent border-none rounded-md cursor-pointer leading-none text-[var(--nim-text-muted)] transition-colors duration-200 hover:text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)]"
          onClick={handleDismiss}
          aria-label="Close"
        >
          <MaterialSymbol icon="close" size={20} />
        </button>

        <div className="posthog-survey-content p-8">
          {/* Progress indicator for multi-question surveys */}
          {survey.questions.length > 1 && (
            <div className="posthog-survey-progress mb-6 text-[13px] text-[var(--nim-text-muted)]">
              <span>
                Question {currentQuestionIndex + 1} of {survey.questions.length}
              </span>
              <div className="posthog-survey-progress-bar mt-2 h-1 rounded-sm overflow-hidden bg-[var(--nim-bg-tertiary)]">
                <div
                  className="posthog-survey-progress-fill h-full rounded-sm transition-[width] duration-300 ease-out bg-[var(--nim-primary)]"
                  style={{
                    width: `${((currentQuestionIndex + 1) / survey.questions.length) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          <h2 className="posthog-survey-title m-0 mb-3 text-xl font-semibold leading-snug pr-10 text-[var(--nim-text)]">{currentQuestion?.question}</h2>

          {currentQuestion?.description && (
            <p className="posthog-survey-description m-0 mb-6 text-sm leading-relaxed text-[var(--nim-text-muted)]">
              {currentQuestion.description}
            </p>
          )}

          {/* Question type renderers */}
          {currentQuestion?.type === 'open' && (
            <OpenQuestion
              value={(responses[currentQuestionIndex] as string) || ''}
              onChange={handleResponseChange}
            />
          )}

          {currentQuestion?.type === 'rating' && (
            <RatingQuestion
              value={responses[currentQuestionIndex] as number}
              onChange={handleResponseChange}
              scale={'scale' in currentQuestion ? currentQuestion.scale : 10}
              lowerLabel={'lowerBoundLabel' in currentQuestion ? currentQuestion.lowerBoundLabel : undefined}
              upperLabel={'upperBoundLabel' in currentQuestion ? currentQuestion.upperBoundLabel : undefined}
            />
          )}

          {currentQuestion?.type === 'single_choice' && (
            <SingleChoiceQuestion
              value={(responses[currentQuestionIndex] as string) || ''}
              onChange={handleResponseChange}
              choices={'choices' in currentQuestion ? currentQuestion.choices : []}
            />
          )}

          {currentQuestion?.type === 'multiple_choice' && (
            <MultipleChoiceQuestion
              value={(responses[currentQuestionIndex] as string[]) || []}
              onChange={handleResponseChange}
              choices={'choices' in currentQuestion ? currentQuestion.choices : []}
            />
          )}

          {currentQuestion?.type === 'link' && (
            <LinkQuestion
              link={'link' in currentQuestion && currentQuestion.link ? currentQuestion.link : ''}
              buttonText={currentQuestion.buttonText || 'Learn More'}
            />
          )}

          {/* Email field - shown on last question */}
          {isLastQuestion && (
            <div className="posthog-survey-email mt-6 pt-6 border-t border-[var(--nim-border)]">
              <label className="block text-sm font-medium text-[var(--nim-text)] mb-2">
                Email address <span className="text-[var(--nim-text-faint)] font-normal">(optional)</span>
              </label>
              <p className="text-xs text-[var(--nim-text-muted)] mb-3">
                {hasExistingEmail
                  ? 'Your email has already been saved.'
                  : 'Provide your email if you would like us to follow up on your feedback.'}
              </p>
              <input
                type="email"
                className={`w-full px-4 py-3 border border-[var(--nim-border)] rounded-lg text-sm font-inherit transition-[border-color,box-shadow] duration-200 bg-[var(--nim-bg-secondary)] text-[var(--nim-text)] placeholder:text-[var(--nim-text-faint)] focus:outline-none focus:border-[var(--nim-border-focus)] focus:shadow-[0_0_0_3px_rgba(96,165,250,0.15)] ${
                  hasExistingEmail ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                disabled={hasExistingEmail}
              />
            </div>
          )}

          {/* Navigation buttons */}
          <div className="posthog-survey-buttons flex gap-3 mt-6 justify-end">
            {currentQuestionIndex > 0 && (
              <button
                className="posthog-survey-button posthog-survey-button-secondary nim-btn-secondary px-6 py-3 rounded-lg text-sm font-semibold whitespace-nowrap transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handlePreviousQuestion}
              >
                Back
              </button>
            )}
            <button
              className="posthog-survey-button posthog-survey-button-primary nim-btn-primary px-6 py-3 rounded-lg text-sm font-semibold whitespace-nowrap transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleNextQuestion}
              disabled={!hasResponse && currentQuestion?.type !== 'link'}
            >
              {isLastQuestion ? 'Submit' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Question type components

interface OpenQuestionProps {
  value: string;
  onChange: (value: string) => void;
}

const OpenQuestion: React.FC<OpenQuestionProps> = ({ value, onChange }) => (
  <textarea
    className="posthog-survey-textarea w-full px-4 py-3 border border-[var(--nim-border)] rounded-lg text-sm font-inherit resize-y min-h-[100px] transition-[border-color,box-shadow] duration-200 bg-[var(--nim-bg-secondary)] text-[var(--nim-text)] placeholder:text-[var(--nim-text-faint)] focus:outline-none focus:border-[var(--nim-border-focus)] focus:shadow-[0_0_0_3px_rgba(96,165,250,0.15)]"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder="Type your response here..."
    rows={4}
  />
);

interface RatingQuestionProps {
  value: number | undefined;
  onChange: (value: number) => void;
  scale: number;
  lowerLabel?: string;
  upperLabel?: string;
}

const RatingQuestion: React.FC<RatingQuestionProps> = ({
  value,
  onChange,
  scale,
  lowerLabel,
  upperLabel,
}) => {
  // Generate array from 0 to scale (e.g., 0-10 for NPS)
  const ratings = Array.from({ length: scale + 1 }, (_, i) => i);

  return (
    <div className="posthog-survey-rating mb-2">
      <div className="posthog-survey-rating-buttons flex gap-1.5 flex-wrap justify-center">
        {ratings.map((rating) => (
          <button
            key={rating}
            className={`posthog-survey-rating-button w-9 h-9 border border-[var(--nim-border)] rounded-md text-sm font-medium cursor-pointer transition-all duration-150 bg-[var(--nim-bg-secondary)] text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] ${
              value === rating ? 'selected bg-[var(--nim-primary)] border-[var(--nim-primary)] text-white' : ''
            }`}
            onClick={() => onChange(rating)}
            aria-pressed={value === rating}
          >
            {rating}
          </button>
        ))}
      </div>
      {(lowerLabel || upperLabel) && (
        <div className="posthog-survey-rating-labels flex justify-between mt-2 text-xs text-[var(--nim-text-faint)]">
          <span>{lowerLabel || 'Not likely'}</span>
          <span>{upperLabel || 'Very likely'}</span>
        </div>
      )}
    </div>
  );
};

interface SingleChoiceQuestionProps {
  value: string;
  onChange: (value: string) => void;
  choices: string[];
}

const SingleChoiceQuestion: React.FC<SingleChoiceQuestionProps> = ({
  value,
  onChange,
  choices,
}) => (
  <div className="posthog-survey-choices flex flex-col gap-2">
    {choices.map((choice) => (
      <label key={choice} className="posthog-survey-choice flex items-center gap-3 px-4 py-3 border border-[var(--nim-border)] rounded-lg cursor-pointer transition-all duration-150 bg-[var(--nim-bg-secondary)] hover:border-[var(--nim-primary)] hover:bg-[var(--nim-bg-hover)] has-[input:checked]:border-[var(--nim-primary)] has-[input:checked]:bg-[var(--nim-bg-selected)]">
        <input
          type="radio"
          name="survey-choice"
          value={choice}
          checked={value === choice}
          onChange={(e) => onChange(e.target.value)}
          className="appearance-none w-[18px] h-[18px] border-2 border-[var(--nim-border)] rounded-full cursor-pointer shrink-0 bg-[var(--nim-bg)] checked:border-[var(--nim-primary)] checked:bg-[var(--nim-primary)] checked:bg-[radial-gradient(circle,white_35%,transparent_35%)]"
        />
        <span className="posthog-survey-choice-label text-sm leading-snug text-[var(--nim-text)]">{choice}</span>
      </label>
    ))}
  </div>
);

interface MultipleChoiceQuestionProps {
  value: string[];
  onChange: (value: string[]) => void;
  choices: string[];
}

const MultipleChoiceQuestion: React.FC<MultipleChoiceQuestionProps> = ({
  value,
  onChange,
  choices,
}) => {
  const handleToggle = (choice: string) => {
    if (value.includes(choice)) {
      onChange(value.filter((v) => v !== choice));
    } else {
      onChange([...value, choice]);
    }
  };

  return (
    <div className="posthog-survey-choices flex flex-col gap-2">
      {choices.map((choice) => (
        <label key={choice} className="posthog-survey-choice flex items-center gap-3 px-4 py-3 border border-[var(--nim-border)] rounded-lg cursor-pointer transition-all duration-150 bg-[var(--nim-bg-secondary)] hover:border-[var(--nim-primary)] hover:bg-[var(--nim-bg-hover)] has-[input:checked]:border-[var(--nim-primary)] has-[input:checked]:bg-[var(--nim-bg-selected)]">
          <input
            type="checkbox"
            value={choice}
            checked={value.includes(choice)}
            onChange={() => handleToggle(choice)}
            className="appearance-none w-[18px] h-[18px] border-2 border-[var(--nim-border)] rounded cursor-pointer shrink-0 bg-[var(--nim-bg)] checked:border-[var(--nim-primary)] checked:bg-[var(--nim-primary)] checked:bg-[url('data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%20fill=%27white%27%3E%3Cpath%20d=%27M9%2016.17L4.83%2012l-1.42%201.41L9%2019%2021%207l-1.41-1.41L9%2016.17z%27/%3E%3C/svg%3E')] checked:bg-[length:14px] checked:bg-center checked:bg-no-repeat"
          />
          <span className="posthog-survey-choice-label text-sm leading-snug text-[var(--nim-text)]">{choice}</span>
        </label>
      ))}
    </div>
  );
};

interface LinkQuestionProps {
  link: string;
  buttonText: string;
}

const LinkQuestion: React.FC<LinkQuestionProps> = ({ link, buttonText }) => (
  <div className="posthog-survey-link flex justify-center">
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className="posthog-survey-button posthog-survey-button-primary nim-btn-primary px-6 py-3 rounded-lg text-sm font-semibold no-underline whitespace-nowrap transition-all duration-200"
      onClick={() => window.electronAPI?.invoke('open-external', link)}
    >
      {buttonText}
    </a>
  </div>
);

export default PostHogSurvey;
