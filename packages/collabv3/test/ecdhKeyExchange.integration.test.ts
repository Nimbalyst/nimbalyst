/**
 * Integration tests for ECDH Key Exchange (Phase 3).
 *
 * Tests the full key exchange flow:
 * 1. Identity key pair generation and serialization
 * 2. Public key upload/fetch via REST API
 * 3. Document key wrapping (sender wraps for recipient)
 * 4. Key envelope storage/retrieval in TeamDocumentRoom
 * 5. Document key unwrapping (recipient unwraps)
 * 6. End-to-end: both users can encrypt/decrypt with the shared key
 */

import { describe, it, expect, afterEach } from 'vitest';
import { webcrypto } from 'crypto';
import {
  connectDocWS,
  waitForOpen,
  sendAndWait,
  waitForMessage,
  closeWS,
  fetchWithTestAuth,
} from './helpers';

// Polyfill crypto.subtle for Node.js test environment
const subtle = webcrypto.subtle;

const PORT = 8791;
const ORG_ID = 'test-org-ecdh';

// Track open WebSockets for cleanup
const openSockets: WebSocket[] = [];

function connect(docId: string, userId: string): WebSocket {
  const ws = connectDocWS(PORT, docId, userId, ORG_ID);
  openSockets.push(ws);
  return ws;
}

afterEach(async () => {
  for (const ws of openSockets) {
    await closeWS(ws);
  }
  openSockets.length = 0;
});

// ============================================================================
// Helper: ECDH key operations (mirrors ECDHKeyManager logic for tests)
// ============================================================================

async function generateECDHKeyPair() {
  return subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
}

