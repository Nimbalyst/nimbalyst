/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {DRAG_DROP_PASTE} from '@lexical/rich-text';
import {isMimeType} from '@lexical/utils';
import {COMMAND_PRIORITY_HIGH, PASTE_COMMAND} from 'lexical';
import {useEffect} from 'react';

import {INSERT_IMAGE_COMMAND} from '../ImagesPlugin';

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

      // Store via document service
      const { hash, extension } = await (window as any).electronAPI.invoke(
        'document-service:store-asset',
        { buffer, mimeType: file.type }
      );

      // Return relative path to asset
      // TODO: Calculate proper relative path based on current document location
      return `.nimbalyst/assets/${hash}.${extension}`;
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

export default function DragDropPaste(): null {
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
  }, [editor]);
  return null;
}
