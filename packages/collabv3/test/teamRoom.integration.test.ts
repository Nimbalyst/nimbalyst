/**
 * Integration tests for TeamRoom Durable Object.
 *
 * Runs against a local wrangler dev server with TEST_AUTH_BYPASS enabled.
 * Tests the full WebSocket + internal HTTP protocol for consolidated team state.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  connectTeamRoomWS,
  teamRoomInternalPost,
  waitForOpen,
  sendAndWait,
  waitForMessage,
  closeWS,
} from './helpers';
import type {
  TeamServerMessage,
} from '../src/types';

const PORT = 8791;

// Track open WebSockets for cleanup
const openSockets: WebSocket[] = [];

function connect(userId: string, orgId: string): WebSocket {
  const ws = connectTeamRoomWS(PORT, userId, orgId);
  openSockets.push(ws);
  return ws;
}

/** Connect a client and sync so broadcasts are received. */
async function connectAndSync(userId: string, orgId: string): Promise<WebSocket> {
  const ws = connect(userId, orgId);
  await waitForOpen(ws);
  await sendAndWait(ws, { type: 'teamSync' }, 'teamSyncResponse');
  return ws;
}

describe('TeamRoom integration', () => {

  afterEach(async () => {
    await Promise.all(openSockets.map(ws => closeWS(ws)));
    openSockets.length = 0;
  });

  // ========================================================================
  // 1. Connect and teamSync (empty state)
  // ========================================================================

  it('should connect and receive empty team state via teamSync', async () => {
    const orgId = `team-empty-${Date.now()}`;
    const ws = connect('user1', orgId);
    await waitForOpen(ws);

    const response = await sendAndWait<Extract<TeamServerMessage, { type: 'teamSyncResponse' }>>(
      ws,
      { type: 'teamSync' },
      'teamSyncResponse'
    );

    expect(response.type).toBe('teamSyncResponse');
    expect(response.team.metadata).toBeNull();
    expect(response.team.members).toEqual([]);
    expect(response.team.documents).toEqual([]);
    expect(response.team.keyEnvelope).toBeNull();
  });

  // ========================================================================
  // 2. Internal: add-member -> memberAdded broadcast
  // ========================================================================

  it('should broadcast memberAdded when a member is added via internal endpoint', async () => {
    const orgId = `team-add-member-${Date.now()}`;

    const ws1 = await connectAndSync('user1', orgId);
    const ws2 = await connectAndSync('user2', orgId);

    const broadcastPromise = waitForMessage<Extract<TeamServerMessage, { type: 'memberAdded' }>>(
      ws1,
      'memberAdded'
    );

    // Add a new member via internal endpoint (simulating Worker forwarding)
    const res = await teamRoomInternalPost(PORT, orgId, 'admin', 'add-member', {
      userId: 'user3',
      role: 'member',
      email: 'user3@test.com',
    });
    expect(res.status).toBe(200);

    const broadcast = await broadcastPromise;
    expect(broadcast.member.userId).toBe('user3');
    expect(broadcast.member.role).toBe('member');
    expect(broadcast.member.email).toBe('user3@test.com');
    expect(broadcast.member.hasKeyEnvelope).toBe(false);
    expect(broadcast.member.hasIdentityKey).toBe(false);
  });

  // ========================================================================
  // 3. Internal: remove-member -> memberRemoved broadcast
  // ========================================================================

  it('should broadcast memberRemoved when a member is removed', async () => {
    const orgId = `team-remove-member-${Date.now()}`;

    // Use two clients so broadcast reaches the listener
    const ws1 = await connectAndSync('user1', orgId);
    const ws2 = await connectAndSync('user2', orgId);

    // First add a member
    const addPromise = waitForMessage<Extract<TeamServerMessage, { type: 'memberAdded' }>>(
      ws1,
      'memberAdded'
    );
    await teamRoomInternalPost(PORT, orgId, 'admin', 'add-member', {
      userId: 'user-to-remove',
      role: 'member',
    });
    await addPromise;

    // Now remove them
    const broadcastPromise = waitForMessage<Extract<TeamServerMessage, { type: 'memberRemoved' }>>(
      ws1,
      'memberRemoved'
    );

    const res = await teamRoomInternalPost(PORT, orgId, 'admin', 'remove-member', {
      userId: 'user-to-remove',
    });
    expect(res.status).toBe(200);

    const broadcast = await broadcastPromise;
    expect(broadcast.userId).toBe('user-to-remove');
  });

  // ========================================================================
  // 4. Internal: update-role -> memberRoleChanged broadcast
  // ========================================================================

  it('should broadcast memberRoleChanged when a role is updated', async () => {
    const orgId = `team-update-role-${Date.now()}`;

    // Use two clients so broadcast reaches the listener
    const ws1 = await connectAndSync('user1', orgId);
    const ws2 = await connectAndSync('user2', orgId);

    // First add a member
    const addPromise = waitForMessage<Extract<TeamServerMessage, { type: 'memberAdded' }>>(
      ws1,
      'memberAdded'
    );
    await teamRoomInternalPost(PORT, orgId, 'admin', 'add-member', {
      userId: 'user-role-change',
      role: 'member',
    });
    await addPromise;

    // Now change their role
    const broadcastPromise = waitForMessage<Extract<TeamServerMessage, { type: 'memberRoleChanged' }>>(
      ws1,
      'memberRoleChanged'
    );

    const res = await teamRoomInternalPost(PORT, orgId, 'admin', 'update-role', {
      userId: 'user-role-change',
      role: 'admin',
    });
    expect(res.status).toBe(200);

    const broadcast = await broadcastPromise;
    expect(broadcast.userId).toBe('user-role-change');
    expect(broadcast.role).toBe('admin');
  });

  // ========================================================================
  // 5. Upload identity key via WebSocket, fetch peer's key
  // ========================================================================

  it('should store identity key and return it on request', async () => {
    const orgId = `team-identity-key-${Date.now()}`;

    const ws1 = await connectAndSync('user1', orgId);
    const ws2 = await connectAndSync('user2', orgId);

    // User1 uploads their identity key
    ws1.send(JSON.stringify({
      type: 'uploadIdentityKey',
      publicKeyJwk: '{"kty":"EC","crv":"P-256","x":"test-x","y":"test-y"}',
    }));

    // Small delay for the write to complete
    await new Promise(r => setTimeout(r, 200));

    // User2 requests user1's key
    const response = await sendAndWait<Extract<TeamServerMessage, { type: 'identityKeyResponse' }>>(
      ws2,
      { type: 'requestIdentityKey', targetUserId: 'user1' },
      'identityKeyResponse'
    );

    expect(response.userId).toBe('user1');
    expect(response.publicKeyJwk).toBe('{"kty":"EC","crv":"P-256","x":"test-x","y":"test-y"}');
  });

  it('should return error when requesting non-existent identity key', async () => {
    const orgId = `team-no-key-${Date.now()}`;

    const ws = await connectAndSync('user1', orgId);

    const response = await sendAndWait<Extract<TeamServerMessage, { type: 'error' }>>(
      ws,
      { type: 'requestIdentityKey', targetUserId: 'nonexistent-user' },
      'error'
    );

    expect(response.code).toBe('identity_key_not_found');
  });

  // ========================================================================
  // 6. Internal: upload-envelope -> target user receives keyEnvelopeAvailable
  // ========================================================================

  it('should push keyEnvelopeAvailable to target user when envelope is uploaded', async () => {
    const orgId = `team-envelope-${Date.now()}`;

    // Target user connects and syncs
    const wsTarget = await connectAndSync('target-user', orgId);

    // Set up listener for the push notification
    const pushPromise = waitForMessage<Extract<TeamServerMessage, { type: 'keyEnvelopeAvailable' }>>(
      wsTarget,
      'keyEnvelopeAvailable'
    );

    // Upload envelope via internal endpoint
    const res = await teamRoomInternalPost(PORT, orgId, 'admin', 'upload-envelope', {
      targetUserId: 'target-user',
      wrappedKey: 'wrapped-key-data',
      iv: 'envelope-iv',
      senderPublicKey: 'sender-pub-key',
    });
    expect(res.status).toBe(200);

    const push = await pushPromise;
    expect(push.targetUserId).toBe('target-user');
  });

  // ========================================================================
  // 7. Request key envelope via WebSocket
  // ========================================================================

  it('should return key envelope when requested', async () => {
    const orgId = `team-req-envelope-${Date.now()}`;

    // Upload an envelope for target-user first
    await teamRoomInternalPost(PORT, orgId, 'admin', 'upload-envelope', {
      targetUserId: 'target-user',
      wrappedKey: 'the-wrapped-key',
      iv: 'the-iv',
      senderPublicKey: 'the-sender-key',
    });

    // Target user connects and requests their envelope
    const ws = await connectAndSync('target-user', orgId);

    const response = await sendAndWait<Extract<TeamServerMessage, { type: 'keyEnvelope' }>>(
      ws,
      { type: 'requestKeyEnvelope' },
      'keyEnvelope'
    );

    expect(response.wrappedKey).toBe('the-wrapped-key');
    expect(response.iv).toBe('the-iv');
    expect(response.senderPublicKey).toBe('the-sender-key');
  });

  it('should return error when no key envelope exists', async () => {
    const orgId = `team-no-envelope-${Date.now()}`;

    const ws = await connectAndSync('user-no-envelope', orgId);

    const response = await sendAndWait<Extract<TeamServerMessage, { type: 'error' }>>(
      ws,
      { type: 'requestKeyEnvelope' },
      'error'
    );

    expect(response.code).toBe('no_key_envelope');
  });

  // ========================================================================
  // 8. Register document in index -> broadcast to other clients
  // ========================================================================

  it('should register document and broadcast to other clients', async () => {
    const orgId = `team-doc-register-${Date.now()}`;

    const ws1 = await connectAndSync('user1', orgId);
    const ws2 = await connectAndSync('user2', orgId);

    const broadcastPromise = waitForMessage<Extract<TeamServerMessage, { type: 'docIndexBroadcast' }>>(
      ws2,
      'docIndexBroadcast'
    );

    ws1.send(JSON.stringify({
      type: 'docIndexRegister',
      documentId: 'team-doc-001',
      encryptedTitle: btoa('encrypted-title'),
      titleIv: btoa('title-iv'),
      documentType: 'markdown',
    }));

    const broadcast = await broadcastPromise;
    expect(broadcast.document.documentId).toBe('team-doc-001');
    expect(broadcast.document.encryptedTitle).toBe(btoa('encrypted-title'));
    expect(broadcast.document.documentType).toBe('markdown');
    expect(broadcast.document.createdBy).toBe('user1');
  });

  // ========================================================================
  // 9. Update document title -> broadcast
  // ========================================================================

  it('should update document title and broadcast', async () => {
    const orgId = `team-doc-update-${Date.now()}`;

    const ws1 = await connectAndSync('user1', orgId);
    const ws2 = await connectAndSync('user2', orgId);

    // Register first
    ws1.send(JSON.stringify({
      type: 'docIndexRegister',
      documentId: 'doc-to-update',
      encryptedTitle: btoa('original'),
      titleIv: btoa('original-iv'),
      documentType: 'markdown',
    }));
    await waitForMessage(ws2, 'docIndexBroadcast');

    // Update title
    const updatePromise = waitForMessage<Extract<TeamServerMessage, { type: 'docIndexBroadcast' }>>(
      ws2,
      'docIndexBroadcast'
    );

    ws1.send(JSON.stringify({
      type: 'docIndexUpdate',
      documentId: 'doc-to-update',
      encryptedTitle: btoa('updated'),
      titleIv: btoa('updated-iv'),
    }));

    const broadcast = await updatePromise;
    expect(broadcast.document.encryptedTitle).toBe(btoa('updated'));
    expect(broadcast.document.createdBy).toBe('user1');
  });

  // ========================================================================
  // 10. Remove document -> docIndexRemoveBroadcast
  // ========================================================================

  it('should remove document and broadcast removal', async () => {
    const orgId = `team-doc-remove-${Date.now()}`;

    const ws1 = await connectAndSync('user1', orgId);
    const ws2 = await connectAndSync('user2', orgId);

    // Register first
    ws1.send(JSON.stringify({
      type: 'docIndexRegister',
      documentId: 'doc-to-remove',
      encryptedTitle: btoa('remove-me'),
      titleIv: btoa('remove-iv'),
      documentType: 'markdown',
    }));
    await waitForMessage(ws2, 'docIndexBroadcast');

    // Remove
    const removePromise = waitForMessage<Extract<TeamServerMessage, { type: 'docIndexRemoveBroadcast' }>>(
      ws2,
      'docIndexRemoveBroadcast'
    );

    ws1.send(JSON.stringify({
      type: 'docIndexRemove',
      documentId: 'doc-to-remove',
    }));

    const broadcast = await removePromise;
    expect(broadcast.documentId).toBe('doc-to-remove');
  });

  // ========================================================================
  // 11. teamSync returns full state including members, docs, and envelope
  // ========================================================================

  it('should return full team state with members, documents, and envelope on teamSync', async () => {
    const orgId = `team-full-state-${Date.now()}`;

    // Set up metadata
    await teamRoomInternalPost(PORT, orgId, 'admin', 'set-metadata', {
      orgId,
      name: 'Test Team',
      gitRemoteHash: 'abc123',
      createdBy: 'admin',
    });

    // Add members
    await teamRoomInternalPost(PORT, orgId, 'admin', 'add-member', {
      userId: 'member1',
      role: 'admin',
      email: 'member1@test.com',
    });
    await teamRoomInternalPost(PORT, orgId, 'admin', 'add-member', {
      userId: 'member2',
      role: 'member',
      email: 'member2@test.com',
    });

    // Upload envelope for member1
    await teamRoomInternalPost(PORT, orgId, 'admin', 'upload-envelope', {
      targetUserId: 'member1',
      wrappedKey: 'key-for-member1',
      iv: 'iv-for-member1',
      senderPublicKey: 'admin-pub-key',
    });

    // Connect and register a document
    const wsSetup = await connectAndSync('member1', orgId);
    wsSetup.send(JSON.stringify({
      type: 'docIndexRegister',
      documentId: 'shared-doc',
      encryptedTitle: btoa('shared-doc-title'),
      titleIv: btoa('shared-doc-iv'),
      documentType: 'markdown',
    }));
    await new Promise(r => setTimeout(r, 200));
    await closeWS(wsSetup);
    openSockets.splice(openSockets.indexOf(wsSetup), 1);

    // Upload identity key for member1 via internal endpoint
    await teamRoomInternalPost(PORT, orgId, 'admin', 'upload-identity-key', {
      userId: 'member1',
      publicKeyJwk: '{"kty":"EC","crv":"P-256"}',
    });

    // Now connect as member1 and get full state
    const ws = await connectAndSync('member1', orgId);

    // Re-sync to get full state
    const response = await sendAndWait<Extract<TeamServerMessage, { type: 'teamSyncResponse' }>>(
      ws,
      { type: 'teamSync' },
      'teamSyncResponse'
    );

    const team = response.team;

    // Metadata
    expect(team.metadata).not.toBeNull();
    expect(team.metadata!.name).toBe('Test Team');
    expect(team.metadata!.orgId).toBe(orgId);
    expect(team.metadata!.gitRemoteHash).toBe('abc123');
    expect(team.metadata!.createdBy).toBe('admin');

    // Members
    expect(team.members.length).toBe(2);
    const m1 = team.members.find(m => m.userId === 'member1')!;
    expect(m1.role).toBe('admin');
    expect(m1.email).toBe('member1@test.com');
    expect(m1.hasKeyEnvelope).toBe(true);
    expect(m1.hasIdentityKey).toBe(true);

    const m2 = team.members.find(m => m.userId === 'member2')!;
    expect(m2.role).toBe('member');
    expect(m2.hasKeyEnvelope).toBe(false);
    expect(m2.hasIdentityKey).toBe(false);

    // Documents
    expect(team.documents.length).toBe(1);
    expect(team.documents[0].documentId).toBe('shared-doc');

    // Key envelope for the connected user (member1)
    expect(team.keyEnvelope).not.toBeNull();
    expect(team.keyEnvelope!.wrappedKey).toBe('key-for-member1');
  });

  // ========================================================================
  // 12. Internal: delete/delete-all envelopes
  // ========================================================================

  it('should delete a specific key envelope', async () => {
    const orgId = `team-del-envelope-${Date.now()}`;

    // Upload an envelope
    await teamRoomInternalPost(PORT, orgId, 'admin', 'upload-envelope', {
      targetUserId: 'user-del',
      wrappedKey: 'key-data',
      iv: 'iv-data',
      senderPublicKey: 'pub-key',
    });

    // Delete it
    const res = await teamRoomInternalPost(PORT, orgId, 'admin', 'delete-envelope', {
      targetUserId: 'user-del',
    });
    expect(res.status).toBe(200);

    // Verify it's gone
    const ws = await connectAndSync('user-del', orgId);
    const response = await sendAndWait<Extract<TeamServerMessage, { type: 'error' }>>(
      ws,
      { type: 'requestKeyEnvelope' },
      'error'
    );
    expect(response.code).toBe('no_key_envelope');
  });

  it('should delete all key envelopes', async () => {
    const orgId = `team-del-all-env-${Date.now()}`;

    // Upload envelopes for two users
    await teamRoomInternalPost(PORT, orgId, 'admin', 'upload-envelope', {
      targetUserId: 'userA',
      wrappedKey: 'keyA',
      iv: 'ivA',
      senderPublicKey: 'pubA',
    });
    await teamRoomInternalPost(PORT, orgId, 'admin', 'upload-envelope', {
      targetUserId: 'userB',
      wrappedKey: 'keyB',
      iv: 'ivB',
      senderPublicKey: 'pubB',
    });

    // Delete all
    const res = await teamRoomInternalPost(PORT, orgId, 'admin', 'delete-all-envelopes', {});
    expect(res.status).toBe(200);

    // Verify both are gone
    const wsA = await connectAndSync('userA', orgId);
    const responseA = await sendAndWait<Extract<TeamServerMessage, { type: 'error' }>>(
      wsA,
      { type: 'requestKeyEnvelope' },
      'error'
    );
    expect(responseA.code).toBe('no_key_envelope');
  });

  // ========================================================================
  // 13. Internal: set-metadata
  // ========================================================================

  it('should set and update team metadata via internal endpoint', async () => {
    const orgId = `team-metadata-${Date.now()}`;

    // Set initial metadata
    const res1 = await teamRoomInternalPost(PORT, orgId, 'admin', 'set-metadata', {
      orgId,
      name: 'My Team',
      gitRemoteHash: null,
      createdBy: 'admin',
    });
    expect(res1.status).toBe(200);

    // Update name
    const res2 = await teamRoomInternalPost(PORT, orgId, 'admin', 'set-metadata', {
      name: 'Renamed Team',
    });
    expect(res2.status).toBe(200);

    // Verify via teamSync
    const ws = await connectAndSync('user1', orgId);
    const response = await sendAndWait<Extract<TeamServerMessage, { type: 'teamSyncResponse' }>>(
      ws,
      { type: 'teamSync' },
      'teamSyncResponse'
    );

    expect(response.team.metadata!.name).toBe('Renamed Team');
    expect(response.team.metadata!.orgId).toBe(orgId);
  });
});
