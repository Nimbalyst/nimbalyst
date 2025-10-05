import {
  $applyNodeReplacement,
  ElementNode,
  LexicalNode,
  NodeKey,
  SerializedElementNode,
  Spread,
  $getNodeByKey,
  DOMExportOutput,
} from 'lexical';
import { ElementDOMSlot } from 'lexical';

export type TrackerItemType = 'plan' | 'bug' | 'task' | 'idea';
export type TrackerItemStatus = 'to-do' | 'in-progress' | 'in-review' | 'done' | 'blocked';
export type TrackerItemPriority = 'low' | 'medium' | 'high' | 'critical';

export type TrackerItemData = {
  id: string;
  type: TrackerItemType;
  title: string;
  status: TrackerItemStatus;
  priority?: TrackerItemPriority;
  owner?: string;
  tags?: string[];
  created?: string;
  updated?: string;
  dueDate?: string;
};

export type SerializedTrackerItemNode = Spread<
  {
    type: 'tracker-item';
    version: 1;
    data: TrackerItemData;
  },
  SerializedElementNode
>;

export class TrackerItemNode extends ElementNode {
  __data: TrackerItemData;

  constructor(data: TrackerItemData, key?: NodeKey) {
    super(key);
    this.__data = data;
  }

  static getType(): string {
    return 'tracker-item';
  }

  static clone(node: TrackerItemNode): TrackerItemNode {
    return new TrackerItemNode({ ...node.__data }, node.__key);
  }

  createDOM(): HTMLElement {
    const container = document.createElement('span');
    container.className = 'tracker-item-container';
    container.setAttribute('data-tracker-type', this.__data.type);
    container.setAttribute('data-tracker-status', this.__data.status);

    // Custom checkbox (styled for type/status)
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = `tracker-checkbox tracker-${this.__data.type}`;
    checkbox.checked = this.__data.status === 'done';
    checkbox.setAttribute('data-tracker-id', this.__data.id);
    checkbox.contentEditable = 'false';

    // Status indicator badge
    const statusBadge = document.createElement('span');
    statusBadge.className = `tracker-status-badge status-${this.__data.status}`;
    statusBadge.setAttribute('title', this.__data.status);
    statusBadge.contentEditable = 'false';

    // Type badge (e.g., "@bug", "@task", "@plan")
    const typeBadge = document.createElement('span');
    typeBadge.className = `tracker-type-badge tracker-type-${this.__data.type}`;
    typeBadge.textContent = `@${this.__data.type}`;
    typeBadge.contentEditable = 'false';

    // Content area where children render - Lexical handles editability of children
    const content = document.createElement('span');
    content.className = 'tracker-content';
    content.setAttribute('data-lexical-slot', 'content');

    // Append in order: checkbox, priority badge (if set), status badge, type badge, content
    container.appendChild(checkbox);

    // Priority indicator if set
    if (this.__data.priority) {
      const priorityBadge = document.createElement('span');
      priorityBadge.className = `tracker-priority-badge priority-${this.__data.priority}`;
      priorityBadge.setAttribute('title', `Priority: ${this.__data.priority}`);
      priorityBadge.contentEditable = 'false';
      container.appendChild(priorityBadge);
    }

    container.appendChild(statusBadge);
    container.appendChild(typeBadge);
    container.appendChild(content);

    // Add click handler for checkbox
    checkbox.addEventListener('change', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Dispatch custom event that the plugin will handle
      window.dispatchEvent(new CustomEvent('tracker-item-toggle', {
        detail: { nodeKey: this.getKey(), checked: checkbox.checked }
      }));
    });

    // Add click handler for status badge to open metadata editor
    statusBadge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent('tracker-item-edit', {
        detail: {
          nodeKey: this.getKey(),
          data: this.__data,
          target: statusBadge
        }
      }));
    });

    // Add click handler for type badge to open metadata editor
    typeBadge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent('tracker-item-edit', {
        detail: {
          nodeKey: this.getKey(),
          data: this.__data,
          target: typeBadge
        }
      }));
    });

    return container;
  }

  updateDOM(prevNode: TrackerItemNode, dom: HTMLElement): boolean {
    // Update if data changed
    if (prevNode.__data !== this.__data) {
      dom.setAttribute('data-tracker-type', this.__data.type);
      dom.setAttribute('data-tracker-status', this.__data.status);

      const checkbox = dom.querySelector('.tracker-checkbox') as HTMLInputElement;
      if (checkbox) {
        checkbox.checked = this.__data.status === 'done';
        checkbox.className = `tracker-checkbox tracker-${this.__data.type}`;
      }

      const statusBadge = dom.querySelector('.tracker-status-badge');
      if (statusBadge) {
        statusBadge.className = `tracker-status-badge status-${this.__data.status}`;
        statusBadge.setAttribute('title', this.__data.status);
      }

      // Update type badge
      const typeBadge = dom.querySelector('.tracker-type-badge');
      if (typeBadge) {
        typeBadge.className = `tracker-type-badge tracker-type-${this.__data.type}`;
        typeBadge.textContent = `@${this.__data.type}`;
      }

      // Update priority badge
      let priorityBadge = dom.querySelector('.tracker-priority-badge') as HTMLElement;
      if (this.__data.priority) {
        if (!priorityBadge) {
          priorityBadge = document.createElement('span');
          priorityBadge.className = `tracker-priority-badge priority-${this.__data.priority}`;
          priorityBadge.setAttribute('title', `Priority: ${this.__data.priority}`);
          const checkbox = dom.querySelector('.tracker-checkbox');
          if (checkbox) {
            checkbox.after(priorityBadge);
          }
        } else {
          priorityBadge.className = `tracker-priority-badge priority-${this.__data.priority}`;
          priorityBadge.setAttribute('title', `Priority: ${this.__data.priority}`);
        }
      } else if (priorityBadge) {
        priorityBadge.remove();
      }

      return true;
    }
    return false;
  }

  getDOMSlot(element: HTMLElement): ElementDOMSlot {
    const contentArea = element.querySelector('.tracker-content') as HTMLElement;
    return super.getDOMSlot(element).withElement(contentArea);
  }

  static importJSON(serializedNode: SerializedTrackerItemNode): TrackerItemNode {
    const node = $createTrackerItemNode(serializedNode.data);
    node.setFormat(serializedNode.format);
    node.setIndent(serializedNode.indent);
    node.setDirection(serializedNode.direction);
    return node;
  }

  exportJSON(): SerializedTrackerItemNode {
    return {
      ...super.exportJSON(),
      type: 'tracker-item',
      version: 1,
      data: this.__data,
    };
  }

  exportDOM(): DOMExportOutput {
    const element = this.createDOM();
    return { element };
  }

  getData(): TrackerItemData {
    const self = this.getLatest();
    return self.__data;
  }

  setData(data: TrackerItemData): void {
    const writable = this.getWritable();
    writable.__data = data;
  }

  canBeEmpty(): false {
    return false;
  }

  canInsertTextBefore(): boolean {
    return false;
  }

  canInsertTextAfter(): boolean {
    return true;
  }

  extractWithChild(): boolean {
    return true;
  }


}

export function $createTrackerItemNode(data: TrackerItemData): TrackerItemNode {
  return $applyNodeReplacement(new TrackerItemNode(data));
}

export function $getTrackerItemNode(nodeKey: string): TrackerItemNode | null {
  const node = $getNodeByKey(nodeKey);
  return $isTrackerItemNode(node) ? node : null;
}

export function $isTrackerItemNode(
  node: LexicalNode | null | undefined,
): node is TrackerItemNode {
  return node instanceof TrackerItemNode;
}
