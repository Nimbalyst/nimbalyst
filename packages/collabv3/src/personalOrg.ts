import type { Env } from './types';
import { teamRoomGet } from './teamRoomHelpers';
import { createLogger } from './logger';

const log = createLogger('org-type');

export const NIMBALYST_ORG_TYPE_KEY = 'nimbalyst_org_type';
export type NimbalystOrgType = 'personal' | 'team';

type TrustedMetadata = Record<string, unknown>;

export interface DiscoveredOrganizationLike {
  organization?: {
    organization_id?: string;
    trusted_metadata?: TrustedMetadata | null;
  };
  membership?: {
    type?: string;
  };
}

function getStytchApiBase(env: Env): string {
  const isTest = env.STYTCH_PROJECT_ID?.startsWith('project-test-');
  return isTest ? 'https://test.stytch.com/v1/b2b' : 'https://api.stytch.com/v1/b2b';
}

function getStytchAuth(env: Env): string {
  return `Basic ${btoa(`${env.STYTCH_PROJECT_ID}:${env.STYTCH_SECRET_KEY}`)}`;
}

export function getExplicitOrgType(trustedMetadata: unknown): NimbalystOrgType | null {
  if (!trustedMetadata || typeof trustedMetadata !== 'object') {
    return null;
  }

  const orgType = (trustedMetadata as TrustedMetadata)[NIMBALYST_ORG_TYPE_KEY];
  return orgType === 'personal' || orgType === 'team' ? orgType : null;
}

async function updateOrgTypeMetadata(orgId: string, orgType: NimbalystOrgType, env: Env): Promise<void> {
  const response = await fetch(`${getStytchApiBase(env)}/organizations/${orgId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': getStytchAuth(env),
    },
    body: JSON.stringify({
      trusted_metadata: {
        [NIMBALYST_ORG_TYPE_KEY]: orgType,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText || `HTTP ${response.status}`);
  }
}

export async function resolveDiscoveredOrgType(
  discoveredOrg: DiscoveredOrganizationLike,
  env: Env
): Promise<NimbalystOrgType> {
  const orgId = discoveredOrg.organization?.organization_id;
  const explicitType = getExplicitOrgType(discoveredOrg.organization?.trusted_metadata);

  // TeamRoom presence is the definitive signal for team orgs.
  // Always check it, even if explicit metadata exists -- the previous deploy
  // could have incorrectly tagged a team org as 'personal' due to a transient
  // TeamRoom check failure. TeamRoom presence overrides stale metadata.
  if (orgId) {
    let hasTeamRoom = false;
    try {
      hasTeamRoom = (await teamRoomGet(orgId, 'get-metadata', env)).ok;
    } catch (error) {
      log.warn('TeamRoom check failed for org:', orgId, error);
    }

    if (hasTeamRoom) {
      // Backfill or correct metadata to 'team'
      if (explicitType !== 'team') {
        try {
          await updateOrgTypeMetadata(orgId, 'team', env);
          log.info('Backfilled org type: team for org:', orgId, explicitType ? `(was ${explicitType})` : '(no prior metadata)');
        } catch (error) {
          log.warn('Failed to backfill team metadata for org:', orgId, error);
        }
      }
      return 'team';
    }
  }

  // No TeamRoom -- use explicit metadata if available, otherwise assume personal.
  // Don't backfill 'personal' to Stytch -- absence of TeamRoom is not definitive
  // (could be transient failure), and incorrect 'personal' tags are destructive.
  return explicitType ?? 'personal';
}

export function selectPreferredPersonalOrg<T extends DiscoveredOrganizationLike & { orgType: NimbalystOrgType }>(
  discoveredOrgs: T[]
): T | null {
  return (
    discoveredOrgs.find((org) => org.orgType === 'personal' && org.membership?.type === 'active_member') ||
    discoveredOrgs.find((org) => org.orgType === 'personal') ||
    discoveredOrgs.find((org) => org.membership?.type === 'active_member') ||
    discoveredOrgs[0] ||
    null
  );
}
