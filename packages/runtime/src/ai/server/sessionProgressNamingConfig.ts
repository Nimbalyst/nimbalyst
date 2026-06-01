export interface SessionProgressNamingConfig {
  enabled: boolean;
  cadenceTurns: number;
}

export const DEFAULT_SESSION_PROGRESS_NAMING_CONFIG: SessionProgressNamingConfig = {
  enabled: false,
  cadenceTurns: 10,
};

let sessionProgressNamingConfig: SessionProgressNamingConfig = DEFAULT_SESSION_PROGRESS_NAMING_CONFIG;

export function normalizeSessionProgressNamingConfig(
  input: Partial<SessionProgressNamingConfig> | null | undefined
): SessionProgressNamingConfig {
  const rawCadence = Number(input?.cadenceTurns);
  const cadenceTurns = Number.isFinite(rawCadence)
    ? Math.max(1, Math.min(50, Math.round(rawCadence)))
    : DEFAULT_SESSION_PROGRESS_NAMING_CONFIG.cadenceTurns;

  return {
    enabled: input?.enabled === true,
    cadenceTurns,
  };
}

export function setSessionProgressNamingConfig(
  input: Partial<SessionProgressNamingConfig> | null | undefined
): void {
  sessionProgressNamingConfig = normalizeSessionProgressNamingConfig(input);
}

export function getSessionProgressNamingConfig(): SessionProgressNamingConfig {
  return sessionProgressNamingConfig;
}
