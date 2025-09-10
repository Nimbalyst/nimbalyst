import {
  $applyNodeReplacement,
  ElementNode,
  LexicalNode,
  NodeKey,
  SerializedElementNode,
  Spread,
} from 'lexical';
import {ElementDOMSlot} from 'lexical';

export type SerializedCardNode = Spread<
  {
    type: 'kanban-card';
    id: string;
    version: 1;
  },
  SerializedElementNode
>;

export class BoardCardNode extends ElementNode {
  __id: string;

  constructor(id?: string, key?: NodeKey) {
    super(key);
    this.__id = id || Math.random().toString(36).substr(2, 9);
  }

  static getType(): string {
    return 'kanban-card';
  }

  static clone(node: BoardCardNode): BoardCardNode {
    return new BoardCardNode(node.__id, node.__key);
  }

  getId(): string {
    return this.__id;
  }

  createDOM(): HTMLElement {
    const element = document.createElement('div');
    element.className = 'kanban-card';
    element.style.cssText = `
      background: white;
      border: 1px solid #ddd;
      border-radius: 6px;
      padding: 0.75rem;
      margin-bottom: 0.5rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      cursor: text;
      transition: all 0.2s ease;
      position: relative;
      min-height: 2.5rem;
    `;
    element.setAttribute('data-card-id', this.__id);
    element.draggable = true;

    // Add drag handle (visible on hover)
    const dragHandle = document.createElement('div');
    dragHandle.className = 'kanban-card-drag-handle';
    dragHandle.innerHTML = '⋮⋮';
    dragHandle.style.cssText = `
      position: absolute;
      top: 0.5rem;
      right: 0.5rem;
      cursor: grab;
      color: #999;
      font-weight: bold;
      opacity: 0;
      transition: opacity 0.2s ease;
      user-select: none;
      font-size: 0.8rem;
      line-height: 1;
      pointer-events: none;
    `;
    element.appendChild(dragHandle);

    // Add drag events following Lexical's pattern
    element.addEventListener('dragstart', (e) => {
      dragHandle.style.cursor = 'grabbing';
      element.style.opacity = '0.5';
      element.style.transform = 'rotate(2deg)';

      // Set drag data in multiple formats like Lexical does
      const dataTransfer = e.dataTransfer;
      if (dataTransfer) {
        // Set our card-specific data
        dataTransfer.setData('application/x-kanban-card', this.__id);
        dataTransfer.setData('text/plain', this.__id);

        // Let the browser create the drag image
        dataTransfer.effectAllowed = 'move';
      }
    });

    element.addEventListener('dragend', (e) => {
      dragHandle.style.cursor = 'grab';
      element.style.opacity = '1';
      element.style.transform = 'none';
    });

    // Add hover effect
    element.addEventListener('mouseenter', () => {
      element.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
      element.style.borderColor = '#bbb';
      dragHandle.style.opacity = '1';
    });
    element.addEventListener('mouseleave', () => {
      element.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
      element.style.borderColor = '#ddd';
      dragHandle.style.opacity = '0';
    });

    // Add focus styles
    element.addEventListener('focusin', () => {
      element.style.borderColor = '#4a90e2';
      element.style.boxShadow = '0 0 0 2px rgba(74, 144, 226, 0.2)';
    });
    element.addEventListener('focusout', () => {
      element.style.borderColor = '#ddd';
      element.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
    });

    // Remove all DOM drag event handling - let Lexical handle this properly

    return element;
  }

  updateDOM(): false {
    return false;
  }

  getDOMSlot(element: HTMLElement): ElementDOMSlot {
    return super.getDOMSlot(element);
  }

  static importJSON(serializedNode: SerializedCardNode): BoardCardNode {
    const {id} = serializedNode;
    return $createCardNode(id);
  }

  exportJSON(): SerializedCardNode {
    return {
      ...super.exportJSON(),
      type: 'kanban-card',
      id: this.__id,
      version: 1,
    };
  }

  canBeEmpty(): false {
    return false;
  }
}

export function $createCardNode(id?: string): BoardCardNode {
  return $applyNodeReplacement(new BoardCardNode(id));
}

export function $isCardNode(
  node: LexicalNode | null | undefined,
): node is BoardCardNode {
  return node instanceof BoardCardNode;
}
