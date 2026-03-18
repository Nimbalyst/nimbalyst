/**
 * CollaborativeTabEditor
 *
 * A tab editor for collaborative documents backed by DocumentSyncProvider.
 * Much simpler than TabEditor -- no autosave, no file watcher, no history
 * snapshots, no conflict dialog. Content syncs via Y.Doc over WebSocket.
 *
 * State management:
 * - Connection status uses a Jotai atom family (keyed by filePath) so status
 *   changes never re-render the editor or its parent. Only the status bar
 *   subscribes to the atom.
 * - Awareness uses a Jotai atom family so only the avatar component re-renders
 *   when remote users join/leave/move cursors.
 * - Provider readiness uses a ref + one-time state flip (false -> true) that
 *   gates the initial MarkdownEditor mount. After that, no more re-renders.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { MarkdownEditor } from '@nimbalyst/runtime';
import { DocumentSyncProvider } from '@nimbalyst/runtime/sync';
import { CollabLexicalProvider } from '@nimbalyst/runtime/sync';
import type { EditorHost, ExtensionStorage } from '@nimbalyst/runtime';
import type { DocumentSyncStatus } from '@nimbalyst/runtime/sync';
import type { CollabDocumentConfig } from '../../utils/collabDocumentOpener';
import { store, editorDirtyAtom, makeEditorKey } from '@nimbalyst/runtime/store';
import type { Doc } from 'yjs';
import type { Provider } from '@lexical/yjs';
import {
  collabAwarenessAtom,
  collabConnectionStatusAtom,
  hasCollabUnsyncedChanges,
  type RemoteUser,
} from '../../store/atoms/collabEditor';
import { CollabAssetService } from '../../services/CollabAssetService';

interface CollaborativeTabEditorProps {
  /** The collab:// URI for this document */
  filePath: string;
  /** Document title for display */
  fileName: string;
  /** Whether this tab is currently active */
  isActive: boolean;
  /** Collaboration connection config */
  collabConfig: CollabDocumentConfig;
  /** Dirty state callback */
  onDirtyChange?: (isDirty: boolean) => void;
  /** Callback when getContent function is available */
  onGetContentReady?: (getContentFn: () => string) => void;
  /** Callback when manual save function is ready */
  onManualSaveReady?: (saveFn: () => Promise<void>) => void;
}

