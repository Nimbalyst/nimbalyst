/**
 * MockupPlugin - Lexical plugin for embedding mockups in documents.
 *
 * Provides:
 * - MockupNode for rendering mockup screenshots
 * - INSERT_MOCKUP_COMMAND for inserting mockups
 * - Markdown transformer for import/export
 *
 * The component picker integration (dynamic options for selecting/creating mockups)
 * is handled in the platform-specific registration code.
 */

import type { LexicalCommand } from 'lexical';

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $insertNodes,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
} from 'lexical';
import { useEffect } from 'react';

import { hasMockupPlatformService, getMockupPlatformService } from './MockupPlatformService';
import { $createMockupNode, MockupPayload } from './MockupNode';

// Export all the pieces for use elsewhere
export { MockupNode, $createMockupNode, $isMockupNode } from './MockupNode';
export type { MockupPayload, SerializedMockupNode } from './MockupNode';
export { MOCKUP_TRANSFORMER } from './MockupTransformer';
export type { MockupPlatformService } from './MockupPlatformService';
export {
  setMockupPlatformService,
  getMockupPlatformService,
  hasMockupPlatformService,
} from './MockupPlatformService';

/**
 * Command to insert a mockup into the editor.
 * If called with payload (mockupPath + screenshotPath), inserts directly.
 * If called without payload, shows the mockup picker UI.
 */
export const INSERT_MOCKUP_COMMAND: LexicalCommand<MockupPayload | undefined> =
  createCommand('INSERT_MOCKUP_COMMAND');

/**
 * Generates a screenshot for a mockup and returns the paths.
 * Uses the platform service to capture the screenshot.
 *
 * @param mockupPath - Absolute path to the mockup file
 * @param documentPath - Absolute path to the document (for determining assets folder)
 * @returns Object with screenshotPath (relative) and absoluteScreenshotPath
 */
export async function generateMockupScreenshot(
  mockupPath: string,
  documentPath: string,
): Promise<{ screenshotPath: string; absoluteScreenshotPath: string }> {
  if (!hasMockupPlatformService()) {
    throw new Error('MockupPlatformService not available');
  }

  const { getMockupPlatformService } = await import('./MockupPlatformService');
  const service = getMockupPlatformService();

  // Extract mockup filename to use for screenshot name
  const mockupFilename = mockupPath
    .split('/')
    .pop()
    ?.replace('.mockup.html', '') || 'mockup';

  // Determine the document directory and assets folder
  const documentDir = documentPath.substring(0, documentPath.lastIndexOf('/'));
  const assetsDir = `${documentDir}/assets`;
  const screenshotFilename = `${mockupFilename}.mockup.png`;
  const absoluteScreenshotPath = `${assetsDir}/${screenshotFilename}`;

  // Capture the screenshot
  await service.captureScreenshot(mockupPath, absoluteScreenshotPath);

  // Return relative path from document directory
  const screenshotPath = `assets/${screenshotFilename}`;

  return { screenshotPath, absoluteScreenshotPath };
}

/**
 * MockupPlugin component - registers the INSERT_MOCKUP_COMMAND handler.
 *
 * This handles inserting MockupNodes when the command is dispatched with a
 * valid payload. The component picker integration (dynamic mockup selection
 * menu) is handled in the platform-specific registration code.
 */
export default function MockupPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand<MockupPayload | undefined>(
      INSERT_MOCKUP_COMMAND,
      (payload) => {
        // If payload has mockupPath, insert the mockup node
        // screenshotPath can be empty (will show loading state)
        if (payload?.mockupPath) {
          const mockupNode = $createMockupNode({
            ...payload,
            screenshotPath: payload.screenshotPath || '',
          });
          $insertNodes([mockupNode]);
          return true;
        }

        // No payload - show the mockup picker
        if (hasMockupPlatformService()) {
          const service = getMockupPlatformService();
          service.showMockupPicker();
        } else {
          console.warn('[MockupPlugin] Platform service not available');
        }

        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );
  }, [editor]);

  return null;
}
