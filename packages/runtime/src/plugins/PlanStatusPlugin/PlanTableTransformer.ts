/**
 * PlanTableTransformer - Handles markdown import/export for plan tables
 */

import { ElementTransformer } from '@lexical/markdown';
import { $createPlanTableNode, PlanTableNode, $isPlanTableNode } from './PlanTableNode';

const PLAN_TABLE_REGEX = /^<!--\s*plan-table\s*-->\s*$/;

export const PLAN_TABLE_TRANSFORMER: ElementTransformer = {
  dependencies: [PlanTableNode],

  export: (node) => {
    if (!$isPlanTableNode(node)) {
      return null;
    }

    return '<!-- plan-table -->';
  },

  regExp: PLAN_TABLE_REGEX,

  replace: (textNode, _node, matches) => {
    const match = matches[0];

    if (PLAN_TABLE_REGEX.test(match)) {
      const planTableNode = $createPlanTableNode();
      textNode.replace(planTableNode);
    }
  },

  type: 'element',
};