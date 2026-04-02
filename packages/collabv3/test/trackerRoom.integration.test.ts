/**
 * Integration tests for TeamTrackerRoom Durable Object.
 *
 * Runs against a local wrangler dev server with TEST_AUTH_BYPASS enabled.
 * Tests the full WebSocket protocol: connect, sync, upsert, delete, batch, broadcast.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  connectTrackerWS,
  waitForOpen,
  sendAndWait,
  waitForMessage,
  closeWS,
} from './helpers';
import type {
  TrackerServerMessage,
} from '../src/types';

const PORT = 8791;
const ORG_ID = 'test-org';

// Track open WebSockets for cleanup
const openSockets: WebSocket[] = [];

function connect(projectId: string, userId: string): WebSocket {
  const ws = connectTrackerWS(PORT, projectId, userId, ORG_ID);
  openSockets.push(ws);
  return ws;
}

describe('TeamTrackerRoom integration', () => {

  afterEach(async () => {
    await Promise.all(openSockets.map(ws => closeWS(ws)));
    openSockets.length = 0;
  });

  it('should connect and receive empty sync response', async () => {
    const projectId = `test-empty-sync-${Date.now()}`;
    const ws = connect(projectId, 'user1');
    await waitForOpen(ws);

    const response = await sendAndWait<Extract<TrackerServerMessage, { type: 'trackerSyncResponse' }>>(
      ws,
      { type: 'trackerSync', sinceSequence: 0 },
      'trackerSyncResponse'
    );

    expect(response.type).toBe('trackerSyncResponse');
    expect(response.items).toEqual([]);
    expect(response.deletedItemIds).toEqual([]);
    expect(response.hasMore).toBe(false);
    expect(response.sequence).toBe(0);
  });

  it('should upsert an item and broadcast to other clients', async () => {
    const projectId = `test-upsert-broadcast-${Date.now()}`;

    const ws1 = connect(projectId, 'user1');
    const ws2 = connect(projectId, 'user2');
    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);

    // Both clients must sync first
    await sendAndWait(ws1, { type: 'trackerSync', sinceSequence: 0 }, 'trackerSyncResponse');
    await sendAndWait(ws2, { type: 'trackerSync', sinceSequence: 0 }, 'trackerSyncResponse');

    // Client 1 upserts, client 2 should receive broadcast
    const senderBroadcastPromise = waitForMessage<Extract<TrackerServerMessage, { type: 'trackerUpsertBroadcast' }>>(
      ws1,
      'trackerUpsertBroadcast'
    );
    const broadcastPromise = waitForMessage<Extract<TrackerServerMessage, { type: 'trackerUpsertBroadcast' }>>(
      ws2,
      'trackerUpsertBroadcast'
    );

    ws1.send(JSON.stringify({
      type: 'trackerUpsert',
      itemId: 'bug-001',
      encryptedPayload: btoa('encrypted-bug-data'),
      iv: btoa('bug-iv'),
    }));

    const senderBroadcast = await senderBroadcastPromise;
    const broadcast = await broadcastPromise;
    expect(senderBroadcast.type).toBe('trackerUpsertBroadcast');
    expect(senderBroadcast.item.issueNumber).toBe(1);
    expect(senderBroadcast.item.issueKey).toBe('NIM-1');
    expect(broadcast.type).toBe('trackerUpsertBroadcast');
    expect(broadcast.item.itemId).toBe('bug-001');
    expect(broadcast.item.issueNumber).toBe(1);
    expect(broadcast.item.issueKey).toBe('NIM-1');
    expect(broadcast.item.encryptedPayload).toBe(btoa('encrypted-bug-data'));
    expect(broadcast.item.iv).toBe(btoa('bug-iv'));
    expect(broadcast.item.version).toBe(1);
    expect(broadcast.item.sequence).toBeGreaterThan(0);
  });

  it('should preserve incoming issue identity and continue the room sequence', async () => {
    const projectId = `test-issue-identity-${Date.now()}`;

    const ws1 = connect(projectId, 'user1');
    await waitForOpen(ws1);
    await sendAndWait(ws1, { type: 'trackerSync', sinceSequence: 0 }, 'trackerSyncResponse');

    const recoveredBroadcastPromise = waitForMessage<Extract<TrackerServerMessage, { type: 'trackerUpsertBroadcast' }>>(
      ws1,
      'trackerUpsertBroadcast'
    );
    ws1.send(JSON.stringify({
      type: 'trackerUpsert',
      itemId: 'recovered-001',
      encryptedPayload: btoa('recovered-data'),
      iv: btoa('recovered-iv'),
      issueNumber: 42,
      issueKey: 'NIM-42',
    }));

    const recoveredBroadcast = await recoveredBroadcastPromise;
    expect(recoveredBroadcast.item.issueNumber).toBe(42);
    expect(recoveredBroadcast.item.issueKey).toBe('NIM-42');

    const nextBroadcastPromise = waitForMessage<Extract<TrackerServerMessage, { type: 'trackerUpsertBroadcast' }>>(
      ws1,
      'trackerUpsertBroadcast'
    );
    ws1.send(JSON.stringify({
      type: 'trackerUpsert',
      itemId: 'fresh-001',
      encryptedPayload: btoa('fresh-data'),
      iv: btoa('fresh-iv'),
    }));

    const nextBroadcast = await nextBroadcastPromise;
    expect(nextBroadcast.item.issueNumber).toBe(43);
    expect(nextBroadcast.item.issueKey).toBe('NIM-43');

    await closeWS(ws1);
    openSockets.splice(openSockets.indexOf(ws1), 1);

    const ws2 = connect(projectId, 'user2');
    await waitForOpen(ws2);

    const response = await sendAndWait<Extract<TrackerServerMessage, { type: 'trackerSyncResponse' }>>(
      ws2,
      { type: 'trackerSync', sinceSequence: 0 },
      'trackerSyncResponse'
    );

    const recoveredItem = response.items.find(item => item.itemId === 'recovered-001');
    const freshItem = response.items.find(item => item.itemId === 'fresh-001');
    expect(recoveredItem?.issueNumber).toBe(42);
    expect(recoveredItem?.issueKey).toBe('NIM-42');
    expect(freshItem?.issueNumber).toBe(43);
    expect(freshItem?.issueKey).toBe('NIM-43');
  });

  it('should persist items and serve them on sync', async () => {
    const projectId = `test-persist-${Date.now()}`;

    // Client 1 connects and upserts two items
    const ws1 = connect(projectId, 'user1');
    await waitForOpen(ws1);
    await sendAndWait(ws1, { type: 'trackerSync', sinceSequence: 0 }, 'trackerSyncResponse');

    ws1.send(JSON.stringify({
      type: 'trackerUpsert',
      itemId: 'bug-001',
      encryptedPayload: btoa('bug-1-data'),
      iv: btoa('bug-1-iv'),
    }));
    ws1.send(JSON.stringify({
      type: 'trackerUpsert',
      itemId: 'task-001',
      encryptedPayload: btoa('task-1-data'),
      iv: btoa('task-1-iv'),
    }));

    await new Promise(r => setTimeout(r, 300));

    // Disconnect client 1
    await closeWS(ws1);
    openSockets.splice(openSockets.indexOf(ws1), 1);

    // Client 2 connects and syncs from scratch
    const ws2 = connect(projectId, 'user2');
    await waitForOpen(ws2);

    const response = await sendAndWait<Extract<TrackerServerMessage, { type: 'trackerSyncResponse' }>>(
      ws2,
      { type: 'trackerSync', sinceSequence: 0 },
      'trackerSyncResponse'
    );

    expect(response.items).toHaveLength(2);
    const itemIds = response.items.map(i => i.itemId).sort();
    expect(itemIds).toEqual(['bug-001', 'task-001']);

    const bug = response.items.find(i => i.itemId === 'bug-001')!;
    expect(bug.encryptedPayload).toBe(btoa('bug-1-data'));
    expect(bug.version).toBe(1);
  });

  it('should support delta sync with sinceSequence', async () => {
    const projectId = `test-delta-${Date.now()}`;

    const ws1 = connect(projectId, 'user1');
    await waitForOpen(ws1);
    await sendAndWait(ws1, { type: 'trackerSync', sinceSequence: 0 }, 'trackerSyncResponse');

    // Upsert 3 items
    for (let i = 1; i <= 3; i++) {
      ws1.send(JSON.stringify({
        type: 'trackerUpsert',
        itemId: `item-${i}`,
        encryptedPayload: btoa(`data-${i}`),
        iv: btoa(`iv-${i}`),
      }));
    }

    await new Promise(r => setTimeout(r, 300));
    await closeWS(ws1);
    openSockets.splice(openSockets.indexOf(ws1), 1);

    // Client 2 syncs since sequence 2 (should only get item-3)
    const ws2 = connect(projectId, 'user2');
    await waitForOpen(ws2);

    const response = await sendAndWait<Extract<TrackerServerMessage, { type: 'trackerSyncResponse' }>>(
      ws2,
      { type: 'trackerSync', sinceSequence: 2 },
      'trackerSyncResponse'
    );

    expect(response.items).toHaveLength(1);
    expect(response.items[0].itemId).toBe('item-3');
    expect(response.hasMore).toBe(false);
  });

  it('should increment version on re-upsert of same item', async () => {
    const projectId = `test-version-${Date.now()}`;

    const ws1 = connect(projectId, 'user1');
    await waitForOpen(ws1);
    await sendAndWait(ws1, { type: 'trackerSync', sinceSequence: 0 }, 'trackerSyncResponse');

    // Upsert same item twice
    ws1.send(JSON.stringify({
      type: 'trackerUpsert',
      itemId: 'bug-001',
      encryptedPayload: btoa('v1-data'),
      iv: btoa('v1-iv'),
    }));

    await new Promise(r => setTimeout(r, 200));

    ws1.send(JSON.stringify({
      type: 'trackerUpsert',
      itemId: 'bug-001',
      encryptedPayload: btoa('v2-data'),
      iv: btoa('v2-iv'),
    }));

    await new Promise(r => setTimeout(r, 300));
    await closeWS(ws1);
    openSockets.splice(openSockets.indexOf(ws1), 1);

    // New client syncs -- should see version 2 with latest data
    const ws2 = connect(projectId, 'user2');
    await waitForOpen(ws2);

    const response = await sendAndWait<Extract<TrackerServerMessage, { type: 'trackerSyncResponse' }>>(
      ws2,
      { type: 'trackerSync', sinceSequence: 0 },
      'trackerSyncResponse'
    );

    // The sync response should have the latest version of the item
    // (the changelog has 2 entries, but we deduplicate to the latest state)
    const bug = response.items.find(i => i.itemId === 'bug-001');
    expect(bug).toBeDefined();
    expect(bug!.version).toBe(2);
    expect(bug!.encryptedPayload).toBe(btoa('v2-data'));
  });

  it('should delete an item and broadcast to other clients', async () => {
    const projectId = `test-delete-${Date.now()}`;

    const ws1 = connect(projectId, 'user1');
    const ws2 = connect(projectId, 'user2');
    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);

    await sendAndWait(ws1, { type: 'trackerSync', sinceSequence: 0 }, 'trackerSyncResponse');
    await sendAndWait(ws2, { type: 'trackerSync', sinceSequence: 0 }, 'trackerSyncResponse');

    // Create an item first
    ws1.send(JSON.stringify({
      type: 'trackerUpsert',
      itemId: 'bug-to-delete',
      encryptedPayload: btoa('delete-me'),
      iv: btoa('del-iv'),
    }));
    await waitForMessage(ws2, 'trackerUpsertBroadcast');

    // Now delete it
    const deletePromise = waitForMessage<Extract<TrackerServerMessage, { type: 'trackerDeleteBroadcast' }>>(
      ws2,
      'trackerDeleteBroadcast'
    );

    ws1.send(JSON.stringify({
      type: 'trackerDelete',
      itemId: 'bug-to-delete',
    }));

    const deleteBroadcast = await deletePromise;
    expect(deleteBroadcast.itemId).toBe('bug-to-delete');
    expect(deleteBroadcast.sequence).toBeGreaterThan(0);
  });

  it('should include deleted item IDs in sync response', async () => {
    const projectId = `test-sync-delete-${Date.now()}`;

    const ws1 = connect(projectId, 'user1');
    await waitForOpen(ws1);
    await sendAndWait(ws1, { type: 'trackerSync', sinceSequence: 0 }, 'trackerSyncResponse');

    // Create then delete an item
    ws1.send(JSON.stringify({
      type: 'trackerUpsert',
      itemId: 'ephemeral-bug',
      encryptedPayload: btoa('temp'),
      iv: btoa('temp-iv'),
    }));

    await new Promise(r => setTimeout(r, 200));

    ws1.send(JSON.stringify({
      type: 'trackerDelete',
      itemId: 'ephemeral-bug',
    }));

    await new Promise(r => setTimeout(r, 300));
    await closeWS(ws1);
    openSockets.splice(openSockets.indexOf(ws1), 1);

    // New client syncs -- should see the deletion
    const ws2 = connect(projectId, 'user2');
    await waitForOpen(ws2);

    const response = await sendAndWait<Extract<TrackerServerMessage, { type: 'trackerSyncResponse' }>>(
      ws2,
      { type: 'trackerSync', sinceSequence: 0 },
      'trackerSyncResponse'
    );

    // The item was created then deleted -- should appear in deletedItemIds, not items
    expect(response.deletedItemIds).toContain('ephemeral-bug');
    expect(response.items.find(i => i.itemId === 'ephemeral-bug')).toBeUndefined();
  });

  it('should handle batch upsert', async () => {
    const projectId = `test-batch-${Date.now()}`;

    const ws1 = connect(projectId, 'user1');
    const ws2 = connect(projectId, 'user2');
    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);

    await sendAndWait(ws1, { type: 'trackerSync', sinceSequence: 0 }, 'trackerSyncResponse');
    await sendAndWait(ws2, { type: 'trackerSync', sinceSequence: 0 }, 'trackerSyncResponse');

    // Collect broadcasts on ws2
    const broadcasts: Extract<TrackerServerMessage, { type: 'trackerUpsertBroadcast' }>[] = [];
    const allReceived = new Promise<void>((resolve) => {
      ws2.addEventListener('message', (event) => {
        const data = JSON.parse(String(event.data));
        if (data.type === 'trackerUpsertBroadcast') {
          broadcasts.push(data);
          if (broadcasts.length === 3) resolve();
        }
      });
    });

    ws1.send(JSON.stringify({
      type: 'trackerBatchUpsert',
      items: [
        { itemId: 'batch-1', encryptedPayload: btoa('b1'), iv: btoa('i1') },
        { itemId: 'batch-2', encryptedPayload: btoa('b2'), iv: btoa('i2') },
        { itemId: 'batch-3', encryptedPayload: btoa('b3'), iv: btoa('i3') },
      ],
    }));

    await allReceived;
    expect(broadcasts).toHaveLength(3);
    const broadcastIds = broadcasts.map(b => b.item.itemId).sort();
    expect(broadcastIds).toEqual(['batch-1', 'batch-2', 'batch-3']);
  });
});
