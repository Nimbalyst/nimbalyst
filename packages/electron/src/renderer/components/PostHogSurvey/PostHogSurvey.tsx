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
import './PostHogSurvey.css';

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

  const handleSubmit = useCallback(() => {
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

    // Don't mark as completed - user explicitly clicked feedback button,
    // so they should be able to submit feedback again later
    setIsSubmitted(true);
  }, [survey, posthog, responses]);

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
      <div className="posthog-survey-overlay" onClick={onClose}>
        <div className="posthog-survey" onClick={(e) => e.stopPropagation()}>
          <div className="posthog-survey-content posthog-survey-loading">
            <p className="posthog-survey-description">Loading survey...</p>
          </div>
        </div>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="posthog-survey-overlay" onClick={onClose}>
        <div className="posthog-survey" onClick={(e) => e.stopPropagation()}>
          <button
            className="posthog-survey-close"
            onClick={onClose}
            aria-label="Close"
          >
            <MaterialSymbol icon="close" size={20} />
          </button>
          <div className="posthog-survey-content posthog-survey-error">
            <div className="posthog-survey-icon">
              <MaterialSymbol icon="info" size={48} />
            </div>
            <h2 className="posthog-survey-title">No Survey Available</h2>
            <p className="posthog-survey-description">
              There is no feedback survey available at the moment.
            </p>
            <button
              className="posthog-survey-button posthog-survey-button-primary"
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
      <div className="posthog-survey-overlay" onClick={handleClose}>
        <div className="posthog-survey" onClick={(e) => e.stopPropagation()}>
          <button
            className="posthog-survey-close"
            onClick={handleClose}
            aria-label="Close"
          >
            <MaterialSymbol icon="close" size={20} />
          </button>

          <div className="posthog-survey-content posthog-survey-thank-you">
            <div className="posthog-survey-icon">
              <MaterialSymbol icon="check_circle" size={48} fill />
            </div>
            <h2 className="posthog-survey-title">
              {survey.appearance?.thankYouMessageHeader || 'Thank you!'}
            </h2>
            <p className="posthog-survey-description">
              {survey.appearance?.thankYouMessageDescription ||
                'Your feedback helps us improve Nimbalyst.'}
            </p>
            <button
              className="posthog-survey-button posthog-survey-button-primary"
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
    <div className="posthog-survey-overlay" onClick={handleDismiss}>
      <div className="posthog-survey" onClick={(e) => e.stopPropagation()}>
        <button
          className="posthog-survey-close"
          onClick={handleDismiss}
          aria-label="Close"
        >
          <MaterialSymbol icon="close" size={20} />
        </button>

        <div className="posthog-survey-content">
          {/* Progress indicator for multi-question surveys */}
          {survey.questions.length > 1 && (
            <div className="posthog-survey-progress">
              <span>
                Question {currentQuestionIndex + 1} of {survey.questions.length}
              </span>
              <div className="posthog-survey-progress-bar">
                <div
                  className="posthog-survey-progress-fill"
                  style={{
                    width: `${((currentQuestionIndex + 1) / survey.questions.length) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          <h2 className="posthog-survey-title">{currentQuestion?.question}</h2>

          {currentQuestion?.description && (
            <p className="posthog-survey-description">
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

          {/* Navigation buttons */}
          <div className="posthog-survey-buttons">
            {currentQuestionIndex > 0 && (
              <button
                className="posthog-survey-button posthog-survey-button-secondary"
                onClick={handlePreviousQuestion}
              >
                Back
              </button>
            )}
            <button
              className="posthog-survey-button posthog-survey-button-primary"
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
    className="posthog-survey-textarea"
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
    <div className="posthog-survey-rating">
      <div className="posthog-survey-rating-buttons">
        {ratings.map((rating) => (
          <button
            key={rating}
            className={`posthog-survey-rating-button ${
              value === rating ? 'selected' : ''
            }`}
            onClick={() => onChange(rating)}
            aria-pressed={value === rating}
          >
            {rating}
          </button>
        ))}
      </div>
      {(lowerLabel || upperLabel) && (
        <div className="posthog-survey-rating-labels">
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
  <div className="posthog-survey-choices">
    {choices.map((choice) => (
      <label key={choice} className="posthog-survey-choice">
        <input
          type="radio"
          name="survey-choice"
          value={choice}
          checked={value === choice}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="posthog-survey-choice-label">{choice}</span>
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
    <div className="posthog-survey-choices">
      {choices.map((choice) => (
        <label key={choice} className="posthog-survey-choice">
          <input
            type="checkbox"
            value={choice}
            checked={value.includes(choice)}
            onChange={() => handleToggle(choice)}
          />
          <span className="posthog-survey-choice-label">{choice}</span>
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
  <div className="posthog-survey-link">
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className="posthog-survey-button posthog-survey-button-primary"
      onClick={() => window.electronAPI?.invoke('open-external', link)}
    >
      {buttonText}
    </a>
  </div>
);

export default PostHogSurvey;
