/**
 * Context Window Introduction Walkthrough
 *
 * Helps users understand the context window indicator and what it means.
 * Shows when users first use Agent Mode.
 */

import type { WalkthroughDefinition } from '../types';
import { getHelpContent } from '../../help';

const contextHelp = getHelpContent('context-indicator')!;

export const contextWindowIntro: WalkthroughDefinition = {
  id: 'context-window-intro',
  name: 'Context Window',
  version: 1,
  trigger: {
    // Show when in agent mode
    screen: 'agent',
    // Wait for UI to settle and some activity
    delay: 2000,
    // Slightly lower priority than model picker
    priority: 25,
  },
  steps: [
    {
      id: 'context-indicator',
      target: {
        testId: 'context-indicator',
      },
      title: contextHelp.title,
      body: contextHelp.body,
      placement: 'bottom',
    },
  ],
};
