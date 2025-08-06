import type {
  DOMExportOutput,
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedElementNode,
  Spread,
} from 'lexical';

import {
  $applyNodeReplacement,
  $createParagraphNode,
  $createTextNode,
  ElementNode,
} from 'lexical';

type SerializedCardNode = Spread<
  {
    // No extra properties needed
  },
  SerializedElementNode
>;

export class CardNode extends ElementNode {
  static getType(): string {
    return 'card';
  }

  static clone(node: CardNode): CardNode {
    return new CardNode(node.__key);
  }

  constructor(key?: NodeKey) {
    super(key);
  }

  static importJSON(serializedNode: SerializedCardNode): CardNode {
    const node = $createCardNode();
    node.setDirection(serializedNode.direction);
    node.setFormat(serializedNode.format);
    node.setIndent(serializedNode.indent);
    return node;
  }

  exportJSON(): SerializedCardNode {
    return {
      ...super.exportJSON(),
      type: 'card',
      version: 1,
    };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const container = document.createElement('div');
    container.className = 'card-node';
    return container;
  }

  updateDOM(prevNode: CardNode, dom: HTMLElement): boolean {
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('div');
    element.className = 'card-node';
    return { element };
  }

  static importDOM() {
    return {
      div: (node: Node) => ({
        conversion: (domNode: Node) => {
          if (domNode instanceof HTMLElement && domNode.classList.contains('card-node')) {
            return { node: $createCardNode() };
          }
          return null;
        },
        priority: 1,
      }),
    };
  }

  canInsertTextBefore(): boolean {
    return false;
  }

  canInsertTextAfter(): boolean {
    return false;
  }

  // Override to style first child differently
  isInline(): boolean {
    return false;
  }
}

export function $createCardNode(): CardNode {
  return $applyNodeReplacement(new CardNode());
}

export function $isCardNode(node: LexicalNode | null | undefined): node is CardNode {
  return node instanceof CardNode;
}

// Helper to create a card with content
export function $createCardWithContent(title?: string, content?: string): CardNode {
  const cardNode = $createCardNode();

  const titleParagraph = $createParagraphNode();
  titleParagraph.append($createTextNode(title || 'Card Title'));
  cardNode.append(titleParagraph);

  const contentParagraph = $createParagraphNode();
  contentParagraph.append($createTextNode(content || 'Card content goes here...'));
  cardNode.append(contentParagraph);

  return cardNode;
}
