/**
 * Transformer for DecisionStatus nodes
 * Exports to a simple marker that indicates where the decision status should be rendered
 */

import { ElementTransformer } from '@lexical/markdown';
import { LexicalNode } from 'lexical';
import {
  $createDecisionStatusNode,
  $isDecisionStatusNode,
  DecisionStatusNode,
} from './DecisionStatusDecoratorNode';

export const DECISION_STATUS_TRANSFORMER: ElementTransformer = {
  dependencies: [DecisionStatusNode],
  export: (node: LexicalNode) => {
    // Export as a simple HTML comment marker
    return $isDecisionStatusNode(node) ? '<!-- decision-status -->' : null;
  },
  regExp: /^<!-- decision-status -->$/,
  replace: (parentNode, _1, _2, isImport) => {
    const decisionStatusNode = $createDecisionStatusNode();

    if (isImport || parentNode.getNextSibling() != null) {
      parentNode.replace(decisionStatusNode);
    } else {
      parentNode.insertBefore(decisionStatusNode);
    }

    decisionStatusNode.selectNext();
  },
  type: 'element',
};
