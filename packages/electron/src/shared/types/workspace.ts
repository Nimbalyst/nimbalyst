/**
 * Shared workspace and onboarding types.
 * These types are used by both main and renderer processes.
 */

export interface OnboardingConfig {
  version: string;
  onboardingCompleted: boolean;
  plansLocation: 'nimbalyst-local/plans' | 'plans' | string;
  checkInPlans: boolean;
  commandsLocation: 'project' | 'global'; // .claude/ vs ~/.claude/
  claudeCodeIntegration: {
    enabled: boolean;
    planCommandInstalled: boolean;
    trackCommandInstalled: boolean;
    claudeMdConfigured: boolean;
  };
  features: {
    analytics: boolean;
    tracking: boolean;
  };
}

export const DEFAULT_ONBOARDING_CONFIG: OnboardingConfig = {
  version: '1.0.0',
  onboardingCompleted: false,
  plansLocation: 'nimbalyst-local/plans',
  checkInPlans: false,
  commandsLocation: 'project',
  claudeCodeIntegration: {
    enabled: false,
    planCommandInstalled: false,
    trackCommandInstalled: false,
    claudeMdConfigured: false,
  },
  features: {
    analytics: false,
    tracking: true,
  },
};
