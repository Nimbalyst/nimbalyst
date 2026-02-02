/**
 * Walkthrough Definitions Index
 *
 * Export all walkthrough definitions from this file.
 * Each walkthrough is defined in its own file for maintainability.
 */

import type { WalkthroughDefinition } from '../types';
import { aiSessionsButton } from './ai-sessions-button';
import { contextWindowIntro } from './context-window-intro';
import { diffModeIntro } from './diff-mode-intro';
import { fileTreeTools } from './file-tree-tools';
import { layoutControlsIntro } from './layout-controls-intro';
import { modelPickerIntro } from './model-picker-intro';
import { navigationIntro } from './navigation-intro';
import { planModeIntro } from './plan-mode-intro';
import { attachFilesIntro } from './attach-files-intro';
import { sessionQuickOpenIntro } from './session-quick-open-intro';
import { agentWelcomeIntro } from './agent-welcome-intro';
import { gitCommitModeIntro } from './git-commit-mode-intro';
import { filesScopeIntro } from './files-scope-intro';

/**
 * All available walkthroughs.
 * Add new walkthroughs here as they are created.
 */
export const walkthroughs: WalkthroughDefinition[] = [
  navigationIntro,
  aiSessionsButton,
  contextWindowIntro,
  diffModeIntro,
  fileTreeTools,
  layoutControlsIntro,
  modelPickerIntro,
  planModeIntro,
  attachFilesIntro,
  sessionQuickOpenIntro,
  agentWelcomeIntro,
  gitCommitModeIntro,
  filesScopeIntro,
];
