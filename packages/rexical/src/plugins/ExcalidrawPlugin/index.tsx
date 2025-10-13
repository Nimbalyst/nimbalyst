/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { ExcalidrawInitialElements } from '../../ui/ExcalidrawModal';
import ExcalidrawModal from '../../ui/ExcalidrawModal';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';

// NOTE: This CSS file no longer exists in the @excalidraw/excalidraw package
// import '@excalidraw/excalidraw/index.css';

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $insertNodeToNearestRoot } from '@lexical/utils';
import { COMMAND_PRIORITY_EDITOR } from 'lexical';

import { $createExcalidrawNode, ExcalidrawNode, } from './ExcalidrawNode';
import { INSERT_EXCALIDRAW_COMMAND } from './ExcalidrawCommands';

export default function ExcalidrawPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const [isModalOpen, setModalOpen] = useState<boolean>(false);

  useEffect(() => {
    if (!editor.hasNodes([ExcalidrawNode])) {
      throw new Error(
        'ExcalidrawPlugin: ExcalidrawNode not registered on editor',
      );
    }

    return editor.registerCommand(
      INSERT_EXCALIDRAW_COMMAND,
      () => {
        setModalOpen(true);
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );
  }, [editor]);

  const onClose = () => {
    setModalOpen(false);
  };

  const onDelete = () => {
    setModalOpen(false);
  };

  const onSave = (
    elements: ExcalidrawInitialElements,
    appState: Partial<AppState>,
    files: BinaryFiles,
  ) => {
    editor.update(() => {
      const excalidrawNode = $createExcalidrawNode();
      excalidrawNode.setData(
        JSON.stringify({
          appState,
          elements,
          files,
        }),
      );
      $insertNodeToNearestRoot(excalidrawNode);
    });
    setModalOpen(false);
  };

  return isModalOpen ? (
    <ExcalidrawModal
      initialElements={[]}
      initialAppState={{} as AppState}
      initialFiles={{}}
      isShown={isModalOpen}
      onDelete={onDelete}
      onClose={onClose}
      onSave={onSave}
      closeOnClickOutside={false}
    />
  ) : null;
}
