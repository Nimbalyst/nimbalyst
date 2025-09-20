/**
 * PlanTableNode - A decorator node that displays all plan documents in a table
 */

import React from 'react';
import {
  DecoratorNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
  LexicalNode,
  $applyNodeReplacement,
  EditorConfig,
} from 'lexical';
import PlanTableComponent from './PlanTableComponent';

export type SerializedPlanTableNode = Spread<
  {
    type: 'plan-table';
    version: 1;
  },
  SerializedLexicalNode
>;

export class PlanTableNode extends DecoratorNode<JSX.Element> {
  static getType(): string {
    return 'plan-table';
  }

  static clone(node: PlanTableNode): PlanTableNode {
    return new PlanTableNode(node.__key);
  }

  constructor(key?: NodeKey) {
    super(key);
  }

  static importJSON(serializedNode: SerializedPlanTableNode): PlanTableNode {
    const node = $createPlanTableNode();
    return node;
  }

  exportJSON(): SerializedPlanTableNode {
    return {
      type: 'plan-table',
      version: 1,
    };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const div = document.createElement('div');
    div.className = 'plan-table-container';
    return div;
  }

  updateDOM(): false {
    return false;
  }

  decorate(): JSX.Element {
    return <PlanTableComponent nodeKey={this.getKey()} />;
  }

  isTopLevel(): boolean {
    return true;
  }

  isInline(): boolean {
    return false;
  }
}

export function $createPlanTableNode(): PlanTableNode {
  return $applyNodeReplacement(new PlanTableNode());
}

export function $isPlanTableNode(
  node: LexicalNode | null | undefined,
): node is PlanTableNode {
  return node instanceof PlanTableNode;
}