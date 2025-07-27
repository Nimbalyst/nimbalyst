/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type { LexicalEditor } from 'lexical';
import { $getRoot, $isParagraphNode, CLEAR_EDITOR_COMMAND, } from 'lexical';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { exportFile, importFile, serializedDocumentFromEditorState, } from '@lexical/file';
// import { useCollaborationContext } from '@lexical/react/LexicalCollaborationContext';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { mergeRegister } from '@lexical/utils';
// import { CONNECTED_COMMAND, TOGGLE_CONNECT_COMMAND } from '@lexical/yjs';
import { INITIAL_SETTINGS } from '../../appSettings';
import useFlashMessage from '../../hooks/useFlashMessage';
import useModal from '../../hooks/useModal';
import Button from '../../ui/Button';
// Removed docSerialization imports - no longer serializing to URL
// import {docFromHash, docToHash} from '../../utils/docSerialization';
import { SPEECH_TO_TEXT_COMMAND, SUPPORT_SPEECH_RECOGNITION, } from '../SpeechToTextPlugin';

async function sendEditorState(editor: LexicalEditor): Promise<void> {
  const stringifiedEditorState = JSON.stringify(editor.getEditorState());
  try {
    await fetch('http://localhost:1235/setEditorState', {
      body: stringifiedEditorState,
      headers: {
        Accept: 'application/json',
        'Content-type': 'application/json',
      },
      method: 'POST',
    });
  } catch {
    // NO-OP
  }
}

async function validateEditorState(editor: LexicalEditor): Promise<void> {
  const stringifiedEditorState = JSON.stringify(editor.getEditorState());
  let response = null;
  try {
    response = await fetch('http://localhost:1235/validateEditorState', {
      body: stringifiedEditorState,
      headers: {
        Accept: 'application/json',
        'Content-type': 'application/json',
      },
      method: 'POST',
    });
  } catch {
    // NO-OP
  }
  if (response !== null && response.status === 403) {
    throw new Error(
      'Editor state validation failed! Server did not accept changes.',
    );
  }
}

// Disabled docSerialization - don't save content to URL hash
async function shareDoc(doc: SerializedDocument): Promise<void> {
  // Just copy the current URL without modifying the hash
  const newUrl = window.location.toString();
  await window.navigator.clipboard.writeText(newUrl);
}

