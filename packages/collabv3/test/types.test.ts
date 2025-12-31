/**
 * Type and protocol tests for CollabV3
 */

import { describe, it, expect } from 'vitest';
import type {
  ClientMessage,
  ServerMessage,
  EncryptedMessage,
  SessionIndexEntry,
  SessionRoomId,
  IndexRoomId,
} from '../src/types';

describe('Room ID formats', () => {
  it('should match SessionRoomId pattern', () => {
    const validIds: SessionRoomId[] = [
      'user:abc123:session:sess456',
      'user:user-with-dashes:session:session-id',
    ];

    for (const id of validIds) {
      expect(id).toMatch(/^user:[^:]+:session:[^:]+$/);
    }
  });

  it('should match IndexRoomId pattern', () => {
    const validIds: IndexRoomId[] = [
      'user:abc123:index',
      'user:user-with-dashes:index',
    ];

    for (const id of validIds) {
      expect(id).toMatch(/^user:[^:]+:index$/);
    }
  });
});

describe('Message protocol', () => {
  it('should create valid sync_request message', () => {
    const msg: ClientMessage = {
      type: 'sync_request',
      since_seq: 42,
    };

    expect(msg.type).toBe('sync_request');
    expect(JSON.stringify(msg)).toBeTruthy();
  });

  it('should create valid append_message message', () => {
    const encryptedMessage: EncryptedMessage = {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      sequence: 1,
      created_at: Date.now(),
      source: 'user',
      direction: 'input',
      encrypted_content: 'base64encodedcontent==',
      iv: 'base64encodediv==',
      metadata: {},
    };

    const msg: ClientMessage = {
      type: 'append_message',
      message: encryptedMessage,
    };

    expect(msg.type).toBe('append_message');
    expect(msg.message.source).toBe('user');
  });

  it('should create valid sync_response message', () => {
    const msg: ServerMessage = {
      type: 'sync_response',
      messages: [],
      metadata: {
        title: 'Test Session',
        provider: 'claude',
        encrypted_project_id: 'base64-encrypted-project-id',
        project_id_iv: 'base64-iv',
        created_at: Date.now(),
        updated_at: Date.now(),
      },
      has_more: false,
      cursor: null,
    };

    expect(msg.type).toBe('sync_response');
    if (msg.type === 'sync_response') {
      expect(msg.metadata?.title).toBe('Test Session');
    }
  });

  it('should create valid index_sync_response message', () => {
    const session: SessionIndexEntry = {
      session_id: 'sess-123',
      encrypted_project_id: 'base64-encrypted-project-id',
      project_id_iv: 'base64-iv',
      encrypted_title: 'base64-encrypted-title',
      title_iv: 'base64-iv',
      provider: 'claude',
      message_count: 10,
      last_message_at: Date.now(),
      created_at: Date.now() - 86400000,
      updated_at: Date.now(),
    };

    const msg: ServerMessage = {
      type: 'index_sync_response',
      sessions: [session],
      projects: [
        {
          encrypted_project_id: 'base64-encrypted-project-id',
          project_id_iv: 'base64-iv',
          encrypted_name: 'base64-encrypted-name',
          name_iv: 'base64-iv',
          session_count: 1,
          last_activity_at: Date.now(),
          sync_enabled: true,
        },
      ],
    };

    expect(msg.type).toBe('index_sync_response');
    if (msg.type === 'index_sync_response') {
      expect(msg.sessions).toHaveLength(1);
      expect(msg.projects).toHaveLength(1);
    }
  });
});

describe('Encrypted message format', () => {
  it('should have required fields', () => {
    const msg: EncryptedMessage = {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      sequence: 1,
      created_at: 1234567890123,
      source: 'assistant',
      direction: 'output',
      encrypted_content: 'SGVsbG8gV29ybGQ=',
      iv: 'MTIzNDU2Nzg5MDEyMzQ1Ng==',
      metadata: {},
    };

    expect(msg.id).toBeTruthy();
    expect(msg.sequence).toBeGreaterThan(0);
    expect(msg.encrypted_content).toBeTruthy();
    expect(msg.iv).toBeTruthy();
    expect(['user', 'assistant', 'tool', 'system']).toContain(msg.source);
    expect(['input', 'output']).toContain(msg.direction);
  });

  it('should have empty metadata (all sensitive data is encrypted)', () => {
    const msg: EncryptedMessage = {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      sequence: 1,
      created_at: Date.now(),
      source: 'tool',
      direction: 'output',
      encrypted_content: 'encrypted',
      iv: 'iv',
      metadata: {},
    };

    expect(msg.metadata).toEqual({});
  });
});
