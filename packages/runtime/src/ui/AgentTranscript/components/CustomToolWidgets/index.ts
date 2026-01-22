/**
 * Custom Tool Widget Registry
 *
 * This module provides a framework for registering custom widgets that replace
 * the default tool call rendering in the AI transcript view.
 *
 * ## How to add a new custom tool widget:
 *
 * 1. Create a new widget component in this folder (e.g., MyToolWidget.tsx)
 *    - The component should accept CustomToolWidgetProps
 *    - Export the component
 *
 * 2. Register the widget in this file:
 *    - Import the component
 *    - Add an entry to CUSTOM_TOOL_WIDGETS mapping tool name to component
 *
 * ## Example:
 *
 * ```typescript
 * // In MyToolWidget.tsx
 * import React from 'react';
 * import type { CustomToolWidgetProps } from './index';
 *
 * export const MyToolWidget: React.FC<CustomToolWidgetProps> = ({ message, isExpanded, onToggle }) => {
 *   const tool = message.toolCall!;
 *   // Render your custom UI
 *   return <div>...</div>;
 * };
 *
 * // In index.ts
 * import { MyToolWidget } from './MyToolWidget';
 *
 * export const CUSTOM_TOOL_WIDGETS: CustomToolWidgetRegistry = {
 *   'my_tool_name': MyToolWidget,
 *   // MCP tools are often prefixed - register both variants
 *   'mcp__nimbalyst__my_tool_name': MyToolWidget,
 * };
 * ```
 */

import type { Message } from '../../../../ai/server/types';

// Re-export widgets
export { MockupScreenshotWidget } from './MockupScreenshotWidget';
export { AskUserQuestionWidget, storeAskUserQuestionAnswers } from './AskUserQuestionWidget';
export { VisualDisplayWidget } from './VisualDisplayWidget';
export { BashWidget } from './BashWidget';

/**
 * Props passed to custom tool widgets
 */
export interface CustomToolWidgetProps {
  /** The message containing the tool call */
  message: Message;
  /** Whether the widget is expanded (for collapsible widgets) */
  isExpanded: boolean;
  /** Toggle expand/collapse state */
  onToggle: () => void;
  /** Workspace path for resolving relative paths */
  workspacePath?: string;
  /** Optional: Read a file from the filesystem (for loading persisted output files) */
  readFile?: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
}

/**
 * A React component that renders a custom tool widget
 */
export type CustomToolWidgetComponent = React.FC<CustomToolWidgetProps>;

/**
 * Registry mapping tool names to custom widget components
 */
export type CustomToolWidgetRegistry = Record<string, CustomToolWidgetComponent>;

// Import custom widgets
import { MockupScreenshotWidget } from './MockupScreenshotWidget';
import { AskUserQuestionWidget } from './AskUserQuestionWidget';
import { VisualDisplayWidget } from './VisualDisplayWidget';
import { BashWidget } from './BashWidget';

/**
 * Registry of custom tool widgets
 *
 * Keys are tool names (as they appear in message.toolCall.name)
 * Values are React components that render the custom widget
 *
 * Note: MCP tools may have prefixed names (e.g., mcp__nimbalyst__capture_mockup_screenshot)
 * Register both the base name and prefixed variants for full compatibility.
 */
export const CUSTOM_TOOL_WIDGETS: CustomToolWidgetRegistry = {
  // Mockup screenshot capture tool
  'capture_mockup_screenshot': MockupScreenshotWidget,
  'mcp__nimbalyst__capture_mockup_screenshot': MockupScreenshotWidget,

  // AskUserQuestion tool - displays questions from Claude for user input
  'AskUserQuestion': AskUserQuestionWidget,

  // Display to user tool - renders charts and image galleries inline in the transcript
  'display_to_user': VisualDisplayWidget,
  'mcp__nimbalyst__display_to_user': VisualDisplayWidget,

  // Bash tool - terminal-style display for shell commands
  'Bash': BashWidget,
};

/**
 * Get a custom widget component for a tool name, if one is registered
 *
 * This function handles MCP prefix stripping automatically:
 * - First checks for exact match
 * - Then strips 'mcp__nimbalyst__' prefix and checks again
 * - Then strips any 'mcp__*__' prefix pattern and checks again
 *
 * @param toolName The name of the tool from the message
 * @returns The custom widget component, or undefined if none registered
 */
export function getCustomToolWidget(toolName: string): CustomToolWidgetComponent | undefined {
  // Direct match
  if (CUSTOM_TOOL_WIDGETS[toolName]) {
    return CUSTOM_TOOL_WIDGETS[toolName];
  }

  // Strip nimbalyst MCP prefix
  const withoutNimbalystPrefix = toolName.replace(/^mcp__nimbalyst__/, '');
  if (withoutNimbalystPrefix !== toolName && CUSTOM_TOOL_WIDGETS[withoutNimbalystPrefix]) {
    return CUSTOM_TOOL_WIDGETS[withoutNimbalystPrefix];
  }

  // Strip any MCP prefix pattern (mcp__serverName__)
  const withoutAnyMcpPrefix = toolName.replace(/^mcp__[^_]+__/, '');
  if (withoutAnyMcpPrefix !== toolName && CUSTOM_TOOL_WIDGETS[withoutAnyMcpPrefix]) {
    return CUSTOM_TOOL_WIDGETS[withoutAnyMcpPrefix];
  }

  return undefined;
}

/**
 * Check if a tool has a custom widget registered
 *
 * @param toolName The name of the tool from the message
 * @returns true if a custom widget is registered for this tool
 */
export function hasCustomToolWidget(toolName: string): boolean {
  return getCustomToolWidget(toolName) !== undefined;
}
