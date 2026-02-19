/**
 * CollabV3 Worker Entry Point
 *
 * Routes WebSocket connections to appropriate Durable Objects based on room ID.
 * Room ID format: user:{userId}:session:{sessionId} or user:{userId}:index
 *
 * Authentication:
 * - All authentication is done via Stytch session JWTs
 * - JWT 'sub' claim contains the user ID used for room authorization
 */

// Injected at build time by wrangler define
declare const COLLABV3_VERSION: string;

import type { Env } from './types';
import { SessionRoom } from './SessionRoom';
import { IndexRoom } from './IndexRoom';
import { parseAuth as parseAuthJWT, type AuthConfig, type AuthResult } from './auth';
import { handleShareUpload, handleShareView, handleShareContent, handleShareList, handleShareDelete } from './share';
import { handleAccountDeletion } from './accountDeletion';
import { setLogEnvironment, createLogger } from './logger';

const log = createLogger('sync');

// Re-export Durable Object classes
export { SessionRoom, IndexRoom };

// ============================================================================
// CORS Configuration
// ============================================================================

/**
 * Get allowed origins based on environment.
 *
 * Production: Uses ALLOWED_ORIGINS env var or defaults to secure origins
 * Development: Includes localhost and local IP addresses for testing
 */
function getAllowedOrigins(env: Env): string[] {
  // If ALLOWED_ORIGINS is set, use it
  if (env.ALLOWED_ORIGINS) {
    return env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean);
  }

  // Development mode: allow localhost and common local IPs
  if (env.ENVIRONMENT === 'development' || env.ENVIRONMENT === 'local') {
    return [
      'http://localhost:5173',      // Vite dev server
      'http://localhost:5174',      // Vite dev server (alt port)
      'http://localhost:4102',      // Capacitor web dev server
      'http://localhost:8787',      // Wrangler dev server
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
      'http://127.0.0.1:4102',
      'http://127.0.0.1:8787',
      'capacitor://localhost',      // Capacitor iOS/Android
      'http://localhost',           // Generic localhost
      // Common local network IPs (192.168.x.x)
      // These are dynamically checked in getCorsHeaders
    ];
  }

  // Production defaults
  return [
    'https://app.nimbalyst.com',
    'https://nimbalyst.com',
    'capacitor://localhost',
  ];
}

/**
 * Check if origin is allowed.
 * Also allows local network IPs for Capacitor dev testing.
 */
function isOriginAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return false;

  const allowedOrigins = getAllowedOrigins(env);

  // Direct match
  if (allowedOrigins.includes(origin)) {
    return true;
  }

  // Allow local network IPs for Capacitor dev testing (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
  // Only in development/local environments - never in production
  if (env.ENVIRONMENT === 'development' || env.ENVIRONMENT === 'local') {
    try {
      const url = new URL(origin);
      const host = url.hostname;
      if (
        host.startsWith('192.168.') ||
        host.startsWith('10.') ||
        /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)
      ) {
        return true;
      }
    } catch {
      // Invalid URL, not allowed
    }
  }

  return false;
}

/**
 * Get CORS headers for a request.
 * Returns appropriate Access-Control-Allow-Origin based on request origin.
 */
function getCorsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin');

  if (isOriginAllowed(origin, env)) {
    return {
      'Access-Control-Allow-Origin': origin!,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Credentials': 'true',
    };
  }

  // Origin not allowed - return empty CORS headers (browser will block)
  // We still include the methods/headers for preflight, but no Allow-Origin
  return {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// Room ID parsing: org:{orgId}:user:{userId}:{suffix}
interface ParsedRoomId {
  type: 'session' | 'index' | 'projects';
  userId: string;
  orgId: string;
  sessionId?: string;
}

function parseRoomId(roomId: string): ParsedRoomId | null {
  const sessionMatch = roomId.match(/^org:([^:]+):user:([^:]+):session:([^:]+)$/);
  if (sessionMatch) {
    return { type: 'session', orgId: sessionMatch[1], userId: sessionMatch[2], sessionId: sessionMatch[3] };
  }

  const indexMatch = roomId.match(/^org:([^:]+):user:([^:]+):index$/);
  if (indexMatch) {
    return { type: 'index', orgId: indexMatch[1], userId: indexMatch[2] };
  }

  const projectsMatch = roomId.match(/^org:([^:]+):user:([^:]+):projects$/);
  if (projectsMatch) {
    return { type: 'projects', orgId: projectsMatch[1], userId: projectsMatch[2] };
  }

  return null;
}

function getAuthConfig(env: Env): AuthConfig {
  return {
    stytchProjectId: env.STYTCH_PROJECT_ID,
  };
}

// Main fetch handler
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Set log environment once per request (cheap operation)
    setLogEnvironment(env.ENVIRONMENT || 'production');

    const url = new URL(request.url);

    // Health check - returns version for deploy tracking
    if (url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        version: COLLABV3_VERSION,
        environment: env.ENVIRONMENT || 'unknown',
      });
    }

    // WebSocket route: /sync/{roomId}
    if (url.pathname.startsWith('/sync/')) {
      const roomId = url.pathname.slice(6); // Remove '/sync/'

      if (!roomId) {
        return new Response('Missing room ID', { status: 400 });
      }

      const parsed = parseRoomId(roomId);
      if (!parsed) {
        return new Response(`Invalid room ID format: ${roomId}`, { status: 400 });
      }

      // Validate auth matches room user (supports both simple and JWT auth)
      const authConfig = getAuthConfig(env);
      const auth = await parseAuthJWT(request, authConfig);
      log.debug('Auth result:', auth, 'Room userId:', parsed.userId);
      if (!auth || auth.userId !== parsed.userId) {
        log.warn('Auth failed. auth:', auth, 'parsed.userId:', parsed.userId);
        return new Response('Unauthorized', { status: 401 });
      }

      // Validate the org in the room matches the JWT
      if (auth.orgId !== parsed.orgId) {
        log.warn('Org mismatch. Room orgId:', parsed.orgId, 'JWT orgId:', auth.orgId);
        return new Response('Unauthorized: org mismatch', { status: 401 });
      }
      log.debug('Auth passed, forwarding to DO');

      // Route to appropriate DO
      let stub: DurableObjectStub;

      if (parsed.type === 'session' && parsed.sessionId) {
        // Use session ID as DO ID for isolation
        const id = env.SESSION_ROOM.idFromName(roomId);
        stub = env.SESSION_ROOM.get(id);
      } else if (parsed.type === 'index' || parsed.type === 'projects') {
        // Use user ID as DO ID (one index per user)
        const id = env.INDEX_ROOM.idFromName(`user:${parsed.userId}:index`);
        stub = env.INDEX_ROOM.get(id);
      } else {
        return new Response('Invalid room type', { status: 400 });
      }

      // Forward request to DO with user_id and org_id in query params
      const forwardUrl = new URL(request.url);
      forwardUrl.searchParams.set('user_id', auth.userId);
      forwardUrl.searchParams.set('org_id', auth.orgId);
      const forwardRequest = new Request(forwardUrl.toString(), request);
      return stub.fetch(forwardRequest);
    }

    // REST API routes
    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, env, url);
    }

    // Auth routes (OAuth callbacks, etc.)
    if (url.pathname.startsWith('/auth/')) {
      return handleAuthRoutes(request, env, url);
    }

    // Share routes
    if (url.pathname.startsWith('/share')) {
      return handleShareRoutes(request, env, url);
    }

    return new Response('Not Found', { status: 404 });
  },
};


/**
 * Handle REST API requests
 */
