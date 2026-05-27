/**
 * Tip definitions registry
 *
 * All tip definitions are exported here as a single array.
 * Add new tip imports and include them in the array below.
 */

import type { TipDefinition } from '../types';
import { keyboardShortcutsTip } from './keyboard-shortcuts';
import { mobileKeepAwakeTip } from './mobile-keep-awake';
import { themeExploreTip } from './theme-explore';
import { trackerModeTip } from './tracker-mode';
import { worktreeSessionTip } from './worktree-session';

export const tips: TipDefinition[] = [
  mobileKeepAwakeTip,
  worktreeSessionTip,
  trackerModeTip,
  keyboardShortcutsTip,
  themeExploreTip,
];
