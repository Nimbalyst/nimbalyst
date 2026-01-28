/**
 * Hook for opening navigation dialogs with proper typing.
 *
 * This hook provides convenience functions for opening navigation dialogs
 * with the correct data types, making it easier to use from App.tsx.
 */

import { useCallback } from 'react';
import { useDialog } from '../contexts/DialogContext';
import { DIALOG_IDS } from './registry';
import type {
  QuickOpenData,
  SessionQuickOpenData,
  PromptQuickOpenData,
  AgentCommandPaletteData,
} from './navigation';

export interface UseNavigationDialogsReturn {
  openQuickOpen: (data: QuickOpenData) => void;
  openSessionQuickOpen: (data: SessionQuickOpenData) => void;
  openPromptQuickOpen: (data: PromptQuickOpenData) => void;
  openAgentCommandPalette: (data: AgentCommandPaletteData) => void;
  closeNavigationDialogs: () => void;
}

/**
 * Hook for opening navigation dialogs.
 *
 * Usage:
 * ```tsx
 * const { openQuickOpen, openSessionQuickOpen } = useNavigationDialogs();
 *
 * // Open QuickOpen with callbacks
 * openQuickOpen({
 *   workspacePath: '/path/to/workspace',
 *   currentFilePath: '/path/to/current/file.md',
 *   onFileSelect: (filePath) => handleFileSelect(filePath),
 * });
 * ```
 */
export function useNavigationDialogs(): UseNavigationDialogsReturn {
  const { open, close, activeDialogs } = useDialog();

  const openQuickOpen = useCallback(
    (data: QuickOpenData) => {
      open(DIALOG_IDS.QUICK_OPEN, data);
    },
    [open],
  );

  const openSessionQuickOpen = useCallback(
    (data: SessionQuickOpenData) => {
      open(DIALOG_IDS.SESSION_QUICK_OPEN, data);
    },
    [open],
  );

  const openPromptQuickOpen = useCallback(
    (data: PromptQuickOpenData) => {
      open(DIALOG_IDS.PROMPT_QUICK_OPEN, data);
    },
    [open],
  );

  const openAgentCommandPalette = useCallback(
    (data: AgentCommandPaletteData) => {
      open(DIALOG_IDS.AGENT_COMMAND_PALETTE, data);
    },
    [open],
  );

  // Close all navigation dialogs
  const closeNavigationDialogs = useCallback(() => {
    const navigationDialogIds = [
      DIALOG_IDS.QUICK_OPEN,
      DIALOG_IDS.SESSION_QUICK_OPEN,
      DIALOG_IDS.PROMPT_QUICK_OPEN,
      DIALOG_IDS.AGENT_COMMAND_PALETTE,
    ];

    navigationDialogIds.forEach((id) => {
      if (activeDialogs.includes(id)) {
        close(id);
      }
    });
  }, [close, activeDialogs]);

  return {
    openQuickOpen,
    openSessionQuickOpen,
    openPromptQuickOpen,
    openAgentCommandPalette,
    closeNavigationDialogs,
  };
}
