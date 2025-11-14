import React from 'react';
import './ContextUsageDisplay.css';

interface ContextUsageDisplayProps {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextWindow: number;
}

/**
 * ContextUsageDisplay shows token usage for Claude Code sessions
 * Displays format: "110k/200k Tokens (55%)"
 *
 * CRITICAL: Token data comes ONLY from /context command results.
 * If token data is not yet available (values are 0), shows "--" instead.
 */
export function ContextUsageDisplay({
  inputTokens,
  outputTokens,
  totalTokens,
  contextWindow
}: ContextUsageDisplayProps) {
  // If no token data is available yet (all zeros), show placeholder
  const hasTokenData = totalTokens > 0 && contextWindow > 0;

  // Calculate percentage used
  const percentage = contextWindow > 0 ? Math.round((totalTokens / contextWindow) * 100) : 0;

  // Format numbers with k suffix for thousands
  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000) {
      return `${Math.round(tokens / 1000)}k`;
    }
    return tokens.toString();
  };

  // Determine color based on usage level
  const getUsageClass = (): string => {
    if (!hasTokenData) return 'usage-normal';
    if (percentage >= 90) return 'usage-critical';
    if (percentage >= 80) return 'usage-warning';
    return 'usage-normal';
  };

  return (
    <div className={`context-usage-display ${getUsageClass()}`}>
      <span className="usage-text">
        {hasTokenData ? (
          `${formatTokens(totalTokens)}/${formatTokens(contextWindow)} Tokens (${percentage}%)`
        ) : (
          '--'
        )}
      </span>
    </div>
  );
}
