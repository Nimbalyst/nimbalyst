import {
  $applyNodeReplacement,
  ElementNode,
  LexicalNode,
  NodeKey,
  SerializedElementNode,
  Spread,
  $createTextNode,
  $createParagraphNode,
} from 'lexical';
import {ElementDOMSlot} from 'lexical';
import {
  $createColumnHeaderNode,
  BoardColumnHeaderNode,
} from './BoardColumnHeaderNode';

export type SerializedColumnNode = Spread<
  {
    type: 'kanban-column';
    version: 1;
  },
  SerializedElementNode
>;

export class BoardColumnNode extends ElementNode {
  constructor(key?: NodeKey) {
    super(key);
  }

  static getType(): string {
    return 'kanban-column';
  }

  static clone(node: BoardColumnNode): BoardColumnNode {
    return new BoardColumnNode(node.__key);
  }

  createDOM(): HTMLElement {
    const element = document.createElement('div');
    element.className = 'kanban-column';
    element.style.cssText = `
      background: #f9f9f9;
      border-radius: 4px;
      overflow: hidden;
      min-width: 280px;
      display: flex;
      flex-direction: column;
    `;

    return element;
  }

  updateDOM(): false {
    return false;
  }

  getDOMSlot(element: HTMLElement): ElementDOMSlot {
    return super.getDOMSlot(element);
  }

  static importJSON(serializedNode: SerializedColumnNode): BoardColumnNode {
    return $createColumnNode();
  }

  exportJSON(): SerializedColumnNode {
    return {
      ...super.exportJSON(),
      type: 'kanban-column',
      version: 1,
    };
  }

  canBeEmpty(): true {
    return true;
  }
}

export function $createColumnNode(): BoardColumnNode {
  return $applyNodeReplacement(new BoardColumnNode());
}

export function $isColumnNode(
  node: LexicalNode | null | undefined,
): node is BoardColumnNode {
  return node instanceof BoardColumnNode;
}
