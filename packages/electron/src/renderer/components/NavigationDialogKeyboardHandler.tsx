/**
 * NavigationDialogKeyboardHandler
 *
 * This component handles keyboard shortcuts for navigation dialogs.
 * It must be rendered inside DialogProvider to access the dialog context.
 */

import React, { useEffect, useRef } from 'react';
import { useNavigationDialogs } from '../dialogs';

const isMac = navigator.platform.startsWith('Mac');
import type {
  QuickOpenData,
  SessionQuickOpenData,
  PromptQuickOpenData,
  AgentCommandPaletteData,
} from '../dialogs';

interface NavigationDialogKeyboardHandlerProps {
  /** Whether workspace mode is active (dialogs only work in workspace mode) */
  workspaceMode: boolean;
  /** Current workspace path */
  workspacePath: string | null;
  /** Current file path for QuickOpen */
  currentFilePath: string | null;
  /** Callback when a file is selected in QuickOpen */
  onFileSelect: (filePath: string) => void;
  /** Callback when a folder is selected in QuickOpen -- switches to files mode */
  onFolderSelect?: () => void;
  /** Callback when a session is selected in SessionQuickOpen */
  onSessionSelect: (sessionId: string) => void;
  /** Callback when a prompt is selected in PromptQuickOpen */
  onPromptSelect: (sessionId: string, messageTimestamp?: number) => void;
  /** Document context for AgentCommandPalette */
  documentContext: { content?: string; filePath?: string };
}

/**
 * Component that sets up keyboard shortcuts for navigation dialogs.
 * Renders nothing but sets up event listeners.
 */
export function NavigationDialogKeyboardHandler({
  workspaceMode,
  workspacePath,
  currentFilePath,
  onFileSelect,
  onFolderSelect,
  onSessionSelect,
  onPromptSelect,
  documentContext,
}: NavigationDialogKeyboardHandlerProps) {
  const {
    openQuickOpen,
    openSessionQuickOpen,
    openPromptQuickOpen,
    openAgentCommandPalette,
  } = useNavigationDialogs();

  // Store props in refs so keyboard handler always has latest values
  const propsRef = useRef({
    workspaceMode,
    workspacePath,
    currentFilePath,
    onFileSelect,
    onFolderSelect,
    onSessionSelect,
    onPromptSelect,
    documentContext,
  });

  useEffect(() => {
    propsRef.current = {
      workspaceMode,
      workspacePath,
      currentFilePath,
      onFileSelect,
      onFolderSelect,
      onSessionSelect,
      onPromptSelect,
      documentContext,
    };
  });

  // Store dialog openers in ref for keyboard handler
  const dialogsRef = useRef({
    openQuickOpen,
    openSessionQuickOpen,
    openPromptQuickOpen,
    openAgentCommandPalette,
  });

  useEffect(() => {
    dialogsRef.current = {
      openQuickOpen,
      openSessionQuickOpen,
      openPromptQuickOpen,
      openAgentCommandPalette,
    };
  });

  // Set up keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const props = propsRef.current;
      const dialogs = dialogsRef.current;

      // Only handle shortcuts in workspace mode
      if (!props.workspaceMode || !props.workspacePath) return;

      // On macOS, app shortcuts use Command (metaKey). On Windows/Linux, they use Ctrl.
      const isAppModifier = isMac ? e.metaKey : e.ctrlKey;

      // Cmd+Shift+F (Mac) or Ctrl+Shift+F (Windows/Linux) for Quick Open in content search mode
      if (
        isAppModifier &&
        e.shiftKey &&
        (e.key === 'F' || e.key === 'f')
      ) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        dialogs.openQuickOpen({
          workspacePath: props.workspacePath,
          currentFilePath: props.currentFilePath,
          onFileSelect: props.onFileSelect,
          onFolderSelect: props.onFolderSelect,
          startInContentSearchMode: true,
          onShowFileSessions: (filePath: string) => {
            dialogs.openSessionQuickOpen({
              workspacePath: props.workspacePath!,
              onSessionSelect: props.onSessionSelect,
              initialSearchQuery: `@${filePath}`,
              onSwitchToPrompts: (query: string) => {
                dialogs.openPromptQuickOpen({
                  workspacePath: props.workspacePath!,
                  onSessionSelect: props.onPromptSelect,
                  initialSearchQuery: query,
                });
              },
            });
          },
        });
        return;
      }

      // Cmd+O (Mac) or Ctrl+O (Windows/Linux) for Quick Open
      if (isAppModifier && e.key === 'o') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        dialogs.openQuickOpen({
          workspacePath: props.workspacePath,
          currentFilePath: props.currentFilePath,
          onFileSelect: props.onFileSelect,
          onFolderSelect: props.onFolderSelect,
          onShowFileSessions: (filePath: string) => {
            dialogs.openSessionQuickOpen({
              workspacePath: props.workspacePath!,
              onSessionSelect: props.onSessionSelect,
              initialSearchQuery: `@${filePath}`,
              onSwitchToPrompts: (query: string) => {
                dialogs.openPromptQuickOpen({
                  workspacePath: props.workspacePath!,
                  onSessionSelect: props.onPromptSelect,
                  initialSearchQuery: query,
                });
              },
            });
          },
        });
        return;
      }

      // Cmd+L (Mac) or Ctrl+L (Windows/Linux) for Session Quick Open
      if (isAppModifier && e.key === 'l' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        // Carry over search text from Prompt Quick Open if it's currently open
        const carryQuery = (document.querySelector('.prompt-quick-open-search') as HTMLInputElement)?.value || '';
        dialogs.openSessionQuickOpen({
          workspacePath: props.workspacePath,
          onSessionSelect: props.onSessionSelect,
          initialSearchQuery: carryQuery || undefined,
          onSwitchToPrompts: (query: string) => {
            dialogs.openPromptQuickOpen({
              workspacePath: props.workspacePath!,
              onSessionSelect: props.onPromptSelect,
              initialSearchQuery: query,
            });
          },
        });
        return;
      }

      // Cmd+Shift+L (Mac) or Ctrl+Shift+L (Windows/Linux) for Prompt Quick Open
      if (
        isAppModifier &&
        e.shiftKey &&
        (e.key === 'L' || e.key === 'l')
      ) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        // Carry over search text from Session Quick Open if it's currently open
        const carryQuery = (document.querySelector('.session-quick-open-search') as HTMLInputElement)?.value || '';
        dialogs.openPromptQuickOpen({
          workspacePath: props.workspacePath,
          onSessionSelect: props.onPromptSelect,
          initialSearchQuery: carryQuery || undefined,
        });
        return;
      }
    };

    // Use capture phase to handle before other handlers
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  // This component renders nothing
  return null;
}
