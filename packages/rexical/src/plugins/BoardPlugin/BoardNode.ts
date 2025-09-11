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
import './Board.css';

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

    // Create board controls container
    const boardControls = document.createElement('div');
    boardControls.className = 'board-controls';

    // Create config button
    const configButton = document.createElement('button');
    configButton.className = 'board-config-button';
    configButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
      </svg>
    `;

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

    boardControls.appendChild(configButton);
    element.appendChild(boardControls);
    
    // Create columns container
    const columnsContainer = document.createElement('div');
    columnsContainer.className = 'kanban-columns-container';
    element.appendChild(columnsContainer);
    
    // Add new column button
    const addColumnButton = document.createElement('button');
    addColumnButton.className = 'kanban-add-column-button';
    addColumnButton.innerHTML = '+ Add Column';
    addColumnButton.type = 'button';
    
    addColumnButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      window.dispatchEvent(new CustomEvent('board-add-column', {
        detail: { 
          boardNodeKey: this.getKey()
        }
      }));
    });
    
    element.appendChild(addColumnButton);
    
    return element;
  }

  updateDOM(): false {
    return false;
  }

  getDOMSlot(element: HTMLElement): ElementDOMSlot {
    const columnsContainer = element.querySelector('.kanban-columns-container') as HTMLElement;
    return super.getDOMSlot(element).withElement(columnsContainer);
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
