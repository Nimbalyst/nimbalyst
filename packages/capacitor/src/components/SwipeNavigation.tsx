import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

interface SwipeNavigationProps {
  children: React.ReactNode;
  /** Threshold in pixels to trigger navigation (default: 100) */
  threshold?: number;
  /** Whether swipe back is enabled (default: true) */
  enabled?: boolean;
}

/**
 * iOS-style swipe-to-go-back navigation wrapper.
 * Wraps content and detects left-to-right swipe gestures from the left edge
 * of the screen to navigate back.
 */
export function SwipeNavigation({
  children,
  threshold = 100,
  enabled = true,
}: SwipeNavigationProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);

  // Touch state
  const touchStartX = useRef<number>(0);
  const touchStartY = useRef<number>(0);
  const touchCurrentX = useRef<number>(0);
  const isSwiping = useRef<boolean>(false);

  // Visual state for swipe indicator
  const [swipeProgress, setSwipeProgress] = useState(0);
  const [isSwipeActive, setIsSwipeActive] = useState(false);

  // Only enable on detail pages (not on root)
  const canSwipeBack = enabled && location.pathname !== '/' && location.pathname !== '/settings';

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!canSwipeBack) return;

    const touch = e.touches[0];
    const edgeThreshold = 30; // Must start within 30px of left edge

    if (touch.clientX <= edgeThreshold) {
      touchStartX.current = touch.clientX;
      touchStartY.current = touch.clientY;
      touchCurrentX.current = touch.clientX;
      isSwiping.current = true;
      setIsSwipeActive(true);
    }
  }, [canSwipeBack]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isSwiping.current || !canSwipeBack) return;

    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartX.current;
    const deltaY = Math.abs(touch.clientY - touchStartY.current);

    // Cancel if vertical movement is greater than horizontal (scrolling)
    if (deltaY > Math.abs(deltaX) && deltaX < 30) {
      isSwiping.current = false;
      setIsSwipeActive(false);
      setSwipeProgress(0);
      return;
    }

    // Only track rightward swipes
    if (deltaX > 0) {
      touchCurrentX.current = touch.clientX;
      // Calculate progress (0 to 1)
      const progress = Math.min(deltaX / threshold, 1);
      setSwipeProgress(progress);
    }
  }, [canSwipeBack, threshold]);

  const handleTouchEnd = useCallback(() => {
    if (!isSwiping.current || !canSwipeBack) return;

    const deltaX = touchCurrentX.current - touchStartX.current;

    // If swipe distance exceeds threshold, navigate back
    if (deltaX >= threshold) {
      navigate(-1);
    }

    // Reset state
    isSwiping.current = false;
    setIsSwipeActive(false);
    setSwipeProgress(0);
    touchStartX.current = 0;
    touchStartY.current = 0;
    touchCurrentX.current = 0;
  }, [canSwipeBack, threshold, navigate]);

  // Reset state when route changes
  useEffect(() => {
    setIsSwipeActive(false);
    setSwipeProgress(0);
  }, [location.pathname]);

  return (
    <div
      ref={containerRef}
      className="swipe-navigation-container"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* Swipe indicator edge */}
      {canSwipeBack && (
        <div
          className="swipe-edge-indicator"
          style={{
            opacity: isSwipeActive ? 1 : 0,
            transform: `scaleX(${swipeProgress})`,
          }}
        />
      )}

      {/* Content with optional transform during swipe */}
      <div
        className="swipe-navigation-content"
        style={{
          transform: isSwipeActive ? `translateX(${swipeProgress * 50}px)` : 'translateX(0)',
          transition: isSwipeActive ? 'none' : 'transform 0.2s ease-out',
        }}
      >
        {children}
      </div>
    </div>
  );
}
