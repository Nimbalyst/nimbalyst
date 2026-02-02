/**
 * SessionTranscript Atoms
 *
 * Centralized state for SessionTranscript component.
 * These atoms are updated by sessionTranscriptListeners.ts in response to IPC events.
 * SessionTranscript reads from these atoms instead of subscribing to IPC directly.
 *
 * This follows the centralized IPC listener architecture pattern to avoid:
 * - Race conditions when switching sessions
 * - Stale closures capturing old component state
 * - MaxListenersExceededWarning from multiple component subscriptions
 * - State loss on component unmount
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { ExitPlanModeConfirmationData } from '../../components/UnifiedAI/ExitPlanModeConfirmation';

/**
 * Per-session error state.
 * Set when ai:error event fires for this session.
 */
export const sessionErrorAtom = atomFamily((_sessionId: string) =>
  atom<{ message: string; isBedrockToolError?: boolean } | null>(null)
);

/**
 * @deprecated Use sessionPendingExitPlanModeAtom from sessions.ts instead.
 * This atom is no longer used - ExitPlanMode is now DB-backed.
 */
export const sessionExitPlanModeConfirmAtom = atomFamily((_sessionId: string) =>
  atom<any | null>(null)
);

/**
 * Per-session queued prompts.
 * Updated when ai:queuedPromptsReceived event fires.
 * Array of queued prompts waiting to be processed.
 */
export interface QueuedPrompt {
  id: string;
  prompt: string;
  timestamp: number;
  documentContext?: any;
  attachments?: any[];
}

export const sessionQueuedPromptsAtom = atomFamily((_sessionId: string) =>
  atom<QueuedPrompt[]>([])
);
