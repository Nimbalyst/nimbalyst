/**
 * Integration tests for TrackerSyncProvider (client-side).
 *
 * Tests the full flow: TrackerSyncProvider -> encrypted WebSocket -> TrackerRoom DO.
 * Verifies encryption, decryption, sync, broadcast, and field-level LWW merge.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { webcrypto } from 'crypto';
import { TrackerSyncProvider, mergeTrackerItems } from '../../runtime/src/sync/TrackerSync';
import type { TrackerItemPayload, TrackerSyncStatus } from '../../runtime/src/sync/trackerSyncTypes';

const PORT = 8791;
const ORG_ID = 'test-org';

function buildTestUrl(port: number, userId: string, orgId: string) {
  return (roomId: string) =>
    `ws://localhost:${port}/sync/${roomId}?test_user_id=${userId}&test_org_id=${orgId}`;
}

async function generateTestKey(): Promise<CryptoKey> {
  return webcrypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  ) as Promise<CryptoKey>;
}

function makePayload(overrides: Partial<TrackerItemPayload> & { itemId: string }): TrackerItemPayload {
  return {
    type: 'bug',
    title: 'Test bug',
    status: 'open',
    priority: 'high',
    labels: [],
    linkedSessions: [],
    comments: [],
    customFields: {},
    fieldUpdatedAt: {},
    ...overrides,
  };
}

// Track providers for cleanup
const providers: TrackerSyncProvider[] = [];

async function createProvider(
  projectId: string,
  userId: string,
  encryptionKey: CryptoKey,
  callbacks?: {
    onItemUpserted?: (item: TrackerItemPayload) => void;
    onItemDeleted?: (itemId: string) => void;
    onStatusChange?: (status: TrackerSyncStatus) => void;
  }
): Promise<TrackerSyncProvider> {
  const provider = new TrackerSyncProvider({
    serverUrl: `ws://localhost:${PORT}`,
    getJwt: async () => 'test-jwt',
    orgId: ORG_ID,
    encryptionKey,
    userId,
    projectId,
    buildUrl: buildTestUrl(PORT, userId, ORG_ID),
    ...callbacks,
  });
  providers.push(provider);
  return provider;
}

function waitForStatus(
  statuses: TrackerSyncStatus[],
  onChange: (cb: (status: TrackerSyncStatus) => void) => void,
  timeout = 10000
): Promise<TrackerSyncStatus> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for status ${statuses.join('|')}`)), timeout);
    onChange((status) => {
      if (statuses.includes(status)) {
        clearTimeout(timer);
        resolve(status);
      }
    });
  });
}

describe('TrackerSyncProvider integration', () => {

  afterEach(async () => {
    for (const p of providers) {
      p.destroy();
    }
    providers.length = 0;
    // Brief pause for WebSocket cleanup
    await new Promise(r => setTimeout(r, 200));
  });

  it('should connect, sync, and reach connected status', async () => {
    const projectId = `test-connect-${Date.now()}`;
    const key = await generateTestKey();

    let resolveConnected: (s: TrackerSyncStatus) => void;
    const connectedPromise = new Promise<TrackerSyncStatus>(r => { resolveConnected = r; });

    const provider = await createProvider(projectId, 'user1', key, {
      onStatusChange: (status) => {
        if (status === 'connected') resolveConnected(status);
      },
    });

    await provider.connect();
    const status = await connectedPromise;
    expect(status).toBe('connected');
    expect(provider.getStatus()).toBe('connected');
  });

  it('should upsert an item and sync it to another provider', async () => {
    const projectId = `test-upsert-sync-${Date.now()}`;
    const key = await generateTestKey();

    // Provider 1: upsert an item
    let p1Connected: () => void;
    const p1ConnectedPromise = new Promise<void>(r => { p1Connected = r; });

    const provider1 = await createProvider(projectId, 'user1', key, {
      onStatusChange: (s) => { if (s === 'connected') p1Connected(); },
    });

    await provider1.connect();
    await p1ConnectedPromise;

    const payload = makePayload({
      itemId: 'bug-sync-001',
      title: 'Sync test bug',
      status: 'open',
      priority: 'critical',
      fieldUpdatedAt: { title: Date.now(), status: Date.now(), priority: Date.now() },
    });

    await provider1.upsertItem(payload);
    // Wait for server to process
    await new Promise(r => setTimeout(r, 500));

    // Provider 2: connect and sync -- should receive the item
    let receivedItem: TrackerItemPayload | null = null;
    let p2Connected: () => void;
    const p2ConnectedPromise = new Promise<void>(r => { p2Connected = r; });

    const provider2 = await createProvider(projectId, 'user2', key, {
      onItemUpserted: (item) => { receivedItem = item; },
      onStatusChange: (s) => { if (s === 'connected') p2Connected(); },
    });

    await provider2.connect();
    await p2ConnectedPromise;

    expect(receivedItem).not.toBeNull();
    expect(receivedItem!.itemId).toBe('bug-sync-001');
    expect(receivedItem!.title).toBe('Sync test bug');
    expect(receivedItem!.priority).toBe('critical');
  });

  it('should broadcast upserts between connected providers', async () => {
    const projectId = `test-broadcast-${Date.now()}`;
    const key = await generateTestKey();

    let p1Connected: () => void;
    const p1ConnectedPromise = new Promise<void>(r => { p1Connected = r; });
    let p2Connected: () => void;
    const p2ConnectedPromise = new Promise<void>(r => { p2Connected = r; });

    let broadcastedItem: TrackerItemPayload | null = null;
    let itemReceived: () => void;
    const itemReceivedPromise = new Promise<void>(r => { itemReceived = r; });

    const provider1 = await createProvider(projectId, 'user1', key, {
      onStatusChange: (s) => { if (s === 'connected') p1Connected(); },
    });

    const provider2 = await createProvider(projectId, 'user2', key, {
      onStatusChange: (s) => { if (s === 'connected') p2Connected(); },
      onItemUpserted: (item) => {
        broadcastedItem = item;
        itemReceived();
      },
    });

    await provider1.connect();
    await provider2.connect();
    await Promise.all([p1ConnectedPromise, p2ConnectedPromise]);

    const payload = makePayload({
      itemId: 'broadcast-bug',
      title: 'Broadcast test',
      fieldUpdatedAt: { title: Date.now() },
    });

    await provider1.upsertItem(payload);
    await itemReceivedPromise;

    expect(broadcastedItem).not.toBeNull();
    expect(broadcastedItem!.itemId).toBe('broadcast-bug');
    expect(broadcastedItem!.title).toBe('Broadcast test');
  });

  it('should broadcast deletes between connected providers', async () => {
    const projectId = `test-delete-broadcast-${Date.now()}`;
    const key = await generateTestKey();

    let p1Connected: () => void;
    const p1ConnectedPromise = new Promise<void>(r => { p1Connected = r; });
    let p2Connected: () => void;
    const p2ConnectedPromise = new Promise<void>(r => { p2Connected = r; });

    let deletedId: string | null = null;
    let deleteReceived: () => void;
    const deleteReceivedPromise = new Promise<void>(r => { deleteReceived = r; });

    const provider1 = await createProvider(projectId, 'user1', key, {
      onStatusChange: (s) => { if (s === 'connected') p1Connected(); },
    });

    const provider2 = await createProvider(projectId, 'user2', key, {
      onStatusChange: (s) => { if (s === 'connected') p2Connected(); },
      onItemDeleted: (id) => { deletedId = id; deleteReceived(); },
    });

    await provider1.connect();
    await provider2.connect();
    await Promise.all([p1ConnectedPromise, p2ConnectedPromise]);

    // Create then delete
    await provider1.upsertItem(makePayload({ itemId: 'to-delete' }));
    await new Promise(r => setTimeout(r, 300));
    await provider1.deleteItem('to-delete');
    await deleteReceivedPromise;

    expect(deletedId).toBe('to-delete');
  });

  it('should verify encryption (no plaintext on wire)', async () => {
    const projectId = `test-encryption-${Date.now()}`;
    const key = await generateTestKey();

    // Use the raw WebSocket helper to sniff what goes over the wire
    const { connectTrackerWS, waitForOpen, sendAndWait, waitForMessage, closeWS } = await import('./helpers');

    // Provider sends an encrypted item
    let p1Connected: () => void;
    const p1ConnectedPromise = new Promise<void>(r => { p1Connected = r; });

    const provider = await createProvider(projectId, 'user1', key, {
      onStatusChange: (s) => { if (s === 'connected') p1Connected(); },
    });

    await provider.connect();
    await p1ConnectedPromise;

    // Raw WebSocket to observe what the server sends
    const rawWs = connectTrackerWS(PORT, projectId, 'user2', ORG_ID);
    await waitForOpen(rawWs);
    await sendAndWait(rawWs, { type: 'trackerSync', sinceSequence: 0 }, 'trackerSyncResponse');

    const broadcastPromise = waitForMessage(rawWs, 'trackerUpsertBroadcast');

    const secretTitle = 'SQL injection in /api/auth/login';
    await provider.upsertItem(makePayload({
      itemId: 'secret-bug',
      title: secretTitle,
      fieldUpdatedAt: { title: Date.now() },
    }));

    const broadcast = await broadcastPromise;
    const raw = JSON.stringify(broadcast);

    // The wire data must NOT contain the plaintext title
    expect(raw).not.toContain(secretTitle);
    // But it must contain the itemId (plaintext metadata)
    expect(raw).toContain('secret-bug');

    await closeWS(rawWs);
  });

  it('should merge items using field-level LWW', () => {
    const now = Date.now();

    const local = makePayload({
      itemId: 'merge-test',
      title: 'Local title',
      status: 'open',
      priority: 'high',
      fieldUpdatedAt: {
        title: now - 1000,  // older
        status: now,        // newer
        priority: now - 500,
      },
    });

    const remote = makePayload({
      itemId: 'merge-test',
      title: 'Remote title',
      status: 'in-progress',
      priority: 'critical',
      fieldUpdatedAt: {
        title: now,         // newer -> wins
        status: now - 1000, // older
        priority: now,      // newer -> wins
      },
    });

    const merged = mergeTrackerItems(local, remote);

    expect(merged.title).toBe('Remote title');      // remote wins (newer)
    expect(merged.status).toBe('open');              // local wins (newer)
    expect(merged.priority).toBe('critical');        // remote wins (newer)
    expect(merged.fieldUpdatedAt.title).toBe(now);
    expect(merged.fieldUpdatedAt.status).toBe(now);
    expect(merged.fieldUpdatedAt.priority).toBe(now);
  });
});
