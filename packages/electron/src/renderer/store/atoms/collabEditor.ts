import { atom } from 'jotai';
import { atomFamily } from '../debug/atomFamilyRegistry';
import type { DocumentSyncStatus } from '@nimbalyst/runtime/sync';

/** Connection status per collab document. */
export const collabConnectionStatusAtom = atomFamily(
  (_uri: string) => atom<DocumentSyncStatus>('disconnected')
);

export interface RemoteUser {
  name: string;
  color: string;
}

/** Remote user awareness per collab document. */
export const collabAwarenessAtom = atomFamily(
  (_uri: string) => atom<Map<string, RemoteUser>>(new Map())
);

export function hasCollabUnsyncedChanges(status: DocumentSyncStatus): boolean {
  return status === 'offline-unsynced' || status === 'replaying';
}

/**
 * Monotonically increasing counter bumped when the org encryption key is rotated.
 * CollaborativeTabEditor watches this to teardown/recreate providers with the new key.
 */
export const collabKeyRotationEpochAtom = atom(0);
