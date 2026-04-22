/**
 * useTrackerContentCollab
 *
 * Hook that provides collaboration config for a team-synced tracker item's
 * content editor. For local-only items, returns null (use PGLite path).
 *
 * For team-synced items, resolves a CollabDocumentConfig for a DocumentRoom
 * keyed by `tracker-content/{itemId}`, creates a DocumentSyncProvider +
 * CollabLexicalProvider, and returns the collaboration config needed by
 * StravuEditor's CollaborationPlugin.
 *
 * PGLite persistence is handled by TrackerItemDetail via onGetContent/onDirtyChange
 * on the editor config. Bootstrap from PGLite markdown is handled by
 * TrackerItemDetail's collabEditorConfig via `initialEditorState`.
 *
 * Key design choice: the hook does NOT call `syncProvider.connect()` itself
 * -- CollaborationPlugin drives the connect via `providerFactory`. This is
 * important because Lexical's binding only observes FUTURE Y.Doc updates;
 * if the Y.Doc were populated before the binding is created, existing
 * server content would never render.
 *
 * `shouldBootstrap` is always true; Lexical's internal `_xmlText._length === 0`
 * check is the actual gate (bootstrap only fires when the shared text is
 * empty). Combined with `deferInitialSync: true` on CollabLexicalProvider,
 * this ensures the bootstrap decision happens AFTER the server's sync
 * response is applied, so we never CRDT-merge stale PGLite content into a
 * room that already has authoritative content from another collaborator.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DocumentSyncProvider, CollabLexicalProvider } from '@nimbalyst/runtime/sync';
import type { DocumentSyncStatus, ReviewGateState } from '@nimbalyst/runtime/sync';
import type { Doc } from 'yjs';
import type { Provider } from '@lexical/yjs';
import { resolveCollabConfigForUri, type CollabDocumentConfig } from '../utils/collabDocumentOpener';

const TRACKER_CONTENT_TTL_MS = String(90 * 24 * 60 * 60 * 1000);

interface UseTrackerContentCollabOptions {
  itemId: string;
  workspacePath?: string;
  syncMode: string;
  /** Number of team members -- enables review gate when > 1 */
  teamMemberCount: number;
}

interface TrackerContentCollabResult {
  collaboration: {
    providerFactory: (id: string, yjsDocMap: Map<string, Doc>) => Provider;
    shouldBootstrap: boolean;
    username?: string;
    cursorColor?: string;
  } | null;
  loading: boolean;
  status: DocumentSyncStatus;
  syncProvider: DocumentSyncProvider | null;
  reviewState: ReviewGateState | null;
  acceptRemoteChanges: () => void;
  rejectRemoteChanges: () => void;
  /**
   * Increments every time a new CollabLexicalProvider is created. Callers
   * should include this in the React key of the editor tree that hosts
   * `<CollaborationPlugin>`, so a stale plugin (with its `isProviderInitialized`
   * ref still `true` from a previous provider) is fully unmounted and the new
   * provider's sync listener actually gets registered.
   */
  providerEpoch: number;
}

