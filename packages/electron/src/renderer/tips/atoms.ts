/**
 * Jotai atoms for the Contextual Tips System
 *
 * Tips share persistence with the walkthrough system (walkthroughStateAtom),
 * but have their own transient atoms for session-level state.
 */

import { atom } from 'jotai';

/**
 * ID of the currently active (visible) tip.
 * null means no tip is showing.
 */
export const activeTipIdAtom = atom<string | null>(null);

/**
 * Whether a tip has already been shown this session.
 * NOT persisted -- resets on every app restart.
 * Enforces the "one tip per app launch" cooldown.
 */
export const tipShownThisSessionAtom = atom(false);

/**
 * Command atom for requesting a new worktree session from a tip action.
 * AgentMode watches this and performs the actual worktree creation.
 */
export const tipCreateWorktreeSessionRequestAtom = atom<number>(0);
