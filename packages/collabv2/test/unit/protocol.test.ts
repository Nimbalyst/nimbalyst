/**
 * Unit tests for Y.js sync protocol handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  createSyncStep1Message,
  createSyncStep2Message,
  createUpdateMessage,
  handleSyncMessage,
  createDoc,
  encodeDocumentState,
  getDocumentSize,
} from '../../src/protocol';
import { MessageType, SyncMessageType } from '../../src/types';
import * as decoding from 'lib0/decoding';

describe('Y.js Protocol', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  describe('createDoc', () => {
    it('should create empty Y.Doc', () => {
      const newDoc = createDoc();
      expect(newDoc).toBeInstanceOf(Y.Doc);
      expect(getDocumentSize(newDoc)).toBeLessThan(10); // Empty doc is tiny
    });

    it('should create Y.Doc with existing state', () => {
      // Create a doc with some content
      const text = doc.getText('test');
      text.insert(0, 'Hello World');

      // Encode and create new doc from state
      const state = encodeDocumentState(doc);
      const newDoc = createDoc(state);

      // Verify content is restored
      const newText = newDoc.getText('test');
      expect(newText.toString()).toBe('Hello World');
    });
  });

  describe('createSyncStep1Message', () => {
    it('should create valid SyncStep1 message', () => {
      const message = createSyncStep1Message(doc);

      const decoder = decoding.createDecoder(message);
      const messageType = decoding.readVarUint(decoder);
      const syncType = decoding.readVarUint(decoder);

      expect(messageType).toBe(MessageType.Sync);
      expect(syncType).toBe(SyncMessageType.SyncStep1);
    });

    it('should include state vector', () => {
      // Add some content
      const text = doc.getText('test');
      text.insert(0, 'Test content');

      const message = createSyncStep1Message(doc);
      expect(message.length).toBeGreaterThan(0);
    });
  });

  describe('createSyncStep2Message', () => {
    it('should create valid SyncStep2 response', () => {
      // Add content to server doc
      const text = doc.getText('test');
      text.insert(0, 'Server content');

      // Empty client state vector
      const emptyStateVector = Y.encodeStateVector(new Y.Doc());
      const message = createSyncStep2Message(doc, emptyStateVector);

      const decoder = decoding.createDecoder(message);
      const messageType = decoding.readVarUint(decoder);
      const syncType = decoding.readVarUint(decoder);

      expect(messageType).toBe(MessageType.Sync);
      expect(syncType).toBe(SyncMessageType.SyncStep2);
    });

    it('should only send diff, not full state', () => {
      // Both docs have some shared history
      const text = doc.getText('test');
      text.insert(0, 'Initial');

      const clientDoc = createDoc(encodeDocumentState(doc));

      // Server adds more content
      text.insert(7, ' + Server update');

      // Create message with client's state vector
      const clientStateVector = Y.encodeStateVector(clientDoc);
      const message = createSyncStep2Message(doc, clientStateVector);

      // Apply to client
      const decoder = decoding.createDecoder(message);
      decoding.readVarUint(decoder); // messageType
      decoding.readVarUint(decoder); // syncType
      const update = decoding.readVarUint8Array(decoder);

      Y.applyUpdate(clientDoc, update);

      // Client should now have full content
      expect(clientDoc.getText('test').toString()).toBe('Initial + Server update');
    });
  });

  describe('createUpdateMessage', () => {
    it('should wrap update in sync message format', () => {
      const text = doc.getText('test');
      text.insert(0, 'Test');

      const update = Y.encodeStateAsUpdate(doc);
      const message = createUpdateMessage(update);

      const decoder = decoding.createDecoder(message);
      const messageType = decoding.readVarUint(decoder);
      const syncType = decoding.readVarUint(decoder);

      expect(messageType).toBe(MessageType.Sync);
      expect(syncType).toBe(SyncMessageType.Update);
    });
  });

  describe('handleSyncMessage', () => {
    it('should handle SyncStep1 and return SyncStep2', () => {
      // Server has content
      const serverText = doc.getText('test');
      serverText.insert(0, 'Server data');

      // Client sends SyncStep1
      const clientDoc = new Y.Doc();
      const syncStep1 = createSyncStep1Message(clientDoc);

      const result = handleSyncMessage(doc, syncStep1);

      expect(result.response).not.toBeNull();
      expect(result.broadcast).toBeNull();
      expect(result.dirty).toBe(false);

      // Apply response to client
      const decoder = decoding.createDecoder(result.response!);
      decoding.readVarUint(decoder); // messageType
      decoding.readVarUint(decoder); // syncType
      const update = decoding.readVarUint8Array(decoder);

      Y.applyUpdate(clientDoc, update);
      expect(clientDoc.getText('test').toString()).toBe('Server data');
    });

    it('should handle SyncStep2 and apply update', () => {
      // Empty server doc receives SyncStep2 with content
      const clientDoc = new Y.Doc();
      const clientText = clientDoc.getText('test');
      clientText.insert(0, 'Client data');

      // Create SyncStep2 from client's perspective
      const emptyStateVector = Y.encodeStateVector(doc);
      const syncStep2 = createSyncStep2Message(clientDoc, emptyStateVector);

      const result = handleSyncMessage(doc, syncStep2);

      expect(result.response).toBeNull();
      expect(result.broadcast).toBeNull();
      expect(result.dirty).toBe(true);

      // Server should now have client's data
      expect(doc.getText('test').toString()).toBe('Client data');
    });

    it('should handle Update and broadcast to others', () => {
      // Initial sync
      const serverText = doc.getText('test');
      serverText.insert(0, 'Initial');

      // Client syncs
      const clientDoc = createDoc(encodeDocumentState(doc));

      // Client makes a change
      const clientText = clientDoc.getText('test');
      clientText.insert(7, ' + Client update');

      // Get the update to send
      const serverState = Y.encodeStateVector(doc);
      const update = Y.encodeStateAsUpdate(clientDoc, serverState);
      const updateMessage = createUpdateMessage(update);

      const result = handleSyncMessage(doc, updateMessage);

      expect(result.response).toBeNull();
      expect(result.broadcast).not.toBeNull(); // Should broadcast
      expect(result.dirty).toBe(true);

      // Server should have the update
      expect(doc.getText('test').toString()).toBe('Initial + Client update');
    });

    it('should ignore non-sync messages', () => {
      const fakeMessage = new Uint8Array([99, 0, 0]); // Invalid message type

      const result = handleSyncMessage(doc, fakeMessage);

      expect(result.response).toBeNull();
      expect(result.broadcast).toBeNull();
      expect(result.dirty).toBe(false);
    });
  });

  describe('getDocumentSize', () => {
    it('should return small size for empty doc', () => {
      const size = getDocumentSize(doc);
      expect(size).toBeLessThan(10);
    });

    it('should grow with content', () => {
      const emptySize = getDocumentSize(doc);

      const text = doc.getText('test');
      text.insert(0, 'A'.repeat(1000));

      const fullSize = getDocumentSize(doc);
      expect(fullSize).toBeGreaterThan(emptySize);
    });
  });

  describe('CRDT conflict resolution', () => {
    it('should merge concurrent edits from two clients', () => {
      // Initial state
      const text = doc.getText('test');
      text.insert(0, 'Hello');

      // Two clients sync with server
      const client1 = createDoc(encodeDocumentState(doc));
      const client2 = createDoc(encodeDocumentState(doc));

      // Client 1 appends " World"
      client1.getText('test').insert(5, ' World');

      // Client 2 prepends "Say: "
      client2.getText('test').insert(0, 'Say: ');

      // Server receives client1's update
      const sv1 = Y.encodeStateVector(doc);
      const update1 = Y.encodeStateAsUpdate(client1, sv1);
      Y.applyUpdate(doc, update1);

      // Server receives client2's update
      const sv2 = Y.encodeStateVector(doc);
      const update2 = Y.encodeStateAsUpdate(client2, sv2);
      Y.applyUpdate(doc, update2);

      // Result should contain both edits
      const result = doc.getText('test').toString();
      expect(result).toContain('Say:');
      expect(result).toContain('Hello');
      expect(result).toContain('World');
    });
  });
});
