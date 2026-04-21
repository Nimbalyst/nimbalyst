/**
 * useTrackerContentCollab
 *
 * Hook that provides collaboration config for a team-synced tracker item's
 * content editor. For local-only items, returns null (use PGLite path).
 *
 * For team-synced items, resolves a CollabDocumentConfig for a DocumentRoom
 * keyed by `tracker-content:{itemId}`, creates a DocumentSyncProvider +
 * CollabLexicalProvider, and returns the collaboration config needed by
 * StravuEditor's CollaborationPlugin.
 *
 * The hook handles:
 * - Resolving encryption keys and JWT from the main process
 * - Creating and managing provider lifecycle (connect on mount, disconnect on unmount)
 * - Setting 90-day TTL on the DocumentRoom
 * - Seeding empty rooms from PGLite content via shouldBootstrap + initialEditorState
 * - Debounced local PGLite persistence from Y.Doc updates
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DocumentSyncProvider, CollabLexicalProvider } from '@nimbalyst/runtime/sync';
import type { DocumentSyncStatus, ReviewGateState } from '@nimbalyst/runtime/sync';
import type { Doc } from 'yjs';
import type { Provider } from '@lexical/yjs';
import { resolveCollabConfigForUri, type CollabDocumentConfig } from '../utils/collabDocumentOpener';

const TRACKER_CONTENT_TTL_MS = String(90 * 24 * 60 * 60 * 1000);
const CONTENT_SIZE_LIMIT = 1_000_000; // 1MB

interface UseTrackerContentCollabOptions {
  itemId: string;
  workspacePath?: string;
  syncMode: string;
  pgliteContent: string | null;
  /** Number of team members -- enables review gate when > 1 */
  teamMemberCount: number;
}

interface TrackerContentCollabResult {
  collaboration: {
    providerFactory: (id: string, yjsDocMap: Map<string, Doc>) => Provider;
    shouldBootstrap: boolean;
    initialEditorState?: string;
    username?: string;
    cursorColor?: string;
  } | null;
  loading: boolean;
  status: DocumentSyncStatus;
  syncProvider: DocumentSyncProvider | null;
  /** Review gate state -- null when review gate is disabled or not connected */
  reviewState: ReviewGateState | null;
  /** Accept all pending remote changes */
  acceptRemoteChanges: () => void;
  /** Reject all pending remote changes */
  rejectRemoteChanges: () => void;
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
  pgliteContent,
  teamMemberCount,
}: UseTrackerContentCollabOptions): TrackerContentCollabResult {
  const isTeamSynced = syncMode !== 'local';
  const isMultiUser = teamMemberCount > 1;
  const [collabConfig, setCollabConfig] = useState<CollabDocumentConfig | null>(null);
  const [loading, setLoading] = useState(isTeamSynced);
  const [status, setStatus] = useState<DocumentSyncStatus>('disconnected');
  const [reviewState, setReviewState] = useState<ReviewGateState | null>(null);
  const syncProviderRef = useRef<DocumentSyncProvider | null>(null);
  const collabProviderRef = useRef<CollabLexicalProvider | null>(null);
  const contentPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorColor = useMemo(() => randomCursorColor(), []);

  // Resolve collab config from main process when item is team-synced
  useEffect(() => {
    if (!isTeamSynced || !workspacePath) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const documentId = `tracker-content:${itemId}`;
    const uri = `collab://tracker-content:${itemId}`;

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

  // Create providers when config is available
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

        // Set 90-day TTL on first successful connection
        if (newStatus === 'connected') {
          syncProvider.setRoomMetadata({ ttl_ms: TRACKER_CONTENT_TTL_MS });
        }
      },
      onRemoteUpdate: (origin) => {
        collabProviderRef.current?.handleRemoteUpdate(origin);

        // Debounced local PGLite persistence from Y.Doc changes
        // When review gate is active, only persist after acceptance
        if (!isMultiUser) {
          if (contentPersistTimerRef.current) clearTimeout(contentPersistTimerRef.current);
          contentPersistTimerRef.current = setTimeout(() => {
            persistYDocToPGLite(syncProvider, itemId);
          }, 2000);
        }
      },
      reviewGateEnabled: isMultiUser,
      onReviewStateChange: (state) => {
        setReviewState(state);
      },
    });

    const collabProvider = new CollabLexicalProvider(syncProvider);

    syncProviderRef.current = syncProvider;
    collabProviderRef.current = collabProvider;

    return () => {
      if (contentPersistTimerRef.current) {
        clearTimeout(contentPersistTimerRef.current);
        persistYDocToPGLite(syncProvider, itemId);
      }
      syncProvider.destroy();
      syncProviderRef.current = null;
      collabProviderRef.current = null;
      setStatus('disconnected');
    };
  }, [collabConfig, itemId]);

  const acceptRemoteChanges = useCallback(() => {
    const provider = syncProviderRef.current;
    if (!provider) return;
    provider.acceptRemoteChanges();
    // Persist to PGLite after accepting
    persistYDocToPGLite(provider, itemId);
  }, [itemId]);

  const rejectRemoteChanges = useCallback(() => {
    syncProviderRef.current?.rejectRemoteChanges();
  }, []);

  // Build the collaboration config for StravuEditor
  const collaboration = useMemo(() => {
    if (!collabProviderRef.current || !collabConfig) return null;

    const provider = collabProviderRef.current;

    return {
      providerFactory: (id: string, yjsDocMap: Map<string, Doc>): Provider => {
        yjsDocMap.set(id, provider.getYDoc());
        return provider;
      },
      shouldBootstrap: true,
      initialEditorState: pgliteContent || undefined,
      username: collabConfig.userName || collabConfig.userEmail || 'Anonymous',
      cursorColor,
    };
  }, [collabConfig, pgliteContent, cursorColor]);

  if (!isTeamSynced) {
    return {
      collaboration: null, loading: false, status: 'disconnected',
      syncProvider: null, reviewState: null,
      acceptRemoteChanges: () => {}, rejectRemoteChanges: () => {},
    };
  }

  return {
    collaboration, loading, status, syncProvider: syncProviderRef.current,
    reviewState, acceptRemoteChanges, rejectRemoteChanges,
  };
}

/**
 * Serialize Y.Doc content to markdown and persist to PGLite.
 * This keeps local storage in sync for offline access and room rehydration.
 */
async function persistYDocToPGLite(
  syncProvider: DocumentSyncProvider,
  itemId: string,
): Promise<void> {
  try {
    const ydoc = syncProvider.getYDoc();
    const ytext = ydoc.getText('root');
    const markdown = ytext.toJSON();

    if (markdown.length > CONTENT_SIZE_LIMIT) {
      console.warn('[useTrackerContentCollab] Content exceeds 1MB limit, skipping PGLite persist');
      return;
    }

    await window.electronAPI.documentService.updateTrackerItemContent({
      itemId,
      content: markdown,
    });
  } catch (err) {
    console.error('[useTrackerContentCollab] Failed to persist Y.Doc to PGLite:', err);
  }
}
