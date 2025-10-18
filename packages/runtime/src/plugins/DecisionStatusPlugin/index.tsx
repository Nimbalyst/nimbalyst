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
import { $createDecisionStatusNode } from './DecisionStatusDecoratorNode';
import type { PluginPackage } from 'rexical';
import './DecisionStatus.css';

export const INSERT_DECISION_STATUS_COMMAND: LexicalCommand<void> = createCommand();

function insertDecisionStatusNode(editor: LexicalEditor): void {
  editor.update(() => {
    const selection = $getSelection();
    const decisionStatusNode = $createDecisionStatusNode();

    if ($isRangeSelection(selection)) {
      $insertNodes([decisionStatusNode]);
      const nextParagraph = $createParagraphNode();
      decisionStatusNode.insertAfter(nextParagraph);
      nextParagraph.select();
    } else {
      $insertNodes([decisionStatusNode]);
      const nextParagraph = $createParagraphNode();
      decisionStatusNode.insertAfter(nextParagraph);
      nextParagraph.select();
    }
  });
}

export interface DecisionStatusPluginProps {}

function DecisionStatusPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const removeStatusCommand = editor.registerCommand(
      INSERT_DECISION_STATUS_COMMAND,
      () => {
        insertDecisionStatusNode(editor);
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    return () => {
      removeStatusCommand();
    };
  }, [editor]);

  return null;
}


// Re-export the nodes for registration
export { DecisionStatusNode } from './DecisionStatusDecoratorNode';
export { $createDecisionStatusNode, $isDecisionStatusNode } from './DecisionStatusDecoratorNode';
export { DECISION_STATUS_TRANSFORMER } from './DecisionStatusTransformer';

import { DecisionStatusNode } from './DecisionStatusDecoratorNode';
import { DECISION_STATUS_TRANSFORMER } from './DecisionStatusTransformer';

// Export the plugin package for dynamic registration
export const decisionStatusPluginPackage: PluginPackage<DecisionStatusPluginProps> = {
  name: 'decision-status',
  Component: DecisionStatusPlugin,
  nodes: [DecisionStatusNode],
  transformers: [DECISION_STATUS_TRANSFORMER],
  commands: {
    INSERT_DECISION_STATUS: INSERT_DECISION_STATUS_COMMAND,
  },
  userCommands: [
    {
      title: 'Decision Status',
      description: 'Add a decision status block to track architectural decisions',
      icon: 'gavel',
      keywords: ['decision', 'adr', 'architecture', 'choice'],
      command: INSERT_DECISION_STATUS_COMMAND,
    },
  ],
};

export default DecisionStatusPlugin;
