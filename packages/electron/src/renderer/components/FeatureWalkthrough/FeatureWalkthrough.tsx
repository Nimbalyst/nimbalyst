import React, { useState, useCallback, useRef, useEffect } from 'react';
import { usePostHog } from 'posthog-js/react';
import './FeatureWalkthrough.css';

export interface FeatureWalkthroughProps {
  isOpen: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

interface WalkthroughSlide {
  image: string;
  title: string;
  description: string;
}

const WALKTHROUGH_SLIDES: WalkthroughSlide[] = [
  {
    image: './onboarding/onboarding-1.png',
    title: 'View and Approve AI Changes in WYSIWYG Markdown Editor',
    description: 'Write, edit, diagrams, tables, and iterate with AI - all in one powerful environment. Visual diff and approval system lets you review AI changes before accepting them.',
  },
  {
    image: './onboarding/onboarding-2.png',
    title: 'AI-Powered HTML Mockups',
    description: 'Use AI to create and edit HTML mockups based on your files and code. Annotate mockups directly for the AI or edit the HTML source for precise control.',
  },
  {
    image: './onboarding/onboarding-3.png',
    title: 'Agent-First Environment Linked to Your Files',
    description: 'Search, resume, and run Claude Agent sessions integrated with your files. Manage parallel sessions, search through them, and see which files the agent has touched.',
  },
];

// Slide names for analytics
const SLIDE_NAMES = ['editor', 'agent', 'mockup'];

export const FeatureWalkthrough: React.FC<FeatureWalkthroughProps> = ({
  isOpen,
  onComplete,
  onSkip,
}) => {
  const posthog = usePostHog();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [maxImageDimensions, setMaxImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  // Track time spent on each slide
  const slideStartTimeRef = useRef<number>(Date.now());
  const slideTimesRef = useRef<Record<string, number>>({});
  const walkthroughStartTimeRef = useRef<number>(Date.now());

  // Listen for window resize to update dimensions
  useEffect(() => {
    if (!isOpen) return;

    const handleResize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isOpen]);

  // Preload all images and calculate max dimensions
  useEffect(() => {
    if (!isOpen) return;

    setImagesLoaded(false);
    let maxWidth = 0;
    let maxHeight = 0;
    let loadedCount = 0;

    WALKTHROUGH_SLIDES.forEach((slide) => {
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth > maxWidth) maxWidth = img.naturalWidth;
        if (img.naturalHeight > maxHeight) maxHeight = img.naturalHeight;
        loadedCount++;
        if (loadedCount === WALKTHROUGH_SLIDES.length) {
          setMaxImageDimensions({ width: maxWidth, height: maxHeight });
          setImagesLoaded(true);
        }
      };
      img.onerror = () => {
        loadedCount++;
        if (loadedCount === WALKTHROUGH_SLIDES.length) {
          setMaxImageDimensions({ width: maxWidth || 800, height: maxHeight || 600 });
          setImagesLoaded(true);
        }
      };
      img.src = slide.image;
    });
  }, [isOpen]);

  // Reset start time when walkthrough opens and images are loaded
  useEffect(() => {
    if (isOpen && imagesLoaded) {
      walkthroughStartTimeRef.current = Date.now();
      slideStartTimeRef.current = Date.now();
      slideTimesRef.current = {};
    }
  }, [isOpen, imagesLoaded]);

  // Track time when slide changes
  const recordSlideTime = useCallback((fromSlide: number) => {
    const timeSpent = Date.now() - slideStartTimeRef.current;
    const slideName = SLIDE_NAMES[fromSlide];
    slideTimesRef.current[slideName] = (slideTimesRef.current[slideName] || 0) + timeSpent;
    slideStartTimeRef.current = Date.now();
  }, []);

  const handleNext = useCallback(() => {
    recordSlideTime(currentSlide);

    if (currentSlide < WALKTHROUGH_SLIDES.length - 1) {
      setCurrentSlide(currentSlide + 1);
    } else {
      // Completed all slides
      const totalTime = Date.now() - walkthroughStartTimeRef.current;
      posthog?.capture('feature_walkthrough_completed', {
        total_time_ms: totalTime,
        slide_times: slideTimesRef.current,
        skipped: false,
      });
      onComplete();
    }
  }, [currentSlide, onComplete, posthog, recordSlideTime]);

