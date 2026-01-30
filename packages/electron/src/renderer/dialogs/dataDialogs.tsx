/**
 * Data-Carrying Dialogs Registration
 *
 * These dialogs require data to be passed when opening (like error messages,
 * file names, callbacks, etc.). They belong to various groups.
 */

import React from 'react';
import { registerDialog } from '../contexts/DialogContext';
import type { DialogConfig } from '../contexts/DialogContext.types';
import { ProjectSelectionDialog } from '../components/ProjectSelectionDialog/ProjectSelectionDialog';
import { ErrorDialog } from '../components/ErrorDialog/ErrorDialog';
import { SessionImportDialog } from '../components/AgenticCoding/SessionImportDialog';
import { DIALOG_IDS } from './registry';

// Type definitions for dialog data

export interface ProjectSelectionData {
  fileName: string;
  filePath: string;
  suggestedWorkspace?: string;
  onSelectProject: (projectPath: string) => void;
  onCancel: () => void;
}

export interface ErrorDialogData {
  title: string;
  message: string;
  details?: any;
}

export interface SessionImportData {
  workspacePath: string;
}

// Wrapper components that bridge DialogComponentProps to the original component props

function ProjectSelectionWrapper({
  isOpen,
  onClose,
  data,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: ProjectSelectionData;
}) {
  return (
    <ProjectSelectionDialog
      isOpen={isOpen}
      fileName={data.fileName}
      suggestedWorkspace={data.suggestedWorkspace}
      onSelectProject={(projectPath) => {
        data.onSelectProject(projectPath);
        onClose();
      }}
      onCancel={() => {
        data.onCancel();
        onClose();
      }}
    />
  );
}

function ErrorDialogWrapper({
  isOpen,
  onClose,
  data,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: ErrorDialogData;
}) {
  return (
    <ErrorDialog
      isOpen={isOpen}
      onClose={onClose}
      title={data.title}
      message={data.message}
      details={data.details}
    />
  );
}

function SessionImportWrapper({
  isOpen,
  onClose,
  data,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: SessionImportData;
}) {
  const handleImport = async (sessionIds: string[]) => {
    const result = await window.electronAPI?.invoke('claude-code:sync-sessions', {
      sessionIds,
      workspacePath: data.workspacePath,
    });
    if (!result?.success) {
      console.error('[SessionImportDialog] Import failed:', result?.error);
      throw new Error(result?.error || 'Import failed');
    }
  };

  return (
    <SessionImportDialog
      isOpen={isOpen}
      onClose={onClose}
      onImport={handleImport}
      currentWorkspacePath={data.workspacePath}
      filterByWorkspace={true}
    />
  );
}

// Register all data-carrying dialogs
export function registerDataDialogs() {
  registerDialog<ProjectSelectionData>({
    id: DIALOG_IDS.PROJECT_SELECTION,
    group: 'system',
    component:
      ProjectSelectionWrapper as DialogConfig<ProjectSelectionData>['component'],
    priority: 300, // System dialogs have high priority
  });

  registerDialog<ErrorDialogData>({
    id: DIALOG_IDS.ERROR,
    group: 'alert',
    component: ErrorDialogWrapper as DialogConfig<ErrorDialogData>['component'],
    priority: 400, // Errors have highest priority
  });

  registerDialog<SessionImportData>({
    id: DIALOG_IDS.SESSION_IMPORT,
    group: 'system',
    component: SessionImportWrapper as DialogConfig<SessionImportData>['component'],
    priority: 200,
  });
}
