import {
  $applyNodeReplacement,
  ElementNode,
  LexicalNode,
  NodeKey,
  SerializedElementNode,
  Spread,
} from 'lexical';
import {ElementDOMSlot} from 'lexical';

export type SerializedColumnHeaderNode = Spread<
  {
    type: 'kanban-column-header';
    version: 1;
  },
  SerializedElementNode
>;

export class BoardColumnHeaderNode extends ElementNode {
  constructor(key?: NodeKey) {
    super(key);
  }

  static getType(): string {
    return 'kanban-column-header';
  }

  static clone(node: BoardColumnHeaderNode): BoardColumnHeaderNode {
    return new BoardColumnHeaderNode(node.__key);
  }

  createDOM(): HTMLElement {
    const element = document.createElement('div');
    element.className = 'kanban-column-header';
    element.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem;
      background: #e0e0e0;
      border-radius: 4px 4px 0 0;
      margin-bottom: 0.5rem;
      min-height: 2.5rem;
      position: relative;
    `;

    // Header content area (where lexical nodes go)
    const headerContent = document.createElement('div');
    headerContent.className = 'kanban-column-header-content';
    headerContent.style.cssText = `
      flex: 1;
      min-height: 1.5rem;
      font-weight: bold;
      color: #333;
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;

    // Menu button
    const menuButton = document.createElement('button');
    menuButton.className = 'kanban-column-menu-button';
    menuButton.innerHTML = '⋯';
    menuButton.type = 'button';
    menuButton.style.cssText = `
      background: none;
      border: none;
      cursor: pointer;
      padding: 0.25rem;
      border-radius: 3px;
      color: #666;
      font-size: 1rem;
      line-height: 1;
      opacity: 0.7;
      transition: all 0.2s ease;
      margin-left: 0.5rem;
    `;

    // Menu button hover effects
    menuButton.addEventListener('mouseenter', () => {
      menuButton.style.opacity = '1';
      menuButton.style.backgroundColor = '#d0d0d0';
    });
    menuButton.addEventListener('mouseleave', () => {
      menuButton.style.opacity = '0.7';
      menuButton.style.backgroundColor = 'transparent';
    });

    // Menu button click handler
    menuButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Dispatch a custom event for the column menu
      const menuEvent = new CustomEvent('kanban-column-menu', {
        detail: {
          columnElement: element.closest('.kanban-column'),
          buttonElement: menuButton,
        }
      });
      window.dispatchEvent(menuEvent);
    });

    element.append(headerContent, menuButton);
    return element;
  }

  updateDOM(): false {
    return false;
  }

  getDOMSlot(element: HTMLElement): ElementDOMSlot {
    const headerContent = element.querySelector('.kanban-column-header-content') as HTMLElement;
    return super.getDOMSlot(element).withElement(headerContent);
  }

  static importJSON(serializedNode: SerializedColumnHeaderNode): BoardColumnHeaderNode {
    return $createColumnHeaderNode();
  }

  exportJSON(): SerializedColumnHeaderNode {
    return {
      ...super.exportJSON(),
      type: 'kanban-column-header',
      version: 1,
    };
  }

  canBeEmpty(): false {
    return false;
  }
}

export function $createColumnHeaderNode(): BoardColumnHeaderNode {
  return $applyNodeReplacement(new BoardColumnHeaderNode());
}

export function $isColumnHeaderNode(
  node: LexicalNode | null | undefined,
): node is BoardColumnHeaderNode {
  return node instanceof BoardColumnHeaderNode;
}
