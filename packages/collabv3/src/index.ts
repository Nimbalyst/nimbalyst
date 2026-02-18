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
  // This is needed when running Capacitor on a device connecting to local dev server
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

// Room ID parsing
interface ParsedRoomId {
  type: 'session' | 'index' | 'projects';
  userId: string;
  sessionId?: string;
}

function parseRoomId(roomId: string): ParsedRoomId | null {
  // Format: user:{userId}:session:{sessionId}
  const sessionMatch = roomId.match(/^user:([^:]+):session:([^:]+)$/);
  if (sessionMatch) {
    return { type: 'session', userId: sessionMatch[1], sessionId: sessionMatch[2] };
  }

  // Format: user:{userId}:index
  const indexMatch = roomId.match(/^user:([^:]+):index$/);
  if (indexMatch) {
    return { type: 'index', userId: indexMatch[1] };
  }

  // Format: user:{userId}:projects
  const projectsMatch = roomId.match(/^user:([^:]+):projects$/);
  if (projectsMatch) {
    return { type: 'projects', userId: projectsMatch[1] };
  }

  return null;
}

// Get auth configuration from environment
function getAuthConfig(env: Env): AuthConfig {
  return {
    // Read Stytch project ID from environment
    stytchProjectId: (env as any).STYTCH_PROJECT_ID,
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

      // Forward request to DO with user_id added to URL
      // (DOs use simpler auth parsing that expects user_id in query params)
      const forwardUrl = new URL(request.url);
      forwardUrl.searchParams.set('user_id', auth.userId);
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

    // Determine API base from project ID
    const isTestProject = env.STYTCH_PROJECT_ID.startsWith('project-test-');
    const apiBase = isTestProject ? 'https://test.stytch.com/v1' : 'https://api.stytch.com/v1';

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

    // Call Stytch API with secret key
    const stytchResponse = await fetch(`${apiBase}/magic_links/email/login_or_create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${btoa(`${env.STYTCH_PROJECT_ID}:${env.STYTCH_SECRET_KEY}`)}`,
      },
      body: JSON.stringify({
        email: body.email,
        login_magic_link_url: magicLinkUrl,
        signup_magic_link_url: magicLinkUrl,
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
    return new Response(
      JSON.stringify({ error: `Server error: ${err}` }),
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

  const isTestProject = env.STYTCH_PROJECT_ID.startsWith('project-test-');
  const apiBase = isTestProject ? 'https://test.stytch.com/v1' : 'https://api.stytch.com/v1';

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
      // Authenticate the token with Stytch
      let stytchEndpoint: string;
      if (tokenType === 'oauth') {
        stytchEndpoint = `${apiBase}/oauth/authenticate`;
      } else if (tokenType === 'magic_links') {
        stytchEndpoint = `${apiBase}/magic_links/authenticate`;
      } else {
        return new Response(renderErrorPage(`Unknown token type: ${tokenType}`), {
          status: 400,
          headers: { 'Content-Type': 'text/html' },
        });
      }

      const stytchResponse = await fetch(stytchEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${btoa(`${env.STYTCH_PROJECT_ID}:${env.STYTCH_SECRET_KEY}`)}`,
        },
        body: JSON.stringify({
          token,
          session_duration_minutes: 60 * 24 * 7, // 1 week
        }),
      });

      const stytchData = await stytchResponse.json() as {
        user?: { user_id: string; emails?: Array<{ email: string }> };
        session?: { expires_at: string };
        session_token?: string;
        session_jwt?: string;
        error_message?: string;
      };

      if (!stytchResponse.ok || !stytchData.session_token) {
        return new Response(
          renderErrorPage(stytchData.error_message || 'Authentication failed'),
          { status: 401, headers: { 'Content-Type': 'text/html' } }
        );
      }

      // Build deep link URL with session data
      const sessionData = {
        sessionToken: stytchData.session_token,
        sessionJwt: stytchData.session_jwt || '',
        userId: stytchData.user?.user_id || '',
        email: stytchData.user?.emails?.[0]?.email || '',
        expiresAt: stytchData.session?.expires_at || '',
      };

      const deepLinkParams = new URLSearchParams({
        session_token: sessionData.sessionToken,
        session_jwt: sessionData.sessionJwt,
        user_id: sessionData.userId,
        email: sessionData.email,
        expires_at: sessionData.expiresAt,
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
      // Always show session copy option for manual setup on devices that can't use deep links
      return new Response(renderSuccessPage(deepLinkUrl, sessionData, true), {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    } catch (err) {
      return new Response(renderErrorPage(`Server error: ${err}`), {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      });
    }
  }

  // POST /auth/refresh - Refresh session and get new JWT
  // Desktop app calls this when JWT is missing or expired
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

      // Authenticate the session token to get a fresh JWT
      const stytchResponse = await fetch(`${apiBase}/sessions/authenticate`, {
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
        user?: { user_id: string; emails?: Array<{ email: string }> };
        session?: { expires_at: string };
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
        user_id: stytchData.user?.user_id,
        email: stytchData.user?.emails?.[0]?.email,
        expires_at: stytchData.session?.expires_at,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: `Server error: ${err}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // GET /auth/login/google - Initiate Google OAuth
  // Desktop app opens this URL in browser
  // Pass ?showTokens=1 to show session tokens on callback page (for browser testing)
  if (url.pathname === '/auth/login/google') {
    // Pass showTokens param through to callback if present
    const showTokens = url.searchParams.get('showTokens') === '1';
    const callbackUrl = showTokens
      ? `${url.origin}/auth/callback?showTokens=1`
      : `${url.origin}/auth/callback`;

    if (!env.STYTCH_PUBLIC_TOKEN) {
      return new Response('Stytch public token not configured', { status: 500 });
    }

    // Note: We need the public token, not project ID, for OAuth start
    // The public token should be passed as a query param or stored in env
    // For now, construct the OAuth URL that Stytch expects
    const oauthUrl = new URL(`${apiBase}/public/oauth/google/start`);
    oauthUrl.searchParams.set('public_token', env.STYTCH_PUBLIC_TOKEN);
    oauthUrl.searchParams.set('login_redirect_url', callbackUrl);
    oauthUrl.searchParams.set('signup_redirect_url', callbackUrl);
    // Force Google to show account picker instead of auto-selecting
    oauthUrl.searchParams.set('provider_prompt', 'select_account');

    return Response.redirect(oauthUrl.toString(), 302);
  }

  return new Response('Not Found', { status: 404 });
}

/**
 * Render success page that redirects to deep link
 * Shows session data for manual setup on devices that can't use deep links
 */
function renderSuccessPage(deepLinkUrl: string, sessionData: {
  sessionToken: string;
  sessionJwt: string;
  userId: string;
  email: string;
  expiresAt: string;
}, showManualSetup: boolean = false): string {
  const sessionJson = showManualSetup ? JSON.stringify({
    sessionToken: sessionData.sessionToken,
    sessionJwt: sessionData.sessionJwt,
    userId: sessionData.userId,
    email: sessionData.email,
    expiresAt: sessionData.expiresAt,
  }, null, 2) : '';

  // Escape JSON for embedding in HTML attribute
  const escapedJson = sessionJson.replace(/'/g, '&#39;').replace(/"/g, '&quot;');

  const manualSetupHtml = showManualSetup ? `
    <div class="manual-setup-section">
      <p class="manual-setup-desc">App didn't open? Copy session data for manual setup.</p>
      <button class="button secondary-btn copy-btn" onclick="copyTokens()">Copy Session Data</button>
      <input type="hidden" id="tokenData" value="${escapedJson}" />
    </div>
  ` : '';

  const copyScriptHtml = showManualSetup ? `
    function copyTokens() {
      const tokenData = document.getElementById('tokenData').value;
      // Unescape HTML entities
      const textarea = document.createElement('textarea');
      textarea.innerHTML = tokenData;
      const json = textarea.value;
      navigator.clipboard.writeText(json).then(() => {
        const btn = document.querySelector('.copy-btn');
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copy Session Data';
          btn.classList.remove('copied');
        }, 2000);
      });
    }
  ` : '';

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
    .manual-setup-section {
      margin-top: 32px;
      padding-top: 24px;
      border-top: 1px solid rgba(255,255,255,0.2);
    }
    .manual-setup-desc {
      font-size: 12px;
      opacity: 0.7;
      margin-bottom: 12px;
      margin-top: 0;
    }
    .secondary-btn {
      background: rgba(255,255,255,0.15);
      color: white;
      font-size: 13px;
    }
    .secondary-btn:hover { background: rgba(255,255,255,0.25); }
    .copied { background: #22c55e !important; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Successfully Signed In</h1>
    <p>Click the button below to return to Nimbalyst, or it will open automatically.</p>
    <a href="${deepLinkUrl}" class="button">Open Nimbalyst</a>
    <p class="auto-redirect">Redirecting automatically...</p>
    ${manualSetupHtml}
  </div>
  <script>
    // Try to open the deep link automatically
    setTimeout(() => {
      window.location.href = "${deepLinkUrl}";
    }, 1500);
    ${copyScriptHtml}
  </script>
</body>
</html>`;
}

/**
 * Render error page
 */
function renderErrorPage(error: string): string {
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
    <p class="error">${error}</p>
  </div>
</body>
</html>`;
}