async function exportPublicKeyJwk(keyPair: CryptoKeyPair): Promise<string> {
  const jwk = await subtle.exportKey('jwk', keyPair.publicKey);
  return JSON.stringify(jwk);
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function wrapDocumentKey(
  documentKey: CryptoKey,
  senderPrivateKey: CryptoKey,
  recipientPublicKeyJwk: string,
  senderPublicKeyJwk: string
): Promise<{ wrappedKey: string; iv: string; senderPublicKey: string }> {
  const recipientPubKey = await subtle.importKey(
    'jwk',
    JSON.parse(recipientPublicKeyJwk),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const wrappingKey = await subtle.deriveKey(
    { name: 'ECDH', public: recipientPubKey },
    senderPrivateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey']
  );

  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const wrappedKeyBuffer = await subtle.wrapKey(
    'raw',
    documentKey,
    wrappingKey,
    { name: 'AES-GCM', iv }
  );

  return {
    wrappedKey: uint8ArrayToBase64(new Uint8Array(wrappedKeyBuffer)),
    iv: uint8ArrayToBase64(iv),
    senderPublicKey: senderPublicKeyJwk,
  };
}

async function unwrapDocumentKey(
  envelope: { wrappedKey: string; iv: string; senderPublicKey: string },
  recipientPrivateKey: CryptoKey
): Promise<CryptoKey> {
  const senderPubKey = await subtle.importKey(
    'jwk',
    JSON.parse(envelope.senderPublicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const wrappingKey = await subtle.deriveKey(
    { name: 'ECDH', public: senderPubKey },
    recipientPrivateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['unwrapKey']
  );

  return subtle.unwrapKey(
    'raw',
    base64ToUint8Array(envelope.wrappedKey),
    wrappingKey,
    { name: 'AES-GCM', iv: base64ToUint8Array(envelope.iv) },
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('ECDH Key Exchange', () => {
  describe('Identity key REST API', () => {
    it('should upload and fetch a public key', async () => {
      const keyPair = await generateECDHKeyPair();
      const publicKeyJwk = await exportPublicKeyJwk(keyPair);
      const userId = `user-rest-${Date.now()}`;

      // Upload public key
      const uploadRes = await fetchWithTestAuth(PORT, '/api/identity-key', userId, ORG_ID, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKeyJwk }),
      });
      expect(uploadRes.status).toBe(200);
      const uploadBody = await uploadRes.json() as { success: boolean };
      expect(uploadBody.success).toBe(true);

      // Fetch public key
      const fetchRes = await fetchWithTestAuth(PORT, `/api/identity-key/${userId}`, userId, ORG_ID);
      expect(fetchRes.status).toBe(200);
      const fetchBody = await fetchRes.json() as { userId: string; publicKeyJwk: string };
      expect(fetchBody.userId).toBe(userId);
      expect(fetchBody.publicKeyJwk).toBe(publicKeyJwk);
    });

    it('should return 404 for unknown user', async () => {
      const userId = `user-unknown-${Date.now()}`;
      const fetchRes = await fetchWithTestAuth(PORT, `/api/identity-key/nonexistent-user`, userId, ORG_ID);
      expect(fetchRes.status).toBe(404);
    });

    it('should reject non-P256 keys', async () => {
      const userId = `user-bad-key-${Date.now()}`;
      const badJwk = JSON.stringify({ kty: 'RSA', n: 'abc', e: 'AQAB' });

      const res = await fetchWithTestAuth(PORT, '/api/identity-key', userId, ORG_ID, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKeyJwk: badJwk }),
      });
      expect(res.status).toBe(400);
    });

    it('should reject keys with private component', async () => {
      const keyPair = await generateECDHKeyPair();
      // Export private key (has 'd' component)
      const privateJwk = await subtle.exportKey('jwk', keyPair.privateKey);
      const userId = `user-private-${Date.now()}`;

      const res = await fetchWithTestAuth(PORT, '/api/identity-key', userId, ORG_ID, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKeyJwk: JSON.stringify(privateJwk) }),
      });
      expect(res.status).toBe(400);
    });

    it('should update existing public key on re-upload', async () => {
      const userId = `user-update-${Date.now()}`;

      // Upload first key
      const keyPair1 = await generateECDHKeyPair();
      const pubKey1 = await exportPublicKeyJwk(keyPair1);
      await fetchWithTestAuth(PORT, '/api/identity-key', userId, ORG_ID, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKeyJwk: pubKey1 }),
      });

      // Upload second key (should replace)
      const keyPair2 = await generateECDHKeyPair();
      const pubKey2 = await exportPublicKeyJwk(keyPair2);
      await fetchWithTestAuth(PORT, '/api/identity-key', userId, ORG_ID, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKeyJwk: pubKey2 }),
      });

      // Fetch should return the second key
      const fetchRes = await fetchWithTestAuth(PORT, `/api/identity-key/${userId}`, userId, ORG_ID);
      const body = await fetchRes.json() as { publicKeyJwk: string };
      expect(body.publicKeyJwk).toBe(pubKey2);
    });

    it('should enforce org isolation for key fetch', async () => {
      const keyPair = await generateECDHKeyPair();
      const publicKeyJwk = await exportPublicKeyJwk(keyPair);
      const userId = `user-org-iso-${Date.now()}`;

      // Upload with org-A
      await fetchWithTestAuth(PORT, '/api/identity-key', userId, 'org-A', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKeyJwk }),
      });

      // Fetch from org-B should not find it
      const fetchRes = await fetchWithTestAuth(PORT, `/api/identity-key/${userId}`, 'other-user', 'org-B');
      expect(fetchRes.status).toBe(404);

      // Fetch from org-A should find it
      const fetchRes2 = await fetchWithTestAuth(PORT, `/api/identity-key/${userId}`, 'other-user', 'org-A');
      expect(fetchRes2.status).toBe(200);
    });
  });

  describe('Document key wrapping and unwrapping', () => {
    it('should wrap and unwrap a document key between two users', async () => {
      // Generate identity key pairs for two users
      const aliceKeys = await generateECDHKeyPair();
      const bobKeys = await generateECDHKeyPair();

      const alicePubJwk = await exportPublicKeyJwk(aliceKeys);
      const bobPubJwk = await exportPublicKeyJwk(bobKeys);

      // Generate a document key
      const docKey = await subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      // Alice wraps the doc key for Bob
      const envelope = await wrapDocumentKey(
        docKey,
        aliceKeys.privateKey,
        bobPubJwk,
        alicePubJwk
      );

      // Bob unwraps the doc key
      const unwrappedKey = await unwrapDocumentKey(envelope, bobKeys.privateKey);

      // Verify the unwrapped key works: encrypt with original, decrypt with unwrapped
      const plaintext = new TextEncoder().encode('Hello, collaborative editing!');
      const iv = webcrypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await subtle.encrypt(
        { name: 'AES-GCM', iv },
        docKey,
        plaintext
      );
      const decrypted = await subtle.decrypt(
        { name: 'AES-GCM', iv },
        unwrappedKey,
        ciphertext
      );

      expect(new Uint8Array(decrypted)).toEqual(plaintext);
    });
  });

  describe('End-to-end key exchange via TeamDocumentRoom', () => {
    it('should complete full key exchange flow through the server', async () => {
      const docId = `ecdh-e2e-${Date.now()}`;
      const aliceId = `alice-${Date.now()}`;
      const bobId = `bob-${Date.now()}`;

      // Step 1: Generate identity key pairs
      const aliceKeys = await generateECDHKeyPair();
      const bobKeys = await generateECDHKeyPair();

      const alicePubJwk = await exportPublicKeyJwk(aliceKeys);
      const bobPubJwk = await exportPublicKeyJwk(bobKeys);

      // Step 2: Upload public keys to server
      const uploadAlice = await fetchWithTestAuth(PORT, '/api/identity-key', aliceId, ORG_ID, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKeyJwk: alicePubJwk }),
      });
      expect(uploadAlice.status).toBe(200);

      const uploadBob = await fetchWithTestAuth(PORT, '/api/identity-key', bobId, ORG_ID, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKeyJwk: bobPubJwk }),
      });
      expect(uploadBob.status).toBe(200);

      // Step 3: Alice fetches Bob's public key
      const bobKeyRes = await fetchWithTestAuth(PORT, `/api/identity-key/${bobId}`, aliceId, ORG_ID);
      expect(bobKeyRes.status).toBe(200);
      const bobKeyBody = await bobKeyRes.json() as { publicKeyJwk: string };

      // Step 4: Alice generates document key and wraps it for Bob
      const docKey = await subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      const envelope = await wrapDocumentKey(
        docKey,
        aliceKeys.privateKey,
        bobKeyBody.publicKeyJwk,
        alicePubJwk
      );

      // Step 5: Alice stores the key envelope in the TeamDocumentRoom via WebSocket
      const aliceWs = connect(docId, aliceId);
      await waitForOpen(aliceWs);

      // Sync first (required before sending other messages)
      await sendAndWait(aliceWs, { type: 'docSyncRequest', sinceSeq: 0 }, 'docSyncResponse');

      // Store the key envelope
      aliceWs.send(JSON.stringify({
        type: 'addKeyEnvelope',
        targetUserId: bobId,
        wrappedKey: envelope.wrappedKey,
        iv: envelope.iv,
        senderPublicKey: envelope.senderPublicKey,
      }));

      // Give the server a moment to process
      await new Promise(r => setTimeout(r, 200));
      await closeWS(aliceWs);
      openSockets.length = 0;

      // Step 6: Bob connects and requests his key envelope
      const bobWs = connect(docId, bobId);
      await waitForOpen(bobWs);

      const keyEnvelopeMsg = await sendAndWait<{
        type: string;
        wrappedKey: string;
        iv: string;
        senderPublicKey: string;
      }>(bobWs, { type: 'requestKeyEnvelope' }, 'keyEnvelope');

      expect(keyEnvelopeMsg.wrappedKey).toBe(envelope.wrappedKey);
      expect(keyEnvelopeMsg.iv).toBe(envelope.iv);
      expect(keyEnvelopeMsg.senderPublicKey).toBe(envelope.senderPublicKey);

      // Step 7: Bob unwraps the document key
      const unwrappedKey = await unwrapDocumentKey(
        {
          wrappedKey: keyEnvelopeMsg.wrappedKey,
          iv: keyEnvelopeMsg.iv,
          senderPublicKey: keyEnvelopeMsg.senderPublicKey,
        },
        bobKeys.privateKey
      );

      // Step 8: Verify both keys work - encrypt with Alice's key, decrypt with Bob's
      const testData = new TextEncoder().encode('Shared document content');
      const testIv = webcrypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await subtle.encrypt(
        { name: 'AES-GCM', iv: testIv },
        docKey,
        testData
      );
      const decrypted = await subtle.decrypt(
        { name: 'AES-GCM', iv: testIv },
        unwrappedKey,
        ciphertext
      );

      expect(new Uint8Array(decrypted)).toEqual(testData);
    });
  });
});
