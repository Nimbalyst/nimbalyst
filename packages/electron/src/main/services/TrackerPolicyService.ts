import {
  globalRegistry,
  type TrackerSyncMode,
  type TrackerSyncPolicy,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/models/TrackerDataModel';
import { getWorkspaceState } from '../utils/store';

export type StoredTrackerSyncPolicy =
  | TrackerSyncMode
  | Partial<TrackerSyncPolicy>
  | undefined;

function normalizeTrackerSyncMode(mode: unknown, fallback: TrackerSyncMode): TrackerSyncMode {
  return mode === 'local' || mode === 'shared' || mode === 'hybrid' ? mode : fallback;
}

function normalizeTrackerSyncScope(scope: unknown, fallback: TrackerSyncPolicy['scope']): TrackerSyncPolicy['scope'] {
  return scope === 'workspace' || scope === 'project' ? scope : fallback;
}

export function getEffectiveTrackerSyncPolicy(
  workspacePath: string,
  trackerType: string,
): TrackerSyncPolicy {
  const modelPolicy = globalRegistry.get(trackerType)?.sync;
  const fallback: TrackerSyncPolicy = {
    mode: modelPolicy?.mode ?? 'local',
    scope: modelPolicy?.scope ?? 'project',
  };

  const workspaceState = getWorkspaceState(workspacePath) as {
    trackerSyncPolicies?: Record<string, StoredTrackerSyncPolicy>;
  };
  const storedPolicy = workspaceState?.trackerSyncPolicies?.[trackerType];

  if (typeof storedPolicy === 'string') {
    return {
      mode: normalizeTrackerSyncMode(storedPolicy, fallback.mode),
      scope: fallback.scope,
    };
  }

  if (storedPolicy && typeof storedPolicy === 'object') {
    return {
      mode: normalizeTrackerSyncMode(storedPolicy.mode, fallback.mode),
      scope: normalizeTrackerSyncScope(storedPolicy.scope, fallback.scope),
    };
  }

  return fallback;
}

export function shouldSyncTrackerPolicy(policy: TrackerSyncPolicy): boolean {
  return policy.mode === 'shared' || policy.mode === 'hybrid';
}

export function getInitialTrackerSyncStatus(policy: TrackerSyncPolicy): 'local' | 'pending' {
  return shouldSyncTrackerPolicy(policy) ? 'pending' : 'local';
}
