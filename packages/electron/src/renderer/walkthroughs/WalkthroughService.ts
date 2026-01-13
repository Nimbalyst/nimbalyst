/**
 * WalkthroughService - Client-side service for walkthrough state management
 *
 * Handles IPC communication with main process for persisting walkthrough state.
 */

import type { WalkthroughState, WalkthroughStep, WalkthroughDefinition } from './types';

/**
 * Get the current walkthrough state from main process
 */
export async function getWalkthroughState(): Promise<WalkthroughState> {
  return window.electronAPI.invoke('walkthroughs:get-state');
}

/**
 * Enable or disable walkthroughs globally
 */
export async function setWalkthroughsEnabled(enabled: boolean): Promise<void> {
  return window.electronAPI.invoke('walkthroughs:set-enabled', enabled);
}

/**
 * Mark a walkthrough as completed
 */
export async function markWalkthroughCompleted(
  walkthroughId: string,
  version?: number
): Promise<void> {
  return window.electronAPI.invoke('walkthroughs:mark-completed', walkthroughId, version);
}

/**
 * Mark a walkthrough as dismissed
 */
export async function markWalkthroughDismissed(
  walkthroughId: string,
  version?: number
): Promise<void> {
  return window.electronAPI.invoke('walkthroughs:mark-dismissed', walkthroughId, version);
}

/**
 * Record that a walkthrough was shown (for analytics)
 */
export async function recordWalkthroughShown(
  walkthroughId: string,
  version?: number
): Promise<void> {
  return window.electronAPI.invoke('walkthroughs:record-shown', walkthroughId, version);
}

/**
 * Reset all walkthrough state (for testing)
 */
export async function resetWalkthroughState(): Promise<void> {
  return window.electronAPI.invoke('walkthroughs:reset');
}

/**
 * Check if a walkthrough should be shown based on current state
 */
export function shouldShowWalkthrough(
  state: WalkthroughState,
  walkthrough: WalkthroughDefinition
): boolean {
  // Globally disabled
  if (!state.enabled) return false;

  // Already completed or dismissed
  if (state.completed.includes(walkthrough.id)) return false;
  if (state.dismissed.includes(walkthrough.id)) return false;

  // Check for version update (allow re-showing if version changed)
  if (walkthrough.version !== undefined) {
    const history = state.history?.[walkthrough.id];
    if (history?.version !== undefined && history.version !== walkthrough.version) {
      // New version - allow showing again even if previously completed/dismissed
      return true;
    }
  }

  return true;
}

/**
 * Resolve target element from a WalkthroughStep target specification.
 * Prefers data-testid, falls back to selector.
 */
export function resolveTarget(target: WalkthroughStep['target']): HTMLElement | null {
  // Try testId first (preferred)
  if (target.testId) {
    const el = document.querySelector(`[data-testid="${target.testId}"]`);
    if (el) return el as HTMLElement;
  }
  // Fall back to selector
  if (target.selector) {
    const el = document.querySelector(target.selector);
    if (el) return el as HTMLElement;
  }
  return null;
}

/**
 * Check if a target element is valid (visible and in viewport)
 */
export function isTargetValid(element: HTMLElement): boolean {
  // 1. Check element exists in DOM
  if (!document.body.contains(element)) return false;

  // 2. Check not hidden via display/visibility
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;

  // 3. Check element has dimensions (not zero-sized)
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;

  // 4. Check element is not clipped by ancestors with display:none
  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    const parentStyle = getComputedStyle(parent);
    if (parentStyle.display === 'none') return false;
    parent = parent.parentElement;
  }

  // 5. Check element is at least partially in viewport
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const isInViewport =
    rect.top < viewportHeight &&
    rect.bottom > 0 &&
    rect.left < viewportWidth &&
    rect.right > 0;

  return isInViewport;
}

/**
 * Calculate callout position relative to target element.
 * Returns absolute coordinates for positioning.
 */
