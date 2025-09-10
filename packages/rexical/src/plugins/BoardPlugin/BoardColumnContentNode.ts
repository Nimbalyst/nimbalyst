import {
  $applyNodeReplacement,
  ElementNode,
  LexicalNode,
  NodeKey,
  SerializedElementNode,
  Spread,
} from 'lexical';
import {ElementDOMSlot} from 'lexical';

export type SerializedColumnContentNode = Spread<
  {
    type: 'kanban-column-content';
    version: 1;
  },
  SerializedElementNode
>;

export class BoardColumnContentNode extends ElementNode {
  constructor(key?: NodeKey) {
    super(key);
  }

  static getType(): string {
    return 'kanban-column-content';
  }

  static clone(node: BoardColumnContentNode): BoardColumnContentNode {
    return new BoardColumnContentNode(node.__key);
  }

  createDOM(): HTMLElement {
    const element = document.createElement('div');
    element.className = 'kanban-column-content';
    element.style.cssText = `
      min-height: 300px;
      padding: 0.5rem;
      background: white;
      border-radius: 0 0 4px 4px;
      border: 1px solid #ddd;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      transition: all 0.2s ease;
      flex: 1;
    `;

    return element;
  }

  updateDOM(): false {
    return false;
  }

  getDOMSlot(element: HTMLElement): ElementDOMSlot {
    return super.getDOMSlot(element);
  }

  static importJSON(serializedNode: SerializedColumnContentNode): BoardColumnContentNode {
    return $createColumnContentNode();
  }

  exportJSON(): SerializedColumnContentNode {
    return {
      ...super.exportJSON(),
      type: 'kanban-column-content',
      version: 1,
    };
  }

  canBeEmpty(): true {
    return true;
  }
}

export function $createColumnContentNode(): BoardColumnContentNode {
  return $applyNodeReplacement(new BoardColumnContentNode());
}

export function $isColumnContentNode(
  node: LexicalNode | null | undefined,
): node is BoardColumnContentNode {
  return node instanceof BoardColumnContentNode;
}
