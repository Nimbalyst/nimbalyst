import React, { useState, useCallback, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_HIGH,
  createCommand,
  LexicalCommand,
  LexicalEditor,
  LexicalNode,
  $insertNodes,
  TextNode,
  $getNodeByKey,
  KEY_ENTER_COMMAND,
  $isTextNode,
} from 'lexical';
import { $createListItemNode, $isListItemNode, INSERT_UNORDERED_LIST_COMMAND, REMOVE_LIST_COMMAND } from '@lexical/list';
import { useEffect } from 'react';
import { $createTrackerItemNode, $getTrackerItemNode, $isTrackerItemNode, TrackerItemData, TrackerItemType, TrackerItemNode, TrackerItemStatus, TrackerItemPriority } from './TrackerItemNode';
import { TRACKER_ITEM_TRANSFORMERS } from './TrackerItemTransformer';
import type { PluginPackage } from 'rexical';
import { TypeaheadMenuPlugin, type TypeaheadMenuOption } from 'rexical';
import './TrackerItem.css';

interface TrackerEditorState {
  nodeKey: string;
  data: TrackerItemData;
  position: { x: number; y: number };
}

// Type for trigger function (matches TypeaheadMenuPlugin signature)
type TriggerFunction = (text: string) => {
  leadOffset: number;
  matchingString: string;
  replaceableString: string;
} | null;

export const INSERT_TRACKER_TASK_COMMAND: LexicalCommand<void> = createCommand();
export const INSERT_TRACKER_BUG_COMMAND: LexicalCommand<void> = createCommand();
export const INSERT_TRACKER_PLAN_COMMAND: LexicalCommand<void> = createCommand();
export const INSERT_TRACKER_IDEA_COMMAND: LexicalCommand<void> = createCommand();

