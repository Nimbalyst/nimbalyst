import React, { type JSX } from 'react';
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
} from 'lexical';
import { useEffect } from 'react';
import { $createPlanStatusNode } from './PlanStatusDecoratorNode';
import { $createPlanTableNode } from './PlanTableNode';
import type { PluginPackage } from 'rexical';
import './PlanStatus.css';

export const INSERT_PLAN_STATUS_COMMAND: LexicalCommand<void> = createCommand();
export const INSERT_PLAN_TABLE_COMMAND: LexicalCommand<void> = createCommand();

function insertPlanStatusNode(editor: LexicalEditor): void {
  editor.update(() => {
    const selection = $getSelection();
    const planStatusNode = $createPlanStatusNode();

    if ($isRangeSelection(selection)) {
      $insertNodes([planStatusNode]);
      const nextParagraph = $createParagraphNode();
      planStatusNode.insertAfter(nextParagraph);
      nextParagraph.select();
    } else {
      $insertNodes([planStatusNode]);
      const nextParagraph = $createParagraphNode();
      planStatusNode.insertAfter(nextParagraph);
      nextParagraph.select();
    }
  });
}

function insertPlanTableNode(editor: LexicalEditor): void {
  editor.update(() => {
    const selection = $getSelection();
    const planTableNode = $createPlanTableNode();

    if ($isRangeSelection(selection)) {
      $insertNodes([planTableNode]);
      const nextParagraph = $createParagraphNode();
      planTableNode.insertAfter(nextParagraph);
      nextParagraph.select();
    } else {
      $insertNodes([planTableNode]);
      const nextParagraph = $createParagraphNode();
      planTableNode.insertAfter(nextParagraph);
      nextParagraph.select();
    }
  });
}

export interface PlanStatusPluginProps {}

function PlanStatusPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const removeStatusCommand = editor.registerCommand(
      INSERT_PLAN_STATUS_COMMAND,
      () => {
        insertPlanStatusNode(editor);
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    const removeTableCommand = editor.registerCommand(
      INSERT_PLAN_TABLE_COMMAND,
      () => {
        insertPlanTableNode(editor);
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    return () => {
      removeStatusCommand();
      removeTableCommand();
    };
  }, [editor]);

  return null;
}


// Re-export the nodes for registration
export { PlanStatusNode } from './PlanStatusDecoratorNode';
export { $createPlanStatusNode, $isPlanStatusNode } from './PlanStatusDecoratorNode';
export { PlanTableNode } from './PlanTableNode';
export { $createPlanTableNode, $isPlanTableNode } from './PlanTableNode';
export { PLAN_STATUS_TRANSFORMER } from './PlanStatusTransformer';
export { PLAN_TABLE_TRANSFORMER } from './PlanTableTransformer';

import { PlanStatusNode } from './PlanStatusDecoratorNode';
import { PlanTableNode } from './PlanTableNode';
import { PLAN_STATUS_TRANSFORMER } from './PlanStatusTransformer';
import { PLAN_TABLE_TRANSFORMER } from './PlanTableTransformer';

// Export the plugin package for dynamic registration
export const planStatusPluginPackage: PluginPackage<PlanStatusPluginProps> = {
  name: 'plan-status',
  Component: PlanStatusPlugin,
  nodes: [PlanStatusNode, PlanTableNode],
  transformers: [PLAN_STATUS_TRANSFORMER, PLAN_TABLE_TRANSFORMER],
  commands: {
    INSERT_PLAN_STATUS: INSERT_PLAN_STATUS_COMMAND,
    INSERT_PLAN_TABLE: INSERT_PLAN_TABLE_COMMAND,
  },
  userCommands: [
    {
      title: 'Insert Plan Status',
      description: 'Add a plan status block to track project progress',
      icon: <i className="icon checklist" />,
      keywords: ['plan', 'status', 'project', 'tracking'],
      command: INSERT_PLAN_STATUS_COMMAND,
    },
    {
      title: 'Insert Plan Table',
      description: 'Add a table showing all plan documents',
      icon: <i className="icon table" />,
      keywords: ['plan', 'table', 'list', 'overview', 'dashboard'],
      command: INSERT_PLAN_TABLE_COMMAND,
    },
  ],
};

export default PlanStatusPlugin;