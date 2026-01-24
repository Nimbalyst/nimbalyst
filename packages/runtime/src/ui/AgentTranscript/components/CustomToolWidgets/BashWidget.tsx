/**
 * Custom widget for the Bash tool
 *
 * Displays bash commands and their output in a terminal-like interface with:
 * - Compact collapsed state showing command summary
 * - Expanded state with full command, description, and output
 * - Copy functionality for commands
 * - Terminal-style output display
 * - Status indicators (success/error/running)
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { CustomToolWidgetProps } from './index';
import './BashWidget.css';

/**
 * Maximum number of lines to show before adding "show more" in expanded view
 */
const MAX_VISIBLE_LINES = 15;

/**
 * Maximum characters for collapsed command display
 */
const MAX_COLLAPSED_COMMAND_LENGTH = 60;

/**
 * Extract the command from tool arguments
 */
function extractCommand(args: Record<string, any> | undefined): string | null {
  if (!args) return null;
  return args.command || null;
}

/**
 * Extract the description from tool arguments
 */
function extractDescription(args: Record<string, any> | undefined): string | null {
  if (!args) return null;
  return args.description || null;
}

/**
 * Extract output text from the tool result
 */
function extractOutputText(result: any): string | null {
  if (!result) return null;

  // Handle string result directly
  if (typeof result === 'string') {
    return result;
  }

  // Handle array of content blocks (Anthropic format)
  if (Array.isArray(result)) {
    const textParts: string[] = [];
    for (const block of result) {
      if (block.type === 'text' && typeof block.text === 'string') {
        textParts.push(block.text);
      }
    }
    return textParts.length > 0 ? textParts.join('\n') : null;
  }

  // Handle content wrapper object
  if (result.content && Array.isArray(result.content)) {
    const textParts: string[] = [];
    for (const block of result.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        textParts.push(block.text);
      }
    }
    return textParts.length > 0 ? textParts.join('\n') : null;
  }

  // Handle object with text field
  if (result.text && typeof result.text === 'string') {
    return result.text;
  }

  // Handle stdout/stderr format
  if (result.stdout || result.stderr) {
    const parts: string[] = [];
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(result.stderr);
    return parts.join('\n');
  }

  // Handle output field
  if (result.output && typeof result.output === 'string') {
    return result.output;
  }

  return null;
}

/**
 * Check if the tool result indicates an error
 */
function isToolError(result: any, message: any): boolean {
  if (message.isError) return true;
  if (result?.isError === true) return true;
  if (result?.exitCode && result.exitCode !== 0) return true;
  return false;
}

/**
 * Check if the tool is still running (no result yet)
 */
function isToolRunning(tool: any): boolean {
  return !tool.result;
}

/**
 * Count lines in a string
 */
function countLines(text: string): number {
  return text.split('\n').length;
}

/**
 * Truncate text to a maximum number of lines
 */
function truncateLines(text: string, maxLines: number): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join('\n');
}

/**
 * Truncate command for collapsed display
 */
function truncateCommand(command: string, maxLength: number): string {
  if (command.length <= maxLength) return command;
  return command.slice(0, maxLength) + '...';
}

/**
 * Get a short summary of the output for collapsed view
 */
function getOutputSummary(output: string | null): string | null {
  if (!output) return null;
  const lines = output.split('\n').filter(line => line.trim());
  if (lines.length === 0) return null;
  if (lines.length === 1) return lines[0].length > 50 ? lines[0].slice(0, 50) + '...' : lines[0];
  return `${lines.length} lines`;
}

