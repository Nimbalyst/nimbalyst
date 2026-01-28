/**
 * Navigation Dialogs Registration
 *
 * These dialogs are mutually exclusive - only one can be open at a time.
 * Opening one will automatically close any other navigation dialog.
 */

import React from 'react';
import { registerDialog } from '../contexts/DialogContext';
import type { DialogConfig } from '../contexts/DialogContext.types';
import { QuickOpen } from '../components/QuickOpen';
import { SessionQuickOpen } from '../components/SessionQuickOpen';
import { PromptQuickOpen } from '../components/PromptQuickOpen';
import { AgentCommandPalette } from '../components/AgentCommandPalette';
import { DIALOG_IDS } from './registry';

// Type definitions for dialog data

export interface QuickOpenData {
  workspacePath: string;
  currentFilePath?: string | null;
  onFileSelect: (filePath: string) => void;
}

export interface SessionQuickOpenData {
  workspacePath: string;
  onSessionSelect: (sessionId: string) => void;
}

export interface PromptQuickOpenData {
  workspacePath: string;
  onSessionSelect: (sessionId: string) => void;
}

export interface AgentCommandPaletteData {
  workspacePath?: string;
  documentContext?: { content?: string; filePath?: string };
}

// Wrapper components that bridge DialogComponentProps to the original component props

function QuickOpenWrapper({
  isOpen,
  onClose,
  data,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: QuickOpenData;
}) {
  return (
    <QuickOpen
      isOpen={isOpen}
      onClose={onClose}
      workspacePath={data.workspacePath}
      currentFilePath={data.currentFilePath}
      onFileSelect={(filePath) => {
        data.onFileSelect(filePath);
        onClose();
      }}
    />
  );
}

function SessionQuickOpenWrapper({
  isOpen,
  onClose,
  data,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: SessionQuickOpenData;
}) {
  return (
    <SessionQuickOpen
      isOpen={isOpen}
      onClose={onClose}
      workspacePath={data.workspacePath}
      onSessionSelect={(sessionId) => {
        data.onSessionSelect(sessionId);
        onClose();
      }}
    />
  );
}

function PromptQuickOpenWrapper({
  isOpen,
  onClose,
  data,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: PromptQuickOpenData;
}) {
  return (
    <PromptQuickOpen
      isOpen={isOpen}
      onClose={onClose}
      workspacePath={data.workspacePath}
      onSessionSelect={(sessionId) => {
        data.onSessionSelect(sessionId);
        onClose();
      }}
    />
  );
}

function AgentCommandPaletteWrapper({
  isOpen,
  onClose,
  data,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: AgentCommandPaletteData;
}) {
  return (
    <AgentCommandPalette
      isOpen={isOpen}
      onClose={onClose}
      workspacePath={data.workspacePath}
      documentContext={data.documentContext}
    />
  );
}

// Register all navigation dialogs
export function registerNavigationDialogs() {
  registerDialog<QuickOpenData>({
    id: DIALOG_IDS.QUICK_OPEN,
    group: 'navigation',
    component: QuickOpenWrapper as DialogConfig<QuickOpenData>['component'],
    priority: 100,
  });

  registerDialog<SessionQuickOpenData>({
    id: DIALOG_IDS.SESSION_QUICK_OPEN,
    group: 'navigation',
    component:
      SessionQuickOpenWrapper as DialogConfig<SessionQuickOpenData>['component'],
    priority: 100,
  });

  registerDialog<PromptQuickOpenData>({
    id: DIALOG_IDS.PROMPT_QUICK_OPEN,
    group: 'navigation',
    component:
      PromptQuickOpenWrapper as DialogConfig<PromptQuickOpenData>['component'],
    priority: 100,
  });

  registerDialog<AgentCommandPaletteData>({
    id: DIALOG_IDS.AGENT_COMMAND_PALETTE,
    group: 'navigation',
    component:
      AgentCommandPaletteWrapper as DialogConfig<AgentCommandPaletteData>['component'],
    priority: 100,
  });
}