function randomCursorColor(): string {
  const colors = [
    '#E05555', '#2BA89A', '#3A8FD6', '#D97706',
    '#9B59B6', '#E06B8F', '#3B82F6', '#16A34A',
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

export function useTrackerContentCollab({
  itemId,
  workspacePath,
  syncMode,
  teamMemberCount,
}: UseTrackerContentCollabOptions): TrackerContentCollabResult {
  const isTeamSynced = syncMode !== 'local';
  const isMultiUser = teamMemberCount > 1;
  const [collabConfig, setCollabConfig] = useState<CollabDocumentConfig | null>(null);
  const [loading, setLoading] = useState(isTeamSynced);
  const [status, setStatus] = useState<DocumentSyncStatus>('disconnected');
  const [reviewState, setReviewState] = useState<ReviewGateState | null>(null);
  const [providerEpoch, setProviderEpoch] = useState(0);
  const syncProviderRef = useRef<DocumentSyncProvider | null>(null);
  const collabProviderRef = useRef<CollabLexicalProvider | null>(null);
  const cursorColor = useMemo(() => randomCursorColor(), []);

  // Resolve collab config from main process when item is team-synced
  useEffect(() => {
    if (!isTeamSynced || !workspacePath) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const documentId = `tracker-content/${itemId}`;
    const uri = `collab://tracker-content/${itemId}`;

    resolveCollabConfigForUri(workspacePath, uri, documentId, `Tracker ${itemId}`)
      .then((config) => {
        if (cancelled) return;
        if (config) {
          setCollabConfig(config);
        } else {
          console.warn('[useTrackerContentCollab] Failed to resolve collab config for:', itemId);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[useTrackerContentCollab] Error resolving config:', err);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [itemId, workspacePath, isTeamSynced]);

  // Create providers when config is available. Note: we do NOT call
  // `syncProvider.connect()` here. CollaborationPlugin drives the connect
  // via `providerFactory`, which ensures the Lexical binding is created
  // while the Y.Doc is still empty -- otherwise Lexical's observer would
  // miss the initial server content (it only reports FUTURE updates).
  useEffect(() => {
    if (!collabConfig) return;

    const syncProvider = new DocumentSyncProvider({
      serverUrl: collabConfig.serverUrl,
      getJwt: collabConfig.getJwt,
      orgId: collabConfig.orgId,
      documentKey: collabConfig.documentKey,
      orgKeyFingerprint: collabConfig.orgKeyFingerprint,
      userId: collabConfig.userId,
      documentId: collabConfig.documentId,
      createWebSocket: collabConfig.createWebSocket,
      onStatusChange: (newStatus) => {
        setStatus(newStatus);
        collabProviderRef.current?.handleStatusChange(newStatus);

        if (newStatus === 'connected') {
          syncProvider.setRoomMetadata({ ttl_ms: TRACKER_CONTENT_TTL_MS });
        }
      },
      onRemoteUpdate: (origin) => {
        collabProviderRef.current?.handleRemoteUpdate(origin);
      },
      reviewGateEnabled: isMultiUser,
      onReviewStateChange: (state) => {
        setReviewState(state);
      },
    });

    // `deferInitialSync` suppresses the immediate `sync(true)` that
    // CollabLexicalProvider normally fires on listener registration.
    // Instead, sync(true) fires only when the DocumentSyncProvider reaches
    // 'connected' status (i.e., after the server's initial sync response
    // has been applied). By that time Lexical's Y.Doc observer has
    // already rendered any existing server content, so the bootstrap
    // check (`_xmlText._length === 0`) correctly skips bootstrap on a
    // non-empty room instead of CRDT-merging stale PGLite content.
    const collabProvider = new CollabLexicalProvider(syncProvider, {
      deferInitialSync: true,
    });

    syncProviderRef.current = syncProvider;
    collabProviderRef.current = collabProvider;
    // Bump the epoch so the editor host can force-remount CollaborationPlugin.
    // CollaborationPlugin guards its one-time provider initialization with an
    // `isProviderInitialized` ref, so a stale plugin instance held across HMR
    // or React reconciliation would otherwise keep using the destroyed
    // provider and never register its sync listener on the new one.
    setProviderEpoch((e) => e + 1);

    return () => {
      syncProvider.destroy();
      syncProviderRef.current = null;
      collabProviderRef.current = null;
      setStatus('disconnected');
    };
  }, [collabConfig, itemId, isMultiUser]);

  const acceptRemoteChanges = useCallback(() => {
    syncProviderRef.current?.acceptRemoteChanges();
  }, []);

  const rejectRemoteChanges = useCallback(() => {
    syncProviderRef.current?.rejectRemoteChanges();
  }, []);

  const collaboration = useMemo(() => {
    if (!collabProviderRef.current || !collabConfig || providerEpoch === 0) return null;

    const provider = collabProviderRef.current;

    return {
      providerFactory: (id: string, yjsDocMap: Map<string, Doc>): Provider => {
        yjsDocMap.set(id, provider.getYDoc());
        return provider;
      },
      // Always true: Lexical's internal `_xmlText._length === 0` check is
      // the real gate. Because `deferInitialSync` delays sync(true) until
      // the server response is applied, bootstrap will only run when the
      // shared text is still empty at that point (a new room). Non-empty
      // rooms skip bootstrap and render the server state.
      shouldBootstrap: true,
      username: collabConfig.userName || collabConfig.userEmail || 'Anonymous',
      cursorColor,
    };
  }, [collabConfig, cursorColor, providerEpoch]);

  if (!isTeamSynced) {
    return {
      collaboration: null, loading: false, status: 'disconnected',
      syncProvider: null, reviewState: null,
      acceptRemoteChanges: () => {}, rejectRemoteChanges: () => {},
      providerEpoch: 0,
    };
  }

  return {
    collaboration,
    loading,
    status,
    syncProvider: syncProviderRef.current,
    reviewState,
    acceptRemoteChanges,
    rejectRemoteChanges,
    providerEpoch,
  };
}
