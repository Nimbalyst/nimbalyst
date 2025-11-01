/**
 * Unified AI Interface Components
 *
 * This module provides a unified architecture for AI chat and agentic coding interfaces.
 * It merges the functionality of AgenticCodingWindow and AIChat into reusable components.
 *
 * @see README.md for detailed documentation and migration guide
 */

export { AIInput } from './AIInput';
export type { AIInputRef } from './AIInput';
export { AISessionView } from './AISessionView';
export type { AISessionViewProps, AISessionViewRef } from './AISessionView';
export { default as AgenticPanel } from './AgenticPanel'
export type { AgenticPanelProps, AgenticPanelRef } from './AgenticPanel';