export interface CalloutPosition {
  top: number;
  left: number;
  arrowPosition: 'top' | 'bottom' | 'left' | 'right';
  /** Offset for arrow positioning (percentage or px from edge) */
  arrowOffset?: number;
}

const CALLOUT_WIDTH = 320;
const CALLOUT_HEIGHT_ESTIMATE = 200; // Will vary based on content
const ARROW_SIZE = 8;
const VIEWPORT_MARGIN = 16;

export function calculateCalloutPosition(
  target: HTMLElement,
  preferredPlacement: WalkthroughStep['placement']
): CalloutPosition {
  const rect = target.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Center of target element
  const targetCenterX = rect.left + rect.width / 2;
  const targetCenterY = rect.top + rect.height / 2;

  // Determine best placement
  let placement = preferredPlacement;

  if (placement === 'auto') {
    // Choose placement based on available space
    const spaceAbove = rect.top;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceLeft = rect.left;
    const spaceRight = viewportWidth - rect.right;

    // Prefer bottom, then top, then sides
    if (spaceBelow >= CALLOUT_HEIGHT_ESTIMATE + ARROW_SIZE + VIEWPORT_MARGIN) {
      placement = 'bottom';
    } else if (spaceAbove >= CALLOUT_HEIGHT_ESTIMATE + ARROW_SIZE + VIEWPORT_MARGIN) {
      placement = 'top';
    } else if (spaceRight >= CALLOUT_WIDTH + ARROW_SIZE + VIEWPORT_MARGIN) {
      placement = 'right';
    } else if (spaceLeft >= CALLOUT_WIDTH + ARROW_SIZE + VIEWPORT_MARGIN) {
      placement = 'left';
    } else {
      // Default to bottom if nothing fits well
      placement = 'bottom';
    }
  }

  let top: number;
  let left: number;
  let arrowPosition: 'top' | 'bottom' | 'left' | 'right';
  let arrowOffset: number | undefined;

  switch (placement) {
    case 'top':
      top = rect.top - CALLOUT_HEIGHT_ESTIMATE - ARROW_SIZE;
      left = targetCenterX - CALLOUT_WIDTH / 2;
      arrowPosition = 'bottom';
      break;
    case 'bottom':
      top = rect.bottom + ARROW_SIZE;
      left = targetCenterX - CALLOUT_WIDTH / 2;
      arrowPosition = 'top';
      break;
    case 'left':
      top = targetCenterY - CALLOUT_HEIGHT_ESTIMATE / 2;
      left = rect.left - CALLOUT_WIDTH - ARROW_SIZE;
      arrowPosition = 'right';
      break;
    case 'right':
      top = targetCenterY - CALLOUT_HEIGHT_ESTIMATE / 2;
      left = rect.right + ARROW_SIZE;
      arrowPosition = 'left';
      break;
    default:
      // Fallback to bottom
      top = rect.bottom + ARROW_SIZE;
      left = targetCenterX - CALLOUT_WIDTH / 2;
      arrowPosition = 'top';
  }

  // Remember unclamped position to calculate arrow offset
  const unclampedTop = top;
  const unclampedLeft = left;

  // Clamp to viewport bounds
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, viewportWidth - CALLOUT_WIDTH - VIEWPORT_MARGIN));
  top = Math.max(VIEWPORT_MARGIN, Math.min(top, viewportHeight - CALLOUT_HEIGHT_ESTIMATE - VIEWPORT_MARGIN));

  // Calculate arrow offset if callout was clamped
  if (arrowPosition === 'left' || arrowPosition === 'right') {
    // Arrow should point at target center vertically
    // Calculate offset from callout top to target center
    arrowOffset = targetCenterY - top;
  } else if (arrowPosition === 'top' || arrowPosition === 'bottom') {
    // Arrow should point at target center horizontally
    arrowOffset = targetCenterX - left;
  }

  return { top, left, arrowPosition, arrowOffset };
}
