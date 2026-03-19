/**
 * TipCard Component
 *
 * A compact, dismissible card that appears in the bottom-left corner.
 * Renders via portal to avoid z-index issues.
 */

import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { TipDefinition } from './types';

/**
 * Parse basic **bold** text within a string.
 */
function parseBoldText(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-semibold text-[var(--nim-text)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

interface TipCardProps {
  /** The tip definition to display */
  tip: TipDefinition;
  /** Called when user clicks X or presses Escape */
  onDismiss: () => void;
  /** Called when user clicks the primary action */
  onAction: () => void;
  /** Called when user clicks the secondary action */
  onSecondaryAction?: () => void;
}

export function TipCard({
  tip,
  onDismiss,
  onAction,
  onSecondaryAction,
}: TipCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onDismiss]);

  const handleActionClick = useCallback(() => {
    onAction();
  }, [onAction]);

  const handleSecondaryClick = useCallback(() => {
    onSecondaryAction?.();
  }, [onSecondaryAction]);

  const renderedBody = useMemo(() => parseBoldText(tip.content.body), [tip.content.body]);

  const card = (
    <div
      ref={cardRef}
      className="tip-card fixed bottom-5 left-[50px] w-[340px] bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded-[10px] z-[10000] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.35),0_2px_8px_rgba(0,0,0,0.2)] motion-safe:animate-[tip-slide-in_0.3s_ease-out_forwards]"
      role="alert"
      aria-labelledby="tip-title"
      aria-describedby="tip-body"
    >
      {/* Header: icon + title + dismiss */}
      <div className="flex items-start gap-2.5 px-3.5 pt-3.5">
        {tip.content.icon && (
          <div className="w-8 h-8 rounded-[7px] bg-[color-mix(in_srgb,var(--nim-primary)_10%,transparent)] border border-[color-mix(in_srgb,var(--nim-primary)_20%,transparent)] flex items-center justify-center shrink-0 mt-px text-[var(--nim-primary)]">
            {tip.content.icon}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div
            id="tip-title"
            className="text-[13px] font-semibold text-[var(--nim-text)] leading-tight"
          >
            {tip.content.title}
          </div>
        </div>
        <button
          className="nim-btn-icon w-6 h-6 flex items-center justify-center shrink-0 -mt-0.5 -mr-1 text-[var(--nim-text-faint)] hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text-muted)] rounded transition-all duration-150"
          onClick={onDismiss}
          aria-label="Dismiss tip"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div
        id="tip-body"
        className="text-[12.5px] leading-relaxed text-[var(--nim-text-muted)] px-3.5 pt-2 pb-3.5"
        style={{ paddingLeft: tip.content.icon ? '3.5rem' : '0.875rem' }}
      >
        {renderedBody}
      </div>

      {/* Actions */}
      {(tip.content.action || tip.content.secondaryAction) && (
        <div
          className="flex items-center gap-3 px-3.5 pb-3.5"
          style={{ paddingLeft: tip.content.icon ? '3.5rem' : '0.875rem' }}
        >
          {tip.content.action && (
            <button
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[var(--nim-primary)] text-white border-none rounded-md text-[12.5px] font-medium cursor-pointer transition-all duration-150 hover:brightness-110 font-[inherit]"
              onClick={handleActionClick}
            >
              {tip.content.action.label}
            </button>
          )}
          {tip.content.secondaryAction && (
            <button
              className="text-[12.5px] text-[var(--nim-text-faint)] bg-transparent border-none cursor-pointer font-[inherit] transition-colors duration-150 hover:text-[var(--nim-text-muted)] hover:underline"
              onClick={handleSecondaryClick}
            >
              {tip.content.secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );

  return createPortal(card, document.body);
}
