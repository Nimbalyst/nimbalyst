/**
 * Integration tests for DocumentSyncProvider.
 *
 * Tests the full client-side Yjs + encryption layer against a local wrangler dev server.
 * Two DocumentSyncProvider instances connect to the same DocumentRoom and verify that
 * encrypted Yjs updates flow through the DO and Y.Doc states converge.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { DocumentSyncProvider } from '../../runtime/src/sync/DocumentSync';
import type { DocumentSyncConfig, DocumentSyncStatus, ReviewGateState } from '../../runtime/src/sync/documentSyncTypes';
import { generateTestKey, waitFor } from './helpers';

const PORT = 8791;
const ORG_ID = 'test-org';

/** Create a DocumentSyncProvider config for integration tests. */
function createTestConfig(
  documentId: string,
  userId: string,
  documentKey: CryptoKey,
  overrides?: Partial<DocumentSyncConfig>
): DocumentSyncConfig {
  return {
    serverUrl: `ws://localhost:${PORT}`,
    getJwt: async () => 'test-jwt',
    orgId: ORG_ID,
    documentKey,
    userId,
    documentId,
    buildUrl: (roomId: string) =>
      `ws://localhost:${PORT}/sync/${roomId}?test_user_id=${userId}&test_org_id=${ORG_ID}`,
    ...overrides,
  };
}

// Track providers for cleanup
const providers: DocumentSyncProvider[] = [];

function createProvider(config: DocumentSyncConfig): DocumentSyncProvider {
  const provider = new DocumentSyncProvider(config);
  providers.push(provider);
  return provider;
}