// Generate a random color for cursor display
function randomCursorColor(): string {
  const colors = [
    '#E05555', '#2BA89A', '#3A8FD6', '#D97706',
    '#9B59B6', '#E06B8F', '#3B82F6', '#16A34A',
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

// ---------------------------------------------------------------------------
// Collaborative user avatars (subscribes to Jotai atom -- isolated re-renders)
// ---------------------------------------------------------------------------

const CollabAvatars: React.FC<{ filePath: string }> = ({ filePath }) => {
  const users = useAtomValue(collabAwarenessAtom(filePath));
  if (users.size === 0) return null;

  return (
    <div className="flex items-center -space-x-1.5">
      {[...users.entries()].map(([userId, user]) => {
        const initials = user.name
          .split(/\s+/)
          .map(w => w[0])
          .join('')
          .toUpperCase()
          .slice(0, 2) || '?';
        return (
          <div
            key={userId}
            className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-medium"
            style={{
              backgroundColor: user.color,
              color: '#fff',
              border: '1.5px solid var(--nim-bg-secondary)',
            }}
            title={user.name}
          >
            {initials}
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Status bar (subscribes to Jotai atom -- isolated re-renders)
// ---------------------------------------------------------------------------

const CollabStatusBar: React.FC<{ filePath: string; fileName: string }> = ({ filePath, fileName }) => {
  const status = useAtomValue(collabConnectionStatusAtom(filePath));

  const statusDot = status === 'connected'
    ? 'bg-green-500'
    : status === 'replaying'
      ? 'bg-blue-500'
      : status === 'offline-unsynced'
        ? 'bg-orange-500'
    : status === 'error'
      ? 'bg-red-500'
    : status === 'connecting' || status === 'syncing'
      ? 'bg-yellow-500'
      : 'bg-gray-500';

  const statusLabel = status === 'connected'
    ? 'Connected'
    : status === 'replaying'
      ? 'Replaying local changes...'
      : status === 'offline-unsynced'
        ? 'Offline - unsynced changes'
    : status === 'error'
      ? 'Decryption failed - encryption key mismatch'
    : status === 'connecting'
      ? 'Connecting...'
      : status === 'syncing'
        ? 'Syncing...'
        : 'Disconnected';

  return (
    <div
      className="flex items-center gap-2 px-3 py-1 text-xs"
      style={{
        borderBottom: '1px solid var(--nim-border)',
        color: 'var(--nim-text-muted)',
        backgroundColor: 'var(--nim-bg-secondary)',
      }}
    >
      <div className={`w-2 h-2 rounded-full ${statusDot}`} />
      <span>{statusLabel}</span>
      <CollabAvatars filePath={filePath} />
      <span className="mx-1">|</span>
      <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>group</span>
      <span>{fileName}</span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const CollaborativeTabEditor: React.FC<CollaborativeTabEditorProps> = ({
  filePath,
  fileName,
  isActive,
  collabConfig,
  onDirtyChange,
  onGetContentReady,
  onManualSaveReady,
}) => {
  const syncProviderRef = useRef<DocumentSyncProvider | null>(null);
  const collabProviderRef = useRef<CollabLexicalProvider | null>(null);
  const isActiveRef = useRef(isActive);
  const cursorColor = useMemo(() => randomCursorColor(), []);
  const assetService = useMemo(() => new CollabAssetService(collabConfig), [collabConfig]);
  // providerReady flips once from false->true. Using a ref + forceUpdate
  // avoids the render loop from useState. We only need one re-render to
  // mount MarkdownEditor, then never again.
  const providerReadyRef = useRef(false);
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  // Create the DocumentSyncProvider and CollabLexicalProvider on mount.
  // IMPORTANT: We do NOT call connect() here. CollaborationPlugin calls
  // provider.connect() itself after registering its onSync listener.
  // If we connect early, the sync event fires before the listener is
  // registered and the bootstrap / initial content seeding is missed.
  useEffect(() => {
    isActiveRef.current = isActive;
    if (window.electronAPI?.setDocumentEdited) {
      const status = syncProviderRef.current?.getStatus() ?? 'disconnected';
      window.electronAPI.setDocumentEdited(
        isActive && hasCollabUnsyncedChanges(status)
      );
    }
  }, [isActive]);

  useEffect(() => {
    console.log('[CollaborativeTabEditor] Creating providers, initialContent:', !!collabConfig.initialContent);

    const syncProvider = new DocumentSyncProvider({
      serverUrl: collabConfig.serverUrl,
      getJwt: collabConfig.getJwt,
      orgId: collabConfig.orgId,
      documentKey: collabConfig.documentKey,
      userId: collabConfig.userId,
      documentId: collabConfig.documentId,
      createWebSocket: collabConfig.createWebSocket,
      onStatusChange: (status) => {
        console.log('[CollaborativeTabEditor] Status change:', status);
        // Write to Jotai atom -- only CollabStatusBar re-renders
        store.set(collabConnectionStatusAtom(filePath), status);
        if (isActiveRef.current && window.electronAPI?.setDocumentEdited) {
          window.electronAPI.setDocumentEdited(hasCollabUnsyncedChanges(status));
        }
        // Forward to CollabLexicalProvider
        collabProviderRef.current?.handleStatusChange(status);
      },
      initialPendingUpdateBase64: collabConfig.pendingUpdateBase64,
      onPendingUpdateChange: async (pendingUpdateBase64) => {
        await window.electronAPI.documentSync.setPendingUpdate(
          collabConfig.workspacePath,
          collabConfig.orgId,
          collabConfig.documentId,
          pendingUpdateBase64,
        );
      },
      onRemoteUpdate: (origin) => {
        // Forward to CollabLexicalProvider
        collabProviderRef.current?.handleRemoteUpdate(origin);
      },
      // Review gate disabled for now -- will be enabled in Phase 4c
      reviewGateEnabled: false,
    });

    // Subscribe to awareness changes and write to Jotai atom
    const awarenessUnsub = syncProvider.onAwarenessChange((states) => {
      const users = new Map<string, RemoteUser>();
      for (const [userId, state] of states) {
        users.set(userId, { name: state.user.name, color: state.user.color });
      }
      store.set(collabAwarenessAtom(filePath), users);
    });

    const collabProvider = new CollabLexicalProvider(syncProvider);

    syncProviderRef.current = syncProvider;
    collabProviderRef.current = collabProvider;

    // One-time flip: mount MarkdownEditor
    if (!providerReadyRef.current) {
      providerReadyRef.current = true;
      forceUpdate();
    }

    return () => {
      awarenessUnsub();
      syncProvider.destroy();
      syncProviderRef.current = null;
      collabProviderRef.current = null;
      if (isActiveRef.current && window.electronAPI?.setDocumentEdited) {
        window.electronAPI.setDocumentEdited(false);
      }
      // Clean up the atoms
      store.set(collabConnectionStatusAtom(filePath), 'disconnected');
      store.set(collabAwarenessAtom(filePath), new Map());
    };
  }, [collabConfig, filePath]);

  // Build the provider factory for CollaborationPlugin
  // This function is called by CollaborationPlugin with a doc ID and yjsDocMap.
  // We return our adapter which already has the Y.Doc from DocumentSyncProvider.
  const providerFactory = useCallback((id: string, yjsDocMap: Map<string, Doc>): Provider => {
    console.log('[CollaborativeTabEditor] providerFactory called, id:', id, 'providerReady:', !!collabProviderRef.current);
    const provider = collabProviderRef.current;
    if (!provider) {
      throw new Error('[CollaborativeTabEditor] CollabLexicalProvider not initialized');
    }

    // Register our Y.Doc in the yjsDocMap so CollaborationPlugin can find it
    const ydoc = provider.getYDoc();
    yjsDocMap.set(id, ydoc);
    console.log('[CollaborativeTabEditor] Y.Doc registered in yjsDocMap');

    return provider;
  }, []);

  // Memoize the collaboration config for MarkdownEditor so that
  // re-renders never cascade through to Lexical/CollaborationPlugin.
  const collaborationMemoConfig = useMemo(() => ({
    providerFactory,
    shouldBootstrap: !!collabConfig.initialContent,
    initialContent: collabConfig.initialContent,
    username: collabConfig.userName || collabConfig.userId,
    cursorColor,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [providerFactory, collabConfig.initialContent, collabConfig.userName, collabConfig.userId, cursorColor]);

  const markdownConfig = useMemo(() => ({
    onUploadAsset: (file: File) => assetService.uploadFile(file),
    resolveImageSrc: (src: string) => assetService.resolveImageSrc(src),
    onOpenAssetLink: (href: string) => assetService.openAssetLink(href),
  }), [assetService]);

  // Create a minimal EditorHost for collaboration mode
  // Most operations are no-ops since content syncs via Y.Doc
  const editorHost = useMemo((): EditorHost => {
    const editorKey = makeEditorKey(filePath);

    // No-op storage for collaborative docs
    const storage: ExtensionStorage = {
      get: () => undefined,
      set: async () => {},
      delete: async () => {},
      getGlobal: () => undefined,
      setGlobal: async () => {},
      deleteGlobal: async () => {},
      getSecret: async () => undefined,
      setSecret: async () => {},
      deleteSecret: async () => {},
    };

    return {
      filePath,
      fileName,
      get theme() { return 'auto'; },
      get isActive() { return isActive; },
      workspaceId: undefined,

      onThemeChanged: () => () => {},

      // Content loading: return initial content if seeding, otherwise empty.
      // CollaborationPlugin hydrates from Y.Doc when shouldBootstrap is false.
      async loadContent(): Promise<string> {
        return collabConfig.initialContent || '';
      },

      async loadBinaryContent(): Promise<ArrayBuffer> {
        return new ArrayBuffer(0);
      },

      // File change: no-op. Changes come through Y.Doc.
      onFileChanged(): () => void {
        return () => {};
      },

      // Dirty state: write to Jotai atom
      setDirty(isDirty: boolean): void {
        store.set(editorDirtyAtom(editorKey), isDirty);
        onDirtyChange?.(isDirty);
      },

      // Save: no-op. Content syncs via Y.Doc.
      async saveContent(): Promise<void> {
        // No disk saves for collaborative documents
      },

      // Save request: no-op subscription
      onSaveRequested(): () => void {
        return () => {};
      },

      openHistory(): void {
        // History not yet supported for collaborative documents
      },

      storage,

      registerMenuItems(): void {},
    };
  }, [filePath, fileName, isActive, onDirtyChange]);

  // Expose a no-op manual save function
  useEffect(() => {
    if (onManualSaveReady) {
      onManualSaveReady(async () => {
        // No-op for collaborative documents -- content syncs via Y.Doc
      });
    }
  }, [onManualSaveReady]);

  useEffect(() => {
    return () => {
      assetService.dispose();
    };
  }, [assetService]);

  return (
    <div className="collaborative-tab-editor" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Connection status bar -- subscribes to Jotai atom, isolated re-renders */}
      <CollabStatusBar filePath={filePath} fileName={fileName} />

      {/* Editor area */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {providerReadyRef.current ? (
          <MarkdownEditor
            host={editorHost}
            config={markdownConfig}
            onGetContent={onGetContentReady}
            collaborationConfig={collaborationMemoConfig}
          />
        ) : (
          <div className="flex items-center justify-center h-full" style={{ color: 'var(--nim-text-muted)' }}>
            Connecting to document...
          </div>
        )}
      </div>
    </div>
  );
};
