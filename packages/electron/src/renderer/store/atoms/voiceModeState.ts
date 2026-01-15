/**
 * Voice mode state atoms
 */

import { atom } from 'jotai';

/**
 * Represents a pending voice command awaiting submission.
 */
export interface PendingVoiceCommand {
  /** Unique ID for this pending command */
  id: string;
  /** The command text (can be edited) */
  prompt: string;
  /** Target AI session ID */
  sessionId: string;
  /** Timestamp when the command was created */
  createdAt: number;
  /** Configured delay in milliseconds */
  delayMs: number;
  /** Workspace path for the command */
  workspacePath: string;
  /** Custom coding agent prompt settings */
  codingAgentPrompt?: {
    prepend?: string;
    append?: string;
  };
}

/**
 * Atom storing the current pending voice command.
 * Null when no voice command is pending.
 */
export const pendingVoiceCommandAtom = atom<PendingVoiceCommand | null>(null);
