import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetWorkspaceState, mockGlobalRegistryGet } = vi.hoisted(() => ({
  mockGetWorkspaceState: vi.fn((..._args: any[]) => ({})),
  mockGlobalRegistryGet: vi.fn((..._args: any[]) => undefined as any),
}));

vi.mock('../../utils/store', () => ({
  getWorkspaceState: mockGetWorkspaceState,
}));

vi.mock('@nimbalyst/runtime/plugins/TrackerPlugin/models/TrackerDataModel', () => ({
  globalRegistry: {
    get: mockGlobalRegistryGet,
  },
}));

import {
  getEffectiveTrackerSyncPolicy,
  getInitialTrackerSyncStatus,
} from '../TrackerPolicyService';

describe('TrackerPolicyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWorkspaceState.mockReturnValue({});
    mockGlobalRegistryGet.mockReturnValue(undefined);
  });

  it('falls back to the model policy when no workspace override exists', () => {
    mockGlobalRegistryGet.mockReturnValue({
      sync: { mode: 'shared', scope: 'workspace' },
    });

    expect(getEffectiveTrackerSyncPolicy('/tmp/ws', 'bug')).toEqual({
      mode: 'shared',
      scope: 'workspace',
    });
  });

  it('applies a string workspace override while preserving default scope', () => {
    mockGlobalRegistryGet.mockReturnValue({
      sync: { mode: 'shared', scope: 'project' },
    });
    mockGetWorkspaceState.mockReturnValue({
      trackerSyncPolicies: {
        bug: 'local',
      },
    });

    expect(getEffectiveTrackerSyncPolicy('/tmp/ws', 'bug')).toEqual({
      mode: 'local',
      scope: 'project',
    });
  });

  it('applies an object workspace override for mode and scope', () => {
    mockGlobalRegistryGet.mockReturnValue({
      sync: { mode: 'local', scope: 'project' },
    });
    mockGetWorkspaceState.mockReturnValue({
      trackerSyncPolicies: {
        bug: { mode: 'shared', scope: 'workspace' },
      },
    });

    expect(getEffectiveTrackerSyncPolicy('/tmp/ws', 'bug')).toEqual({
      mode: 'shared',
      scope: 'workspace',
    });
  });

  it('maps local policy to local sync status and shared policy to pending', () => {
    expect(getInitialTrackerSyncStatus({ mode: 'local', scope: 'project' })).toBe('local');
    expect(getInitialTrackerSyncStatus({ mode: 'shared', scope: 'project' })).toBe('pending');
    expect(getInitialTrackerSyncStatus({ mode: 'hybrid', scope: 'workspace' })).toBe('pending');
  });
});
