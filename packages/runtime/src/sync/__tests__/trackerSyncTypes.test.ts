/**
 * Unit tests for tracker sync pure functions:
 * - trackerItemToPayload (TrackerItem -> wire format)
 * - payloadToTrackerItem (wire format -> TrackerItem)
 * - mergeTrackerItems (field-level LWW conflict resolution)
 *
 * These are the core data transformation and merge functions that the entire
 * tracker sync system depends on. They're pure functions with no dependencies.
 */

import { describe, it, expect } from 'vitest';
import { trackerItemToPayload, payloadToTrackerItem } from '../trackerSyncTypes';
import { mergeTrackerItems } from '../TrackerSync';
import type { TrackerItemPayload } from '../trackerSyncTypes';
import type { TrackerItem } from '../../core/DocumentService';

// ============================================================================
// Test Helpers
// ============================================================================

function makeTrackerItem(overrides: Partial<TrackerItem> & { id: string }): TrackerItem {
  return {
    type: 'bug',
    title: 'Test bug',
    status: 'to-do',
    priority: 'medium',
    module: 'nimbalyst-local/tracker/bugs/test.md',
    workspace: '/Users/test/project',
    lastIndexed: new Date('2026-01-01'),
    ...overrides,
  };
}

function makePayload(overrides: Partial<TrackerItemPayload> & { itemId: string }): TrackerItemPayload {
  return {
    type: 'bug',
    title: 'Test bug',
    status: 'to-do',
    priority: 'medium',
    labels: [],
    linkedSessions: [],
    comments: [],
    customFields: {},
    fieldUpdatedAt: {},
    ...overrides,
  };
}

// ============================================================================
// trackerItemToPayload
// ============================================================================

describe('trackerItemToPayload', () => {
  it('should convert basic fields correctly', () => {
    const item = makeTrackerItem({
      id: 'bug-001',
      type: 'bug',
      title: 'Login broken',
      description: 'Cannot log in with valid credentials',
      status: 'to-do',
      priority: 'high',
    });

    const payload = trackerItemToPayload(item, 'user-123');

    expect(payload.itemId).toBe('bug-001');
    expect(payload.type).toBe('bug');
    expect(payload.title).toBe('Login broken');
    expect(payload.description).toBe('Cannot log in with valid credentials');
    expect(payload.status).toBe('to-do');
    expect(payload.priority).toBe('high');
  });

  it('should set reporterId to the provided userId when not set on item', () => {
    const item = makeTrackerItem({ id: 'bug-002' });
    const payload = trackerItemToPayload(item, 'user-456');
    expect(payload.reporterId).toBe('user-456');
  });

  it('should preserve existing reporterId from item', () => {
    const item = makeTrackerItem({
      id: 'bug-003',
      reporterId: 'original-reporter',
    });
    const payload = trackerItemToPayload(item, 'user-456');
    expect(payload.reporterId).toBe('original-reporter');
  });

  it('should default priority to medium when not set', () => {
    const item = makeTrackerItem({ id: 'bug-004', priority: undefined });
    const payload = trackerItemToPayload(item, 'user-123');
    expect(payload.priority).toBe('medium');
  });

  it('should handle empty arrays for labels, linkedSessions', () => {
    const item = makeTrackerItem({ id: 'bug-005' });
    const payload = trackerItemToPayload(item, 'user-123');
    expect(payload.labels).toEqual([]);
    expect(payload.linkedSessions).toEqual([]);
    expect(payload.comments).toEqual([]);
  });

  it('should preserve collaborative fields', () => {
    const item = makeTrackerItem({
      id: 'bug-006',
      assigneeId: 'assignee-1',
      labels: ['critical', 'auth'],
      linkedSessions: ['session-1', 'session-2'],
      linkedCommitSha: 'abc123',
      documentId: 'doc-1',
    });

    const payload = trackerItemToPayload(item, 'user-123');

    expect(payload.assigneeId).toBe('assignee-1');
    expect(payload.labels).toEqual(['critical', 'auth']);
    expect(payload.linkedSessions).toEqual(['session-1', 'session-2']);
    expect(payload.linkedCommitSha).toBe('abc123');
    expect(payload.documentId).toBe('doc-1');
  });

  it('should set fieldUpdatedAt timestamps for all mergeable fields', () => {
    const before = Date.now();
    const item = makeTrackerItem({ id: 'bug-007' });
    const payload = trackerItemToPayload(item, 'user-123');
    const after = Date.now();

    const expectedFields = [
      'title', 'status', 'priority', 'description',
      'assigneeEmail', 'reporterEmail', 'authorIdentity', 'lastModifiedBy',
      'assigneeId', 'reporterId', 'labels', 'linkedSessions',
      'linkedCommitSha', 'documentId', 'archived', 'comments', 'customFields',
    ];

    for (const field of expectedFields) {
      expect(payload.fieldUpdatedAt[field]).toBeGreaterThanOrEqual(before);
      expect(payload.fieldUpdatedAt[field]).toBeLessThanOrEqual(after);
    }
  });

  it('should handle archived items', () => {
    const item = makeTrackerItem({
      id: 'bug-008',
      archived: true,
      archivedAt: '2026-03-01T00:00:00Z',
    });

    const payload = trackerItemToPayload(item, 'user-123');
    expect(payload.archived).toBe(true);
    expect(payload.archivedAt).toBe('2026-03-01T00:00:00Z');
  });

  it('should default archived to false when not set', () => {
    const item = makeTrackerItem({ id: 'bug-009' });
    const payload = trackerItemToPayload(item, 'user-123');
    expect(payload.archived).toBe(false);
  });

  it('should pass through customFields', () => {
    const item = makeTrackerItem({
      id: 'bug-010',
      customFields: { severity: 'P0', affectedUsers: 1500 },
    });

    const payload = trackerItemToPayload(item, 'user-123');
    expect(payload.customFields).toEqual({ severity: 'P0', affectedUsers: 1500 });
  });
});