export const BashWidget: React.FC<CustomToolWidgetProps> = ({ message, isExpanded, onToggle }) => {
  const [copied, setCopied] = useState(false);
  const [outputExpanded, setOutputExpanded] = useState(false);

  const tool = message.toolCall;

  // Reset copied state after timeout
  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [copied]);

  const handleCopyCommand = useCallback(async () => {
    const command = extractCommand(tool?.arguments);
    if (command) {
      try {
        await navigator.clipboard.writeText(command);
        setCopied(true);
      } catch (err) {
        console.error('Failed to copy command:', err);
      }
    }
  }, [tool?.arguments]);

  if (!tool) return null;

  const command = extractCommand(tool.arguments);
  const description = extractDescription(tool.arguments);
  const output = extractOutputText(tool.result);
  const hasError = isToolError(tool.result, message);
  const isRunning = isToolRunning(tool);

  // Check if output needs truncation in expanded view
  const outputLineCount = output ? countLines(output) : 0;
  const needsTruncation = outputLineCount > MAX_VISIBLE_LINES;
  const displayOutput = output && needsTruncation && !outputExpanded
    ? truncateLines(output, MAX_VISIBLE_LINES)
    : output;
  const hiddenLineCount = outputLineCount - MAX_VISIBLE_LINES;

  // For collapsed view
  const truncatedCommand = command ? truncateCommand(command, MAX_COLLAPSED_COMMAND_LENGTH) : null;
  const outputSummary = getOutputSummary(output);

  // Collapsed view - two lines: description/label + command
  if (!isExpanded) {
    // Get first line of command for display
    const firstLineCommand = command ? command.split('\n')[0] : null;
    const displayCommand = firstLineCommand
      ? truncateCommand(firstLineCommand, MAX_COLLAPSED_COMMAND_LENGTH)
      : null;

    return (
      <button
        className={`bash-widget bash-widget--collapsed ${hasError ? 'bash-widget--error' : ''} ${isRunning ? 'bash-widget--running' : ''}`}
        onClick={onToggle}
        type="button"
      >
        <div className="bash-widget__collapsed-content">
          <div className="bash-widget__collapsed-icon">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5"></polyline>
              <line x1="12" y1="19" x2="20" y2="19"></line>
            </svg>
          </div>
          <div className="bash-widget__collapsed-text">
            {description ? (
              <>
                <span className="bash-widget__collapsed-description">{description}</span>
                {displayCommand && (
                  <code className="bash-widget__collapsed-command">{displayCommand}</code>
                )}
              </>
            ) : displayCommand ? (
              <code className="bash-widget__collapsed-command">{displayCommand}</code>
            ) : (
              <span className="bash-widget__collapsed-label">Bash</span>
            )}
          </div>
        </div>
        <div className="bash-widget__collapsed-right">
          {isRunning && (
            <span className="bash-widget__status bash-widget__status--running">
              <span className="bash-widget__spinner" />
            </span>
          )}
          {!isRunning && !hasError && (
            <span className="bash-widget__status bash-widget__status--success">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </span>
          )}
          {!isRunning && hasError && (
            <span className="bash-widget__status bash-widget__status--error">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </span>
          )}
          <svg className="bash-widget__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </div>
      </button>
    );
  }

  // Expanded view - full details
  return (
    <div className={`bash-widget ${hasError ? 'bash-widget--error' : ''} ${isRunning ? 'bash-widget--running' : ''}`}>
      {/* Header with terminal icon and status */}
      <button className="bash-widget__header" onClick={onToggle} type="button">
        <div className="bash-widget__header-left">
          <div className="bash-widget__icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5"></polyline>
              <line x1="12" y1="19" x2="20" y2="19"></line>
            </svg>
          </div>
          <span className="bash-widget__title">Terminal</span>
        </div>
        <div className="bash-widget__header-right">
          {isRunning && (
            <span className="bash-widget__status bash-widget__status--running">
              <span className="bash-widget__spinner" />
              Running
            </span>
          )}
          {!isRunning && !hasError && (
            <span className="bash-widget__status bash-widget__status--success">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </span>
          )}
          {!isRunning && hasError && (
            <span className="bash-widget__status bash-widget__status--error">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </span>
          )}
          <svg className="bash-widget__chevron bash-widget__chevron--expanded" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
      </button>

      {/* Description if present */}
      {description && (
        <div className="bash-widget__description">
          {description}
        </div>
      )}

      {/* Command display */}
      {command && (
        <div className="bash-widget__command-container">
          <div className="bash-widget__command">
            <span className="bash-widget__prompt">$</span>
            <code className="bash-widget__command-text">{command}</code>
          </div>
          <button
            className={`bash-widget__copy ${copied ? 'bash-widget__copy--copied' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              handleCopyCommand();
            }}
            title={copied ? 'Copied!' : 'Copy command'}
            aria-label={copied ? 'Copied!' : 'Copy command'}
            type="button"
          >
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            )}
          </button>
        </div>
      )}

      {/* Output display */}
      {displayOutput && (
        <div className="bash-widget__output-container">
          <pre className={`bash-widget__output ${hasError ? 'bash-widget__output--error' : ''}`}>
            {displayOutput}
          </pre>
          {needsTruncation && (
            <button
              className="bash-widget__expand-toggle"
              onClick={() => setOutputExpanded(!outputExpanded)}
              type="button"
            >
              {outputExpanded
                ? 'Show less'
                : `Show ${hiddenLineCount} more line${hiddenLineCount === 1 ? '' : 's'}`
              }
            </button>
          )}
        </div>
      )}

      {/* Running indicator with no output yet */}
      {isRunning && !output && (
        <div className="bash-widget__running-indicator">
          <span className="bash-widget__dots">
            <span></span>
            <span></span>
            <span></span>
          </span>
        </div>
      )}
    </div>
  );
};
