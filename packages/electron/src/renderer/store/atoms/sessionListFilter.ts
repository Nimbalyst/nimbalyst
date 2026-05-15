/**
 * Session List Filter Atoms
 *
 * Renderer-only filter state for the sessions list panel. Mirrors the tag
 * picker behavior the kanban view already provides (see sessionKanban.ts), but
 * scoped to the list and without phase/showComplete since the list has its
 * own time grouping and archive toggle.
 *
 * Session-only state -- clears on reload, like the kanban filter.
 */

import { atom } from 'jotai';

export interface SessionListFilter {
  tags: string[];
}

export const sessionListTagFilterAtom = atom<SessionListFilter>({ tags: [] });
