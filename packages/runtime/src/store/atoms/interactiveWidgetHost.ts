/**
 * Interactive Widget Host Atoms
 *
 * Per-session host for interactive tool widgets (ExitPlanMode, GitCommit, etc.)
 * The host is set by SessionTranscript (which has access to atoms, PostHog, etc.)
 * and read by widgets directly via useAtomValue.
 *
 * This avoids prop drilling through the component tree.
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { store } from '../store';
import type { InteractiveWidgetHost } from '../../ui/AgentTranscript/components/CustomToolWidgets/InteractiveWidgetHost';

/**
 * Per-session interactive widget host.
 * Set by SessionTranscript when mounted, read by widgets.
 */
export const interactiveWidgetHostAtom = atomFamily((_sessionId: string) =>
  atom<InteractiveWidgetHost | null>(null)
);

/**
 * Set the interactive widget host for a session.
 * Called by SessionTranscript when it mounts or when dependencies change.
 */
export function setInteractiveWidgetHost(sessionId: string, host: InteractiveWidgetHost | null): void {
  store.set(interactiveWidgetHostAtom(sessionId), host);
}

/**
 * Get the interactive widget host for a session.
 * Used by widgets that need to call host methods.
 */
export function getInteractiveWidgetHost(sessionId: string): InteractiveWidgetHost | null {
  return store.get(interactiveWidgetHostAtom(sessionId));
}

/**
 * Cleanup atom for a session (call when session is deleted).
 */
export function cleanupInteractiveWidgetHost(sessionId: string): void {
  interactiveWidgetHostAtom.remove(sessionId);
}