export default function ActionsPlugin({
  isRichText,
  shouldPreserveNewLinesInMarkdown,
}: {
  isRichText: boolean;
  shouldPreserveNewLinesInMarkdown: boolean;
}): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [isEditable, setIsEditable] = useState(() => editor.isEditable());
  const [isSpeechToText, setIsSpeechToText] = useState(false);
  const [connected, setConnected] = useState(false);
  const [isEditorEmpty, setIsEditorEmpty] = useState(true);
  const [modal, showModal] = useModal();
  const showFlashMessage = useFlashMessage();
  // const {isCollabActive} = useCollaborationContext();
  const isCollabActive = false; // Collaboration disabled
  // Disabled docSerialization - don't load content from URL hash
  // useEffect(() => {
  //   if (INITIAL_SETTINGS.isCollab) {
  //     return;
  //   }
  //   docFromHash(window.location.hash).then((doc) => {
  //     if (doc && doc.source === 'Playground') {
  //       editor.setEditorState(editorStateFromSerializedDocument(editor, doc));
  //       editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
  //     }
  //   });
  // }, [editor]);
  useEffect(() => {
    return mergeRegister(
      editor.registerEditableListener((editable) => {
        setIsEditable(editable);
      }),
      // Collaboration disabled
      // editor.registerCommand<boolean>(
      //   CONNECTED_COMMAND,
      //   (payload) => {
      //     const isConnected = payload;
      //     setConnected(isConnected);
      //     return false;
      //   },
      //   COMMAND_PRIORITY_EDITOR,
      // ),
    );
  }, [editor]);

  useEffect(() => {
    return editor.registerUpdateListener(
      ({dirtyElements, prevEditorState, tags}) => {
        // If we are in read only mode, send the editor state
        // to server and ask for validation if possible.
        if (
          !isEditable &&
          dirtyElements.size > 0 &&
          !tags.has(HISTORIC_TAG) &&
          !tags.has(COLLABORATION_TAG)
        ) {
          validateEditorState(editor);
        }
        editor.getEditorState().read(() => {
          const root = $getRoot();
          const children = root.getChildren();

          if (children.length > 1) {
            setIsEditorEmpty(false);
          } else {
            if ($isParagraphNode(children[0])) {
              const paragraphChildren = children[0].getChildren();
              setIsEditorEmpty(paragraphChildren.length === 0);
            } else {
              setIsEditorEmpty(false);
            }
          }
        });
      },
    );
  }, [editor, isEditable]);


  return (
    <div className="actions">
      {SUPPORT_SPEECH_RECOGNITION && (
        <button
          onClick={() => {
            editor.dispatchCommand(SPEECH_TO_TEXT_COMMAND, !isSpeechToText);
            setIsSpeechToText(!isSpeechToText);
          }}
          className={
            'action-button action-button-mic ' +
            (isSpeechToText ? 'active' : '')
          }
          title="Speech To Text"
          aria-label={`${
            isSpeechToText ? 'Enable' : 'Disable'
          } speech to text`}>
          <i className="mic" />
        </button>
      )}
      <button
        className="action-button import"
        onClick={() => importFile(editor)}
        title="Import"
        aria-label="Import editor state from JSON">
        <i className="import" />
      </button>

      <button
        className="action-button export"
        onClick={() =>
          exportFile(editor, {
            fileName: `Playground ${new Date().toISOString()}`,
            source: 'Playground',
          })
        }
        title="Export"
        aria-label="Export editor state to JSON">
        <i className="export" />
      </button>
      <button
        className="action-button share"
        disabled={isCollabActive || INITIAL_SETTINGS.isCollab}
        onClick={() =>
          shareDoc(
            serializedDocumentFromEditorState(editor.getEditorState(), {
              source: 'Playground',
            }),
          ).then(
            () => showFlashMessage('URL copied to clipboard'),
            () => showFlashMessage('URL could not be copied to clipboard'),
          )
        }
        title="Share"
        aria-label="Share Playground link to current editor state">
        <i className="share" />
      </button>
      <button
        className="action-button clear"
        disabled={isEditorEmpty}
        onClick={() => {
          showModal('Clear editor', (onClose) => (
            <ShowClearDialog editor={editor} onClose={onClose} />
          ));
        }}
        title="Clear"
        aria-label="Clear editor contents">
        <i className="clear" />
      </button>
      <button
        className={`action-button ${!isEditable ? 'unlock' : 'lock'}`}
        onClick={() => {
          // Send latest editor state to commenting validation server
          if (isEditable) {
            sendEditorState(editor);
          }
          editor.setEditable(!editor.isEditable());
        }}
        title="Read-Only Mode"
        aria-label={`${!isEditable ? 'Unlock' : 'Lock'} read-only mode`}>
        <i className={!isEditable ? 'unlock' : 'lock'} />
      </button>
      {/* Collaboration disabled */}
      {/* {isCollabActive && (
        <button
          className="action-button connect"
          onClick={() => {
            // editor.dispatchCommand(TOGGLE_CONNECT_COMMAND, !connected);
          }}
          title={`${
            connected ? 'Disconnect' : 'Connect'
          } Collaborative Editing`}
          aria-label={`${
            connected ? 'Disconnect from' : 'Connect to'
          } a collaborative editing server`}>
          <i className={connected ? 'disconnect' : 'connect'} />
        </button>
      )} */}
      {modal}
    </div>
  );
}

function ShowClearDialog({
  editor,
  onClose,
}: {
  editor: LexicalEditor;
  onClose: () => void;
}): JSX.Element {
  return (
    <>
      Are you sure you want to clear the editor?
      <div className="Modal__content">
        <Button
          onClick={() => {
            editor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined);
            editor.focus();
            onClose();
          }}>
          Clear
        </Button>{' '}
        <Button
          onClick={() => {
            editor.focus();
            onClose();
          }}>
          Cancel
        </Button>
      </div>
    </>
  );
}
