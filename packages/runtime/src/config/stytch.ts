/**
 * Stytch Configuration
 *
 * These are PUBLIC tokens - safe to commit to git.
 * They are designed to be embedded in client-side code.
 *
 * DO NOT put the secret key here - it should only exist on the server (collabv3).
 */

export const STYTCH_CONFIG = {
  // Test environment (for development)
  test: {
    projectId: 'project-test-57c2ed3f-9858-4f0e-acd1-508b56501ceb',
    publicToken: 'public-token-test-fa780430-5784-4819-b400-f7202872b072',
    apiBase: 'https://test.stytch.com/v1',
  },
  // Live environment (for production)
  live: {
    projectId: 'project-live-bc85edd6-90a8-43a0-b9e3-1315bbed6650',
    publicToken: 'public-token-live-28108ebb-471e-4366-89fe-77d0e0d4a270',
    apiBase: 'https://api.stytch.com/v1',
  },
};

/**
 * Get the Stytch config for the current environment.
 * Uses test environment in development, live in production.
 */
export function getStytchConfig() {
  const isProduction = process.env.NODE_ENV === 'production';

  // Allow override via environment variable
  if (process.env.STYTCH_PROJECT_ID && process.env.STYTCH_PUBLIC_TOKEN) {
    // Determine API base from project ID (test projects start with 'project-test-')
    const isTestProject = process.env.STYTCH_PROJECT_ID.startsWith('project-test-');
    return {
      projectId: process.env.STYTCH_PROJECT_ID,
      publicToken: process.env.STYTCH_PUBLIC_TOKEN,
      apiBase: isTestProject ? 'https://test.stytch.com/v1' : 'https://api.stytch.com/v1',
    };
  }

  return isProduction ? STYTCH_CONFIG.live : STYTCH_CONFIG.test;
}