// ============================================================================
// payloadToTrackerItem
// ============================================================================

describe('payloadToTrackerItem', () => {
  it('should convert basic fields correctly', () => {
    const payload = makePayload({
      itemId: 'bug-101',
      type: 'task',
      title: 'Refactor auth',
      description: 'Split into separate module',
      status: 'in-progress',
      priority: 'high',
    });

    const item = payloadToTrackerItem(payload, '/workspace/project');

    expect(item.id).toBe('bug-101');
    expect(item.type).toBe('task');
    expect(item.title).toBe('Refactor auth');
    expect(item.description).toBe('Split into separate module');
    expect(item.status).toBe('in-progress');
    expect(item.priority).toBe('high');
    expect(item.workspace).toBe('/workspace/project');
  });

  it('should set syncStatus to synced', () => {
    const payload = makePayload({ itemId: 'bug-102' });
    const item = payloadToTrackerItem(payload, '/workspace');
    expect(item.syncStatus).toBe('synced');
  });

  it('should set module to empty string (synced items have no source file)', () => {
    const payload = makePayload({ itemId: 'bug-103' });
    const item = payloadToTrackerItem(payload, '/workspace');
    expect(item.module).toBe('');
  });

  it('should map assigneeId to owner', () => {
    const payload = makePayload({
      itemId: 'bug-104',
      assigneeId: 'member-1',
    });
    const item = payloadToTrackerItem(payload, '/workspace');
    expect(item.owner).toBe('member-1');
    expect(item.assigneeId).toBe('member-1');
  });

  it('should preserve collaborative fields', () => {
    const payload = makePayload({
      itemId: 'bug-105',
      reporterId: 'reporter-1',
      labels: ['ui', 'regression'],
      linkedSessions: ['sess-1'],
      linkedCommitSha: 'def456',
      documentId: 'doc-2',
    });

    const item = payloadToTrackerItem(payload, '/workspace');

    expect(item.reporterId).toBe('reporter-1');
    expect(item.labels).toEqual(['ui', 'regression']);
    expect(item.linkedSessions).toEqual(['sess-1']);
    expect(item.linkedCommitSha).toBe('def456');
    expect(item.documentId).toBe('doc-2');
  });

  it('should handle archived items', () => {
    const payload = makePayload({
      itemId: 'bug-106',
      archived: true,
      archivedAt: '2026-02-15T12:00:00Z',
    });

    const item = payloadToTrackerItem(payload, '/workspace');
    expect(item.archived).toBe(true);
    expect(item.archivedAt).toBe('2026-02-15T12:00:00Z');
  });

  it('should default archived to false', () => {
    const payload = makePayload({ itemId: 'bug-107' });
    const item = payloadToTrackerItem(payload, '/workspace');
    expect(item.archived).toBe(false);
  });

  it('should set lastIndexed to current time', () => {
    const before = new Date();
    const payload = makePayload({ itemId: 'bug-108' });
    const item = payloadToTrackerItem(payload, '/workspace');
    const after = new Date();

    expect(item.lastIndexed.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(item.lastIndexed.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

// ============================================================================
// Round-trip: TrackerItem -> Payload -> TrackerItem
// ============================================================================

describe('payload round-trip', () => {
  it('should preserve data through a full round-trip', () => {
    const original = makeTrackerItem({
      id: 'round-trip-1',
      type: 'bug',
      title: 'Round trip test',
      description: 'Testing full round trip',
      status: 'in-progress',
      priority: 'critical',
      assigneeId: 'dev-1',
      labels: ['sync', 'test'],
      linkedSessions: ['session-abc'],
      linkedCommitSha: 'abc123def',
      documentId: 'doc-xyz',
      customFields: { browser: 'Chrome', os: 'macOS' },
      archived: false,
    });

    const payload = trackerItemToPayload(original, 'user-999');
    const roundTripped = payloadToTrackerItem(payload, original.workspace);

    expect(roundTripped.id).toBe(original.id);
    expect(roundTripped.type).toBe(original.type);
    expect(roundTripped.title).toBe(original.title);
    expect(roundTripped.description).toBe(original.description);
    expect(roundTripped.status).toBe(original.status);
    expect(roundTripped.priority).toBe(original.priority);
    expect(roundTripped.assigneeId).toBe(original.assigneeId);
    expect(roundTripped.labels).toEqual(original.labels);
    expect(roundTripped.linkedSessions).toEqual(original.linkedSessions);
    expect(roundTripped.linkedCommitSha).toBe(original.linkedCommitSha);
    expect(roundTripped.documentId).toBe(original.documentId);
    expect(roundTripped.customFields).toEqual(original.customFields);
    expect(roundTripped.workspace).toBe(original.workspace);
    expect(roundTripped.syncStatus).toBe('synced');
  });

  it('should handle items with minimal fields', () => {
    const minimal = makeTrackerItem({
      id: 'minimal-1',
      title: 'Minimal item',
    });

    const payload = trackerItemToPayload(minimal, 'user-1');
    const result = payloadToTrackerItem(payload, minimal.workspace);

    expect(result.id).toBe('minimal-1');
    expect(result.title).toBe('Minimal item');
    expect(result.labels).toEqual([]);
    expect(result.linkedSessions).toEqual([]);
  });
});

// ============================================================================
// mergeTrackerItems (field-level LWW)
// ============================================================================

describe('mergeTrackerItems', () => {
  it('should take remote field when remote timestamp is newer', () => {
    const now = Date.now();

    const local = makePayload({
      itemId: 'merge-1',
      title: 'Old title',
      fieldUpdatedAt: { title: now - 1000 },
    });

    const remote = makePayload({
      itemId: 'merge-1',
      title: 'New title',
      fieldUpdatedAt: { title: now },
    });

    const merged = mergeTrackerItems(local, remote);
    expect(merged.title).toBe('New title');
    expect(merged.fieldUpdatedAt.title).toBe(now);
  });

  it('should keep local field when local timestamp is newer', () => {
    const now = Date.now();

    const local = makePayload({
      itemId: 'merge-2',
      status: 'done',
      fieldUpdatedAt: { status: now },
    });

    const remote = makePayload({
      itemId: 'merge-2',
      status: 'to-do',
      fieldUpdatedAt: { status: now - 1000 },
    });

    const merged = mergeTrackerItems(local, remote);
    expect(merged.status).toBe('done');
  });

  it('should keep local field when timestamps are equal (local wins ties)', () => {
    const now = Date.now();

    const local = makePayload({
      itemId: 'merge-3',
      title: 'Local version',
      fieldUpdatedAt: { title: now },
    });

    const remote = makePayload({
      itemId: 'merge-3',
      title: 'Remote version',
      fieldUpdatedAt: { title: now },
    });

    const merged = mergeTrackerItems(local, remote);
    expect(merged.title).toBe('Local version');
  });

  it('should merge different fields independently', () => {
    const now = Date.now();

    const local = makePayload({
      itemId: 'merge-4',
      title: 'Local title',
      status: 'in-progress',
      priority: 'low',
      description: 'Local desc',
      fieldUpdatedAt: {
        title: now - 100,   // older -> remote wins
        status: now,         // newer -> local wins
        priority: now - 200, // older -> remote wins
        description: now,    // newer -> local wins
      },
    });

    const remote = makePayload({
      itemId: 'merge-4',
      title: 'Remote title',
      status: 'done',
      priority: 'critical',
      description: 'Remote desc',
      fieldUpdatedAt: {
        title: now,          // newer -> wins
        status: now - 500,   // older
        priority: now,       // newer -> wins
        description: now - 1000, // older
      },
    });

    const merged = mergeTrackerItems(local, remote);

    expect(merged.title).toBe('Remote title');       // remote won
    expect(merged.status).toBe('in-progress');        // local won
    expect(merged.priority).toBe('critical');         // remote won
    expect(merged.description).toBe('Local desc');    // local won
  });

  it('should handle missing fieldUpdatedAt entries (default to 0)', () => {
    const now = Date.now();

    const local = makePayload({
      itemId: 'merge-5',
      title: 'Local',
      fieldUpdatedAt: {}, // no timestamps
    });

    const remote = makePayload({
      itemId: 'merge-5',
      title: 'Remote',
      fieldUpdatedAt: { title: now }, // has timestamp
    });

    const merged = mergeTrackerItems(local, remote);
    // Remote wins because local timestamp defaults to 0
    expect(merged.title).toBe('Remote');
  });

  it('should merge array fields (labels) using whole-array LWW', () => {
    const now = Date.now();

    const local = makePayload({
      itemId: 'merge-6',
      labels: ['old-label'],
      fieldUpdatedAt: { labels: now - 1000 },
    });

    const remote = makePayload({
      itemId: 'merge-6',
      labels: ['new-label-1', 'new-label-2'],
      fieldUpdatedAt: { labels: now },
    });

    const merged = mergeTrackerItems(local, remote);
    // Remote array replaces local entirely (not element-level merge)
    expect(merged.labels).toEqual(['new-label-1', 'new-label-2']);
  });

  it('should merge archived state', () => {
    const now = Date.now();

    const local = makePayload({
      itemId: 'merge-7',
      archived: false,
      fieldUpdatedAt: { archived: now - 500 },
    });

    const remote = makePayload({
      itemId: 'merge-7',
      archived: true,
      archivedAt: '2026-03-15T00:00:00Z',
      fieldUpdatedAt: { archived: now },
    });

    const merged = mergeTrackerItems(local, remote);
    expect(merged.archived).toBe(true);
    // Note: archivedAt is not in mergeableFields list, it comes with archived
  });

  it('should preserve non-mergeable fields from local (itemId, type)', () => {
    const local = makePayload({
      itemId: 'merge-8',
      type: 'bug',
      fieldUpdatedAt: {},
    });

    const remote = makePayload({
      itemId: 'merge-8',
      type: 'task', // different type -- should NOT be merged
      fieldUpdatedAt: {},
    });

    const merged = mergeTrackerItems(local, remote);
    // itemId and type are not in mergeableFields, so local's values should persist
    expect(merged.itemId).toBe('merge-8');
    expect(merged.type).toBe('bug');
  });

  it('should handle customFields as a single LWW field', () => {
    const now = Date.now();

    const local = makePayload({
      itemId: 'merge-9',
      customFields: { browser: 'Firefox' },
      fieldUpdatedAt: { customFields: now - 100 },
    });

    const remote = makePayload({
      itemId: 'merge-9',
      customFields: { browser: 'Chrome', os: 'Linux' },
      fieldUpdatedAt: { customFields: now },
    });

    const merged = mergeTrackerItems(local, remote);
    // Entire customFields object replaced by remote
    expect(merged.customFields).toEqual({ browser: 'Chrome', os: 'Linux' });
  });
});
