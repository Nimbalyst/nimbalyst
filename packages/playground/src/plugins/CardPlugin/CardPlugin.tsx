import React from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $insertNodes, COMMAND_PRIORITY_EDITOR, createCommand } from 'lexical';
import { mergeRegister } from '@lexical/utils';
import { $createCardNode, $createCardWithContent, CardNode } from './CardNode';
import './CardPlugin.css';

export type InsertCardPayload = {
  title?: string;
  content?: string;
};

export const INSERT_CARD_COMMAND = createCommand<InsertCardPayload>('INSERT_CARD_COMMAND');

export default function CardPlugin(): null {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    if (!editor) return;
    
    if (!editor.hasNodes([CardNode])) {
      throw new Error('CardPlugin: CardNode not registered on editor');
    }

    return mergeRegister(
      editor.registerCommand(
        INSERT_CARD_COMMAND,
        (payload) => {
          const cardNode = $createCardWithContent(
            payload?.title,
            payload?.content
          );
          
          $insertNodes([cardNode]);
          return true;
        },
        COMMAND_PRIORITY_EDITOR
      )
    );
  }, [editor]);

  return null;
}
