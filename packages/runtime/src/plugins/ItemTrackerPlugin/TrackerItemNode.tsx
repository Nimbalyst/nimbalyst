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
import  { JSX } from 'react';
import TrackerItemComponent from './TrackerItemComponent';

export type TrackerItemType = 'plan' | 'bug' | 'task';
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
  SerializedLexicalNode
>;

export class TrackerItemNode extends DecoratorNode<JSX.Element> {
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
    const span = document.createElement('span');
    span.className = 'tracker-item-decorator-container';
    return span;
  }

  updateDOM(): false {
    return false;
  }

  static importJSON(serializedNode: SerializedTrackerItemNode): TrackerItemNode {
    return $createTrackerItemNode(serializedNode.data);
  }

  exportJSON(): SerializedTrackerItemNode {
    return {
      ...super.exportJSON(),
      type: 'tracker-item',
      version: 1,
      data: this.__data,
    };
  }

  getData(): TrackerItemData {
    const self = this.getLatest();
    return self.__data;
  }

  setData(data: TrackerItemData): void {
    const writable = this.getWritable();
    writable.__data = data;
  }

  decorate(editor: LexicalEditor, config: EditorConfig): JSX.Element {
    return (
      <TrackerItemComponent
        nodeKey={this.getKey()}
        editor={editor}
        data={this.__data}
      />
    );
  }

  isInline(): boolean {
    return true;
  }

    isKeyboardSelectable(): boolean {
        return super.isKeyboardSelectable();
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
