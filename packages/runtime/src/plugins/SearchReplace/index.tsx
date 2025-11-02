import { useEffect } from 'react';
import { FixedTabHeaderRegistry } from '../shared/fixedTabHeader/FixedTabHeaderRegistry';
import type { TabContext } from '../shared/fixedTabHeader/types';
import { SearchReplaceBar } from './SearchReplaceBar';
import { SearchReplaceStateManager } from './SearchReplaceStateManager';

/**
 * SearchReplacePlugin
 *
 * Registers the SearchReplaceBar with the FixedTabHeaderRegistry.
 * The bar is shown when search is open for a tab.
 */
export function SearchReplacePlugin() {
  useEffect(() => {
    const registry = FixedTabHeaderRegistry.getInstance();

    // Register the search/replace bar provider
    registry.register({
      id: 'search-replace-bar',
      priority: 90, // Slightly lower than DiffApprovalBar (100), so diff bar renders first
      shouldRender: (context: TabContext) => {
        // Always render if there's an editor - the component will handle visibility internally
        return !!(context.editor && context.filePath);
      },
      component: SearchReplaceBar,
    });

    return () => {
      registry.unregister('search-replace-bar');
    };
  }, []);

  return null; // Plugin doesn't render anything itself
}

// Export components and utilities for external use
export { SearchReplaceBar } from './SearchReplaceBar';
export { SearchReplaceStateManager } from './SearchReplaceStateManager';
export type { SearchReplaceState } from './SearchReplaceStateManager';
