/**
 * Files Scope Introduction Walkthrough
 *
 * Introduces users to the file scope modes in the Files Edited sidebar.
 * Explains the three scope modes and session filtering within workstreams.
 * Only shows when the dropdown is visible (session has edited files).
 */

import type { WalkthroughDefinition } from '../types';
import { getHelpContent } from '../../help';
import { isTargetValid } from '../WalkthroughService';

const filesScopeHelp = getHelpContent('files-scope-dropdown')!;

export const filesScopeIntro: WalkthroughDefinition = {
  id: 'files-scope-intro',
  name: 'File Scope Modes',
  version: 1,
  trigger: {
    // Show when in agent mode (where Files Edited sidebar lives)
    screen: 'agent',
    // Only show when the dropdown is visible (session has edited files)
    condition: () => {
      const dropdown = document.querySelector('[data-testid="files-scope-dropdown"]');
      return dropdown !== null && isTargetValid(dropdown as HTMLElement);
    },
    // Wait for sidebar to fully render
    delay: 2500,
    // Lower priority - show after more fundamental walkthroughs
    priority: 20,
  },
  steps: [
    {
      id: 'files-scope-dropdown',
      target: {
        testId: 'files-scope-dropdown',
      },
      title: filesScopeHelp.title,
      body: filesScopeHelp.body,
      placement: 'left',
    },
  ],
};
