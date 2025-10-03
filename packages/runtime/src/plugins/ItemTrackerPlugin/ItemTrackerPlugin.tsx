import React, { useState, useCallback } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  LexicalCommand,
  LexicalEditor,
  $insertNodes,
  TextNode,
} from 'lexical';
import { useEffect } from 'react';
import { $createTrackerItemNode, TrackerItemData, TrackerItemType, TrackerItemNode } from './TrackerItemNode';
import { TRACKER_ITEM_TRANSFORMERS } from './TrackerItemTransformer';
import type { PluginPackage } from 'rexical';
import { TypeaheadMenuPlugin, type TypeaheadMenuOption } from 'rexical';
import './TrackerItem.css';

// Type for trigger function (matches TypeaheadMenuPlugin signature)
type TriggerFunction = (text: string) => {
  leadOffset: number;
  matchingString: string;
  replaceableString: string;
} | null;

export const INSERT_TRACKER_TASK_COMMAND: LexicalCommand<void> = createCommand();
export const INSERT_TRACKER_BUG_COMMAND: LexicalCommand<void> = createCommand();
export const INSERT_TRACKER_PLAN_COMMAND: LexicalCommand<void> = createCommand();

// Helper function to generate a ULID-style ID
function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${timestamp}${random}`;
}

function insertTrackerItemNode(editor: LexicalEditor, type: TrackerItemType): void {
  editor.update(() => {
    const selection = $getSelection();

    const itemData: TrackerItemData = {
      id: generateId(type === 'task' ? 'tsk' : type === 'bug' ? 'bug' : 'pln'),
      type,
      title: `New ${type}`,
      status: 'to-do',
      priority: 'medium',
      created: new Date().toISOString().split('T')[0],
    };

    const trackerItemNode = $createTrackerItemNode(itemData);

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

const trackerTriggerFn: TriggerFunction = (text: string) => {
  // console.log('Tracker trigger called with text:', text);
  const match = text.match(/@(\w*)$/);
  if (match) {
    // console.log('Tracker trigger matched:', match[0]);
    return {
      leadOffset: match.index!,
      matchingString: match[1],
      replaceableString: match[0],
    };
  }
  return null;
};

function ItemTrackerPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);

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
        if (textNode) {
          textNode.remove();
        }
      });
      option.onSelect();
      closeMenu();
    },
    [editor]
  );

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

    return () => {
      removeTaskCommand();
      removeBugCommand();
      removePlanCommand();
    };
  }, [editor]);

  return (
    <TypeaheadMenuPlugin
      options={filteredOptions}
      triggerFn={trackerTriggerFn}
      onQueryChange={setQuery}
      onSelectOption={handleSelectOption}
    />
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
