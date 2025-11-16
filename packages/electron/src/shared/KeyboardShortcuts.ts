/**
 * Centralized keyboard shortcuts for the application
 * Shared between main and renderer processes
 */

export const KeyboardShortcuts = {
  // File Menu
  file: {
    new: 'Cmd+N',
    newWindow: 'Cmd+Shift+N',
    open: 'Cmd+O',
    openFolder: 'Cmd+Shift+O',
    save: 'Cmd+S',
    closeTab: 'Cmd+W',
    closeProject: 'Cmd+Shift+W',
    quit: 'Cmd+Q'
  },

  // Edit Menu
  edit: {
    undo: 'Cmd+Z',
    redo: 'Cmd+Shift+Z',
    cut: 'Cmd+X',
    copy: 'Cmd+C',
    copyMarkdown: 'Cmd+Shift+C',
    paste: 'Cmd+V',
    selectAll: 'Cmd+A',
    find: 'Cmd+F',
    findNext: 'Cmd+G',
    findPrevious: 'Cmd+Shift+G',
    findAndReplace: 'Cmd+F', // Same as find - both open search/replace bar now
    viewHistory: 'Cmd+Y',
    approve: 'Cmd+Enter',
    reject: 'Cmd+Shift+Backspace'
  },

  // View Menu
  view: {
    // View modes - keep existing shortcuts
    filesMode: 'Cmd+E',
    agentMode: 'Cmd+K',

    // Panels
    toggleAIChat: 'Cmd+Shift+A',
    toggleBottomPanel: 'Cmd+J',
    toggleSidebar: 'Cmd+B',

    // Navigation
    navigateBack: 'Cmd+[',
    navigateForward: 'Cmd+]',

    // Tab navigation - use Option instead of Alt for macOS compatibility
    nextTab: 'Cmd+Option+Right',
    prevTab: 'Cmd+Option+Left',

    // Zoom
    actualSize: 'Cmd+0',
    zoomIn: 'Cmd+Plus',
    zoomOut: 'Cmd+-',

    // Developer tools
    toggleDevTools: 'Cmd+Alt+I',
    reload: 'Cmd+R',
    forceReload: 'Cmd+Shift+R',

    // Full screen
    toggleFullScreen: 'Ctrl+Cmd+F'
  },

  // Window Menu
  window: {
    workspaceManager: 'Cmd+P',
    sessionManager: 'Cmd+Shift+H',
    agenticCoding: 'Cmd+Shift+K',
    aiModels: 'Cmd+,',
    minimize: 'Cmd+M'
  },

  // Developer Menu
  developer: {
    toggleDebugConsole: 'Cmd+Shift+D',
    refreshFileTree: 'Cmd+Shift+F5'
  }
} as const;

/**
 * Get platform-specific shortcut display (for renderer)
 */
export function getShortcutDisplay(shortcut: string): string {
  return shortcut
    .replace('Cmd', '⌘')
    .replace('Ctrl', '⌃')
    .replace('Option', '⌥')
    .replace('Alt', '⌥')
    .replace('Shift', '⇧');
}

/**
 * Get Electron accelerator format (for main process)
 */
export function getElectronAccelerator(shortcut: string): string {
  return shortcut.replace('Cmd', 'CmdOrCtrl');
}