describe('DocumentSyncProvider integration', () => {

  afterEach(async () => {
    for (const p of providers) {
      p.destroy();
    }
    providers.length = 0;
    // Brief pause to let wrangler clean up connections
    await new Promise(r => setTimeout(r, 200));
  });

  it('should connect, sync, and reach connected status', async () => {
    const docId = `sync-connect-${Date.now()}`;
    const key = await generateTestKey();
    const statuses: DocumentSyncStatus[] = [];

    const provider = createProvider(
      createTestConfig(docId, 'user1', key, {
        onStatusChange: (s) => statuses.push(s),
      })
    );

    await provider.connect();
    await waitFor(() => provider.isConnected(), 5000);

    expect(provider.getStatus()).toBe('connected');
    expect(provider.isSynced()).toBe(true);
    expect(statuses).toContain('connecting');
    expect(statuses).toContain('syncing');
    expect(statuses).toContain('connected');
  });

  it('should sync Yjs text between two providers', async () => {
    const docId = `sync-text-${Date.now()}`;
    const key = await generateTestKey();

    const provider1 = createProvider(createTestConfig(docId, 'user1', key));
    const provider2 = createProvider(createTestConfig(docId, 'user2', key));

    await provider1.connect();
    await waitFor(() => provider1.isConnected(), 5000);

    await provider2.connect();
    await waitFor(() => provider2.isConnected(), 5000);

    // User1 types into their Y.Doc
    const text1 = provider1.getYDoc().getText('content');
    text1.insert(0, 'Hello from user1');

    // Wait for the update to propagate through the DO to user2
    const text2 = provider2.getYDoc().getText('content');
    await waitFor(() => text2.toString() === 'Hello from user1', 5000);

    expect(text2.toString()).toBe('Hello from user1');
  });

  it('should sync bidirectional edits', async () => {
    const docId = `sync-bidi-${Date.now()}`;
    const key = await generateTestKey();

    const provider1 = createProvider(createTestConfig(docId, 'user1', key));
    const provider2 = createProvider(createTestConfig(docId, 'user2', key));

    await provider1.connect();
    await waitFor(() => provider1.isConnected(), 5000);
    await provider2.connect();
    await waitFor(() => provider2.isConnected(), 5000);

    // User1 types
    const text1 = provider1.getYDoc().getText('content');
    text1.insert(0, 'AAA');

    const text2 = provider2.getYDoc().getText('content');
    await waitFor(() => text2.toString() === 'AAA', 5000);

    // User2 appends
    text2.insert(3, ' BBB');

    await waitFor(() => text1.toString() === 'AAA BBB', 5000);
    expect(text1.toString()).toBe('AAA BBB');
    expect(text2.toString()).toBe('AAA BBB');
  });

  it('should recover state on reconnect via sync', async () => {
    const docId = `sync-reconnect-${Date.now()}`;
    const key = await generateTestKey();

    // User1 connects and writes data
    const provider1 = createProvider(createTestConfig(docId, 'user1', key));
    await provider1.connect();
    await waitFor(() => provider1.isConnected(), 5000);

    const text1 = provider1.getYDoc().getText('content');
    text1.insert(0, 'persisted data');

    // Wait for server to store the update
    await new Promise(r => setTimeout(r, 500));

    // User1 disconnects
    provider1.disconnect();

    // User2 connects fresh -- should get the data via sync
    const provider2 = createProvider(createTestConfig(docId, 'user2', key));
    await provider2.connect();
    await waitFor(() => provider2.isConnected(), 5000);

    const text2 = provider2.getYDoc().getText('content');
    // The sync response should have delivered the encrypted update
    await waitFor(() => text2.toString() === 'persisted data', 5000);
    expect(text2.toString()).toBe('persisted data');
  });

  it('should encrypt updates (server cannot read plaintext)', async () => {
    const docId = `sync-encrypted-${Date.now()}`;
    const key = await generateTestKey();

    // Intercept what goes over the wire
    const sentMessages: string[] = [];
    const origSend = WebSocket.prototype.send;

    const provider = createProvider(createTestConfig(docId, 'user1', key));
    await provider.connect();
    await waitFor(() => provider.isConnected(), 5000);

    // Patch the provider's WebSocket send to capture messages
    const ws = (provider as unknown as { ws: WebSocket }).ws;
    const patchedSend = ws.send.bind(ws);
    ws.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
      if (typeof data === 'string') sentMessages.push(data);
      return patchedSend(data);
    };

    // Type some recognizable text
    const text = provider.getYDoc().getText('content');
    text.insert(0, 'SECRET_PLAINTEXT_DATA');

    // Wait for the update to be sent
    await waitFor(() => sentMessages.some(m => m.includes('docUpdate')), 3000);

    // Verify the sent message contains encrypted data, not plaintext
    const updateMsg = sentMessages.find(m => m.includes('docUpdate'));
    expect(updateMsg).toBeDefined();
    expect(updateMsg).not.toContain('SECRET_PLAINTEXT_DATA');

    const parsed = JSON.parse(updateMsg!);
    expect(parsed.type).toBe('docUpdate');
    expect(parsed.encryptedUpdate).toBeTruthy();
    expect(parsed.iv).toBeTruthy();
  });

  it('should broadcast awareness between providers', async () => {
    const docId = `sync-awareness-${Date.now()}`;
    const key = await generateTestKey();

    const provider1 = createProvider(createTestConfig(docId, 'user1', key));
    const provider2 = createProvider(createTestConfig(docId, 'user2', key));

    await provider1.connect();
    await waitFor(() => provider1.isConnected(), 5000);
    await provider2.connect();
    await waitFor(() => provider2.isConnected(), 5000);

    // Subscribe to awareness on provider2
    let receivedStates: Map<string, unknown> | null = null;
    provider2.onAwarenessChange((states) => {
      receivedStates = states;
    });

    // Provider1 sends awareness (cursor uses serialized relative positions as base64 strings)
    await provider1.sendAwareness({
      cursor: { anchor: btoa('pos:5'), head: btoa('pos:10') },
      user: { name: 'Alice', color: '#ff0000' },
    });

    // Wait for awareness to arrive at provider2
    await waitFor(() => receivedStates !== null && receivedStates.size > 0, 5000);

    expect(receivedStates!.size).toBe(1);
    const state = receivedStates!.get('user1');
    expect(state).toBeDefined();
    expect((state as { user: { name: string } }).user.name).toBe('Alice');
    expect((state as { cursor: { anchor: string } }).cursor.anchor).toBe(btoa('pos:5'));
  });

  it('should throttle awareness updates via setLocalAwareness', async () => {
    const docId = `sync-throttle-${Date.now()}`;
    const key = await generateTestKey();

    const provider1 = createProvider(createTestConfig(docId, 'user1', key));
    const provider2 = createProvider(createTestConfig(docId, 'user2', key));

    await provider1.connect();
    await waitFor(() => provider1.isConnected(), 5000);
    await provider2.connect();
    await waitFor(() => provider2.isConnected(), 5000);

    // Track awareness updates received
    const receivedUpdates: Map<string, unknown>[] = [];
    provider2.onAwarenessChange((states) => {
      receivedUpdates.push(new Map(states));
    });

    // Send many rapid awareness updates via setLocalAwareness
    for (let i = 0; i < 10; i++) {
      provider1.setLocalAwareness({
        cursor: { anchor: btoa(`pos:${i}`), head: btoa(`pos:${i + 1}`) },
        user: { name: 'Alice', color: '#ff0000' },
      });
    }

    // Wait for at least one awareness update to arrive
    await waitFor(() => receivedUpdates.length > 0, 5000);

    // Wait for throttle window to pass so the final coalesced update can arrive
    await new Promise(r => setTimeout(r, 800));

    // Should have received fewer updates than sent (throttled)
    // At most 2: one immediate + one coalesced after throttle
    expect(receivedUpdates.length).toBeLessThanOrEqual(3);
    expect(receivedUpdates.length).toBeGreaterThanOrEqual(1);

    // The last received state should have the final cursor position
    const lastStates = receivedUpdates[receivedUpdates.length - 1];
    const lastState = lastStates.get('user1') as { cursor: { anchor: string } };
    expect(lastState).toBeDefined();
    expect(lastState.cursor.anchor).toBe(btoa('pos:9'));
  });
});

