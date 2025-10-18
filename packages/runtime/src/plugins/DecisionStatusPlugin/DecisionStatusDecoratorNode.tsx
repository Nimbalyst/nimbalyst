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
import DecisionStatusComponent from './DecisionStatusComponent';

export type DecisionStatus = 'proposed' | 'in-discussion' | 'decided' | 'implemented' | 'rejected' | 'superseded';
export type DecisionType = 'architecture' | 'product' | 'technical' | 'process';

export type DecisionOption = {
  name: string;
  description?: string;
};

export type DecisionStatusConfig = {
  decisionId?: string;
  title?: string;
  status?: DecisionStatus;
  decisionType?: DecisionType;
  chosen?: string; // Which option was chosen
  options?: DecisionOption[] | string[]; // Options that were considered
  owner?: string;
  stakeholders?: string[];
  tags?: string[];
  created?: string;
  updated?: string;
};

export type SerializedDecisionStatusNode = Spread<
  {
    type: 'decision-status';
    version: 1;
  },
  SerializedLexicalNode
>;

export class DecisionStatusNode extends DecoratorNode<JSX.Element> {

  constructor(key?: NodeKey) {
    super(key);
  }

  static getType(): string {
    return 'decision-status';
  }

  static clone(node: DecisionStatusNode): DecisionStatusNode {
    return new DecisionStatusNode(node.__key);
  }


  createDOM(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'decision-status-decorator-container';
    return div;
  }

  updateDOM(): false {
    return false;
  }

  static importJSON(serializedNode: SerializedDecisionStatusNode): DecisionStatusNode {
    return $createDecisionStatusNode();
  }

  exportJSON(): SerializedDecisionStatusNode {
    return {
      ...super.exportJSON(),
      type: 'decision-status',
      version: 1,
    };
  }

  decorate(editor: LexicalEditor, config: EditorConfig): JSX.Element {
    return (
      <DecisionStatusComponent
        nodeKey={this.getKey()}
        editor={editor}
      />
    );
  }

  isInline(): boolean {
    return false;
  }
}

export function $createDecisionStatusNode(): DecisionStatusNode {
  return $applyNodeReplacement(new DecisionStatusNode());
}

export function $getDecisionStatusNode(nodeKey: string): DecisionStatusNode | null {
  const node = $getNodeByKey(nodeKey);
  return $isDecisionStatusNode(node) ? node : null;
}

export function $isDecisionStatusNode(
  node: LexicalNode | null | undefined,
): node is DecisionStatusNode {
  return node instanceof DecisionStatusNode;
}
