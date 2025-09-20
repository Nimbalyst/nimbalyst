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
import type { PluginPackage } from 'rexical';
import './PlanStatus.css';

export const INSERT_PLAN_STATUS_COMMAND: LexicalCommand<void> = createCommand();

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

export interface PlanStatusPluginProps {}

function PlanStatusPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const removeCommand = editor.registerCommand(
      INSERT_PLAN_STATUS_COMMAND,
      () => {
        insertPlanStatusNode(editor);
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    return () => {
      removeCommand();
    };
  }, [editor]);

  return null;
}


// Re-export the node for registration
export { PlanStatusNode } from './PlanStatusDecoratorNode';
export { $createPlanStatusNode, $isPlanStatusNode } from './PlanStatusDecoratorNode';
export { PLAN_STATUS_TRANSFORMER } from './PlanStatusTransformer';
import { PlanStatusNode } from './PlanStatusDecoratorNode';
import { PLAN_STATUS_TRANSFORMER } from './PlanStatusTransformer';

// Export the plugin package for dynamic registration
export const planStatusPluginPackage: PluginPackage<PlanStatusPluginProps> = {
  name: 'plan-status',
  Component: PlanStatusPlugin,
  nodes: [PlanStatusNode],
  transformers: [PLAN_STATUS_TRANSFORMER],
  commands: {
    INSERT_PLAN_STATUS: INSERT_PLAN_STATUS_COMMAND,
  },
  userCommands: [
    {
      title: 'Insert Plan Status',
      description: 'Add a plan status block to track project progress',
      icon: <i className="icon checklist" />,
      keywords: ['plan', 'status', 'project', 'tracking'],
      command: INSERT_PLAN_STATUS_COMMAND,
    },
  ],
};

export default PlanStatusPlugin;