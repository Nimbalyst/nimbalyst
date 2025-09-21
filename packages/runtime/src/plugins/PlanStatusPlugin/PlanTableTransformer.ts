/**
 * PlanTableTransformer - Handles markdown import/export for plan tables
 */

import { ElementTransformer } from '@lexical/markdown';
import { $createPlanTableNode, PlanTableNode, $isPlanTableNode, SortColumn, SortDirection } from './PlanTableNode';

const PLAN_TABLE_REGEX = /^<!--\s*plan-table(?:\s+sortBy="([^"]+)"\s+sortDirection="([^"]+)")?\s*-->\s*$/;

export const PLAN_TABLE_TRANSFORMER: ElementTransformer = {
  dependencies: [PlanTableNode],

  export: (node) => {
    if (!$isPlanTableNode(node)) {
      return null;
    }

    const sortBy = node.getSortBy();
    const sortDirection = node.getSortDirection();

    // Only include sorting attributes if they differ from defaults
    if (sortBy === 'lastUpdated' && sortDirection === 'desc') {
      return '<!-- plan-table -->';
    }

    return `<!-- plan-table sortBy="${sortBy}" sortDirection="${sortDirection}" -->`;
  },

  regExp: PLAN_TABLE_REGEX,

  replace: (textNode, _node, matches) => {
    const match = matches[0];
    const sortBy = matches[1] as SortColumn | undefined;
    const sortDirection = matches[2] as SortDirection | undefined;

    if (PLAN_TABLE_REGEX.test(match)) {
      const planTableNode = $createPlanTableNode(
        sortBy || 'lastUpdated',
        sortDirection || 'desc'
      );
      textNode.replace(planTableNode);
    }
  },

  type: 'element',
};