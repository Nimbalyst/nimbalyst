/**
 * CollabV3 Worker Entry Point
 *
 * Routes WebSocket connections to appropriate Durable Objects based on room ID.
 * Room ID format: user:{userId}:session:{sessionId} or user:{userId}:index
 *
 * Authentication:
 * - Supports both legacy simple auth (Bearer {userId}:{token}) and JWT auth (Stytch)
 * - JWT auth extracts user ID from the 'sub' claim
 * - Both methods can be used simultaneously for backward compatibility
 */

import type { Env } from './types';
import { SessionRoom } from './SessionRoom';
import { IndexRoom } from './IndexRoom';
import { parseAuth as parseAuthJWT, type AuthConfig, type AuthResult } from './auth';

// Re-export Durable Object classes
export { SessionRoom, IndexRoom };

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
    // Read Stytch project ID from environment if available
    stytchProjectId: (env as any).STYTCH_PROJECT_ID,
    // Allow simple auth for backward compatibility
    allowSimpleAuth: true,
  };
}

// Main fetch handler
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
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
      if (!auth || auth.user_id !== parsed.userId) {
        return new Response('Unauthorized', { status: 401 });
      }

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

      // Forward request to DO
      return stub.fetch(request);
    }

    // REST API routes
    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, env, url);
    }

    // Auth routes (OAuth callbacks, etc.)
    if (url.pathname.startsWith('/auth/')) {
      return handleAuthRoutes(request, env, url);
    }

    return new Response('Not Found', { status: 404 });
  },
};

/**
 * Parse auth from request
 */
function parseAuth(request: Request): { userId: string; token: string } | null {
  // Try Authorization header: "Bearer {userId}:{token}"
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const parts = authHeader.slice(7).split(':');
    if (parts.length >= 2) {
      return { userId: parts[0], token: parts.slice(1).join(':') };
    }
  }

  // Try query params
  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id');
  const token = url.searchParams.get('token');
  if (userId && token) {
    return { userId, token };
  }

  return null;
}

/**
 * Handle REST API requests
 */
async function handleApiRequest(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  // CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

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
    const indexId = env.INDEX_ROOM.idFromName(`user:${auth.user_id}:index`);
    const stub = env.INDEX_ROOM.get(indexId);

    // Forward to status endpoint for now (could add dedicated list endpoint)
    return stub.fetch(new Request(`${url.origin}/status`));
  }

  // GET /api/session/{sessionId}/status - Get session status
  if (url.pathname.startsWith('/api/session/') && url.pathname.endsWith('/status')) {
    const sessionId = url.pathname.slice(13, -7); // Extract session ID
    const roomId = `user:${auth.user_id}:session:${sessionId}`;
    const id = env.SESSION_ROOM.idFromName(roomId);
    const stub = env.SESSION_ROOM.get(id);

    return stub.fetch(new Request(`${url.origin}/status`));
  }

  // POST /api/bulk-index - Bulk update session index (for initial sync)
  if (url.pathname === '/api/bulk-index' && request.method === 'POST') {
    try {
      const body = await request.json() as { sessions: unknown[] };

      const indexId = env.INDEX_ROOM.idFromName(`user:${auth.user_id}:index`);
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

    // Call Stytch API with secret key
    const stytchResponse = await fetch(`${apiBase}/magic_links/email/login_or_create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${btoa(`${env.STYTCH_PROJECT_ID}:${env.STYTCH_SECRET_KEY}`)}`,
      },
      body: JSON.stringify({
        email: body.email,
        login_magic_link_url: body.redirect_url || 'http://localhost:8787/oauth/callback',
        signup_magic_link_url: body.redirect_url || 'http://localhost:8787/oauth/callback',
      }),
    });

    const stytchData = await stytchResponse.json();

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
  // Check for required environment variables
  if (!env.STYTCH_PROJECT_ID || !env.STYTCH_SECRET_KEY) {
    return new Response('Stytch not configured', { status: 500 });
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
      const deepLinkParams = new URLSearchParams({
        session_token: stytchData.session_token,
        session_jwt: stytchData.session_jwt || '',
        user_id: stytchData.user?.user_id || '',
        email: stytchData.user?.emails?.[0]?.email || '',
        expires_at: stytchData.session?.expires_at || '',
      });

      const deepLinkUrl = `nimbalyst://auth/callback?${deepLinkParams.toString()}`;

      // Return a page that redirects to the deep link
      return new Response(renderSuccessPage(deepLinkUrl), {
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

  // GET /auth/login/google - Initiate Google OAuth
  // Desktop app opens this URL in browser
  if (url.pathname === '/auth/login/google') {
    const callbackUrl = `${url.origin}/auth/callback`;
    const publicToken = env.STYTCH_PROJECT_ID.replace('project-', 'public-token-');

    // Note: We need the public token, not project ID, for OAuth start
    // The public token should be passed as a query param or stored in env
    // For now, construct the OAuth URL that Stytch expects
    const oauthUrl = new URL(`${apiBase}/public/oauth/google/start`);
    oauthUrl.searchParams.set('public_token', env.STYTCH_PUBLIC_TOKEN || publicToken);
    oauthUrl.searchParams.set('login_redirect_url', callbackUrl);
    oauthUrl.searchParams.set('signup_redirect_url', callbackUrl);

    return Response.redirect(oauthUrl.toString(), 302);
  }

  return new Response('Not Found', { status: 404 });
}

/**
 * Render success page that redirects to deep link
 */
function renderSuccessPage(deepLinkUrl: string): string {
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
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
    }
    .button:hover { transform: scale(1.05); }
    .auto-redirect { font-size: 12px; opacity: 0.7; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Successfully Signed In</h1>
    <p>Click the button below to return to Nimbalyst, or it will open automatically.</p>
    <a href="${deepLinkUrl}" class="button">Open Nimbalyst</a>
    <p class="auto-redirect">Redirecting automatically...</p>
  </div>
  <script>
    // Try to open the deep link automatically
    setTimeout(() => {
      window.location.href = "${deepLinkUrl}";
    }, 1000);
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
