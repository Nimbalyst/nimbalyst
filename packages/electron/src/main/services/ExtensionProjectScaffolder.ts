import { app, BrowserWindow, dialog } from 'electron';
import { basename, dirname, join } from 'path';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { templates } from '../../../../extensions/extension-dev-kit/src/templates.ts';
import { createWindow, findWindowByWorkspace } from '../window/WindowManager';
import { addToRecentItems, getWorkspaceWindowState, isExtensionDevToolsEnabled } from '../utils/store';

type ExtensionTemplateId = 'minimal' | 'custom-editor' | 'ai-tool';

function getTemplateChoice(response: number): ExtensionTemplateId | null {
  switch (response) {
    case 0:
      return 'minimal';
    case 1:
      return 'custom-editor';
    case 2:
      return 'ai-tool';
    default:
      return null;
  }
}

function deriveProjectName(projectPath: string): string {
  const raw = basename(projectPath)
    .replace(/\.[^/.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();

  if (!raw) {
    return 'New Extension';
  }

  return raw
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function deriveExtensionId(projectPath: string): string {
  const slug = basename(projectPath)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `com.developer.${slug || 'new-extension'}`;
}

function writeTemplateFiles(projectPath: string, files: Record<string, string>): void {
  mkdirSync(projectPath, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = join(projectPath, relativePath);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
}

function openWorkspace(projectPath: string): void {
  addToRecentItems('workspaces', projectPath, basename(projectPath));

  const existingWindow = findWindowByWorkspace(projectPath);
  if (existingWindow && !existingWindow.isDestroyed()) {
    existingWindow.focus();
    return;
  }

  const savedState = getWorkspaceWindowState(projectPath);
  createWindow(false, true, projectPath, savedState?.bounds);
}

export async function showNewExtensionProjectDialog(sourceWindow?: BrowserWindow | null): Promise<void> {
  const templateResult = sourceWindow
    ? await dialog.showMessageBox(sourceWindow, {
      type: 'question',
      title: 'New Extension Project',
      message: 'Choose a template for your new Nimbalyst extension project.',
      detail: 'You can refine the scaffold after creation and use Claude to build, install, and reload the extension inside Nimbalyst.',
      buttons: ['Minimal', 'Custom Editor', 'AI Tool', 'Cancel'],
      defaultId: 0,
      cancelId: 3,
      noLink: true,
    })
    : await dialog.showMessageBox({
      type: 'question',
      title: 'New Extension Project',
      message: 'Choose a template for your new Nimbalyst extension project.',
      detail: 'You can refine the scaffold after creation and use Claude to build, install, and reload the extension inside Nimbalyst.',
      buttons: ['Minimal', 'Custom Editor', 'AI Tool', 'Cancel'],
      defaultId: 0,
      cancelId: 3,
      noLink: true,
    });

  const templateId = getTemplateChoice(templateResult.response);
  if (!templateId) {
    return;
  }

  const defaultPath = join(app.getPath('documents'), 'my-nimbalyst-extension');
  const projectResult = sourceWindow
    ? await dialog.showSaveDialog(sourceWindow, {
      title: 'Create New Extension Project',
      defaultPath,
      buttonLabel: 'Create Project',
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    })
    : await dialog.showSaveDialog({
      title: 'Create New Extension Project',
      defaultPath,
      buttonLabel: 'Create Project',
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });

  if (projectResult.canceled || !projectResult.filePath) {
    return;
  }

  const projectPath = projectResult.filePath;

  if (existsSync(projectPath) && readdirSync(projectPath).length > 0) {
    if (sourceWindow) {
      await dialog.showMessageBox(sourceWindow, {
        type: 'warning',
        title: 'Folder Not Empty',
        message: 'Choose an empty folder for the new extension project.',
        detail: `The selected folder already contains files:\n${projectPath}`,
        buttons: ['OK'],
      });
    } else {
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Folder Not Empty',
        message: 'Choose an empty folder for the new extension project.',
        detail: `The selected folder already contains files:\n${projectPath}`,
        buttons: ['OK'],
      });
    }
    return;
  }

  const templateFn = templates[templateId];
  const files = templateFn({
    name: deriveProjectName(projectPath),
    extensionId: deriveExtensionId(projectPath),
    filePatterns: ['*.example'],
  });

  writeTemplateFiles(projectPath, files);
  openWorkspace(projectPath);

  const nextStep = isExtensionDevToolsEnabled()
    ? 'Next: ask Claude to build and install the extension.'
    : 'Next: enable Extension Dev Tools in Settings > Advanced, then ask Claude to build and install the extension.';

  if (sourceWindow) {
    await dialog.showMessageBox(sourceWindow, {
      type: 'info',
      title: 'Extension Project Created',
      message: 'Your new Nimbalyst extension project has been created and opened.',
      detail: `${nextStep}\n\nProject path:\n${projectPath}`,
      buttons: ['OK'],
    });
  } else {
    await dialog.showMessageBox({
      type: 'info',
      title: 'Extension Project Created',
      message: 'Your new Nimbalyst extension project has been created and opened.',
      detail: `${nextStep}\n\nProject path:\n${projectPath}`,
      buttons: ['OK'],
    });
  }
}
