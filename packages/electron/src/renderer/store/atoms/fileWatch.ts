/**
 * File Watch Atoms
 *
 * Per-file-path counter atoms incremented when the main process emits
 * file-watcher events. Consumers (DocumentModel backing stores, TabEditor)
 * subscribe to the family entry for their file path.
 *
 * Updated by store/listeners/fileChangeListeners.ts.
 */

import { atom } from 'jotai';
import { atomFamily } from '../debug/atomFamilyRegistry';

export const fileChangedOnDiskAtomFamily = atomFamily((_filePath: string) =>
  atom(0)
);

export const historyPendingTagCreatedAtomFamily = atomFamily((_filePath: string) =>
  atom(0)
);
