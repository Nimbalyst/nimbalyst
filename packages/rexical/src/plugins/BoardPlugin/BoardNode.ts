import {
  $applyNodeReplacement,
  ElementNode,
  LexicalNode,
  NodeKey,
  SerializedElementNode,
  Spread,
} from 'lexical';
import {ElementDOMSlot} from 'lexical';
import { BoardConfig } from './BoardConfigDialog';

export type SerializedKanbanBoardNode = Spread<
  {
    type: 'kanban-board';
    version: 1;
    config?: BoardConfig;
  },
  SerializedElementNode
>;

export class BoardNode extends ElementNode {
  __config: BoardConfig | null;

  constructor(config?: BoardConfig, key?: NodeKey) {
    super(key);
    this.__config = config || null;
  }

  static getType(): string {
    return 'kanban-board';
  }

  static clone(node: BoardNode): BoardNode {
    return new BoardNode(node.__config || undefined, node.__key);
  }

  getConfig(): BoardConfig | null {
    return this.__config;
  }

  setConfig(config: BoardConfig): void {
    const writable = this.getWritable();
    writable.__config = config;
  }

  createDOM(): HTMLElement {
    // Create the board element (this is what gets returned and becomes the main element)
    const element = document.createElement('div');
    element.className = 'kanban-board';
    element.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1rem;
      padding: 1rem;
      min-height: 400px;
      background: #f5f5f5;
      border-radius: 8px;
      border: 2px solid transparent;
      transition: border-color 0.2s ease;
      margin: 1rem 0;
      position: relative;
    `;

    // Create config button
    const configButton = document.createElement('button');
    configButton.className = 'board-config-button';
    configButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
      </svg>
    `;
    configButton.style.cssText = `
      position: absolute;
      top: 0.5rem;
      right: 0.5rem;
      background: white;
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 0.5rem;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.2s ease;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #666;
    `;

    // Add hover effects
    element.addEventListener('mouseenter', () => {
      element.style.borderColor = '#4a90e2';
      configButton.style.opacity = '1';
    });

    element.addEventListener('mouseleave', () => {
      element.style.borderColor = 'transparent';
      configButton.style.opacity = '0';
    });

    // Add config button click handler
    configButton.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      // Dispatch custom event to open config dialog
      window.dispatchEvent(new CustomEvent('board-configure', {
        detail: { 
          boardElement: element,
          boardNodeKey: this.getKey(),
          currentConfig: this.__config
        }
      }));
    });

    configButton.addEventListener('mouseenter', () => {
      configButton.style.background = '#f0f0f0';
      configButton.style.borderColor = '#999';
    });

    configButton.addEventListener('mouseleave', () => {
      configButton.style.background = 'white';
      configButton.style.borderColor = '#ddd';
    });

    element.appendChild(configButton);
    
    return element;
  }

  updateDOM(): false {
    return false;
  }

  getDOMSlot(element: HTMLElement): ElementDOMSlot {
    return super.getDOMSlot(element);
  }

  static importJSON(serializedNode: SerializedKanbanBoardNode): BoardNode {
    return $createBoardNode(serializedNode.config);
  }

  exportJSON(): SerializedKanbanBoardNode {
    return {
      ...super.exportJSON(),
      type: 'kanban-board',
      version: 1,
      config: this.__config || undefined,
    };
  }

  canBeEmpty(): true {
    return true;
  }

  isShadowRoot(): true {
    return true;
  }
}

export function $createBoardNode(config?: BoardConfig): BoardNode {
  return $applyNodeReplacement(new BoardNode(config));
}

export function $isBoardNode(
  node: LexicalNode | null | undefined,
): node is BoardNode {
  return node instanceof BoardNode;
}
