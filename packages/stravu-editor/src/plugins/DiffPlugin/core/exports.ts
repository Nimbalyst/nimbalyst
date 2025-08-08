/**
 * Core exports from the diff functionality
 */

// Core diff types
export type { Change } from './diffPluginUtils';

// Plugin utilities (needed for React plugin and toolbar)
export {
  $approveDiffs,
  $hasDiffNodes,
  $rejectDiffs,
  APPLY_DIFF_COMMAND,
  APPROVE_DIFF_COMMAND,
  REJECT_DIFF_COMMAND,
} from './diffPluginUtils';

// DiffState utilities for diff tracking
export {
  $getDiffState,
  $setDiffState,
  $clearDiffState,
  $hasDiffState,
} from './DiffState';
export type { DiffStateType } from './DiffState';

// Main API - the primary entry point
export { applyMarkdownDiff, applyMarkdownReplace } from './diffUtils';
export type { TextReplacement } from './diffUtils';

// Testing utilities
export { NodeStructureValidator } from './NodeStructureValidator';
export { generateUnifiedDiff } from './standardDiffFormat';

export { diffHandlerRegistry } from '../handlers';
export { NoopDiffHandler } from '../handlers/NoopDiffHandler';

export { DiffError } from './DiffError';