// Helper function to generate a ULID-style ID
function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${timestamp}${random}`;
}

function insertTrackerItemNode(editor: LexicalEditor, type: TrackerItemType, existingText?: string): void {
  editor.update(() => {
    const selection = $getSelection();

    const title = existingText || `New ${type}`;

    // Generate ID prefix based on type
    let prefix = 'tsk';
    if (type === 'bug') prefix = 'bug';
    else if (type === 'plan') prefix = 'pln';
    else if (type === 'idea') prefix = 'ida';
    else if (type === 'decision') prefix = 'dec';

    const itemData: TrackerItemData = {
      id: generateId(prefix),
      type,
      title,
      status: 'to-do',
      priority: 'medium',
      created: new Date().toISOString().split('T')[0],
    };

    const trackerItemNode = $createTrackerItemNode(itemData);

    // Add text content as children
    const textNode = $createTextNode(title);
    trackerItemNode.append(textNode);

    if ($isRangeSelection(selection)) {
      $insertNodes([trackerItemNode]);
      const nextParagraph = $createParagraphNode();
      trackerItemNode.insertAfter(nextParagraph);
      nextParagraph.select();
    } else {
      $insertNodes([trackerItemNode]);
      const nextParagraph = $createParagraphNode();
      trackerItemNode.insertAfter(nextParagraph);
      nextParagraph.select();
    }
  });
}

export interface ItemTrackerPluginProps {}

function ItemTrackerPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<TrackerEditorState | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const capturedTextRef = useRef<string>('');

  const trackerTriggerFn: TriggerFunction = useCallback((text: string) => {
    const match = text.match(/@(\w*)$/);
    if (match) {
      // Capture the text before the @trigger
      capturedTextRef.current = text.substring(0, match.index).trim();
      return {
        leadOffset: match.index!,
        matchingString: match[1],
        replaceableString: match[0],
      };
    }
    return null;
  }, []);

  // Update tracker item data
  const updateTrackerData = useCallback((nodeKey: string, updates: Partial<TrackerItemData>) => {
    editor.update(() => {
      const node = $getTrackerItemNode(nodeKey);
      if (node) {
        const currentData = node.getData();
        node.setData({
          ...currentData,
          ...updates,
          updated: new Date().toISOString(),
        });
      }
    });
  }, [editor]);

  // Close popover on click outside
  useEffect(() => {
    if (!editorState) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setEditorState(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [editorState]);

  const options: TypeaheadMenuOption[] = [
    {
      id: 'bug',
      label: 'Bug',
      description: 'Track a bug or issue',
      icon: <span className="material-symbols-outlined">bug_report</span>,
      keywords: ['bug', 'issue', 'defect'],
      onSelect: () => insertTrackerItemNode(editor, 'bug'),
    },
    {
      id: 'task',
      label: 'Task',
      description: 'Track a task or to-do',
      icon: <span className="material-symbols-outlined">check_box</span>,
      keywords: ['task', 'todo', 'work'],
      onSelect: () => insertTrackerItemNode(editor, 'task'),
    },
    {
      id: 'plan',
      label: 'Plan',
      description: 'Track a plan or initiative',
      icon: <span className="material-symbols-outlined">assignment</span>,
      keywords: ['plan', 'initiative', 'project'],
      onSelect: () => insertTrackerItemNode(editor, 'plan'),
    },
    {
      id: 'idea',
      label: 'Idea',
      description: 'Track an idea or suggestion',
      icon: <span className="material-symbols-outlined">lightbulb</span>,
      keywords: ['idea', 'suggestion', 'brainstorm'],
      onSelect: () => insertTrackerItemNode(editor, 'idea'),
    },
    {
      id: 'decision',
      label: 'Decision',
      description: 'Track a decision or ADR',
      icon: <span className="material-symbols-outlined">gavel</span>,
      keywords: ['decision', 'adr', 'architecture'],
      onSelect: () => insertTrackerItemNode(editor, 'decision'),
    },
  ];

  const filteredOptions = query
    ? options.filter(option =>
        option.label.toLowerCase().includes(query.toLowerCase()) ||
        option.keywords?.some(kw => kw.includes(query.toLowerCase()))
      )
    : options;

  const handleSelectOption = useCallback(
    (option: TypeaheadMenuOption, textNode: TextNode | null, closeMenu: () => void) => {
      editor.update(() => {
        // Get the type from the option ID
        const type = option.id as TrackerItemType;

        // Use the captured text from the trigger function
        const existingText = capturedTextRef.current;

        // Generate ID prefix based on type
        let prefix = 'tsk';
        if (type === 'bug') prefix = 'bug';
        else if (type === 'plan') prefix = 'pln';
        else if (type === 'idea') prefix = 'ida';
        else if (type === 'decision') prefix = 'dec';

        // Create tracker item
        const itemData: TrackerItemData = {
          id: generateId(prefix),
          type,
          title: existingText || `New ${type}`,
          status: 'to-do',
          priority: 'medium',
          created: new Date().toISOString().split('T')[0],
        };

        const trackerItemNode = $createTrackerItemNode(itemData);
        const newTextNode = $createTextNode(itemData.title);
        trackerItemNode.append(newTextNode);

        // Try to find the list item to replace its content
        let listItem = null;
        if (textNode) {
          let node: LexicalNode | null = textNode;
          while (node) {
            if ($isListItemNode(node)) {
              listItem = node;
              break;
            }
            node = node.getParent();
          }
        }

        // Fallback: try from selection
        if (!listItem) {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            let node: LexicalNode | null = selection.anchor.getNode();
            while (node) {
              if ($isListItemNode(node)) {
                listItem = node;
                break;
              }
              node = node.getParent();
            }
          }
        }

        // Replace list item content with tracker item
        if (listItem) {
          // Clear the list item and add tracker
          listItem.clear();
          listItem.append(trackerItemNode);
          trackerItemNode.selectEnd();
        } else {
          // Not in a list - insert at current selection
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            selection.insertNodes([trackerItemNode]);
            trackerItemNode.selectEnd();
          }
        }

        // Clear the captured text
        capturedTextRef.current = '';
      });
      closeMenu();
    },
    [editor]
  );

  // Handle checkbox toggle events
  useEffect(() => {
    const handleToggle = (event: Event) => {
      const customEvent = event as CustomEvent<{ nodeKey: string; checked: boolean }>;
      const { nodeKey, checked } = customEvent.detail;

      editor.update(() => {
        const node = $getTrackerItemNode(nodeKey);
        if (node) {
          const data = node.getData();
          node.setData({
            ...data,
            status: checked ? 'done' : 'to-do',
            updated: new Date().toISOString(),
          });
        }
      });
    };

    const handleEdit = (event: Event) => {
      const customEvent = event as CustomEvent<{ nodeKey: string; data: TrackerItemData; target: HTMLElement }>;
      const { nodeKey, data, target } = customEvent.detail;

      // Get the position from the target element
      if (target) {
        const rect = target.getBoundingClientRect();
        setEditorState({
          nodeKey,
          data,
          position: { x: rect.left, y: rect.bottom + 4 }
        });
      }
    };

    window.addEventListener('tracker-item-toggle', handleToggle);
    window.addEventListener('tracker-item-edit', handleEdit);

    return () => {
      window.removeEventListener('tracker-item-toggle', handleToggle);
      window.removeEventListener('tracker-item-edit', handleEdit);
    };
  }, [editor]);

  // Register commands
  useEffect(() => {
    const removeTaskCommand = editor.registerCommand(
      INSERT_TRACKER_TASK_COMMAND,
      () => {
        insertTrackerItemNode(editor, 'task');
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    const removeBugCommand = editor.registerCommand(
      INSERT_TRACKER_BUG_COMMAND,
      () => {
        insertTrackerItemNode(editor, 'bug');
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    const removePlanCommand = editor.registerCommand(
      INSERT_TRACKER_PLAN_COMMAND,
      () => {
        insertTrackerItemNode(editor, 'plan');
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    const removeIdeaCommand = editor.registerCommand(
      INSERT_TRACKER_IDEA_COMMAND,
      () => {
        insertTrackerItemNode(editor, 'idea');
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    // Handle Enter key when inside a tracker item in a list
    const removeEnterCommand = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return false;
        }

        // Traverse up to find TrackerItemNode
        const anchorNode = selection.anchor.getNode();
        let currentNode: LexicalNode | null = anchorNode;
        let trackerItem: TrackerItemNode | null = null;

        // Walk up the tree to find the tracker item
        while (currentNode && !trackerItem) {
          if ($isTrackerItemNode(currentNode)) {
            trackerItem = currentNode;
            break;
          }
          currentNode = currentNode.getParent();
        }

        if (trackerItem) {
          // Check if the tracker item is inside a list
          const listItem = trackerItem.getParent();

          if ($isListItemNode(listItem)) {
            // Check if we're at the end of the tracker item's content
            // Get the last child of the tracker item
            const lastChild = trackerItem.getLastChild();

            if (!lastChild) {
              return false;
            }

            // Check if our cursor is at the end of the last child
            const anchorNode = selection.anchor.getNode();
            const isAtEnd = selection.isCollapsed() &&
                           (anchorNode === lastChild || lastChild.isParentOf(anchorNode)) &&
                           selection.anchor.offset === anchorNode.getTextContentSize();

            if (isAtEnd) {
              event?.preventDefault();

              // Insert a new list item after this one with a paragraph
              const newListItem = $createListItemNode();
              const newParagraph = $createParagraphNode();
              const newTextNode = $createTextNode('');
              newParagraph.append(newTextNode);
              newListItem.append(newParagraph);
              listItem.insertAfter(newListItem);

              // Move selection to the new text node
              newTextNode.select(0, 0);

              return true;
            }
          }
        }

        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );

    return () => {
      removeTaskCommand();
      removeBugCommand();
      removePlanCommand();
      removeIdeaCommand();
      removeEnterCommand();
    };
  }, [editor]);

  const statusOptions: { value: TrackerItemStatus; label: string }[] = [
    { value: 'to-do', label: 'To Do' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'in-review', label: 'In Review' },
    { value: 'done', label: 'Done' },
    { value: 'blocked', label: 'Blocked' },
  ];

  const priorityOptions: { value: TrackerItemPriority; label: string }[] = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'critical', label: 'Critical' },
  ];

  return (
    <>
      <TypeaheadMenuPlugin
        options={filteredOptions}
        triggerFn={trackerTriggerFn}
        onQueryChange={setQuery}
        onSelectOption={handleSelectOption}
      />

      {editorState && (
        <div
          ref={popoverRef}
          className="tracker-item-popover"
          style={{
            position: 'fixed',
            left: `${editorState.position.x}px`,
            top: `${editorState.position.y}px`,
            zIndex: 10000,
          }}
        >
          <div className="tracker-item-popover-header">
            <span className="material-symbols-outlined">
              {editorState.data.type === 'bug' ? 'bug_report' :
               editorState.data.type === 'task' ? 'check_box' :
               editorState.data.type === 'idea' ? 'lightbulb' :
               editorState.data.type === 'decision' ? 'gavel' :
               'assignment'}
            </span>
            <span>{editorState.data.type.charAt(0).toUpperCase() + editorState.data.type.slice(1)}</span>
          </div>

          <div className="tracker-item-popover-field">
            <label>Status</label>
            <select
              value={editorState.data.status}
              onChange={(e) => {
                const newStatus = e.target.value as TrackerItemStatus;
                updateTrackerData(editorState.nodeKey, { status: newStatus });
                setEditorState({ ...editorState, data: { ...editorState.data, status: newStatus } });
              }}
            >
              {statusOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="tracker-item-popover-field">
            <label>Priority</label>
            <select
              value={editorState.data.priority || ''}
              onChange={(e) => {
                const newPriority = e.target.value as TrackerItemPriority | undefined;
                updateTrackerData(editorState.nodeKey, { priority: newPriority || undefined });
                setEditorState({ ...editorState, data: { ...editorState.data, priority: newPriority || undefined } });
              }}
            >
              <option value="">None</option>
              {priorityOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="tracker-item-popover-field">
            <label>Owner</label>
            <input
              type="text"
              value={editorState.data.owner || ''}
              onChange={(e) => {
                const newOwner = e.target.value || undefined;
                updateTrackerData(editorState.nodeKey, { owner: newOwner });
                setEditorState({ ...editorState, data: { ...editorState.data, owner: newOwner } });
              }}
              placeholder="Assign to..."
            />
          </div>

          <div className="tracker-item-popover-field">
            <label>Due Date</label>
            <input
              type="date"
              value={editorState.data.dueDate || ''}
              onChange={(e) => {
                const newDueDate = e.target.value || undefined;
                updateTrackerData(editorState.nodeKey, { dueDate: newDueDate });
                setEditorState({ ...editorState, data: { ...editorState.data, dueDate: newDueDate } });
              }}
            />
          </div>

          <div className="tracker-item-popover-field">
            <label>Description</label>
            <textarea
              rows={3}
              value={editorState.data.description || ''}
              onChange={(e) => {
                const newDescription = e.target.value || undefined;
                updateTrackerData(editorState.nodeKey, { description: newDescription });
                setEditorState({ ...editorState, data: { ...editorState.data, description: newDescription } });
              }}
              placeholder="Add description..."
            />
          </div>

          <div className="tracker-item-popover-footer">
            <span className="tracker-item-id">ID: {editorState.data.id}</span>
            {editorState.data.created && (
              <span className="tracker-item-date">Created: {editorState.data.created}</span>
            )}
            {editorState.data.updated && (
              <span className="tracker-item-date">Updated: {new Date(editorState.data.updated).toLocaleString()}</span>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// Export the plugin package for dynamic registration
export const itemTrackerPluginPackage: PluginPackage<ItemTrackerPluginProps> = {
  name: 'item-tracker',
  Component: ItemTrackerPlugin,
  nodes: [TrackerItemNode],
  transformers: TRACKER_ITEM_TRANSFORMERS,
  commands: {
    INSERT_TRACKER_TASK: INSERT_TRACKER_TASK_COMMAND,
    INSERT_TRACKER_BUG: INSERT_TRACKER_BUG_COMMAND,
    INSERT_TRACKER_PLAN: INSERT_TRACKER_PLAN_COMMAND,
  },
  userCommands: [
    {
      title: 'Task Item',
      description: 'Add a task item to track work',
      icon: 'check_box',
      keywords: ['task', 'todo', 'item', 'tracker'],
      command: INSERT_TRACKER_TASK_COMMAND,
    },
    {
      title: 'Bug Item',
      description: 'Add a bug item to track issues',
      icon: 'bug_report',
      keywords: ['bug', 'issue', 'defect', 'tracker'],
      command: INSERT_TRACKER_BUG_COMMAND,
    },
    {
      title: 'Plan Item',
      description: 'Add a plan item to track initiatives',
      icon: 'assignment',
      keywords: ['plan', 'initiative', 'project', 'tracker'],
      command: INSERT_TRACKER_PLAN_COMMAND,
    },
  ],
};

export default ItemTrackerPlugin;
