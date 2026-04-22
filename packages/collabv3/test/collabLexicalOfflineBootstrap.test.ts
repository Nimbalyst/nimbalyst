/**
 * Tests that CollabLexicalProvider bootstraps content even when the
 * WebSocket connection fails. This is the exact bug that caused tracker
 * content to vanish: CollaborationPlugin never got a sync(true) event,
 * so it never called initialEditorState to bootstrap from PGLite.
 *
 * This test does NOT use wrangler dev. It intentionally connects to a
 * bogus server URL that fails immediately, proving that the local-first
 * Y.Doc bootstrap works independently of the network.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { DocumentSyncProvider } from '../../runtime/src/sync/DocumentSync';
import { CollabLexicalProvider } from '../../runtime/src/sync/CollabLexicalProvider';
import type { DocumentSyncConfig, DocumentSyncStatus } from '../../runtime/src/sync/documentSyncTypes';
import { generateTestKey } from './helpers';

const providers: DocumentSyncProvider[] = [];

afterEach(() => {
  for (const p of providers) {
    p.destroy();
  }
  providers.length = 0;
});

describe('CollabLexicalProvider offline bootstrap', () => {

  it('should fire sync(true) immediately so CollaborationPlugin can bootstrap', async () => {
    const key = await generateTestKey();

    const syncProvider = new DocumentSyncProvider({
      serverUrl: 'ws://localhost:1', // bogus port -- will fail immediately
      getJwt: async () => 'test-jwt',
      orgId: 'test-org',
      documentKey: key,
      userId: 'user-a',
      documentId: `offline-bootstrap-${Date.now()}`,
      buildUrl: (roomId) => `ws://localhost:1/sync/${roomId}`,
    });
    providers.push(syncProvider);

    const collabProvider = new CollabLexicalProvider(syncProvider);

    // Track sync events
    const syncEvents: boolean[] = [];
    collabProvider.on('sync', (isSynced: boolean) => {
      syncEvents.push(isSynced);
    });

    // Connect -- the WS will fail, but sync(true) should fire immediately
    await collabProvider.connect();

    // Give the microtask a chance to fire
    await new Promise(r => setTimeout(r, 50));

    // sync(true) should have fired even though the WS is failing
    expect(syncEvents).toContain(true);
    expect(syncEvents[0]).toBe(true);
  });

  it('should provide a usable Y.Doc even when WS fails', async () => {
    const key = await generateTestKey();

    const syncProvider = new DocumentSyncProvider({
      serverUrl: 'ws://localhost:1',
      getJwt: async () => 'test-jwt',
      orgId: 'test-org',
      documentKey: key,
      userId: 'user-a',
      documentId: `offline-ydoc-${Date.now()}`,
      buildUrl: (roomId) => `ws://localhost:1/sync/${roomId}`,
    });
    providers.push(syncProvider);

    const collabProvider = new CollabLexicalProvider(syncProvider);
    const ydoc = collabProvider.getYDoc();

    // Register the Y.Doc in a map (same as providerFactory does)
    const yjsDocMap = new Map<string, Y.Doc>();
    yjsDocMap.set('main', ydoc);

    await collabProvider.connect();
    await new Promise(r => setTimeout(r, 50));

    // Simulate what CollaborationPlugin does after sync(true):
    // check if Y.Doc shared type is empty, then bootstrap
    const sharedType = ydoc.get('main', Y.XmlElement);
    expect(sharedType.length).toBe(0); // empty -- bootstrap should fire

    // Simulate bootstrap: insert content into Y.Doc
    const ytext = new Y.XmlText();
    ytext.insert(0, 'Bootstrapped from PGLite');
    sharedType.insert(0, [ytext]);

    // Content should be in the Y.Doc
    expect(sharedType.length).toBe(1);
    expect(sharedType.toJSON()).toContain('Bootstrapped from PGLite');
  });

  it('should never fire sync(false) on WS failure (Y.Doc stays usable)', async () => {
    const key = await generateTestKey();

    let lastStatus: DocumentSyncStatus = 'disconnected';
    const syncProvider = new DocumentSyncProvider({
      serverUrl: 'ws://localhost:1',
      getJwt: async () => 'test-jwt',
      orgId: 'test-org',
      documentKey: key,
      userId: 'user-a',
      documentId: `offline-no-false-${Date.now()}`,
      buildUrl: (roomId) => `ws://localhost:1/sync/${roomId}`,
      onStatusChange: (s) => { lastStatus = s; },
    });
    providers.push(syncProvider);

    const collabProvider = new CollabLexicalProvider(syncProvider);

    const syncEvents: boolean[] = [];
    collabProvider.on('sync', (isSynced: boolean) => {
      syncEvents.push(isSynced);
    });

    await collabProvider.connect();

    // Wait for WS to fail and reconnect attempts to start
    await new Promise(r => setTimeout(r, 2000));

    // sync(true) should have fired, but sync(false) should NOT have
    expect(syncEvents.filter(v => v === true).length).toBeGreaterThanOrEqual(1);
    expect(syncEvents.filter(v => v === false).length).toBe(0);
  });
});
