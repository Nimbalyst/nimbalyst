import React from 'react';
import { KeyboardShortcuts, getShortcutDisplay } from '../../../shared/KeyboardShortcuts';
import './KeyboardShortcutsDialog.css';

interface KeyboardShortcutsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutGroup {
  title: string;
  shortcuts: Array<{
    label: string;
    shortcut: string;
  }>;
}

export function KeyboardShortcutsDialog({ isOpen, onClose }: KeyboardShortcutsDialogProps) {
  if (!isOpen) return null;

  const shortcutGroups: ShortcutGroup[] = [
    {
      title: 'File',
      shortcuts: [
        { label: 'New File / New Session', shortcut: KeyboardShortcuts.file.newFile },
        { label: 'New Window', shortcut: KeyboardShortcuts.file.newWindow },
        { label: 'Open File', shortcut: KeyboardShortcuts.file.open },
        { label: 'Open Folder', shortcut: KeyboardShortcuts.file.openFolder },
        { label: 'Save', shortcut: KeyboardShortcuts.file.save },
        { label: 'Close Tab', shortcut: KeyboardShortcuts.file.closeTab },
        { label: 'Close Project', shortcut: KeyboardShortcuts.file.closeProject },
        { label: 'Quit', shortcut: KeyboardShortcuts.file.quit },
      ],
    },
    {
      title: 'Edit',
      shortcuts: [
        { label: 'Undo', shortcut: KeyboardShortcuts.edit.undo },
        { label: 'Redo', shortcut: KeyboardShortcuts.edit.redo },
        { label: 'Cut', shortcut: KeyboardShortcuts.edit.cut },
        { label: 'Copy', shortcut: KeyboardShortcuts.edit.copy },
        { label: 'Paste', shortcut: KeyboardShortcuts.edit.paste },
        { label: 'Select All', shortcut: KeyboardShortcuts.edit.selectAll },
        { label: 'Find', shortcut: KeyboardShortcuts.edit.find },
        { label: 'Find and Replace', shortcut: KeyboardShortcuts.edit.findAndReplace },
        { label: 'View Local History', shortcut: KeyboardShortcuts.edit.viewHistory },
        { label: 'Approve Current Action', shortcut: KeyboardShortcuts.edit.approve },
        { label: 'Reject Current Action', shortcut: KeyboardShortcuts.edit.reject },
      ],
    },
    {
      title: 'View',
      shortcuts: [
        { label: 'Files Mode', shortcut: KeyboardShortcuts.view.filesMode },
        { label: 'Agent Mode', shortcut: KeyboardShortcuts.view.agentMode },
        { label: 'Toggle AI Chat Panel', shortcut: KeyboardShortcuts.view.toggleAIChat },
        { label: 'Toggle Bottom Panel', shortcut: KeyboardShortcuts.view.toggleBottomPanel },
        { label: 'Navigate Back', shortcut: KeyboardShortcuts.view.navigateBack },
        { label: 'Navigate Forward', shortcut: KeyboardShortcuts.view.navigateForward },
        { label: 'Next Tab', shortcut: KeyboardShortcuts.view.nextTab },
        { label: 'Previous Tab', shortcut: KeyboardShortcuts.view.prevTab },
        { label: 'Actual Size', shortcut: KeyboardShortcuts.view.actualSize },
        { label: 'Zoom In', shortcut: KeyboardShortcuts.view.zoomIn },
        { label: 'Zoom Out', shortcut: KeyboardShortcuts.view.zoomOut },
        { label: 'Toggle Full Screen', shortcut: KeyboardShortcuts.view.toggleFullScreen },
      ],
    },
    {
      title: 'Window',
      shortcuts: [
        { label: 'Project Manager', shortcut: KeyboardShortcuts.window.workspaceManager },
        { label: 'Session Manager', shortcut: KeyboardShortcuts.window.sessionManager },
        { label: 'Agentic Coding', shortcut: KeyboardShortcuts.window.agenticCoding },
        { label: 'Settings', shortcut: KeyboardShortcuts.window.aiModels },
        { label: 'Minimize', shortcut: KeyboardShortcuts.window.minimize },
        { label: 'Switch to Window 1-9', shortcut: 'Cmd+1-9' },
      ],
    },
    {
      title: 'Developer',
      shortcuts: [
        { label: 'Toggle Developer Tools', shortcut: KeyboardShortcuts.view.toggleDevTools },
        { label: 'Reload', shortcut: KeyboardShortcuts.view.reload },
        { label: 'Force Reload', shortcut: KeyboardShortcuts.view.forceReload },
        { label: 'Refresh File Tree', shortcut: KeyboardShortcuts.developer.refreshFileTree },
      ],
    },
  ];

  return (
    <div className="keyboard-shortcuts-dialog-overlay" onClick={onClose}>
      <div className="keyboard-shortcuts-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="keyboard-shortcuts-dialog-header">
          <h2>Keyboard Shortcuts</h2>
          <button className="keyboard-shortcuts-dialog-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="keyboard-shortcuts-dialog-content">
          {shortcutGroups.map((group) => (
            <div key={group.title} className="keyboard-shortcuts-group">
              <h3 className="keyboard-shortcuts-group-title">{group.title}</h3>
              <div className="keyboard-shortcuts-list">
                {group.shortcuts.map((item) => (
                  <div key={item.label} className="keyboard-shortcut-item">
                    <span className="keyboard-shortcut-label">{item.label}</span>
                    <kbd className="keyboard-shortcut-key">{getShortcutDisplay(item.shortcut)}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
