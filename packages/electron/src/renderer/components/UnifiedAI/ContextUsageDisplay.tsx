import React, { useId, useMemo, useState, useRef, useCallback } from 'react';
import type { TokenUsageCategory } from '@nimbalyst/runtime/ai/server/types';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { getHelpContent } from '../../help';
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
  inputTokens: number;       // Cumulative input tokens (for tooltip breakdown)
  outputTokens: number;      // Cumulative output tokens (for tooltip breakdown)
  totalTokens: number;       // Cumulative total tokens (fallback if no currentContext)
  contextWindow: number;     // Context window size (legacy, use currentContext)
  categories?: TokenUsageCategory[];  // Categories (legacy, use currentContext)
  // Current context snapshot for Claude Code (from /context command)
  currentContext?: {
    tokens: number;          // Current tokens in context window
    contextWindow: number;   // Max context window size
    categories?: TokenUsageCategory[];
  };
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
  categories,
  currentContext
}: ContextUsageDisplayProps) {
  // For context window display, prefer currentContext (from /context command)
  // Fall back to legacy fields for backward compatibility
  const displayTokens = currentContext?.tokens ?? totalTokens;
  const displayContextWindow = currentContext?.contextWindow ?? contextWindow;
  const displayCategories = currentContext?.categories ?? categories;

  // Check what data we have
  const hasTokenData = displayTokens > 0 || totalTokens > 0;
  const hasContextWindow = displayContextWindow > 0;
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [helpExpanded, setHelpExpanded] = useState(false);
  const tooltipId = useId();
  const helpContent = getHelpContent('context-indicator');
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Calculate percentage used (only meaningful with context window)
  const percentage = hasContextWindow ? Math.round((displayTokens / displayContextWindow) * 100) : 0;

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
    if (!displayCategories || displayCategories.length === 0) {
      return [];
    }

    return displayCategories
      .filter(cat => cat && (cat.tokens > 0 || cat.percentage > 0))
      .map((cat, index) => ({
        ...cat,
        color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
        width: Math.max(0, Math.min(cat.percentage, 100)),
        percentText: formatPercent(cat.percentage)
      }));
  }, [displayCategories]);

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

  // Clear any pending hide timeout
  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  // Show tooltip immediately, hide with delay to allow moving mouse to tooltip
  const handleMouseEnter = useCallback(() => {
    clearHideTimeout();
    if (enableTooltip) {
      setTooltipVisible(true);
    }
  }, [enableTooltip, clearHideTimeout]);

  const handleMouseLeave = useCallback(() => {
    // Delay hiding to allow moving mouse to tooltip
    hideTimeoutRef.current = setTimeout(() => {
      setTooltipVisible(false);
    }, 150);
  }, []);

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
      return `${formatTokensShort(displayTokens)}/${formatTokensShort(displayContextWindow)} (${percentage}%)`;
    }
    return `${formatTokensShort(displayTokens)} tokens`;
  };

  const label = hasTokenData
    ? hasContextWindow
      ? `Context usage ${formatTokensShort(displayTokens)} of ${formatTokensShort(displayContextWindow)} tokens (${percentage}%)`
      : `Token usage: ${formatTokensShort(displayTokens)} total tokens`
    : 'Token usage data not available yet';

  return (
    <div
      className={`context-usage-display ${getUsageClass()}`}
      tabIndex={hasTokenData ? 0 : -1}
      aria-label={label}
      aria-describedby={shouldShowTooltip ? tooltipId : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
      role="group"
      data-testid="context-indicator"
    >
      <span className="usage-text">{getDisplayText()}</span>

      {shouldShowTooltip && (
        <div
          className="context-usage-tooltip"
          id={tooltipId}
          role="tooltip"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="tooltip-header">
            <div className="tooltip-header-left">
              <span>{hasContextWindow ? 'Context Breakdown' : 'Token Usage'}</span>
              {helpContent && (
                <button
                  className="tooltip-help-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setHelpExpanded(!helpExpanded);
                  }}
                  title={helpExpanded ? 'Hide help' : 'What is this?'}
                  aria-expanded={helpExpanded}
                >
                  <MaterialSymbol icon={helpExpanded ? 'expand_less' : 'help'} size={14} />
                </button>
              )}
            </div>
            {hasContextWindow && (
              <span className="tooltip-total">
                {formatTokensShort(displayTokens)} / {formatTokensShort(displayContextWindow)}
              </span>
            )}
          </div>

          {/* Expandable help section */}
          {helpExpanded && helpContent && (
            <div className="tooltip-help-section">
              <div className="tooltip-help-title">{helpContent.title}</div>
              <div className="tooltip-help-body">{helpContent.body}</div>
            </div>
          )}

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
