import React from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $insertNodes, COMMAND_PRIORITY_EDITOR, createCommand } from 'lexical';
import { mergeRegister } from '@lexical/utils';
import { $createMathNode, MathNode } from './MathNode';
import './MathPlugin.css';

export type InsertMathPayload = {
  equation: string;
  inline?: boolean;
};

export const INSERT_MATH_COMMAND = createCommand<InsertMathPayload>('INSERT_MATH_COMMAND');

export default function MathPlugin(): null {
  const [editor] = useLexicalComposerContext();

  console.log("Rendering MathPlugin");
  React.useEffect(() => {
    if (!editor.hasNodes([MathNode])) {
      throw new Error('MathPlugin: MathNode not registered on editor');
    }

    return mergeRegister(
      editor.registerCommand(
        INSERT_MATH_COMMAND,
        ({ equation, inline }) => {
          const mathNode = $createMathNode(equation, inline);
          $insertNodes([mathNode]);
          return true;
        },
        COMMAND_PRIORITY_EDITOR
      )
    );
  }, [editor]);

  return null;
}
