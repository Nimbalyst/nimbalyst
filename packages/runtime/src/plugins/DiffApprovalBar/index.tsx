import { useEffect } from 'react';
import { $hasDiffNodes } from 'rexical';
import { FixedTabHeaderRegistry } from '../shared/fixedTabHeader/FixedTabHeaderRegistry';
import type { TabContext } from '../shared/fixedTabHeader/types';
import { DiffApprovalBar } from './DiffApprovalBar';

/**
 * Plugin to register the DiffApprovalBar with the FixedTabHeaderRegistry
 */
export function DiffApprovalBarPlugin() {
  useEffect(() => {
    const registry = FixedTabHeaderRegistry.getInstance();

    registry.register({
      id: 'diff-approval-bar',
      priority: 100,
      shouldRender: (context: TabContext) => {
        if (!context.editor) return false;
        return $hasDiffNodes(context.editor);
      },
      component: DiffApprovalBar,
    });

    return () => {
      registry.unregister('diff-approval-bar');
    };
  }, []);

  return null;
}

export { DiffApprovalBar };
