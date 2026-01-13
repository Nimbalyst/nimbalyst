/**
 * WalkthroughCallout Component
 *
 * A floating callout/bubble that attaches to UI elements to guide users
 * through features. Supports multi-step navigation, dismissal, and theming.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { WalkthroughStep, WalkthroughDefinition } from '../types';
import {
  resolveTarget,
  isTargetValid,
  calculateCalloutPosition,
  type CalloutPosition,
} from '../WalkthroughService';
import { getShortcutDisplay } from '../../../shared/KeyboardShortcuts';
import './WalkthroughCallout.css';

interface WalkthroughCalloutProps {
  /** The walkthrough definition */
  definition: WalkthroughDefinition;
  /** Current step index */
  stepIndex: number;
  /** Called when user clicks Next */
  onNext: () => void;
  /** Called when user clicks Back */
  onBack: () => void;
  /** Called when user dismisses (X button, Escape, or click outside) */
  onDismiss: () => void;
  /** Called when user completes the walkthrough (Done on last step) */
  onComplete: () => void;
}

export function WalkthroughCallout({
  definition,
  stepIndex,
  onNext,
  onBack,
  onDismiss,
  onComplete,
}: WalkthroughCalloutProps) {
  const calloutRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CalloutPosition | null>(null);
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);

  const step = definition.steps[stepIndex];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === definition.steps.length - 1;
  const totalSteps = definition.steps.length;

  // Find and validate target element
  useEffect(() => {
    if (!step) return;

    const findTarget = () => {
      const target = resolveTarget(step.target);
      if (target && isTargetValid(target)) {
        // Check visibility condition if provided
        if (step.visibilityCondition && !step.visibilityCondition()) {
          setTargetElement(null);
          setPosition(null);
          return;
        }
        setTargetElement(target);
        const pos = calculateCalloutPosition(target, step.placement);
        setPosition(pos);
      } else {
        setTargetElement(null);
        setPosition(null);
      }
    };

    // Find immediately
    findTarget();

    // Re-check periodically in case target becomes available
    const interval = setInterval(findTarget, 500);

    // Also re-check on resize/scroll
    const handleResize = () => findTarget();
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize, true);

    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize, true);
    };
  }, [step]);

  // Add/remove highlight class on target element
  useEffect(() => {
    if (!targetElement) return;

    // Add highlight class
    targetElement.classList.add('walkthrough-target-highlight');

    return () => {
      // Remove highlight class on cleanup
      targetElement.classList.remove('walkthrough-target-highlight');
    };
  }, [targetElement]);

  // Handle Escape key and click outside
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (
        calloutRef.current &&
        !calloutRef.current.contains(e.target as Node) &&
        // Don't dismiss if clicking on the target element
        targetElement &&
        !targetElement.contains(e.target as Node)
      ) {
        onDismiss();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onDismiss, targetElement]);

  // Handle action button click
  const handleActionClick = useCallback(() => {
    if (step?.action) {
      step.action.onClick();
    }
  }, [step]);

  // Handle next/complete
  const handleNextOrComplete = useCallback(() => {
    if (isLastStep) {
      onComplete();
    } else {
      onNext();
    }
  }, [isLastStep, onComplete, onNext]);

  // Don't render if no valid target
  if (!position || !step) {
    return null;
  }

  const callout = (
    <div
      ref={calloutRef}
      className="walkthrough-callout"
      style={{
        top: position.top,
        left: position.left,
      }}
      role="dialog"
      aria-labelledby="walkthrough-title"
      aria-describedby="walkthrough-body"
    >
      {/* Arrow - positioned dynamically based on target element */}
      <div
        className={`walkthrough-callout-arrow walkthrough-callout-arrow--${position.arrowPosition}`}
        style={
          position.arrowOffset !== undefined
            ? position.arrowPosition === 'left' || position.arrowPosition === 'right'
              ? { top: position.arrowOffset, transform: 'translateY(-50%)' }
              : { left: position.arrowOffset, transform: 'translateX(-50%)' }
            : undefined
        }
      />

      {/* Content */}
      <div className="walkthrough-callout-content">
        <div className="walkthrough-callout-title-row">
          <div id="walkthrough-title" className="walkthrough-callout-title">
            {step.title}
          </div>
          {step.shortcut && (
            <kbd className="walkthrough-shortcut">{getShortcutDisplay(step.shortcut)}</kbd>
          )}
          <button
            className="walkthrough-callout-dismiss"
            onClick={onDismiss}
            aria-label="Dismiss"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div id="walkthrough-body" className="walkthrough-callout-body">
          {step.body}
        </div>

        {/* Optional action button */}
        {step.action && (
          <div className="walkthrough-callout-action">
            <button
              className="walkthrough-callout-action-btn"
              onClick={handleActionClick}
            >
              {step.action.label}
            </button>
          </div>
        )}
      </div>

      {/* Footer with navigation */}
      <div className="walkthrough-callout-footer">
        <div className="walkthrough-callout-nav">
          {!isFirstStep && (
            <button
              className="walkthrough-callout-btn walkthrough-callout-btn--back"
              onClick={onBack}
            >
              Back
            </button>
          )}
          <button
            className={`walkthrough-callout-btn walkthrough-callout-btn--next ${isLastStep ? 'walkthrough-callout-btn--done' : ''}`}
            onClick={handleNextOrComplete}
          >
            {isLastStep ? 'Done' : 'Next'}
          </button>
        </div>
        {totalSteps > 1 && (
          <div className="walkthrough-callout-progress">
            {stepIndex + 1} of {totalSteps}
          </div>
        )}
      </div>
    </div>
  );

  // Render in a portal at the document body to avoid z-index issues
  return createPortal(callout, document.body);
}