async function handleApiRequest(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  // Get CORS headers based on request origin
  const origin = request.headers.get('Origin');
  log.debug('API request to', url.pathname, 'from origin:', origin);
  const corsHeaders = getCorsHeaders(request, env);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Auth endpoints (no auth required)
  if (url.pathname === '/api/auth/magic-link' && request.method === 'POST') {
    return handleMagicLinkRequest(request, env, corsHeaders);
  }

  // All other API routes require authentication
  const authConfig = getAuthConfig(env);
  const auth = await parseAuthJWT(request, authConfig);
  if (!auth) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }

  // GET /api/sessions - List sessions for user
  if (url.pathname === '/api/sessions' && request.method === 'GET') {
    const indexId = env.INDEX_ROOM.idFromName(`user:${auth.userId}:index`);
    const stub = env.INDEX_ROOM.get(indexId);

    // Forward to status endpoint for now (could add dedicated list endpoint)
    return stub.fetch(new Request(`${url.origin}/status`));
  }

  // GET /api/session/{sessionId}/status - Get session status
  if (url.pathname.startsWith('/api/session/') && url.pathname.endsWith('/status')) {
    const sessionId = url.pathname.slice(13, -7); // Extract session ID
    const roomId = `user:${auth.userId}:session:${sessionId}`;
    const id = env.SESSION_ROOM.idFromName(roomId);
    const stub = env.SESSION_ROOM.get(id);

    return stub.fetch(new Request(`${url.origin}/status`));
  }

  // POST /api/bulk-index - Bulk update session index (for initial sync)
  if (url.pathname === '/api/bulk-index' && request.method === 'POST') {
    try {
      const body = await request.json() as { sessions: unknown[] };

      const indexId = env.INDEX_ROOM.idFromName(`user:${auth.userId}:index`);
      const stub = env.INDEX_ROOM.get(indexId);

      // For bulk operations, we need to call the DO method directly
      // This requires forwarding via fetch with special path
      const bulkRequest = new Request(`${url.origin}/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      return stub.fetch(bulkRequest);
    } catch (err) {
      return new Response(`Invalid request body: ${err}`, { status: 400 });
    }
  }

  // POST /api/account/delete - Delete user account and all data
  if (url.pathname === '/api/account/delete' && request.method === 'POST') {
    return handleAccountDeletion(auth, env, corsHeaders);
  }

  return new Response('Not Found', { status: 404, headers: corsHeaders });
}

/**
 * Handle share routes for session sharing.
 * GET /share/{shareId} is public (no auth).
 * POST /share, GET /shares, DELETE /share/{shareId} require auth.
 */
async function handleShareRoutes(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders,
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      },
    });
  }

  // GET /share/{shareId}/content - Public, serve raw encrypted content
  if (url.pathname.match(/^\/share\/[^/]+\/content$/) && request.method === 'GET') {
    const shareId = url.pathname.slice('/share/'.length, url.pathname.lastIndexOf('/'));
    if (shareId) {
      return handleShareContent(shareId, env);
    }
  }

  // GET /share/{shareId} - Public, serve HTML or decryption viewer
  if (url.pathname.startsWith('/share/') && !url.pathname.includes('/content') && request.method === 'GET') {
    const shareId = url.pathname.slice('/share/'.length);
    if (shareId) {
      return handleShareView(shareId, env);
    }
  }

  // POST /share - Upload HTML (authenticated)
  if (url.pathname === '/share' && request.method === 'POST') {
    const authConfig = getAuthConfig(env);
    const auth = await parseAuthJWT(request, authConfig);
    if (!auth) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return handleShareUpload(request, env, auth, corsHeaders);
  }

  // GET /shares - List user's shares (authenticated)
  if (url.pathname === '/shares' && request.method === 'GET') {
    const authConfig = getAuthConfig(env);
    const auth = await parseAuthJWT(request, authConfig);
    if (!auth) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return handleShareList(env, auth, corsHeaders);
  }

  // DELETE /share/{shareId} - Delete share (authenticated)
  if (url.pathname.startsWith('/share/') && request.method === 'DELETE') {
    const shareId = url.pathname.slice('/share/'.length);
    const authConfig = getAuthConfig(env);
    const auth = await parseAuthJWT(request, authConfig);
    if (!auth) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return handleShareDelete(shareId, env, auth, corsHeaders);
  }

  return new Response('Not Found', { status: 404, headers: corsHeaders });
}

/**
 * Handle magic link send request.
 * This uses the Stytch secret key (server-side only) to send magic link emails.
 */
async function handleMagicLinkRequest(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  // Check for required environment variables
  if (!env.STYTCH_PROJECT_ID || !env.STYTCH_SECRET_KEY) {
    return new Response(
      JSON.stringify({ error: 'Stytch not configured on server' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json() as { email: string; redirect_url: string };

    if (!body.email) {
      return new Response(
        JSON.stringify({ error: 'Email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine magic link redirect URL
    let magicLinkUrl: string;
    const isDev = env.ENVIRONMENT === 'development' || env.ENVIRONMENT === 'local';

    if (body.redirect_url) {
      // Validate redirect URL is HTTPS in production
      if (!isDev && !body.redirect_url.startsWith('https://')) {
        return new Response(
          JSON.stringify({ error: 'redirect_url must use HTTPS' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      magicLinkUrl = body.redirect_url;
    } else if (isDev) {
      // Only allow HTTP fallback in development mode
      magicLinkUrl = 'http://localhost:8787/oauth/callback';
    } else {
      // Production requires explicit redirect_url
      return new Response(
        JSON.stringify({ error: 'redirect_url is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Call Stytch B2B Discovery magic link API
    // Discovery flow: sends a magic link that returns an intermediate session
    const magicLinkIsTest = env.STYTCH_PROJECT_ID.startsWith('project-test-');
    const b2bApiBase = magicLinkIsTest ? 'https://test.stytch.com/v1/b2b' : 'https://api.stytch.com/v1/b2b';

    const stytchResponse = await fetch(`${b2bApiBase}/magic_links/email/discovery/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${btoa(`${env.STYTCH_PROJECT_ID}:${env.STYTCH_SECRET_KEY}`)}`,
      },
      body: JSON.stringify({
        email_address: body.email,
        discovery_redirect_url: magicLinkUrl,
      }),
    });

    const stytchData = await stytchResponse.json() as { error_message?: string; email_id?: string };

    if (!stytchResponse.ok) {
      return new Response(
        JSON.stringify({ error: stytchData.error_message || 'Failed to send magic link' }),
        { status: stytchResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, email_id: stytchData.email_id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    log.error('Magic link error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle auth routes (OAuth callbacks, login initiation, etc.)
 */
async function handleAuthRoutes(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  // Get CORS headers based on request origin
  const corsHeaders = getCorsHeaders(request, env);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Check for required environment variables
  if (!env.STYTCH_PROJECT_ID || !env.STYTCH_SECRET_KEY) {
    return new Response('Stytch not configured', { status: 500, headers: corsHeaders });
  }

  const b2bApiBase = env.STYTCH_PROJECT_ID.startsWith('project-test-')
    ? 'https://test.stytch.com/v1/b2b'
    : 'https://api.stytch.com/v1/b2b';

  // GET /auth/callback - OAuth/Magic Link callback from Stytch
  // Stytch redirects here with ?token=xxx&stytch_token_type=oauth|magic_links
  if (url.pathname === '/auth/callback') {
    const token = url.searchParams.get('token');
    const tokenType = url.searchParams.get('stytch_token_type');

    if (!token || !tokenType) {
      return new Response(renderErrorPage('Missing token or token type'), {
        status: 400,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    try {
      // B2B Discovery flow: OAuth returns an intermediate session token.
      // We need to: 1) authenticate via discovery, 2) list orgs, 3) exchange for org-scoped session.
      // For users with a single org, this is transparent.
      const result = await authenticateB2BToken(token, tokenType, b2bApiBase, env);

      if (!result.ok) {
        return new Response(
          renderErrorPage(result.error || 'Authentication failed'),
          { status: 401, headers: { 'Content-Type': 'text/html' } }
        );
      }

      const deepLinkParams = new URLSearchParams({
        session_token: result.sessionToken,
        session_jwt: result.sessionJwt,
        user_id: result.userId,
        email: result.email,
        expires_at: result.expiresAt,
        org_id: result.orgId,
      });

      const deepLinkUrl = `nimbalyst://auth/callback?${deepLinkParams.toString()}`;

      // Mobile Safari: do a direct 302 redirect to the deep link.
      // Safari on iOS blocks automatic JS redirects to custom URL schemes,
      // but follows HTTP 302 redirects reliably.
      const ua = request.headers.get('user-agent') || '';
      const isMobile = /iPhone|iPad|iPod/i.test(ua);
      if (isMobile) {
        return new Response(null, {
          status: 302,
          headers: { 'Location': deepLinkUrl },
        });
      }

      // Desktop: return a page that redirects to the deep link
      return new Response(renderSuccessPage(deepLinkUrl), {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    } catch (err) {
      log.error('Auth callback error:', err);
      return new Response(renderErrorPage('An unexpected error occurred. Please try again.'), {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      });
    }
  }

  // POST /auth/refresh - Refresh B2B session and get new JWT
  if (url.pathname === '/auth/refresh' && request.method === 'POST') {
    try {
      const body = await request.json() as { session_token: string };
      const sessionToken = body.session_token;

      if (!sessionToken) {
        return new Response(JSON.stringify({ error: 'session_token required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const stytchResponse = await fetch(`${b2bApiBase}/sessions/authenticate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${btoa(`${env.STYTCH_PROJECT_ID}:${env.STYTCH_SECRET_KEY}`)}`,
        },
        body: JSON.stringify({
          session_token: sessionToken,
          session_duration_minutes: 60 * 24 * 7, // 1 week
        }),
      });

      const stytchData = await stytchResponse.json() as {
        member?: { member_id: string; email_address?: string; name?: string };
        member_session?: { expires_at: string };
        organization?: { organization_id: string };
        session_token?: string;
        session_jwt?: string;
        error_message?: string;
      };

      if (!stytchResponse.ok || !stytchData.session_token) {
        console.error('[auth/refresh] Stytch error:', stytchResponse.status, stytchData.error_message);
        return new Response(JSON.stringify({
          error: stytchData.error_message || 'Session refresh failed',
          expired: stytchResponse.status === 401,
        }), {
          status: stytchResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        session_token: stytchData.session_token,
        session_jwt: stytchData.session_jwt,
        user_id: stytchData.member?.member_id || '',
        email: stytchData.member?.email_address || '',
        expires_at: stytchData.member_session?.expires_at || '',
        org_id: stytchData.organization?.organization_id || '',
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      log.error('Session refresh error:', err);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // GET /auth/login/google - Initiate Google OAuth via B2B Discovery
  // Desktop app opens this URL in browser
  if (url.pathname === '/auth/login/google') {
    const callbackUrl = `${url.origin}/auth/callback`;

    if (!env.STYTCH_PUBLIC_TOKEN) {
      return new Response('Stytch public token not configured', { status: 500 });
    }

    // B2B discovery OAuth - authenticate first, then select/create org
    const oauthUrl = new URL(`${b2bApiBase}/public/oauth/google/discovery/start`);
    oauthUrl.searchParams.set('public_token', env.STYTCH_PUBLIC_TOKEN);
    oauthUrl.searchParams.set('discovery_redirect_url', callbackUrl);
    // Force Google to show account picker instead of auto-selecting
    oauthUrl.searchParams.set('provider_prompt', 'select_account');

    return Response.redirect(oauthUrl.toString(), 302);
  }

  return new Response('Not Found', { status: 404 });
}

interface B2BAuthResult {
  ok: boolean;
  error?: string;
  sessionToken: string;
  sessionJwt: string;
  userId: string;
  email: string;
  expiresAt: string;
  orgId: string;
}

/**
 * Authenticate a B2B token from OAuth or magic link callback.
 *
 * Discovery flow:
 * 1. Authenticate the intermediate token
 * 2. List discovered organizations
 * 3. If user has orgs, exchange for org-scoped session (auto-select first org)
 * 4. If user has no orgs, create a personal organization first
 */
async function authenticateB2BToken(
  token: string,
  tokenType: string,
  b2bApiBase: string,
  env: Env
): Promise<B2BAuthResult> {
  const failResult = (error: string): B2BAuthResult => ({
    ok: false, error, sessionToken: '', sessionJwt: '', userId: '', email: '', expiresAt: '', orgId: '',
  });

  const b2bAuth = `Basic ${btoa(`${env.STYTCH_PROJECT_ID}:${env.STYTCH_SECRET_KEY}`)}`;

  // Step 1: Authenticate via B2B discovery
  let discoveryEndpoint: string;
  let discoveryBody: Record<string, string>;
  if (tokenType === 'discovery_oauth' || tokenType === 'oauth') {
    discoveryEndpoint = `${b2bApiBase}/oauth/discovery/authenticate`;
    discoveryBody = { discovery_oauth_token: token };
  } else if (tokenType === 'discovery' || tokenType === 'magic_links') {
    discoveryEndpoint = `${b2bApiBase}/magic_links/discovery/authenticate`;
    discoveryBody = { discovery_magic_links_token: token };
  } else {
    return failResult(`Unknown token type: ${tokenType}`);
  }

  const discoveryResponse = await fetch(discoveryEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': b2bAuth,
    },
    body: JSON.stringify(discoveryBody),
  });

  if (!discoveryResponse.ok) {
    const errData = await discoveryResponse.json().catch(() => ({})) as { error_message?: string };
    return failResult(errData.error_message || 'Discovery authentication failed');
  }

  const discoveryData = await discoveryResponse.json() as {
    intermediate_session_token?: string;
    email_address?: string;
    discovered_organizations?: Array<{
      organization?: {
        organization_id: string;
        organization_name: string;
      };
      membership?: { type: string };
    }>;
    error_message?: string;
  };

  if (!discoveryData.intermediate_session_token) {
    return failResult(discoveryData.error_message || 'Discovery authentication failed');
  }

  const intermediateToken = discoveryData.intermediate_session_token;
  const email = discoveryData.email_address || '';
  const discoveredOrgs = discoveryData.discovered_organizations || [];

  // Step 2: Select or create organization
  let targetOrgId: string;

  if (discoveredOrgs.length > 0) {
    targetOrgId = discoveredOrgs[0].organization?.organization_id || '';
  } else {
    // New user with no orgs - create a personal organization
    const createOrgResponse = await fetch(`${b2bApiBase}/discovery/organizations/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': b2bAuth,
      },
      body: JSON.stringify({
        intermediate_session_token: intermediateToken,
        organization_name: `${email.split('@')[0]}'s Workspace`,
        session_duration_minutes: 60 * 24 * 7, // 1 week
      }),
    });

    if (!createOrgResponse.ok) {
      const errData = await createOrgResponse.json() as { error_message?: string };
      return failResult(errData.error_message || 'Failed to create personal organization');
    }

    const createData = await createOrgResponse.json() as {
      member?: { member_id: string; email_address?: string };
      member_session?: { expires_at: string };
      organization?: { organization_id: string };
      session_token?: string;
      session_jwt?: string;
    };

    return {
      ok: true,
      sessionToken: createData.session_token || '',
      sessionJwt: createData.session_jwt || '',
      userId: createData.member?.member_id || '',
      email: createData.member?.email_address || email,
      expiresAt: createData.member_session?.expires_at || '',
      orgId: createData.organization?.organization_id || '',
    };
  }

  // Step 3: Exchange intermediate session for org-scoped session
  const exchangeResponse = await fetch(`${b2bApiBase}/discovery/intermediate_sessions/exchange`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': b2bAuth,
    },
    body: JSON.stringify({
      intermediate_session_token: intermediateToken,
      organization_id: targetOrgId,
      session_duration_minutes: 60 * 24 * 7, // 1 week
    }),
  });

  if (!exchangeResponse.ok) {
    const errData = await exchangeResponse.json() as { error_message?: string };
    return failResult(errData.error_message || 'Session exchange failed');
  }

  const exchangeData = await exchangeResponse.json() as {
    member?: { member_id: string; email_address?: string };
    member_session?: { expires_at: string };
    organization?: { organization_id: string };
    session_token?: string;
    session_jwt?: string;
  };

  return {
    ok: true,
    sessionToken: exchangeData.session_token || '',
    sessionJwt: exchangeData.session_jwt || '',
    userId: exchangeData.member?.member_id || '',
    email: exchangeData.member?.email_address || email,
    expiresAt: exchangeData.member_session?.expires_at || '',
    orgId: exchangeData.organization?.organization_id || '',
  };
}

/**
 * Render success page that redirects to deep link
 * Shows session data for manual setup on devices that can't use deep links
 */
function renderSuccessPage(deepLinkUrl: string): string {
  // Escape deep link URL for HTML attribute and JS string contexts
  const safeDeepLinkHtml = escapeHtml(deepLinkUrl);
  const safeDeepLinkJs = escapeJsString(deepLinkUrl);

  return `<!DOCTYPE html>
<html>
<head>
  <title>Sign In Successful</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      box-sizing: border-box;
    }
    .container {
      text-align: center;
      padding: 40px;
      background: rgba(255,255,255,0.1);
      border-radius: 16px;
      backdrop-filter: blur(10px);
      max-width: 500px;
      width: 100%;
    }
    h1 { margin-bottom: 16px; font-size: 24px; }
    p { opacity: 0.9; margin-bottom: 24px; }
    .button {
      display: inline-block;
      padding: 12px 24px;
      background: white;
      color: #667eea;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      transition: transform 0.2s;
      cursor: pointer;
      border: none;
      font-size: 16px;
    }
    .button:hover { transform: scale(1.05); }
    .auto-redirect { font-size: 12px; opacity: 0.7; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Successfully Signed In</h1>
    <p>Click the button below to return to Nimbalyst, or it will open automatically.</p>
    <a href="${safeDeepLinkHtml}" class="button">Open Nimbalyst</a>
    <p class="auto-redirect">Redirecting automatically...</p>
  </div>
  <script>
    // Try to open the deep link automatically
    setTimeout(() => {
      window.location.href = "${safeDeepLinkJs}";
    }, 1500);
  </script>
</body>
</html>`;
}

/**
 * Escape a string for safe embedding in HTML content.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape a string for safe embedding in a JavaScript string literal (inside double quotes).
 */
function escapeJsString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/</g, '\\x3c')
    .replace(/>/g, '\\x3e')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Render error page
 */
function renderErrorPage(error: string): string {
  const safeError = escapeHtml(error);
  return `<!DOCTYPE html>
<html>
<head>
  <title>Sign In Failed</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      color: white;
    }
    .container {
      text-align: center;
      padding: 40px;
      background: rgba(255,255,255,0.1);
      border-radius: 16px;
      backdrop-filter: blur(10px);
      max-width: 400px;
    }
    h1 { margin-bottom: 16px; font-size: 24px; }
    p { opacity: 0.9; }
    .error { font-family: monospace; font-size: 12px; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Sign In Failed</h1>
    <p>Please close this window and try again.</p>
    <p class="error">${safeError}</p>
  </div>
</body>
</html>`;
}
