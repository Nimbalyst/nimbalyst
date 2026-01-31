/**
 * Session Quick Open Introduction Walkthrough
 *
 * Introduces users to the session quick search feature.
 * Shows when users are in agent mode and the search button is visible.
 */

import type { WalkthroughDefinition } from '../types';
import { getHelpContent } from '../../help';
import { isTargetValid } from '../WalkthroughService';

const sessionQuickOpenHelp = getHelpContent('session-quick-search-button')!;

export const sessionQuickOpenIntro: WalkthroughDefinition = {
  id: 'session-quick-open-intro',
  name: 'Session Quick Open',
  version: 1,
  trigger: {
    // Show when in agent mode
    screen: 'agent',
    // Only show when session quick search button is visible
    condition: () => {
      const button = document.querySelector('[data-testid="session-quick-search-button"]');
      return button !== null && isTargetValid(button as HTMLElement);
    },
    // Wait for UI to settle
    delay: 2500,
    // Early priority to show this useful feature
    priority: 12,
  },
  steps: [
    {
      id: 'session-quick-open',
      target: {
        testId: 'session-quick-search-button',
      },
      title: sessionQuickOpenHelp.title,
      body: sessionQuickOpenHelp.body,
      shortcut: sessionQuickOpenHelp.shortcut,
      placement: 'right',
    },
  ],
};