describe('Review gate integration', () => {

  afterEach(async () => {
    for (const p of providers) {
      p.destroy();
    }
    providers.length = 0;
    await new Promise(r => setTimeout(r, 200));
  });

  it('should not flag remote changes when reviewGateEnabled is false', async () => {
    const docId = `review-disabled-${Date.now()}`;
    const key = await generateTestKey();

    const provider1 = createProvider(createTestConfig(docId, 'user1', key));
    const provider2 = createProvider(createTestConfig(docId, 'user2', key));

    await provider1.connect();
    await waitFor(() => provider1.isConnected(), 5000);
    await provider2.connect();
    await waitFor(() => provider2.isConnected(), 5000);

    // User1 types
    provider1.getYDoc().getText('content').insert(0, 'Hello');

    // Wait for propagation
    await waitFor(() => provider2.getYDoc().getText('content').toString() === 'Hello', 5000);

    // Review gate should report nothing (disabled by default)
    expect(provider2.hasUnreviewedRemoteChanges()).toBe(false);
    expect(provider2.getReviewGateState().hasUnreviewed).toBe(false);
    expect(provider2.getReviewGateState().unreviewedCount).toBe(0);
  });

  it('should track remote changes as unreviewed when gate is enabled', async () => {
    const docId = `review-track-${Date.now()}`;
    const key = await generateTestKey();

    const reviewStates: ReviewGateState[] = [];

    const provider1 = createProvider(createTestConfig(docId, 'user1', key));
    const provider2 = createProvider(createTestConfig(docId, 'user2', key, {
      reviewGateEnabled: true,
      onReviewStateChange: (state) => reviewStates.push(state),
    }));

    await provider1.connect();
    await waitFor(() => provider1.isConnected(), 5000);
    await provider2.connect();
    await waitFor(() => provider2.isConnected(), 5000);

    // Initially no unreviewed changes
    expect(provider2.hasUnreviewedRemoteChanges()).toBe(false);

    // User1 types
    provider1.getYDoc().getText('content').insert(0, 'Remote edit');

    // Wait for propagation
    await waitFor(() => provider2.getYDoc().getText('content').toString() === 'Remote edit', 5000);

    // Provider2 should see the change as unreviewed
    expect(provider2.hasUnreviewedRemoteChanges()).toBe(true);
    const state = provider2.getReviewGateState();
    expect(state.hasUnreviewed).toBe(true);
    expect(state.unreviewedCount).toBe(1);
    expect(state.unreviewedAuthors).toContain('user1');

    // onReviewStateChange should have been called
    expect(reviewStates.length).toBeGreaterThanOrEqual(1);
    expect(reviewStates[reviewStates.length - 1].hasUnreviewed).toBe(true);
  });

  it('should accept remote changes and clear unreviewed state', async () => {
    const docId = `review-accept-${Date.now()}`;
    const key = await generateTestKey();

    const reviewStates: ReviewGateState[] = [];

    const provider1 = createProvider(createTestConfig(docId, 'user1', key));
    const provider2 = createProvider(createTestConfig(docId, 'user2', key, {
      reviewGateEnabled: true,
      onReviewStateChange: (state) => reviewStates.push(state),
    }));

    await provider1.connect();
    await waitFor(() => provider1.isConnected(), 5000);
    await provider2.connect();
    await waitFor(() => provider2.isConnected(), 5000);

    // User1 types
    provider1.getYDoc().getText('content').insert(0, 'Accept me');
    await waitFor(() => provider2.getYDoc().getText('content').toString() === 'Accept me', 5000);

    expect(provider2.hasUnreviewedRemoteChanges()).toBe(true);

    // Accept the changes
    provider2.acceptRemoteChanges();

    expect(provider2.hasUnreviewedRemoteChanges()).toBe(false);
    expect(provider2.getReviewGateState().unreviewedCount).toBe(0);
    expect(provider2.getUnreviewedUpdates()).toHaveLength(0);

    // The Y.Doc content should still be there (accepted, not removed)
    expect(provider2.getYDoc().getText('content').toString()).toBe('Accept me');

    // Callback should have reported cleared state
    const lastState = reviewStates[reviewStates.length - 1];
    expect(lastState.hasUnreviewed).toBe(false);
  });

  it('should not mark initial sync data as unreviewed', async () => {
    const docId = `review-initial-${Date.now()}`;
    const key = await generateTestKey();

    // User1 writes data first
    const provider1 = createProvider(createTestConfig(docId, 'user1', key));
    await provider1.connect();
    await waitFor(() => provider1.isConnected(), 5000);
    provider1.getYDoc().getText('content').insert(0, 'Pre-existing data');
    await new Promise(r => setTimeout(r, 500));
    provider1.disconnect();

    // User2 connects with review gate enabled -- initial sync should NOT
    // be flagged as unreviewed
    const provider2 = createProvider(createTestConfig(docId, 'user2', key, {
      reviewGateEnabled: true,
    }));
    await provider2.connect();
    await waitFor(() => provider2.isConnected(), 5000);

    expect(provider2.getYDoc().getText('content').toString()).toBe('Pre-existing data');
    expect(provider2.hasUnreviewedRemoteChanges()).toBe(false);
    expect(provider2.getReviewGateState().unreviewedCount).toBe(0);
  });

  it('should allow local edits to autosave regardless of review gate', async () => {
    const docId = `review-local-${Date.now()}`;
    const key = await generateTestKey();

    const provider1 = createProvider(createTestConfig(docId, 'user1', key));
    const provider2 = createProvider(createTestConfig(docId, 'user2', key, {
      reviewGateEnabled: true,
    }));

    await provider1.connect();
    await waitFor(() => provider1.isConnected(), 5000);
    await provider2.connect();
    await waitFor(() => provider2.isConnected(), 5000);

    // User2 (with review gate) types locally
    provider2.getYDoc().getText('content').insert(0, 'Local edit');

    // Local edits should NOT trigger the review gate
    expect(provider2.hasUnreviewedRemoteChanges()).toBe(false);

    // Now user1 sends a remote edit
    provider1.getYDoc().getText('content').insert(0, 'Remote: ');
    await waitFor(() => provider2.hasUnreviewedRemoteChanges(), 5000);

    // Both texts should be in the Y.Doc (CRDT merge)
    const content = provider2.getYDoc().getText('content').toString();
    expect(content).toContain('Local edit');
    expect(content).toContain('Remote: ');

    // But only remote changes are flagged
    expect(provider2.getReviewGateState().unreviewedAuthors).toEqual(['user1']);
  });

  it('should accumulate multiple remote updates from different users', async () => {
    const docId = `review-multi-${Date.now()}`;
    const key = await generateTestKey();

    const provider1 = createProvider(createTestConfig(docId, 'user1', key));
    const provider2 = createProvider(createTestConfig(docId, 'user2', key));
    const provider3 = createProvider(createTestConfig(docId, 'user3', key, {
      reviewGateEnabled: true,
    }));

    await provider1.connect();
    await waitFor(() => provider1.isConnected(), 5000);
    await provider2.connect();
    await waitFor(() => provider2.isConnected(), 5000);
    await provider3.connect();
    await waitFor(() => provider3.isConnected(), 5000);

    // User1 and user2 both type
    provider1.getYDoc().getText('content').insert(0, 'From user1');
    await waitFor(() => provider3.getYDoc().getText('content').toString().includes('From user1'), 5000);

    provider2.getYDoc().getText('content').insert(0, 'From user2 ');
    await waitFor(() => provider3.getYDoc().getText('content').toString().includes('From user2'), 5000);

    // Provider3 should see both as unreviewed
    const state = provider3.getReviewGateState();
    expect(state.hasUnreviewed).toBe(true);
    expect(state.unreviewedCount).toBe(2);
    expect(state.unreviewedAuthors).toContain('user1');
    expect(state.unreviewedAuthors).toContain('user2');

    // Accept clears all
    provider3.acceptRemoteChanges();
    expect(provider3.hasUnreviewedRemoteChanges()).toBe(false);
    expect(provider3.getReviewGateState().unreviewedAuthors).toEqual([]);
  });

  it('should provide unreviewed diff via getUnreviewedDiff()', async () => {
    const docId = `review-diff-${Date.now()}`;
    const key = await generateTestKey();

    const provider1 = createProvider(createTestConfig(docId, 'user1', key));
    const provider2 = createProvider(createTestConfig(docId, 'user2', key, {
      reviewGateEnabled: true,
    }));

    await provider1.connect();
    await waitFor(() => provider1.isConnected(), 5000);
    await provider2.connect();
    await waitFor(() => provider2.isConnected(), 5000);

    // Initially no diff
    expect(provider2.getUnreviewedDiff()).toBeNull();

    // User1 types
    provider1.getYDoc().getText('content').insert(0, 'Diff content');
    await waitFor(() => provider2.hasUnreviewedRemoteChanges(), 5000);

    // Get the diff
    const diff = provider2.getUnreviewedDiff();
    expect(diff).not.toBeNull();
    expect(diff!.byteLength).toBeGreaterThan(0);

    // Apply the diff to a fresh Y.Doc to verify it contains the remote change
    const reviewDoc = new Y.Doc();
    // First apply the reviewed state
    const reviewedSV = provider2.getReviewedStateVector();
    expect(reviewedSV).not.toBeNull();
    // Apply the diff on top of an empty doc to see what it contains
    Y.applyUpdate(reviewDoc, diff!);
    expect(reviewDoc.getText('content').toString()).toBe('Diff content');
    reviewDoc.destroy();

    // After accept, diff should be null
    provider2.acceptRemoteChanges();
    expect(provider2.getUnreviewedDiff()).toBeNull();
  });

  it('should reject remote changes (clear buffer without advancing SV)', async () => {
    const docId = `review-reject-${Date.now()}`;
    const key = await generateTestKey();

    const provider1 = createProvider(createTestConfig(docId, 'user1', key));
    const provider2 = createProvider(createTestConfig(docId, 'user2', key, {
      reviewGateEnabled: true,
    }));

    await provider1.connect();
    await waitFor(() => provider1.isConnected(), 5000);
    await provider2.connect();
    await waitFor(() => provider2.isConnected(), 5000);

    // User1 types
    provider1.getYDoc().getText('content').insert(0, 'Rejected edit');
    await waitFor(() => provider2.hasUnreviewedRemoteChanges(), 5000);

    // Reject the changes
    provider2.rejectRemoteChanges();

    // The unreviewed buffer is cleared
    expect(provider2.hasUnreviewedRemoteChanges()).toBe(false);
    expect(provider2.getReviewGateState().unreviewedCount).toBe(0);

    // The Y.Doc still contains the data (CRDT -- can't truly undo)
    // but the review gate no longer flags it. The host can choose not to save.
    expect(provider2.getYDoc().getText('content').toString()).toBe('Rejected edit');
  });
});
