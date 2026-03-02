/**
 * HelpContent - Centralized registry for UI help text
 *
 * This module provides a single source of truth for help content that appears
 * in walkthroughs, tooltips, and other help UI. By centralizing this content,
 * we ensure consistency and make it easy to update help text in one place.
 *
 * See nimbalyst-local/plans/help-content-inventory.md for the full inventory.
 */

import { KeyboardShortcuts } from '../../shared/KeyboardShortcuts';

/**
 * Help content for a single UI element
 */
export interface HelpEntry {
  /** Short title for the feature */
  title: string;
  /** Longer description of what the feature does */
  body: string;
  /** Optional keyboard shortcut (from KeyboardShortcuts) */
  shortcut?: string;
}

/**
 * Central registry of help content, keyed by data-testid
 */
export const HelpContent: Record<string, HelpEntry> = {
  // ============================================================================
  // Files Mode - File Tree
  // ============================================================================

  'file-tree-filter-button': {
    title: 'Filter Your File Tree',
    body: 'Show only markdown files, uncommitted git changes, or files the AI has read or written in this session.',
  },
  'file-tree-quick-open-button': {
    title: 'Quick Open Files',
    body: 'Search for any file in your project by name. Recently opened files appear at the top.',
    shortcut: KeyboardShortcuts.file.open,
  },
  'file-tree-new-file-button': {
    title: 'New File',
    body: 'Create a new file in the selected folder.',
    shortcut: KeyboardShortcuts.file.newFile,
  },
  'file-tree-new-folder-button': {
    title: 'New Folder',
    body: 'Create a new folder in the selected folder.',
  },

  // ============================================================================
  // Files Mode - Unified Header
  // ============================================================================

  'ai-sessions-button': {
    title: 'Past AI Sessions',
    body: 'See AI sessions that edited this file. Jump back to continue a conversation or review changes.',
  },
  'file-history-button': {
    title: 'Document History',
    body: 'View previous versions of this document. Restore or compare any saved state.',
    shortcut: KeyboardShortcuts.edit.viewHistory,
  },
  'toc-toggle-button': {
    title: 'Table of Contents',
    body: 'Toggle the table of contents panel. Navigate quickly to any heading in the document.',
  },

  // ============================================================================
  // Files Mode - Diff Mode
  // ============================================================================

  'diff-keep-button': {
    title: 'Keep Changes',
    body: 'Accept the AI changes for this section and update the document.',
    shortcut: KeyboardShortcuts.edit.approve,
  },
  'diff-revert-button': {
    title: 'Revert Changes',
    body: 'Reject the AI changes and restore the original content.',
    shortcut: KeyboardShortcuts.edit.reject,
  },
  'diff-keep-all-button': {
    title: 'Keep All Changes',
    body: 'Accept all pending AI changes throughout the document.',
  },
  'diff-revert-all-button': {
    title: 'Revert All Changes',
    body: 'Reject all pending AI changes and restore the original document.',
  },

  // ============================================================================
  // Navigation
  // ============================================================================

  'nav-back-button': {
    title: 'Navigate Back',
    body: 'Go back to the previous file or location.',
    shortcut: KeyboardShortcuts.view.navigateBack,
  },
  'nav-forward-button': {
    title: 'Navigate Forward',
    body: 'Go forward in your navigation history.',
    shortcut: KeyboardShortcuts.view.navigateForward,
  },

  // ============================================================================
  // View Modes
  // ============================================================================

  'files-mode-button': {
    title: 'Files Mode',
    body: 'Browse and edit your project files with AI assistance on any document.',
    shortcut: KeyboardShortcuts.view.filesMode,
  },
  'agent-mode-button': {
    title: 'Agent Mode',
    body: 'Full AI coding agent with project-wide context, tool use, and multi-step tasks.',
    shortcut: KeyboardShortcuts.view.agentMode,
  },

  // ============================================================================
  // Agent Mode - Session Views
  // ============================================================================

  'session-kanban-button': {
    title: 'Kanban Board',
    body: 'Switch to a kanban board view of your sessions organized by phase: Backlog, Planning, Implementing, Validating, and Complete. Drag sessions between columns to update their status.',
    shortcut: KeyboardShortcuts.window.kanbanView,
  },

  // ============================================================================
  // Agent Mode - Layout Controls
  // ============================================================================

  'layout-controls': {
    title: 'Session Layout Modes',
    body: `View your AI session and files edited together:

**Files**: Show only the file editor tabs. Available when you open an edited file in an AI Session.

**Split**: Show both transcript and editor stacked vertically. Drag the divider to adjust.

**Agent**: Show only the conversation transcript.`,
  },

  // ============================================================================
  // Agent Mode - Session Management
  // ============================================================================

  'session-history-button': {
    title: 'Session History',
    body: 'Browse past AI sessions. Search, filter, and resume previous conversations.',
    shortcut: KeyboardShortcuts.window.sessionManager,
  },
  'session-quick-open-button': {
    title: 'Quick Open Session',
    body: 'Search and jump to any AI session by content or title. Much faster than scrolling through history.',
    shortcut: KeyboardShortcuts.window.sessionQuickOpen,
  },
  'session-quick-search-button': {
    title: 'Search Sessions',
    body: `Quickly find any AI session by name. Type **@** to search by file edited -- find every session that touched a specific file. Press **Tab** to switch to prompt search and find sessions by what you asked.`,
    shortcut: KeyboardShortcuts.window.sessionQuickOpen,
  },
  'session-archive-button': {
    title: 'Archive Session',
    body: 'Archive this session to keep your session list organized. Archived sessions can be restored anytime.',
  },

  // ============================================================================
  // Agent Mode - AI Input
  // ============================================================================

  'agent-input': {
    title: 'AI Input',
    body: 'Type your message or paste images and files. The AI has full context of your project.',
  },
  'plan-mode-toggle': {
    title: 'Plan vs Agent Mode',
    body: 'Toggle between Plan and Agent modes. Plan mode creates structured plans before the AI writes code. Agent mode executes changes directly.',
  },
  'attach-files-input': {
    title: 'Attach Files & Images',
    body: 'Drag and drop files or paste images directly into the chat. You can also use @ to mention files from your project.',
  },
  'agent-welcome': {
    title: 'Start Your First Session',
    body: 'Create an AI coding session. Describe what you want to build, and the agent will help you.',
  },

  // ============================================================================
  // Agent Mode - Files Edited Sidebar
  // ============================================================================

  'files-scope-dropdown': {
    title: 'File Scope Modes',
    body: 'Control which files are shown. View AI edits from this session, only uncommitted changes, or all files in the workspace. In workstreams, filter by individual session or see all sessions combined.',
  },

  // ============================================================================
  // Agent Mode - Git Operations
  // ============================================================================

  'git-commit-mode-toggle': {
    title: 'Commit Modes',
    body: 'Choose how to commit your changes. Manual lets you write your own message. Smart uses AI to analyze changes and propose a commit message.',
  },
  'git-operations-commit-with-ai-button': {
    title: 'AI-Assisted Commit',
    body: 'Have the AI analyze your changes and propose a set of files and a commit message for you to edit and approve.',
  },

  // ============================================================================
  // Agent Mode - Model & Context
  // ============================================================================

  'model-picker': {
    title: 'Select AI Model',
    body: 'Choose which AI model to use. Different models have different capabilities and speeds.',
  },
  'context-indicator': {
    title: 'Context Window',
    body: 'Shows how much of the AI context window is used. Includes files, conversation history, and tools.',
  },

  // ============================================================================
  // Agent Mode - Transcript Controls
  // ============================================================================

  'transcript-archive-button': {
    title: 'Archive Session',
    body: 'Archive this session to keep your session list tidy.',
  },
  'transcript-search-button': {
    title: 'Search Transcript',
    body: 'Search within this conversation for specific messages or content.',
  },

  // ============================================================================
  // Agent Mode - Voice
  // ============================================================================

  'voice-mode-toggle': {
    title: 'Voice Mode',
    body: 'Speak to the AI instead of typing. The AI will respond with voice.',
  },

  // ============================================================================
  // Project Window Gutter
  // ============================================================================

  'gutter-permissions-button': {
    title: 'Agent Permissions',
    body: 'Configure which tools the AI agent can use. Control file access, command execution, and more.',
  },
  'gutter-sync-button': {
    title: 'Session Sync',
    body: 'Check sync status for this project and manage sync settings.',
  },
  'gutter-extension-dev-button': {
    title: 'Extension Dev Mode',
    body: 'Open extension development tools, logs, and rebuild options.',
  },
  'gutter-theme-button': {
    title: 'Theme',
    body: 'Switch between light and dark themes.',
  },
  'gutter-feedback-button': {
    title: 'Send Feedback',
    body: 'Share feedback or report issues with the team.',
  },
  'gutter-user-button': {
    title: 'User Menu',
    body: 'Open user menu to access User Settings, Project Settings, Team Settings, and account info.',
  },
  'terminal-panel-button': {
    title: 'Terminal',
    body: 'Toggle the terminal panel for running commands.',
    shortcut: KeyboardShortcuts.view.toggleTerminalPanel,
  },
  'tracker-mode-button': {
    title: 'Trackers',
    body: 'Switch to Tracker mode for a full project management view with table and kanban layouts.',
    shortcut: KeyboardShortcuts.view.trackerMode,
  },

  // ============================================================================
  // Settings
  // ============================================================================

  'settings-project-tab': {
    title: 'Project Settings',
    body: 'Settings specific to this project. Stored in the project folder.',
  },
  'settings-global-tab': {
    title: 'Global Settings',
    body: 'Settings that apply to all projects.',
  },
  'settings-walkthroughs-toggle': {
    title: 'Feature Guides',
    body: 'Show helpful guides for new features. Guides appear automatically as you use the app.',
  },
  'settings-walkthroughs-reset': {
    title: 'Reset Guides',
    body: 'Show all feature guides again, even ones you have already seen.',
  },

  // ============================================================================
  // Project Manager
  // ============================================================================

  'project-manager-open': {
    title: 'Open Project',
    body: 'Open a project folder from your computer.',
    shortcut: KeyboardShortcuts.file.openFolder,
  },
  'project-manager-recent': {
    title: 'Recent Projects',
    body: 'Your recently opened projects for quick access.',
  },
};

/**
 * Get help content for a UI element by its data-testid
 */
export function getHelpContent(testId: string): HelpEntry | undefined {
  return HelpContent[testId];
}

/**
 * Check if help content exists for a given testId
 */
export function hasHelpContent(testId: string): boolean {
  return testId in HelpContent;
}