  const handlePrevious = useCallback(() => {
    recordSlideTime(currentSlide);
    if (currentSlide > 0) {
      setCurrentSlide(currentSlide - 1);
    }
  }, [currentSlide, recordSlideTime]);

  const handleDotClick = useCallback((index: number) => {
    recordSlideTime(currentSlide);
    setCurrentSlide(index);
  }, [currentSlide, recordSlideTime]);

  const handleSkip = useCallback(() => {
    // Record time on current slide before skipping
    recordSlideTime(currentSlide);

    const totalTime = Date.now() - walkthroughStartTimeRef.current;
    posthog?.capture('feature_walkthrough_completed', {
      total_time_ms: totalTime,
      slide_times: slideTimesRef.current,
      skipped: true,
      skipped_at_slide: SLIDE_NAMES[currentSlide],
    });
    onSkip();
  }, [currentSlide, onSkip, posthog, recordSlideTime]);

  if (!isOpen || !imagesLoaded || !maxImageDimensions) return null;

  const slide = WALKTHROUGH_SLIDES[currentSlide];
  const isLastSlide = currentSlide === WALKTHROUGH_SLIDES.length - 1;

  // Calculate display dimensions:
  // - Use native resolution when screen is large enough
  // - Scale down proportionally when screen is smaller
  // - Ensure entire dialog (image + title + dots + buttons) fits on screen
  const dialogHorizontalPadding = 48; // 24px padding on each side of image container
  // Vertical chrome breakdown:
  // - Image container padding: 48px (24 top + 24 bottom)
  // - Content/title area: ~86px (24 top + 32 bottom padding + ~30px title)
  // - Dots: ~26px (16px bottom padding + 10px height)
  // - Footer: ~84px (16 top + 24 bottom padding + ~44px button)
  // Total: ~244px, add buffer for borders/rounding = 260px
  const dialogVerticalChrome = 260;
  const screenMargin = 40; // Minimum margin from screen edges

  const maxAvailableWidth = windowSize.width - (screenMargin * 2) - dialogHorizontalPadding;
  const maxAvailableHeight = windowSize.height - (screenMargin * 2) - dialogVerticalChrome;

  const nativeWidth = maxImageDimensions.width;
  const nativeHeight = maxImageDimensions.height;
  const aspectRatio = nativeWidth / nativeHeight;

  // Start with native dimensions, then constrain to fit
  let displayWidth = Math.min(nativeWidth, maxAvailableWidth);
  let displayHeight = displayWidth / aspectRatio;

  // If height still doesn't fit, constrain by height instead
  if (displayHeight > maxAvailableHeight) {
    displayHeight = maxAvailableHeight;
    displayWidth = displayHeight * aspectRatio;
  }

  return (
    <div className="feature-walkthrough-overlay">
      <div className="feature-walkthrough-dialog">
        {/* Image container with fixed dimensions based on largest image */}
        <div
          className="feature-walkthrough-image-container"
          style={{
            width: displayWidth,
            height: displayHeight,
            minWidth: displayWidth,
            minHeight: displayHeight,
          }}
        >
          <img
            src={slide.image}
            alt={slide.title}
            className="feature-walkthrough-image"
          />
        </div>

        {/* Content - title only since images contain descriptions */}
        <div className="feature-walkthrough-content">
          <h2 className="feature-walkthrough-title">{slide.title}</h2>
        </div>

        {/* Dots indicator */}
        <div className="feature-walkthrough-dots">
          {WALKTHROUGH_SLIDES.map((_, index) => (
            <button
              key={index}
              className={`feature-walkthrough-dot ${index === currentSlide ? 'active' : ''}`}
              onClick={() => handleDotClick(index)}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>

        {/* Footer with buttons */}
        <div className="feature-walkthrough-footer">
          <button
            className="feature-walkthrough-skip-button"
            onClick={handleSkip}
          >
            Skip
          </button>
          <div className="feature-walkthrough-nav-buttons">
            {currentSlide > 0 && (
              <button
                className="feature-walkthrough-nav-button secondary"
                onClick={handlePrevious}
              >
                Previous
              </button>
            )}
            <button
              className="feature-walkthrough-nav-button primary"
              onClick={handleNext}
            >
              {isLastSlide ? 'Get Started' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
