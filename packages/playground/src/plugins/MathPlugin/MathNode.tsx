import type { 
  DOMConversionMap, 
  EditorConfig, 
  LexicalNode, 
  NodeKey,
  SerializedLexicalNode,
  Spread
} from 'lexical';

import { $applyNodeReplacement, DecoratorNode } from 'lexical';

type SerializedMathNode = Spread<
  {
    equation: string;
    inline: boolean;
  },
  SerializedLexicalNode
>;

export class MathNode extends DecoratorNode<JSX.Element> {
  __equation: string;
  __inline: boolean;

  static getType(): string {
    return 'math';
  }

  static clone(node: MathNode): MathNode {
    return new MathNode(node.__equation, node.__inline, node.__key);
  }

  constructor(equation: string, inline?: boolean, key?: NodeKey) {
    super(key);
    this.__equation = equation;
    this.__inline = inline || false;
  }

  static importJSON(serializedNode: SerializedMathNode): MathNode {
    const { equation, inline } = serializedNode;
    return $createMathNode(equation, inline);
  }

  exportJSON(): SerializedMathNode {
    return {
      ...super.exportJSON(),
      equation: this.__equation,
      inline: this.__inline,
      type: 'math',
      version: 1,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement(this.__inline ? 'span' : 'div');
    span.className = this.__inline ? 'math-inline' : 'math-block';
    return span;
  }

  updateDOM(): false {
    return false;
  }

  decorate(): JSX.Element {
    return (
      <span className={this.__inline ? 'math-inline' : 'math-block'}>
        {/* Simple display - in real implementation use KaTeX */}
        <code>{this.__equation}</code>
      </span>
    );
  }
}

export function $createMathNode(equation: string, inline = false): MathNode {
  return $applyNodeReplacement(new MathNode(equation, inline));
}

export function $isMathNode(node: LexicalNode | null | undefined): node is MathNode {
  return node instanceof MathNode;
}
