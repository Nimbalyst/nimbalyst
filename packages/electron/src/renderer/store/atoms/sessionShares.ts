/**
 * Session Shares State
 *
 * Tracks which sessions have been shared (have active share links).
 * Used by SessionListItem context menu and AgentSessionHeader to show
 * share state and enable copy/unshare actions.
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';

export interface ShareInfo {
  shareId: string;
  sessionId: string;
  title: string;
  sizeBytes: number;
  createdAt: string;
  expiresAt: string | null;
  viewCount: number;
}

/**
 * Map of sessionId -> ShareInfo for all shared sessions.
 * Populated by fetching from server on app launch (if authenticated).
 */
export const sessionSharesMapAtom = atom<Map<string, ShareInfo>>(new Map());

/**
 * Whether shares have been fetched from server.
 */
export const sharesFetchedAtom = atom(false);

/**
 * Per-session derived atom: returns ShareInfo if shared, null otherwise.
 */
export const sessionShareAtom = atomFamily((sessionId: string) =>
  atom((get) => {
    const sharesMap = get(sessionSharesMapAtom);
    return sharesMap.get(sessionId) ?? null;
  })
);

/**
 * Write atom: fetch shares from server and populate the map.
 */
export const fetchSessionSharesAtom = atom(null, async (get, set) => {
  try {
    const result = await (window as any).electronAPI?.listShares();
    if (result?.success && result.shares) {
      const map = new Map<string, ShareInfo>();
      for (const share of result.shares) {
        map.set(share.sessionId, share);
      }
      set(sessionSharesMapAtom, map);
      set(sharesFetchedAtom, true);
    }
  } catch (error) {
    console.error('[sessionShares] Failed to fetch shares:', error);
  }
});

/**
 * Write atom: add a share to the local cache after successful upload.
 */
export const addSessionShareAtom = atom(null, (get, set, share: ShareInfo) => {
  const current = get(sessionSharesMapAtom);
  const next = new Map(current);
  next.set(share.sessionId, share);
  set(sessionSharesMapAtom, next);
});

/**
 * Write atom: remove a share from the local cache after successful unshare.
 */
export const removeSessionShareAtom = atom(null, (get, set, sessionId: string) => {
  const current = get(sessionSharesMapAtom);
  const next = new Map(current);
  next.delete(sessionId);
  set(sessionSharesMapAtom, next);
});
