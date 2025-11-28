/**
 * Y.js Sync Protocol Handler
 *
 * Implements the core Y.js WebSocket sync protocol (SyncStep1, SyncStep2, Update).
 * This is a minimal implementation focused on document sync - awareness is deferred.
 */

import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { MessageType, SyncMessageType, type SyncResult } from './types';

/**
 * Create a SyncStep1 message (state vector request)
 * Clients send this to initiate sync with the server.
 */
export function createSyncStep1Message(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MessageType.Sync);
  encoding.writeVarUint(encoder, SyncMessageType.SyncStep1);
  const stateVector = Y.encodeStateVector(doc);
  encoding.writeVarUint8Array(encoder, stateVector);
  return encoding.toUint8Array(encoder);
}

/**
 * Create a SyncStep2 message (diff response)
 * Server sends this in response to SyncStep1 with the diff.
 */
export function createSyncStep2Message(
  doc: Y.Doc,
  clientStateVector: Uint8Array
): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MessageType.Sync);
  encoding.writeVarUint(encoder, SyncMessageType.SyncStep2);
  const update = Y.encodeStateAsUpdate(doc, clientStateVector);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

/**
 * Create an Update message for broadcasting changes
 */
export function createUpdateMessage(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MessageType.Sync);
  encoding.writeVarUint(encoder, SyncMessageType.Update);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

/**
 * Handle an incoming sync message
 * Returns a response to send back and optionally a message to broadcast.
 */
export function handleSyncMessage(
  doc: Y.Doc,
  message: Uint8Array
): SyncResult {
  const decoder = decoding.createDecoder(message);
  const messageType = decoding.readVarUint(decoder);

  if (messageType !== MessageType.Sync) {
    // Not a sync message - ignore for now
    return { response: null, broadcast: null, dirty: false };
  }

  const syncMessageType = decoding.readVarUint(decoder);

  switch (syncMessageType) {
    case SyncMessageType.SyncStep1: {
      // Client sent state vector, respond with diff
      const clientStateVector = decoding.readVarUint8Array(decoder);
      const response = createSyncStep2Message(doc, clientStateVector);

      // Also send our state vector back so client can send us what we're missing
      const ourStateVector = Y.encodeStateVector(doc);
      const step1Response = encoding.createEncoder();
      encoding.writeVarUint(step1Response, MessageType.Sync);
      encoding.writeVarUint(step1Response, SyncMessageType.SyncStep1);
      encoding.writeVarUint8Array(step1Response, ourStateVector);

      // Combine: send step2 (diff) + step1 (our state vector)
      // Actually, standard Y.js flow: just send step2
      return { response, broadcast: null, dirty: false };
    }

    case SyncMessageType.SyncStep2: {
      // Server/peer sent diff in response to our SyncStep1
      const update = decoding.readVarUint8Array(decoder);
      Y.applyUpdate(doc, update);
      return { response: null, broadcast: null, dirty: true };
    }

    case SyncMessageType.Update: {
      // Incremental update from a peer
      const update = decoding.readVarUint8Array(decoder);
      Y.applyUpdate(doc, update);

      // Broadcast this update to other clients
      const broadcast = createUpdateMessage(update);
      return { response: null, broadcast, dirty: true };
    }

    default:
      return { response: null, broadcast: null, dirty: false };
  }
}

/**
 * Apply a raw Y.js update to a document
 */
export function applyUpdate(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update);
}

/**
 * Encode the full document state as an update (for persistence)
 */
export function encodeDocumentState(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/**
 * Create a new Y.Doc and optionally initialize with existing state
 */
export function createDoc(existingState?: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  if (existingState && existingState.length > 0) {
    Y.applyUpdate(doc, existingState);
  }
  return doc;
}

/**
 * Get the size of the document state in bytes
 */
export function getDocumentSize(doc: Y.Doc): number {
  return Y.encodeStateAsUpdate(doc).length;
}
