/**
 * Tracker Data Atoms
 *
 * Cross-platform Jotai atoms that hold tracker item data.
 * Platform host adapters (Electron IPC listener, mobile adapter)
 * populate these atoms. TrackerTable reads from them reactively.
 *
 * This replaces the (window as any).documentService polling pattern
 * with reactive atom-based data flow that works on any platform.
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { TrackerItem, TrackerItemType } from '../../core/DocumentService';

// ============================================================
// Primary Data Store
// ============================================================

/**
 * All tracker items keyed by ID.
 * This is the single source of truth for tracker item data.
 * Host adapters populate this atom; UI components read from it.
 */
export const trackerItemsMapAtom = atom<Map<string, TrackerItem>>(new Map());

/**
 * Whether the initial data load has completed.
 * Used by TrackerTable to show loading state on first mount.
 */
export const trackerDataLoadedAtom = atom(false);

// ============================================================
// Derived Read Atoms
// ============================================================

/**
 * All tracker items as a flat array.
 */
export const trackerItemsArrayAtom = atom((get) => {
  return Array.from(get(trackerItemsMapAtom).values());
});

/**
 * Tracker items filtered by type (excludes archived).
 * Returns all non-archived items when type is 'all'.
 */
export const trackerItemsByTypeAtom = atomFamily((type: TrackerItemType | 'all') =>
  atom((get) => {
    const map = get(trackerItemsMapAtom);
    const all = Array.from(map.values());
    const active = all.filter(item => !item.archived);
    if (type === 'all') return active;
    return active.filter(item => item.type === type);
  })
);

/**
 * Archived tracker items, optionally filtered by type.
 */
export const archivedTrackerItemsAtom = atomFamily((type: TrackerItemType | 'all') =>
  atom((get) => {
    const map = get(trackerItemsMapAtom);
    const all = Array.from(map.values());
    const archived = all.filter(item => item.archived);
    if (type === 'all') return archived;
    return archived.filter(item => item.type === type);
  })
);

/**
 * A single tracker item by ID.
 * Only notifies subscribers when that specific item changes, not when
 * other items in the map change. Use this in detail/edit components
 * so they don't re-render on unrelated item updates.
 */
export const trackerItemByIdAtom = atomFamily((id: string) =>
  atom((get) => get(trackerItemsMapAtom).get(id) ?? null)
);

/**
 * Count of non-archived items per type.
 */
export const trackerItemCountByTypeAtom = atomFamily((type: TrackerItemType) =>
  atom((get) => {
    return get(trackerItemsByTypeAtom(type)).length;
  })
);

// ============================================================
// Write Atoms (for host adapters)
// ============================================================

/**
 * Upsert a single tracker item.
 * If the item already exists (by ID), it is replaced.
 */
export const upsertTrackerItemAtom = atom(null, (get, set, item: TrackerItem) => {
  const map = new Map(get(trackerItemsMapAtom));
  map.set(item.id, item);
  set(trackerItemsMapAtom, map);
});

/**
 * Remove a single tracker item by ID.
 */
export const removeTrackerItemAtom = atom(null, (get, set, id: string) => {
  const map = new Map(get(trackerItemsMapAtom));
  if (map.delete(id)) {
    set(trackerItemsMapAtom, map);
  }
});

/**
 * Replace all tracker items at once (bulk load).
 * Used for initial load and full refresh.
 */
export const replaceAllTrackerItemsAtom = atom(null, (_get, set, items: TrackerItem[]) => {
  const map = new Map<string, TrackerItem>();
  for (const item of items) {
    map.set(item.id, item);
  }
  set(trackerItemsMapAtom, map);
  set(trackerDataLoadedAtom, true);
});
