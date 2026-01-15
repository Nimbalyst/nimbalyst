/**
 * Navigation Introduction Walkthrough
 *
 * Introduces users to the navigation gutter with Files mode and Agent mode.
 * This is a high-priority walkthrough shown to new users.
 */

import type { WalkthroughDefinition } from '../types';

export const navigationIntro: WalkthroughDefinition = {
  id: 'navigation-intro',
  name: 'Navigation Introduction',
  version: 1,
  trigger: {
    // Show in any mode since the nav gutter is always visible
    screen: '*',
    // Short delay after app loads
    delay: 500,
    // Highest priority - show this first
    priority: 5,
  },
  steps: [
    {
      id: 'files-mode',
      target: {
        testId: 'files-mode-button',
      },
      title: 'Files Mode',
      body: 'Browse and edit your project files. Open markdown documents, code files, and more. The AI assistant sidebar is available here too.',
      placement: 'right',
      shortcut: 'Cmd+1',
    },
    {
      id: 'agent-mode',
      target: {
        testId: 'agent-mode-button',
      },
      title: 'Agent Mode',
      body: 'A focused coding environment powered by Claude. Give instructions, and the AI agent will write code, run commands, and make changes across your project.',
      placement: 'right',
      shortcut: 'Cmd+2',
    },
  ],
};
