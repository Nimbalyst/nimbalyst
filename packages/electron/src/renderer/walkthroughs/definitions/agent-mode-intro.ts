/**
 * Agent Mode Introduction Walkthrough
 *
 * A simple walkthrough to introduce users to Agent Mode.
 * This is shown when users first enter the "files" mode.
 */

import type { WalkthroughDefinition } from '../types';

export const agentModeIntro: WalkthroughDefinition = {
  id: 'agent-mode-intro',
  name: 'Agent Mode Introduction',
  version: 1,
  trigger: {
    // Show when in files mode (main workspace view)
    screen: 'files',
    // Delay to let UI settle after initial load
    delay: 1000,
    // Lower priority - other walkthroughs can take precedence
    priority: 10,
  },
  steps: [
    {
      id: 'agent-mode-button',
      target: {
        // Target the AI sidebar toggle or agent mode button
        // Will need to add data-testid to the appropriate element
        testId: 'ai-sidebar-toggle',
      },
      title: 'Meet Agent Mode',
      body: 'Click here to open the AI assistant. Ask questions, get suggestions, or let Claude help you write and debug code.',
      placement: 'right',
    },
  ],
};
