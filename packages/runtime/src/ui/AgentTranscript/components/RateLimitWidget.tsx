import React, { useEffect } from 'react';

// Inject rate limit widget styles once (for color-mix patterns)
const injectRateLimitStyles = () => {
  const styleId = 'rate-limit-widget-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .rate-limit-widget {
      background-color: color-mix(in srgb, var(--nim-warning) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--nim-warning) 25%, transparent);
    }
  `;
  document.head.appendChild(style);
};

interface RateLimitWidgetProps {
  errorMessage: string;
}

/**
 * Parses reset time from the error message format:
 * "Rate limited (5-hour session limit). Resets at: 2026-02-27T23:00:00.000Z. [RATE_LIMIT]"
 */
function parseResetTime(errorMessage: string): string | null {
  const match = errorMessage.match(/Resets at: (.+?)\./);
  if (!match || match[1] === 'unknown') return null;
  return match[1];
}

function formatResetTime(isoString: string): string {
  try {
    const resetDate = new Date(isoString);
    const now = new Date();
    const diffMs = resetDate.getTime() - now.getTime();

    if (diffMs <= 0) return 'any moment now';

    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMinutes / 60);
    const remainingMinutes = diffMinutes % 60;

    if (diffHours > 0) {
      return `${diffHours}h ${remainingMinutes}m`;
    }
    return `${diffMinutes}m`;
  } catch {
    return isoString;
  }
}

function parseLimitType(errorMessage: string): string {
  const match = errorMessage.match(/Rate limited \((.+?) limit\)/);
  return match ? match[1] : 'usage';
}

export const RateLimitWidget: React.FC<RateLimitWidgetProps> = ({ errorMessage }) => {
  useEffect(() => {
    injectRateLimitStyles();
  }, []);

  const resetTime = parseResetTime(errorMessage);
  const limitType = parseLimitType(errorMessage);

  return (
    <div className="rate-limit-widget my-4 p-4 rounded-lg flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--nim-warning)] text-white text-xs font-bold">!</span>
        <span className="text-[var(--nim-warning)] text-sm font-semibold">Rate limit reached</span>
      </div>
      <div className="text-[var(--nim-text-muted)] text-[0.85rem] leading-relaxed">
        You've hit your {limitType} rate limit.
        {resetTime && ` Resets in ${formatResetTime(resetTime)}.`}
      </div>
    </div>
  );
};
