/**
 * Session Mention Atoms
 *
 * Provides Jotai-based state management for @@ session mentions in AIInput.
 * Filters the in-memory session registry by title -- no IPC needed.
 *
 * Pattern follows fileMention.ts:
 * - sessionMentionOptionsAtom: workspace-scoped TypeaheadOption[]
 * - searchSessionMentionAtom: write-only atom that filters sessionRegistryAtom
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { TypeaheadOption } from '../../components/Typeahead/GenericTypeahead';
import { sessionRegistryAtom } from './sessions';

// ============================================================
// Base Atoms
// ============================================================

/**
 * Search results for session mentions, stored as TypeaheadOption[] ready for display.
 */
export const sessionMentionOptionsAtom = atomFamily((_workspacePath: string) =>
  atom<TypeaheadOption[]>([])
);

// ============================================================
// Helpers
// ============================================================

/**
 * Format a relative time string from a timestamp.
 */
function relativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return `${Math.floor(diffDay / 30)}mo ago`;
}

/**
 * Chat bubble icon as a React element for session typeahead options.
 */
function chatBubbleIcon(): string {
  // Using a simple SVG string that GenericTypeahead can render
  // GenericTypeahead supports string icons (rendered as text) and ReactElement icons
  return '\u{1F4AC}';
}

// ============================================================
// Action Atoms
// ============================================================

/**
 * Search for sessions matching a query by filtering the in-memory session registry.
 * Results are stored directly in sessionMentionOptionsAtom.
 */
export const searchSessionMentionAtom = atom(
  null,
  (get, set, { workspacePath, query, excludeSessionId }: {
    workspacePath: string;
    query: string;
    excludeSessionId?: string;
  }) => {
    const registry = get(sessionRegistryAtom);
    const lowerQuery = query.toLowerCase().trim();

    // Filter sessions: regular sessions only, exclude current
    let sessions = Array.from(registry.values()).filter(s => {
      if (s.sessionType !== 'session') return false;
      if (excludeSessionId && s.id === excludeSessionId) return false;
      if (!lowerQuery) return true;
      return (s.title || '').toLowerCase().includes(lowerQuery);
    });

    // Sort by most recently updated
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);

    // Limit to 10 results
    sessions = sessions.slice(0, 10);

    const options: TypeaheadOption[] = sessions.map(s => {
      const phaseTag = s.phase ? ` [${s.phase}]` : '';
      return {
        id: s.id,
        label: s.title || 'Untitled',
        description: `${relativeTime(s.updatedAt)}${phaseTag}`,
        icon: chatBubbleIcon(),
        data: {
          id: s.id,
          title: s.title || 'Untitled',
          shortId: s.id.substring(0, 5),
        },
      };
    });

    set(sessionMentionOptionsAtom(workspacePath), options);
  }
);
