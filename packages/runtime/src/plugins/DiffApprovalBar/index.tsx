import { useEffect } from 'react';
import { $hasDiffNodes } from '../../editor';
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
        // Only check for diff nodes if this is a Lexical editor
        // Monaco editors use a different diff system (Phase 2)
        if (typeof (context.editor as any).getEditorState !== 'function') {
          return false;
        }
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
