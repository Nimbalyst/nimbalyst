import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../../../database/initialize', () => ({
  getDatabase: () => ({
    query: mockQuery,
  }),
}));

vi.mock('../../../services/TrackerIdentityService', () => ({
  getCurrentIdentity: vi.fn(() => ({ displayName: 'Test User' })),
}));

vi.mock('../../../services/TrackerPolicyService', () => ({
  getEffectiveTrackerSyncPolicy: vi.fn(() => ({ mode: 'local', scope: 'project' })),
  getInitialTrackerSyncStatus: vi.fn(() => 'local'),
  shouldSyncTrackerPolicy: vi.fn(() => false),
}));

vi.mock('../../../services/TrackerSyncManager', () => ({
  isTrackerSyncActive: vi.fn(() => false),
  syncTrackerItem: vi.fn(),
}));

import { handleTrackerGet } from '../trackerToolHandlers';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bug_internal',
    issue_key: 'NIM-1',
    issue_number: 1,
    type: 'bug',
    type_tags: ['bug'],
    data: JSON.stringify({
      title: 'Scoped bug',
      status: 'to-do',
      priority: 'high',
    }),
    updated: '2026-04-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('handleTrackerGet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scopes issue key lookups to the active workspace', async () => {
    mockQuery.mockResolvedValue({
      rows: [makeRow({ workspace: '/tmp/workspace-a' })],
    });

    const result = await handleTrackerGet({ id: 'NIM-1' }, '/tmp/workspace-a');

    expect(result.isError).toBe(false);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('WHERE (id = $1 OR issue_key = $1) AND workspace = $2'),
      ['NIM-1', '/tmp/workspace-a'],
    );
  });
});
