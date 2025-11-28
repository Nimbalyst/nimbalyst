/**
 * Cloudflare Worker Entry Point
 *
 * Routes WebSocket connections to the appropriate Durable Object.
 * Handles authentication and session routing.
 */

import type { Env, AuthResult } from './types';

// Export the Durable Object class so Cloudflare can instantiate it
export { YjsSyncObject } from './durable-object';

/**
 * Validate authorization header
 * For MVP, this is a simple token check. In production, validate JWT.
 */
async function validateAuth(
  authHeader: string | null,
  _env: Env
): Promise<AuthResult> {
  if (!authHeader) {
    return { valid: false, error: 'Missing authorization header' };
  }

  // For local development, accept any bearer token and extract userId
  // Format: "Bearer userId:token" or just "Bearer token"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return { valid: false, error: 'Invalid authorization format' };
  }

  const token = parts[1];

  // For dev: if token contains ':', first part is userId
  const colonIndex = token.indexOf(':');
  if (colonIndex > 0) {
    const userId = token.substring(0, colonIndex);
    return { valid: true, userId };
  }

  // For dev: use token as userId
  return { valid: true, userId: token };

  // TODO: Production JWT validation
  // const secret = env.JWT_SECRET
  // if (!secret) {
  //   return { valid: false, error: 'JWT secret not configured' }
  // }
  // try {
  //   const payload = await verifyJWT(token, secret)
  //   return { valid: true, userId: payload.sub }
  // } catch (error) {
  //   return { valid: false, error: 'Invalid token' }
  // }
}

/**
 * CORS headers for WebSocket upgrade and REST endpoints
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Upgrade, Connection',
};

/**
 * Handle CORS preflight requests
 */
function handleOptions(): Response {
  return new Response(null, { headers: corsHeaders });
}

/**
 * Main Worker fetch handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Health check endpoint
    if (path === '/health') {
      return new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // List sessions endpoint: GET /sessions?userId={userId}
    if (path === '/sessions' && request.method === 'GET') {
      return handleListSessions(request, env);
    }

    // Sync endpoint: /sync/{sessionId}
    const syncMatch = path.match(/^\/sync\/([^/]+)(\/.*)?$/);
    if (!syncMatch) {
      return new Response('Not found', { status: 404, headers: corsHeaders });
    }

    const sessionId = syncMatch[1];
    const subPath = syncMatch[2] || '';

    // Extract userId from auth - check header first, then query param (for y-websocket)
    // For dev: skip strict auth validation, just extract userId
    let userId = 'anonymous';

    const authHeader = request.headers.get('Authorization');
    const authParam = url.searchParams.get('authorization');
    const authValue = authHeader || authParam;

    if (authValue) {
      // Extract userId from "Bearer userId:token" format
      const match = authValue.match(/^Bearer\s+([^:]+)/);
      if (match) {
        userId = match[1];
      }
    }

    // Create Durable Object ID scoped to user + session
    const objectId = env.YJSSYNC.idFromName(`${userId}:${sessionId}`);
    const stub = env.YJSSYNC.get(objectId);

    // Forward request with user context in headers
    const modifiedHeaders = new Headers(request.headers);
    modifiedHeaders.set('X-User-Id', userId);
    modifiedHeaders.set('X-Session-Id', sessionId);

    // Construct forwarded URL
    const forwardUrl = new URL(request.url);
    forwardUrl.pathname = subPath || '/';

    const forwardedRequest = new Request(forwardUrl.toString(), {
      method: request.method,
      headers: modifiedHeaders,
      body: request.body,
    });

    // Forward to Durable Object
    const response = await stub.fetch(forwardedRequest);

    // Add CORS headers to response (unless it's a WebSocket upgrade)
    if (response.status === 101) {
      return response;
    }

    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      newHeaders.set(key, value);
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};

/**
 * Handle session listing endpoint
 */
async function handleListSessions(request: Request, env: Env): Promise<Response> {
  // Validate authorization
  const authHeader = request.headers.get('Authorization');
  const authResult = await validateAuth(authHeader, env);

  if (!authResult.valid) {
    return new Response(JSON.stringify({ error: authResult.error }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const userId = authResult.userId!;
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '100', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  try {
    const results = await env.DB.prepare(
      `
      SELECT session_id, user_id, title, created_at, last_synced_at, device_count, snapshot_count
      FROM session_metadata
      WHERE user_id = ?
      ORDER BY last_synced_at DESC
      LIMIT ? OFFSET ?
    `
    )
      .bind(userId, limit, offset)
      .all();

    return new Response(JSON.stringify({ sessions: results.results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Failed to list sessions:', error);
    return new Response(JSON.stringify({ error: 'Failed to list sessions' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
