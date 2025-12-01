/**
 * CollabV3 Worker Entry Point
 *
 * Routes WebSocket connections to appropriate Durable Objects based on room ID.
 * Room ID format: user:{userId}:session:{sessionId} or user:{userId}:index
 */

import type { Env } from './types';
import { SessionRoom } from './SessionRoom';
import { IndexRoom } from './IndexRoom';

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

      // Validate auth matches room user
      const auth = parseAuth(request);
      if (!auth || auth.userId !== parsed.userId) {
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
  const auth = parseAuth(request);
  if (!auth) {
    return new Response('Unauthorized', { status: 401 });
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

  return new Response('Not Found', { status: 404 });
}
