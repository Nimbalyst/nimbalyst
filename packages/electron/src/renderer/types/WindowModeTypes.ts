/**
 * Window Mode System Types
 *
 * Defines content modes available in workspace windows.
 * Each component manages its own state - this just tracks which mode is active.
 */

/**
 * Content modes available in workspace windows
 * - files: File tree and editor tabs
 * - agent: Agentic coding panel
 * - settings: Settings view
 */
export type ContentMode = 'files' | 'agent' | 'tracker' | 'collab' | 'settings';
