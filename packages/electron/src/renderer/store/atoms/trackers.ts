/**
 * Tracker Atoms
 *
 * State for the tracker system (bugs, plans, tasks, etc.) in the bottom panel.
 * Uses tracker type as keys for per-tracker-type state.
 *
 * Key principle: TrackerService WRITES counts and items,
 * TrackerTab components subscribe to their specific type's state.
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';

/**
 * Tracker item types supported by the system.
 */
export type TrackerType = 'bug' | 'plan' | 'task' | 'idea' | 'decision';

/**
 * Status values for tracker items.
 */
export type TrackerStatus =
  | 'open'
  | 'in-progress'
  | 'in-review'
  | 'completed'
  | 'blocked'
  | 'rejected';

/**
 * Tracker item data structure.
 */
export interface TrackerItem {
  id: string;
  type: TrackerType;
  title: string;
  description?: string;
  status: TrackerStatus;
  priority: 'low' | 'medium' | 'high' | 'critical';
  filePath: string; // Path to the markdown file
  createdAt: number;
  updatedAt: number;
  tags: string[];
}

/**
 * Counts by tracker type.
 * TrackerTabs subscribe to show counts in tab badges.
 */
export const trackerCountsAtom = atom<Record<TrackerType, number>>({
  bug: 0,
  plan: 0,
  task: 0,
  idea: 0,
  decision: 0,
});

/**
 * Per-type tracker count.
 * Derived from trackerCountsAtom for efficient per-tab subscriptions.
 */
export const trackerCountAtom = atomFamily((type: TrackerType) =>
  atom((get) => {
    const counts = get(trackerCountsAtom);
    return counts[type] ?? 0;
  })
);

/**
 * Items per tracker type.
 * TrackerList subscribes to its type's items.
 */
export const trackerItemsAtom = atomFamily((_type: TrackerType) =>
  atom<TrackerItem[]>([])
);

/**
 * Currently selected tracker type in bottom panel.
 */
export const activeTrackerTypeAtom = atom<TrackerType | null>(null);

/**
 * Currently selected tracker item ID.
 */
export const selectedTrackerItemAtom = atom<string | null>(null);

/**
 * Filter state per tracker type.
 */
export interface TrackerFilter {
  status?: TrackerStatus[];
  priority?: TrackerItem['priority'][];
  tags?: string[];
  search?: string;
}

export const trackerFilterAtom = atomFamily((_type: TrackerType) =>
  atom<TrackerFilter>({})
);

/**
 * Derived: filtered items for a tracker type.
 */
export const filteredTrackerItemsAtom = atomFamily((type: TrackerType) =>
  atom((get) => {
    const items = get(trackerItemsAtom(type));
    const filter = get(trackerFilterAtom(type));

    let filtered = items;

    if (filter.status && filter.status.length > 0) {
      filtered = filtered.filter((item) => filter.status!.includes(item.status));
    }

    if (filter.priority && filter.priority.length > 0) {
      filtered = filtered.filter((item) =>
        filter.priority!.includes(item.priority)
      );
    }

    if (filter.tags && filter.tags.length > 0) {
      filtered = filtered.filter((item) =>
        filter.tags!.some((tag) => item.tags.includes(tag))
      );
    }

    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.title.toLowerCase().includes(searchLower) ||
          item.description?.toLowerCase().includes(searchLower)
      );
    }

    return filtered;
  })
);

/**
 * Derived: total open items across all tracker types.
 * Useful for global badge.
 */
export const totalOpenItemsAtom = atom((get) => {
  const counts = get(trackerCountsAtom);
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
});

/**
 * Derived: critical/high priority items count.
 * For attention indicator.
 */
export const criticalItemsCountAtom = atom((get) => {
  let count = 0;
  const types: TrackerType[] = ['bug', 'plan', 'task', 'idea', 'decision'];
  for (const type of types) {
    const items = get(trackerItemsAtom(type));
    count += items.filter(
      (item) =>
        (item.priority === 'critical' || item.priority === 'high') &&
        item.status !== 'completed' &&
        item.status !== 'rejected'
    ).length;
  }
  return count;
});

/**
 * Actions for managing tracker state.
 */

/**
 * Update counts for all tracker types.
 * Called by TrackerService after scanning.
 */
export const updateTrackerCountsAtom = atom(
  null,
  (_get, set, counts: Record<TrackerType, number>) => {
    set(trackerCountsAtom, counts);
  }
);

/**
 * Update items for a tracker type.
 */
export const updateTrackerItemsAtom = atom(
  null,
  (
    _get,
    set,
    { type, items }: { type: TrackerType; items: TrackerItem[] }
  ) => {
    set(trackerItemsAtom(type), items);
  }
);

/**
 * Set filter for a tracker type.
 */
export const setTrackerFilterAtom = atom(
  null,
  (
    _get,
    set,
    { type, filter }: { type: TrackerType; filter: TrackerFilter }
  ) => {
    set(trackerFilterAtom(type), filter);
  }
);

/**
 * Clear filter for a tracker type.
 */
export const clearTrackerFilterAtom = atom(
  null,
  (_get, set, type: TrackerType) => {
    set(trackerFilterAtom(type), {});
  }
);
