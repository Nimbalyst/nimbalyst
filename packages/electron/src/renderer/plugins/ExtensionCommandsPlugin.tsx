/**
 * ExtensionCommandsPlugin - Lexical plugin for handling extension slash commands.
 *
 * Registers command listeners for all extension-contributed slash commands.
 * When a command is dispatched, it looks up and invokes the handler from the
 * ExtensionPluginBridge.
 */

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { COMMAND_PRIORITY_EDITOR } from 'lexical';
import { useEffect, useState } from 'react';
import { getExtensionLoader } from '@nimbalyst/runtime';
import {
  getAllExtensionCommands,
  extensionCommandHandlers,
} from '../extensions/ExtensionPluginBridge';

/**
 * ExtensionCommandsPlugin component - registers command handlers for extension slash commands.
 */
export default function ExtensionCommandsPlugin(): null {
  const [editor] = useLexicalComposerContext();
  const [, forceUpdate] = useState(0);

  // Subscribe to extension changes to re-register commands
  useEffect(() => {
    const loader = getExtensionLoader();
    const unsubscribe = loader.subscribe(() => {
      forceUpdate((n) => n + 1);
    });
    return unsubscribe;
  }, []);

  // Register command listeners for all extension commands
  useEffect(() => {
    const commands = getAllExtensionCommands();
    const unregisterFns: Array<() => void> = [];

    for (const [commandId, command] of commands) {
      const unregister = editor.registerCommand(
        command,
        () => {
          const handler = extensionCommandHandlers.get(commandId);
          if (handler) {
            try {
              handler();
            } catch (error) {
              console.error(
                `[ExtensionCommandsPlugin] Error executing handler for ${commandId}:`,
                error
              );
            }
          } else {
            console.warn(
              `[ExtensionCommandsPlugin] No handler found for command ${commandId}`
            );
          }
          return true;
        },
        COMMAND_PRIORITY_EDITOR
      );
      unregisterFns.push(unregister);
    }

    return () => {
      for (const unregister of unregisterFns) {
        unregister();
      }
    };
  }, [editor, forceUpdate]);

  return null;
}
