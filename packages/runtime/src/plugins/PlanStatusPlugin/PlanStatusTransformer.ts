/**
 * Transformer for PlanStatus nodes
 * Exports to a simple marker that indicates where the plan status should be rendered
 */

import { ElementTransformer } from '@lexical/markdown';
import { LexicalNode } from 'lexical';
import {
  $createPlanStatusNode,
  $isPlanStatusNode,
  PlanStatusNode,
} from './PlanStatusDecoratorNode';

export const PLAN_STATUS_TRANSFORMER: ElementTransformer = {
  dependencies: [PlanStatusNode],
  export: (node: LexicalNode) => {
    // Export as a simple HTML comment marker
    // TODO: Could detect document type and export appropriate marker
    return $isPlanStatusNode(node) ? '<!-- plan-status -->' : null;
  },
  regExp: /^<!-- (?:plan-status|decision-status) -->$/,
  replace: (parentNode, _1, _2, isImport) => {
    const planStatusNode = $createPlanStatusNode();

    if (isImport || parentNode.getNextSibling() != null) {
      parentNode.replace(planStatusNode);
    } else {
      parentNode.insertBefore(planStatusNode);
    }

    // Don't select during import - this causes unwanted scroll-to-view behavior
    if (!isImport) {
      planStatusNode.selectNext();
    }
  },
  type: 'element',
};