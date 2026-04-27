/**
 * NavigationDialogKeyboardHandler
 *
 * This component handles keyboard shortcuts for navigation dialogs.
 * It must be rendered inside DialogProvider to access the dialog context.
 */

import React, { useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { useNavigationDialogs } from '../dialogs';
import { openNavigationDialogRequestAtom } from '../store/atoms/appCommands';

const isMac = navigator.platform.startsWith('Mac');
import type {
  QuickOpenData,
  SessionQuickOpenData,
  PromptQuickOpenData,
  ProjectQuickOpenData,
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
    openProjectQuickOpen,
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
    openProjectQuickOpen,
  });

  useEffect(() => {
    dialogsRef.current = {
      openQuickOpen,
      openSessionQuickOpen,
      openPromptQuickOpen,
      openProjectQuickOpen,
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

      // Cmd+Shift+P (Mac) or Ctrl+Shift+P (Windows/Linux) for Project Quick Open
      if (
        isAppModifier &&
        e.shiftKey &&
        (e.key === 'P' || e.key === 'p')
      ) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        dialogs.openProjectQuickOpen({
          currentWorkspacePath: props.workspacePath,
        });
        return;
      }

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

  // React to menu-triggered dialog opens. The IPC subscription lives in
  // store/listeners/appCommandListeners.ts; we watch the request atom here.
  const openNavigationDialogRequest = useAtomValue(openNavigationDialogRequestAtom);
  useEffect(() => {
    if (!openNavigationDialogRequest) return;
    const dialogId = openNavigationDialogRequest.dialogId;
    const handleOpenDialog = () => {
      const props = propsRef.current;
      const dialogs = dialogsRef.current;

      if (!props.workspaceMode || !props.workspacePath) return;

      switch (dialogId) {
        case 'project-quick-open':
          dialogs.openProjectQuickOpen({
            currentWorkspacePath: props.workspacePath,
          });
          break;
        case 'quick-open':
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
              });
            },
          });
          break;
        case 'session-quick-open':
          dialogs.openSessionQuickOpen({
            workspacePath: props.workspacePath,
            onSessionSelect: props.onSessionSelect,
            onSwitchToPrompts: (query: string) => {
              dialogs.openPromptQuickOpen({
                workspacePath: props.workspacePath!,
                onSessionSelect: props.onPromptSelect,
                initialSearchQuery: query,
              });
            },
          });
          break;
        case 'prompt-quick-open':
          dialogs.openPromptQuickOpen({
            workspacePath: props.workspacePath,
            onSessionSelect: props.onPromptSelect,
          });
          break;
        case 'content-search':
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
              });
            },
          });
          break;
      }
    };

    handleOpenDialog();
  }, [openNavigationDialogRequest]);

  // This component renders nothing
  return null;
}
