/**
 * Integration tests for DocumentRoom Durable Object.
 *
 * Runs against a local wrangler dev server with TEST_AUTH_BYPASS enabled.
 * Tests the full WebSocket protocol: connect, sync, update, compaction, awareness, key envelopes.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  connectDocWS,
  waitForOpen,
  sendAndWait,
  waitForMessage,
  closeWS,
} from './helpers';
import type {
  DocServerMessage,
} from '../src/types';

const PORT = 8791;
const ORG_ID = 'test-org';

// Track open WebSockets for cleanup
const openSockets: WebSocket[] = [];

function connect(docId: string, userId: string): WebSocket {
  const ws = connectDocWS(PORT, docId, userId, ORG_ID);
  openSockets.push(ws);
  return ws;
}

describe('DocumentRoom integration', () => {

  afterEach(async () => {
    // Close any remaining sockets
    await Promise.all(openSockets.map(ws => closeWS(ws)));
    openSockets.length = 0;
  });

  it('should connect and receive empty sync response', async () => {
    // Use a unique doc ID to avoid cross-test state
    const docId = `test-empty-sync-${Date.now()}`;
    const ws = connect(docId, 'user1');
    await waitForOpen(ws);

    const response = await sendAndWait<Extract<DocServerMessage, { type: 'docSyncResponse' }>>(
      ws,
      { type: 'docSyncRequest', sinceSeq: 0 },
      'docSyncResponse'
    );

    expect(response.type).toBe('docSyncResponse');
    expect(response.updates).toEqual([]);
    expect(response.hasMore).toBe(false);
    expect(response.cursor).toBe(0);
    expect(response.snapshot).toBeUndefined();
  });

  it('should broadcast updates between two clients', async () => {
    const docId = `test-broadcast-${Date.now()}`;

    // Connect two clients
    const ws1 = connect(docId, 'user1');
    const ws2 = connect(docId, 'user2');
    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);

    // Both clients must sync first
    await sendAndWait(ws1, { type: 'docSyncRequest', sinceSeq: 0 }, 'docSyncResponse');
    await sendAndWait(ws2, { type: 'docSyncRequest', sinceSeq: 0 }, 'docSyncResponse');

    // Client 1 sends an update, client 2 should receive the broadcast
    const broadcastPromise = waitForMessage<Extract<DocServerMessage, { type: 'docUpdateBroadcast' }>>(
      ws2,
      'docUpdateBroadcast'
    );

    ws1.send(JSON.stringify({
      type: 'docUpdate',
      encryptedUpdate: 'dGVzdC11cGRhdGUtMQ==', // base64 "test-update-1"
      iv: 'dGVzdC1pdi0x',
    }));

    const broadcast = await broadcastPromise;
    expect(broadcast.type).toBe('docUpdateBroadcast');
    expect(broadcast.encryptedUpdate).toBe('dGVzdC11cGRhdGUtMQ==');
    expect(broadcast.iv).toBe('dGVzdC1pdi0x');
    expect(broadcast.senderId).toBe('user1');
    expect(broadcast.sequence).toBe(1);
  });

  it('should persist updates and serve them on sync', async () => {
    const docId = `test-persist-${Date.now()}`;

    // Client 1 connects, syncs, and sends updates
    const ws1 = connect(docId, 'user1');
    await waitForOpen(ws1);
    await sendAndWait(ws1, { type: 'docSyncRequest', sinceSeq: 0 }, 'docSyncResponse');

    ws1.send(JSON.stringify({
      type: 'docUpdate',
      encryptedUpdate: 'dXBkYXRlLTE=',
      iv: 'aXYtMQ==',
    }));
    ws1.send(JSON.stringify({
      type: 'docUpdate',
      encryptedUpdate: 'dXBkYXRlLTI=',
      iv: 'aXYtMg==',
    }));

    // Wait a moment for server to process
    await new Promise(r => setTimeout(r, 300));

    // Client 1 disconnects
    await closeWS(ws1);
    openSockets.splice(openSockets.indexOf(ws1), 1);

    // Client 2 connects fresh and syncs
    const ws2 = connect(docId, 'user2');
    await waitForOpen(ws2);

    const response = await sendAndWait<Extract<DocServerMessage, { type: 'docSyncResponse' }>>(
      ws2,
      { type: 'docSyncRequest', sinceSeq: 0 },
      'docSyncResponse'
    );

    expect(response.updates).toHaveLength(2);
    expect(response.updates[0].encryptedUpdate).toBe('dXBkYXRlLTE=');
    expect(response.updates[0].sequence).toBe(1);
    expect(response.updates[1].encryptedUpdate).toBe('dXBkYXRlLTI=');
    expect(response.updates[1].sequence).toBe(2);
    expect(response.hasMore).toBe(false);
  });

  it('should support delta sync with sinceSeq', async () => {
    const docId = `test-delta-${Date.now()}`;

    const ws1 = connect(docId, 'user1');
    await waitForOpen(ws1);
    await sendAndWait(ws1, { type: 'docSyncRequest', sinceSeq: 0 }, 'docSyncResponse');

    // Send 3 updates
    for (let i = 1; i <= 3; i++) {
      ws1.send(JSON.stringify({
        type: 'docUpdate',
        encryptedUpdate: btoa(`update-${i}`),
        iv: btoa(`iv-${i}`),
      }));
    }

    await new Promise(r => setTimeout(r, 300));
    await closeWS(ws1);
    openSockets.splice(openSockets.indexOf(ws1), 1);

    // Client 2 asks for updates since seq 2 (should only get seq 3)
    const ws2 = connect(docId, 'user2');
    await waitForOpen(ws2);

    const response = await sendAndWait<Extract<DocServerMessage, { type: 'docSyncResponse' }>>(
      ws2,
      { type: 'docSyncRequest', sinceSeq: 2 },
      'docSyncResponse'
    );

    expect(response.updates).toHaveLength(1);
    expect(response.updates[0].sequence).toBe(3);
  });

  it('should handle compaction with snapshot', async () => {
    const docId = `test-compact-${Date.now()}`;

    const ws1 = connect(docId, 'user1');
    await waitForOpen(ws1);
    await sendAndWait(ws1, { type: 'docSyncRequest', sinceSeq: 0 }, 'docSyncResponse');

    // Send 5 updates
    for (let i = 1; i <= 5; i++) {
      ws1.send(JSON.stringify({
        type: 'docUpdate',
        encryptedUpdate: btoa(`update-${i}`),
        iv: btoa(`iv-${i}`),
      }));
    }
    await new Promise(r => setTimeout(r, 300));

    // Compact: snapshot covers up to seq 5
    ws1.send(JSON.stringify({
      type: 'docCompact',
      encryptedState: btoa('snapshot-state'),
      iv: btoa('snapshot-iv'),
      replacesUpTo: 5,
    }));
    await new Promise(r => setTimeout(r, 300));

    await closeWS(ws1);
    openSockets.splice(openSockets.indexOf(ws1), 1);

    // New client syncs from 0 - should get the snapshot
    const ws2 = connect(docId, 'user2');
    await waitForOpen(ws2);

    const response = await sendAndWait<Extract<DocServerMessage, { type: 'docSyncResponse' }>>(
      ws2,
      { type: 'docSyncRequest', sinceSeq: 0 },
      'docSyncResponse'
    );

    expect(response.snapshot).toBeDefined();
    expect(response.snapshot!.encryptedState).toBe(btoa('snapshot-state'));
    expect(response.snapshot!.replacesUpTo).toBe(5);
    // No updates needed beyond the snapshot (all covered by replacesUpTo)
    expect(response.updates).toHaveLength(0);
  });

  it('should broadcast awareness (no persistence)', async () => {
    const docId = `test-awareness-${Date.now()}`;

    const ws1 = connect(docId, 'user1');
    const ws2 = connect(docId, 'user2');
    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);

    // Both must sync first to be marked as synced
    await sendAndWait(ws1, { type: 'docSyncRequest', sinceSeq: 0 }, 'docSyncResponse');
    await sendAndWait(ws2, { type: 'docSyncRequest', sinceSeq: 0 }, 'docSyncResponse');

    const awarenessPromise = waitForMessage<Extract<DocServerMessage, { type: 'docAwarenessBroadcast' }>>(
      ws2,
      'docAwarenessBroadcast'
    );

    ws1.send(JSON.stringify({
      type: 'docAwareness',
      encryptedState: btoa('cursor-data'),
      iv: btoa('cursor-iv'),
    }));

    const awareness = await awarenessPromise;
    expect(awareness.encryptedState).toBe(btoa('cursor-data'));
    expect(awareness.iv).toBe(btoa('cursor-iv'));
    expect(awareness.fromUserId).toBe('user1');
  });

  // Valid P-256 public key JWK for use in envelope tests
  const TEST_P256_JWK = JSON.stringify({
    kty: 'EC',
    crv: 'P-256',
    x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU',
    y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0',
  });

  // A different valid P-256 public key for overwrite tests
  const TEST_P256_JWK_2 = JSON.stringify({
    kty: 'EC',
    crv: 'P-256',
    x: 'iGaLqP6y-SJCRExUhqGilFLjIgecIWd1BaHPPH85gqo',
    y: 'eFfxMi6fCAvEWM0s-PEUmqZfjGhpEOVRLKTi3qqnMGo',
  });

  it('should store and retrieve key envelopes', async () => {
    const docId = `test-envelope-${Date.now()}`;

    // User1 stores an envelope for user2
    const ws1 = connect(docId, 'user1');
    await waitForOpen(ws1);
    await sendAndWait(ws1, { type: 'docSyncRequest', sinceSeq: 0 }, 'docSyncResponse');

    ws1.send(JSON.stringify({
      type: 'addKeyEnvelope',
      targetUserId: 'user2',
      wrappedKey: btoa('wrapped-doc-key'),
      iv: btoa('envelope-iv'),
      senderPublicKey: TEST_P256_JWK,
    }));
    await new Promise(r => setTimeout(r, 300));

    // User2 connects and retrieves the envelope
    const ws2 = connect(docId, 'user2');
    await waitForOpen(ws2);
    await sendAndWait(ws2, { type: 'docSyncRequest', sinceSeq: 0 }, 'docSyncResponse');

    const envelope = await sendAndWait<Extract<DocServerMessage, { type: 'keyEnvelope' }>>(
      ws2,
      { type: 'requestKeyEnvelope' },
      'keyEnvelope'
    );

    expect(envelope.wrappedKey).toBe(btoa('wrapped-doc-key'));
    expect(envelope.iv).toBe(btoa('envelope-iv'));
    expect(envelope.senderPublicKey).toBe(TEST_P256_JWK);
    expect(envelope.senderUserId).toBe('user1');
  });

  it('should reject envelope overwrite by a different sender', async () => {
    const docId = `test-envelope-overwrite-${Date.now()}`;

    // User1 stores an envelope for user3
    const ws1 = connect(docId, 'user1');
    await waitForOpen(ws1);
    await sendAndWait(ws1, { type: 'docSyncRequest', sinceSeq: 0 }, 'docSyncResponse');

    ws1.send(JSON.stringify({
      type: 'addKeyEnvelope',
      targetUserId: 'user3',
      wrappedKey: btoa('original-key'),
      iv: btoa('original-iv'),
      senderPublicKey: TEST_P256_JWK,
    }));
    await new Promise(r => setTimeout(r, 300));

    // User2 tries to overwrite user3's envelope -- should be rejected
    const ws2 = connect(docId, 'user2');
    await waitForOpen(ws2);
    await sendAndWait(ws2, { type: 'docSyncRequest', sinceSeq: 0 }, 'docSyncResponse');

    const error = await sendAndWait<Extract<DocServerMessage, { type: 'error' }>>(
      ws2,
      {
        type: 'addKeyEnvelope',
        targetUserId: 'user3',
        wrappedKey: btoa('malicious-key'),
        iv: btoa('malicious-iv'),
        senderPublicKey: TEST_P256_JWK_2,
      } as any,
      'error'
    );

    expect(error.code).toBe('envelope_sender_mismatch');

    // Verify the original envelope is still intact
    const ws3 = connect(docId, 'user3');
    await waitForOpen(ws3);
    await sendAndWait(ws3, { type: 'docSyncRequest', sinceSeq: 0 }, 'docSyncResponse');

    const envelope = await sendAndWait<Extract<DocServerMessage, { type: 'keyEnvelope' }>>(
      ws3,
      { type: 'requestKeyEnvelope' },
      'keyEnvelope'
    );

    expect(envelope.wrappedKey).toBe(btoa('original-key'));
    expect(envelope.senderUserId).toBe('user1');
  });

  it('should allow same sender to update their own envelope', async () => {
    const docId = `test-envelope-self-update-${Date.now()}`;

    // User1 stores an envelope for user2
    const ws1 = connect(docId, 'user1');
    await waitForOpen(ws1);
    await sendAndWait(ws1, { type: 'docSyncRequest', sinceSeq: 0 }, 'docSyncResponse');

    ws1.send(JSON.stringify({
      type: 'addKeyEnvelope',
      targetUserId: 'user2',
      wrappedKey: btoa('original-key'),
      iv: btoa('original-iv'),
      senderPublicKey: TEST_P256_JWK,
    }));
    await new Promise(r => setTimeout(r, 300));

    // User1 updates the envelope (same sender, should succeed)
    ws1.send(JSON.stringify({
      type: 'addKeyEnvelope',
      targetUserId: 'user2',
      wrappedKey: btoa('updated-key'),
      iv: btoa('updated-iv'),
      senderPublicKey: TEST_P256_JWK,
    }));
    await new Promise(r => setTimeout(r, 300));

    // User2 retrieves envelope and gets the updated data
    const ws2 = connect(docId, 'user2');
    await waitForOpen(ws2);
    await sendAndWait(ws2, { type: 'docSyncRequest', sinceSeq: 0 }, 'docSyncResponse');

    const envelope = await sendAndWait<Extract<DocServerMessage, { type: 'keyEnvelope' }>>(
      ws2,
      { type: 'requestKeyEnvelope' },
      'keyEnvelope'
    );

    expect(envelope.wrappedKey).toBe(btoa('updated-key'));
    expect(envelope.iv).toBe(btoa('updated-iv'));
    expect(envelope.senderUserId).toBe('user1');
  });

  it('should return error when no key envelope exists', async () => {
    const docId = `test-no-envelope-${Date.now()}`;

    const ws = connect(docId, 'user3');
    await waitForOpen(ws);
    await sendAndWait(ws, { type: 'docSyncRequest', sinceSeq: 0 }, 'docSyncResponse');

    const error = await sendAndWait<Extract<DocServerMessage, { type: 'error' }>>(
      ws,
      { type: 'requestKeyEnvelope' },
      'error'
    );

    expect(error.code).toBe('no_key_envelope');
  });
});
