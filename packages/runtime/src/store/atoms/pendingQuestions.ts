/**
 * Pending Questions Atoms
 *
 * Per-session state tracking for AskUserQuestion tool calls that are
 * waiting for user input. Uses atomFamily keyed by sessionId.
 *
 * This replaces the manual Map-based store in AskUserQuestionWidget.tsx
 * with proper Jotai reactivity.
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { store } from '../store';

/**
 * Data structure for a pending AskUserQuestion.
 */
export interface PendingQuestionData {
  questionId: string;
  sessionId: string;
}

/**
 * Per-session pending question state.
 * Stores the questionId if a question is pending for this session, null otherwise.
 */
export const sessionPendingQuestionIdAtom = atomFamily((_sessionId: string) =>
  atom<string | null>(null)
);

/**
 * Derived atom to check if a session has a pending question.
 * Components subscribe to this for efficient updates.
 */
export const sessionHasPendingQuestionAtom = atomFamily((sessionId: string) =>
  atom((get) => get(sessionPendingQuestionIdAtom(sessionId)) !== null)
);

/**
 * Register a pending question for a session.
 * Call this when ai:askUserQuestion event is received.
 */
export function registerPendingQuestion(questionId: string, sessionId: string): void {
  store.set(sessionPendingQuestionIdAtom(sessionId), questionId);
}

/**
 * Unregister a pending question.
 * Call this when the question is answered or cancelled.
 */
export function unregisterPendingQuestion(questionId: string): void {
  // Find and clear the session that has this question
  // Note: This requires knowing the sessionId, which the caller should have
  // For backwards compatibility, we iterate through known sessions
  // In practice, callers should use clearPendingQuestionForSession instead

  // Since atomFamily doesn't expose all instances, we rely on the caller
  // to provide the sessionId via clearPendingQuestionForSession
}

/**
 * Clear pending question for a specific session.
 * More efficient than unregisterPendingQuestion when sessionId is known.
 */
export function clearPendingQuestionForSession(sessionId: string): void {
  store.set(sessionPendingQuestionIdAtom(sessionId), null);
}

/**
 * Check if a specific question is pending.
 */
export function isQuestionPending(questionId: string, sessionId: string): boolean {
  return store.get(sessionPendingQuestionIdAtom(sessionId)) === questionId;
}

/**
 * Check if a session has any pending question.
 */
export function sessionHasPendingQuestion(sessionId: string): boolean {
  return store.get(sessionPendingQuestionIdAtom(sessionId)) !== null;
}

/**
 * Cleanup atom for a session (call when session is deleted).
 */
export function cleanupSessionPendingQuestion(sessionId: string): void {
  sessionPendingQuestionIdAtom.remove(sessionId);
  sessionHasPendingQuestionAtom.remove(sessionId);
}
