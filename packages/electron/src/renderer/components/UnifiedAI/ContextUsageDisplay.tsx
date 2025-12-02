import React, { useId, useMemo, useState } from 'react';
import type { TokenUsageCategory } from '@nimbalyst/runtime/ai/server/types';
import './ContextUsageDisplay.css';

const CATEGORY_COLORS = [
  'var(--primary-color)',
  '#5E81F4',
  '#4AB4D8',
  '#F59E0B',
  '#F97316',
  '#EC4899',
  '#8B5CF6'
];

interface ContextUsageDisplayProps {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextWindow: number;
  categories?: TokenUsageCategory[];
}

interface FormattedCategory extends TokenUsageCategory {
  color: string;
  width: number;
  percentText: string;
}

/**
 * ContextUsageDisplay shows token usage for AI sessions
 *
 * Display formats:
 * - With context window: "110k/200k Tokens (55%)" - shows percentage usage
 * - Without context window: "15k Tokens" - just shows cumulative total
 * - No data yet: "--"
 */
export function ContextUsageDisplay({
  inputTokens,
  outputTokens,
  totalTokens,
  contextWindow,
  categories
}: ContextUsageDisplayProps) {
  // Check what data we have
  const hasTokenData = totalTokens > 0;
  const hasContextWindow = contextWindow > 0;
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const tooltipId = useId();

  // Calculate percentage used (only meaningful with context window)
  const percentage = hasContextWindow ? Math.round((totalTokens / contextWindow) * 100) : 0;

  // Format numbers with k suffix for thousands
  const formatTokensShort = (tokens: number): string => {
    if (tokens >= 1000) {
      return `${Math.round(tokens / 1000)}k`;
    }
    return tokens.toString();
  };

  const formatPercent = (value: number): string => {
    if (!Number.isFinite(value)) {
      return '0';
    }
    return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
  };

  const formattedCategories = useMemo<FormattedCategory[]>(() => {
    if (!categories || categories.length === 0) {
      return [];
    }

    return categories
      .filter(cat => cat && (cat.tokens > 0 || cat.percentage > 0))
      .map((cat, index) => ({
        ...cat,
        color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
        width: Math.max(0, Math.min(cat.percentage, 100)),
        percentText: formatPercent(cat.percentage)
      }));
  }, [categories]);

  // Categories that represent actual usage (exclude "Free space" from bar fill)
  const usedCategories = useMemo(() => {
    return formattedCategories.filter(cat =>
      !cat.name.toLowerCase().includes('free')
    );
  }, [formattedCategories]);

  // Total width of used categories for the bar fill
  const usedPercentage = useMemo(() => {
    return usedCategories.reduce((sum, cat) => sum + cat.width, 0);
  }, [usedCategories]);

  const enableTooltip = hasTokenData && (formattedCategories.length > 0 || inputTokens > 0 || outputTokens > 0);
  const shouldShowTooltip = tooltipVisible && enableTooltip;

  const getUsageClass = (): string => {
    if (!hasTokenData) return 'usage-normal';
    if (hasContextWindow && percentage >= 90) return 'usage-critical';
    if (hasContextWindow && percentage >= 80) return 'usage-warning';
    return 'usage-normal';
  };

  // Build display text
  const getDisplayText = (): string => {
    if (!hasTokenData) return '--';
    if (hasContextWindow) {
      return `${formatTokensShort(totalTokens)}/${formatTokensShort(contextWindow)} (${percentage}%)`;
    }
    return `${formatTokensShort(totalTokens)} tokens`;
  };

  const label = hasTokenData
    ? hasContextWindow
      ? `Context usage ${formatTokensShort(totalTokens)} of ${formatTokensShort(contextWindow)} tokens (${percentage}%)`
      : `Token usage: ${formatTokensShort(totalTokens)} total tokens`
    : 'Token usage data not available yet';

  const handleVisibilityChange = (visible: boolean) => {
    if (!enableTooltip) return;
    setTooltipVisible(visible);
  };

  return (
    <div
      className={`context-usage-display ${getUsageClass()}`}
      tabIndex={hasTokenData ? 0 : -1}
      aria-label={label}
      aria-describedby={shouldShowTooltip ? tooltipId : undefined}
      onMouseEnter={() => handleVisibilityChange(true)}
      onMouseLeave={() => handleVisibilityChange(false)}
      onFocus={() => handleVisibilityChange(true)}
      onBlur={() => handleVisibilityChange(false)}
      role="group"
    >
      <span className="usage-text">{getDisplayText()}</span>

      {shouldShowTooltip && (
        <div className="context-usage-tooltip" id={tooltipId} role="tooltip">
          <div className="tooltip-header">
            <span>{hasContextWindow ? 'Context Breakdown' : 'Token Usage'}</span>
            {hasContextWindow && (
              <span className="tooltip-total">
                {formatTokensShort(totalTokens)} / {formatTokensShort(contextWindow)}
              </span>
            )}
          </div>

          {/* Show input/output breakdown if available */}
          {(inputTokens > 0 || outputTokens > 0) && (
            <div className="tooltip-io-breakdown">
              <div className="tooltip-io-row">
                <span className="tooltip-io-label">Input:</span>
                <span className="tooltip-io-value">{inputTokens.toLocaleString()}</span>
              </div>
              <div className="tooltip-io-row">
                <span className="tooltip-io-label">Output:</span>
                <span className="tooltip-io-value">{outputTokens.toLocaleString()}</span>
              </div>
              <div className="tooltip-io-row tooltip-io-total">
                <span className="tooltip-io-label">Total:</span>
                <span className="tooltip-io-value">{totalTokens.toLocaleString()}</span>
              </div>
            </div>
          )}

          {/* Category bar (only for Claude Code with context data) */}
          {hasContextWindow && formattedCategories.length > 0 && (
            <>
              <div className="tooltip-bar">
                <div className="tooltip-bar-fill" style={{ width: `${usedPercentage}%` }}>
                  {usedCategories.map((cat, index) => {
                    // Calculate width relative to the used portion
                    const relativeWidth = usedPercentage > 0 ? (cat.width / usedPercentage) * 100 : 0;
                    return (
                      <span
                        key={`${cat.name}-${index}`}
                        className="tooltip-bar-segment"
                        style={{ width: `${relativeWidth}%`, backgroundColor: cat.color }}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="tooltip-categories">
                {formattedCategories.map((cat, index) => {
                  const isFreeSpace = cat.name.toLowerCase().includes('free');
                  return (
                    <div
                      className={`tooltip-category-row${isFreeSpace ? ' free-space' : ''}`}
                      key={`${cat.name}-${index}`}
                    >
                      <span
                        className="tooltip-dot"
                        style={isFreeSpace ? undefined : { backgroundColor: cat.color }}
                      />
                      <span className="tooltip-category-name">{cat.name}</span>
                      <span className="tooltip-category-tokens">{cat.tokens.toLocaleString()} tokens</span>
                      <span className="tooltip-category-percent">{cat.percentText}%</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
