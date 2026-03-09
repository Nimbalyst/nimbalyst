/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {$createLinkNode} from '@lexical/link';
import {DRAG_DROP_PASTE} from '@lexical/rich-text';
import {$wrapNodeInElement, isMimeType} from '@lexical/utils';
import {
  $createParagraphNode,
  $createTextNode,
  $insertNodes,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_HIGH,
  LexicalEditor,
} from 'lexical';
import {useEffect} from 'react';

import {INSERT_IMAGE_COMMAND} from '../ImagesPlugin';
import type { UploadedEditorAsset } from '../../EditorConfig';

const ACCEPTABLE_IMAGE_TYPES = [
  'image/',
  'image/heic',
  'image/heif',
  'image/gif',
  'image/webp',
];

async function processImageFile(file: File): Promise<string> {
  // Check if we have access to electron API for asset storage
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    try {
      // Read file as array buffer
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Array.from(new Uint8Array(arrayBuffer));

      // Get current document path from window global (set by EditorMode)
      const documentPath = (window as any).__currentDocumentPath || undefined;

      // Store via document service
      const { relativePath } = await (window as any).electronAPI.invoke(
        'document-service:store-asset',
        { buffer, mimeType: file.type, documentPath }
      );

      // Return the relative path provided by the service
      return relativePath;
    } catch (error) {
      console.error('Failed to store asset, falling back to base64:', error);
      // Fall through to base64 fallback
    }
  }

  // Fallback to base64 if electron API unavailable or error occurred
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read file'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function insertUploadedAsset(
  editor: LexicalEditor,
  file: File,
  asset: UploadedEditorAsset
): void {
  if (asset.kind === 'image') {
    editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
      altText: asset.altText ?? file.name,
      src: asset.src,
    });
    return;
  }

  editor.update(() => {
    const linkNode = $createLinkNode(asset.src);
    linkNode.append($createTextNode(asset.name ?? file.name));
    $insertNodes([linkNode]);
    if ($isRootOrShadowRoot(linkNode.getParentOrThrow())) {
      $wrapNodeInElement(linkNode, $createParagraphNode).selectEnd();
    }
  });
}

export default function DragDropPaste({
  uploadAsset,
}: {
  uploadAsset?: (file: File) => Promise<UploadedEditorAsset>;
}): null {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    // Handle DRAG_DROP_PASTE command that's dispatched by RichTextPlugin
    // when files are pasted/dropped
    return editor.registerCommand(
      DRAG_DROP_PASTE,
      (files) => {
        (async () => {
          // Process each file
          for (const file of files) {
            if (uploadAsset) {
              const asset = await uploadAsset(file);
              insertUploadedAsset(editor, file, asset);
              continue;
            }

            if (isMimeType(file, ACCEPTABLE_IMAGE_TYPES)) {
              const src = await processImageFile(file);
              editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
                altText: file.name,
                src,
              });
            }
          }
        })();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, uploadAsset]);
  return null;
}
