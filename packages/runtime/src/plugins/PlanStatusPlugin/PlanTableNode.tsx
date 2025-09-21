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

export type SortDirection = 'asc' | 'desc';
export type SortColumn = 'title' | 'status' | 'priority' | 'lastUpdated' | 'progress';

export type SerializedPlanTableNode = Spread<
  {
    type: 'plan-table';
    version: 1;
    sortBy?: SortColumn;
    sortDirection?: SortDirection;
  },
  SerializedLexicalNode
>;

export class PlanTableNode extends DecoratorNode<JSX.Element> {
  __sortBy: SortColumn;
  __sortDirection: SortDirection;

  static getType(): string {
    return 'plan-table';
  }

  static clone(node: PlanTableNode): PlanTableNode {
    return new PlanTableNode(
      node.__sortBy,
      node.__sortDirection,
      node.__key
    );
  }

  constructor(
    sortBy: SortColumn = 'lastUpdated',
    sortDirection: SortDirection = 'desc',
    key?: NodeKey
  ) {
    super(key);
    this.__sortBy = sortBy;
    this.__sortDirection = sortDirection;
  }

  static importJSON(serializedNode: SerializedPlanTableNode): PlanTableNode {
    const { sortBy = 'lastUpdated', sortDirection = 'desc' } = serializedNode;
    const node = $createPlanTableNode(sortBy, sortDirection);
    return node;
  }

  exportJSON(): SerializedPlanTableNode {
    return {
      type: 'plan-table',
      version: 1,
      sortBy: this.__sortBy,
      sortDirection: this.__sortDirection,
    };
  }

  getSortBy(): SortColumn {
    return this.__sortBy;
  }

  getSortDirection(): SortDirection {
    return this.__sortDirection;
  }

  setSorting(sortBy: SortColumn, sortDirection: SortDirection): void {
    const writable = this.getWritable();
    writable.__sortBy = sortBy;
    writable.__sortDirection = sortDirection;
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
    return (
      <PlanTableComponent
        nodeKey={this.getKey()}
        sortBy={this.__sortBy}
        sortDirection={this.__sortDirection}
      />
    );
  }

  isTopLevel(): boolean {
    return true;
  }

  isInline(): boolean {
    return false;
  }
}

export function $createPlanTableNode(
  sortBy: SortColumn = 'lastUpdated',
  sortDirection: SortDirection = 'desc'
): PlanTableNode {
  return $applyNodeReplacement(new PlanTableNode(sortBy, sortDirection));
}

export function $isPlanTableNode(
  node: LexicalNode | null | undefined,
): node is PlanTableNode {
  return node instanceof PlanTableNode;
}