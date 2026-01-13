/**
 * HelpTooltip Component
 *
 * A styled tooltip that displays help content from the centralized HelpContent registry.
 * Shows title, description, and keyboard shortcut (if available).
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getHelpContent, type HelpEntry } from './HelpContent';
import { getShortcutDisplay } from '../../shared/KeyboardShortcuts';
import './HelpTooltip.css';

interface HelpTooltipProps {
  /** The data-testid to look up help content for */
  testId: string;
  /** The element to wrap with tooltip functionality */
  children: React.ReactElement;
  /** Override placement (default: auto) */
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
  /** Delay before showing tooltip in ms (default: 500) */
  delay?: number;
  /** Whether to disable the tooltip */
  disabled?: boolean;
}

interface TooltipPosition {
  top: number;
  left: number;
  placement: 'top' | 'bottom' | 'left' | 'right';
}

const TOOLTIP_MARGIN = 8;

function calculatePosition(
  targetRect: DOMRect,
  tooltipWidth: number,
  tooltipHeight: number,
  preferredPlacement: 'top' | 'bottom' | 'left' | 'right' | 'auto'
): TooltipPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let placement = preferredPlacement;

  if (placement === 'auto') {
    // Prefer bottom, then top, then right, then left
    const spaceBelow = viewportHeight - targetRect.bottom;
    const spaceAbove = targetRect.top;
    const spaceRight = viewportWidth - targetRect.right;
    const spaceLeft = targetRect.left;

    if (spaceBelow >= tooltipHeight + TOOLTIP_MARGIN) {
      placement = 'bottom';
    } else if (spaceAbove >= tooltipHeight + TOOLTIP_MARGIN) {
      placement = 'top';
    } else if (spaceRight >= tooltipWidth + TOOLTIP_MARGIN) {
      placement = 'right';
    } else if (spaceLeft >= tooltipWidth + TOOLTIP_MARGIN) {
      placement = 'left';
    } else {
      placement = 'bottom';
    }
  }

  let top: number;
  let left: number;

  const targetCenterX = targetRect.left + targetRect.width / 2;
  const targetCenterY = targetRect.top + targetRect.height / 2;

  switch (placement) {
    case 'top':
      top = targetRect.top - tooltipHeight - TOOLTIP_MARGIN;
      left = targetCenterX - tooltipWidth / 2;
      break;
    case 'bottom':
      top = targetRect.bottom + TOOLTIP_MARGIN;
      left = targetCenterX - tooltipWidth / 2;
      break;
    case 'left':
      top = targetCenterY - tooltipHeight / 2;
      left = targetRect.left - tooltipWidth - TOOLTIP_MARGIN;
      break;
    case 'right':
      top = targetCenterY - tooltipHeight / 2;
      left = targetRect.right + TOOLTIP_MARGIN;
      break;
  }

  // Clamp to viewport
  left = Math.max(8, Math.min(left, viewportWidth - tooltipWidth - 8));
  top = Math.max(8, Math.min(top, viewportHeight - tooltipHeight - 8));

  return { top, left, placement };
}

export function HelpTooltip({
  testId,
  children,
  placement = 'auto',
  delay = 500,
  disabled = false,
}: HelpTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const helpContent = getHelpContent(testId);

  const showTooltip = useCallback(() => {
    if (disabled || !helpContent || !targetRef.current) return;

    const rect = targetRef.current.getBoundingClientRect();
    // Estimate tooltip size (will be refined after render)
    const estimatedWidth = 280;
    const estimatedHeight = 80;
    const pos = calculatePosition(rect, estimatedWidth, estimatedHeight, placement);
    setPosition(pos);
    setIsVisible(true);
  }, [disabled, helpContent, placement]);

  const hideTooltip = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(showTooltip, delay);
  }, [delay, showTooltip]);

  const handleMouseLeave = useCallback(() => {
    hideTooltip();
  }, [hideTooltip]);

  // Refine position after tooltip renders
  useEffect(() => {
    if (isVisible && tooltipRef.current && targetRef.current) {
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const targetRect = targetRef.current.getBoundingClientRect();
      const pos = calculatePosition(
        targetRect,
        tooltipRect.width,
        tooltipRect.height,
        placement
      );
      setPosition(pos);
    }
  }, [isVisible, placement]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // If no help content, just render children without tooltip
  if (!helpContent) {
    return children;
  }

  // Clone children to add event handlers and ref
  const childWithHandlers = React.cloneElement(children, {
    ref: (el: HTMLElement | null) => {
      targetRef.current = el;
      // Preserve existing ref if any
      const originalRef = (children as any).ref;
      if (typeof originalRef === 'function') {
        originalRef(el);
      } else if (originalRef && 'current' in originalRef) {
        originalRef.current = el;
      }
    },
    onMouseEnter: (e: React.MouseEvent) => {
      handleMouseEnter();
      children.props.onMouseEnter?.(e);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      handleMouseLeave();
      children.props.onMouseLeave?.(e);
    },
    onFocus: (e: React.FocusEvent) => {
      handleMouseEnter();
      children.props.onFocus?.(e);
    },
    onBlur: (e: React.FocusEvent) => {
      handleMouseLeave();
      children.props.onBlur?.(e);
    },
  });

  return (
    <>
      {childWithHandlers}
      {isVisible &&
        position &&
        createPortal(
          <div
            ref={tooltipRef}
            className={`help-tooltip help-tooltip--${position.placement}`}
            style={{ top: position.top, left: position.left }}
            role="tooltip"
          >
            <div className="help-tooltip-header">
              <span className="help-tooltip-title">{helpContent.title}</span>
              {helpContent.shortcut && (
                <kbd className="help-tooltip-shortcut">
                  {getShortcutDisplay(helpContent.shortcut)}
                </kbd>
              )}
            </div>
            <div className="help-tooltip-body">{helpContent.body}</div>
          </div>,
          document.body
        )}
    </>
  );
}
