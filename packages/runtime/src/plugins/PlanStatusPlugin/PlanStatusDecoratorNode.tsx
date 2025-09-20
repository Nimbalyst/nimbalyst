import {
  $applyNodeReplacement,
  DecoratorNode,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
  EditorConfig,
  LexicalEditor,
  $getNodeByKey,
} from 'lexical';
import * as React from 'react';
import type { JSX } from 'react';
import PlanStatusComponent from './PlanStatusComponent';

export type PlanStatus = 'draft' | 'planned' | 'in-progress' | 'review' | 'completed' | 'cancelled';
export type PlanPriority = 'low' | 'medium' | 'high' | 'critical';

export type PlanStatusConfig = {
  planId?: string;
  title?: string;
  status?: PlanStatus;
  state?: string;
  planType?: string;
  priority?: PlanPriority;
  owner?: string;
  stakeholders?: string[];
  tags?: string[];
  created?: string;
  updated?: string;
  dueDate?: string;
  startDate?: string;
  progress?: number;
};

export type SerializedPlanStatusNode = Spread<
  {
    type: 'plan-status';
    version: 1;
  },
  SerializedLexicalNode
>;

export class PlanStatusNode extends DecoratorNode<JSX.Element> {

  constructor(key?: NodeKey) {
    super(key);
  }

  static getType(): string {
    return 'plan-status';
  }

  static clone(node: PlanStatusNode): PlanStatusNode {
    return new PlanStatusNode(node.__key);
  }


  createDOM(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'plan-status-decorator-container';
    return div;
  }

  updateDOM(): false {
    return false;
  }

  static importJSON(serializedNode: SerializedPlanStatusNode): PlanStatusNode {
    return $createPlanStatusNode();
  }

  exportJSON(): SerializedPlanStatusNode {
    return {
      ...super.exportJSON(),
      type: 'plan-status',
      version: 1,
    };
  }

  decorate(editor: LexicalEditor, config: EditorConfig): JSX.Element {
    return (
      <PlanStatusComponent
        nodeKey={this.getKey()}
        editor={editor}
      />
    );
  }

  isInline(): boolean {
    return false;
  }
}

export function $createPlanStatusNode(): PlanStatusNode {
  return $applyNodeReplacement(new PlanStatusNode());
}

export function $getPlanStatusNode(nodeKey: string): PlanStatusNode | null {
  const node = $getNodeByKey(nodeKey);
  return $isPlanStatusNode(node) ? node : null;
}

export function $isPlanStatusNode(
  node: LexicalNode | null | undefined,
): node is PlanStatusNode {
  return node instanceof PlanStatusNode;
}
