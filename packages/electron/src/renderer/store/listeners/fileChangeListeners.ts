/**
 * Central File Change Listeners
 *
 * Subscribes to per-file IPC events ONCE and dispatches to atom-family
 * entries keyed by file path. Consumers (DocumentModel backing stores,
 * TabEditor instances) read their own entry via store.sub or useAtomValue.
 *
 * Events:
 * - file-changed-on-disk -> fileChangedOnDiskAtomFamily(path)
 * - history:pending-tag-created -> historyPendingTagCreatedAtomFamily(path)
 *
 * Call initFileChangeListeners() once at app startup.
 */

import { store } from '@nimbalyst/runtime/store';
import {
  fileChangedOnDiskAtomFamily,
  historyPendingTagCreatedAtomFamily,
} from '../atoms/fileWatch';

let initialized = false;

export function initFileChangeListeners(): () => void {
  if (initialized) {
    return () => {};
  }
  initialized = true;

  const cleanups: Array<() => void> = [];

  const u1 = window.electronAPI?.on?.('file-changed-on-disk', (data: { path: string }) => {
    if (!data?.path) return;
    console.log('[diff-trace] IPC file-changed-on-disk', { path: data.path, t: performance.now() });
    store.set(fileChangedOnDiskAtomFamily(data.path), (v) => v + 1);
  });
  if (typeof u1 === 'function') cleanups.push(u1);

  const u2 = window.electronAPI?.on?.('history:pending-tag-created', (data: { path: string }) => {
    if (!data?.path) return;
    console.log('[diff-trace] IPC history:pending-tag-created', { path: data.path, t: performance.now() });
    store.set(historyPendingTagCreatedAtomFamily(data.path), (v) => v + 1);
  });
  if (typeof u2 === 'function') cleanups.push(u2);

  return () => {
    initialized = false;
    cleanups.forEach((c) => c());
  };
}
