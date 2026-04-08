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

/**
 * Determine the effective sync policy for a tracker type.
 *
 * Priority chain:
 * 1. Workspace-level override (stored in workspace state)
 * 2. Model registry (if loaded -- renderer always has it, main process may not)
 * 3. Caller-provided syncMode (from the renderer, which always has the model)
 * 4. Default: 'local'
 */
export function getEffectiveTrackerSyncPolicy(
  workspacePath: string,
  trackerType: string,
  callerSyncMode?: string,
): TrackerSyncPolicy {
  const modelPolicy = globalRegistry.get(trackerType)?.sync;
  const fallback: TrackerSyncPolicy = {
    mode: normalizeTrackerSyncMode(modelPolicy?.mode ?? callerSyncMode, 'local'),
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
