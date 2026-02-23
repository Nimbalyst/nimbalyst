/**
 * MermaidPlugin - Main plugin component
 */

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $insertNodes,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  LexicalCommand,
} from 'lexical';
import { useEffect } from 'react';
import { $createMermaidNode, MermaidNode, MermaidPayload } from './MermaidNode';
import { mergeRegister } from '@lexical/utils';

export const INSERT_MERMAID_COMMAND: LexicalCommand<MermaidPayload> =
  createCommand('INSERT_MERMAID_COMMAND');

export default function MermaidPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!editor.hasNodes([MermaidNode])) {
      throw new Error('MermaidPlugin: MermaidNode not registered on editor');
    }

    return mergeRegister(
      editor.registerCommand(
        INSERT_MERMAID_COMMAND,
        (payload?: MermaidPayload) => {
          const selection = $getSelection();

          if ($isRangeSelection(selection)) {
            const mermaidNode = $createMermaidNode(payload);
            $insertNodes([mermaidNode]);
          }

          return true;
        },
        COMMAND_PRIORITY_EDITOR
      )
    );
  }, [editor]);

  return null;
}

// Export everything needed for the plugin
export { MermaidNode, $createMermaidNode, $isMermaidNode } from './MermaidNode';
export { MERMAID_TRANSFORMER } from './MermaidTransformer';
export type { MermaidPayload, SerializedMermaidNode } from './MermaidNode';