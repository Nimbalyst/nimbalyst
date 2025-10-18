/**
 * Window Mode System Types
 *
 * Defines content modes available in workspace windows.
 * Each component manages its own state - this just tracks which mode is active.
 */

/**
 * Content modes available in workspace windows
 */
export type ContentMode = 'files' | 'agent' | 'plan' | 'tracker' | 'settings';

/**
 * Sidebar views (orthogonal to content modes)
 */
export type SidebarView = 'files' | 'plans' | 'settings';
