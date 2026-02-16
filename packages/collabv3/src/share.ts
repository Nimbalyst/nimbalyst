/**
 * Session Share Handlers
 *
 * Handles uploading, serving, listing, and deleting shared session HTML exports.
 * Shared sessions are stored in R2 with metadata in D1.
 */

import type { Env } from './types';
import type { AuthResult } from './auth';
import { createLogger } from './logger';

const log = createLogger('share');

/** Maximum upload size: 5 MB */
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;

/** Base62 character set for share ID generation */
const BASE62_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Share ID length: 22 chars = ~131 bits of entropy */
const SHARE_ID_LENGTH = 22;

/** Default TTL: 1 week in milliseconds */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Generate a cryptographically random base62 share ID.
 */
function generateShareId(): string {
  // Use rejection sampling to avoid modulo bias (256 % 62 != 0)
  const limit = 256 - (256 % BASE62_CHARS.length); // 248 = largest multiple of 62 <= 256
  let result = '';
  while (result.length < SHARE_ID_LENGTH) {
    const bytes = new Uint8Array(SHARE_ID_LENGTH - result.length);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit && result.length < SHARE_ID_LENGTH) {
        result += BASE62_CHARS[b % BASE62_CHARS.length];
      }
    }
  }
  return result;
}

/**
 * Handle share upload: POST /share
 *
 * Authenticated. Accepts HTML body, stores in R2, records metadata in D1.
 * Returns { shareId, url }.
 */
export async function handleShareUpload(
  request: Request,
  env: Env,
  auth: AuthResult,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

  // Read HTML body
  const html = await request.text();
  const title = request.headers.get('X-Session-Title') || 'Untitled';
  const sessionId = request.headers.get('X-Session-Id') || '';

  // Validate size
  if (html.length > MAX_UPLOAD_SIZE) {
    return new Response(
      JSON.stringify({ error: 'File too large. Maximum size is 5 MB.' }),
      { status: 413, headers: jsonHeaders }
    );
  }

  if (html.length === 0) {
    return new Response(
      JSON.stringify({ error: 'Empty body' }),
      { status: 400, headers: jsonHeaders }
    );
  }

  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEFAULT_TTL_MS);
    let shareId: string;
    let r2Key: string;
    let isUpdate = false;

    // Check for existing share of this session by this user (upsert)
    const existing = sessionId
      ? await env.DB.prepare(
          `SELECT id, r2_key FROM shared_sessions WHERE user_id = ? AND session_id = ? AND is_deleted = 0`
        ).bind(auth.userId, sessionId).first<{ id: string; r2_key: string }>()
      : null;

    if (existing) {
      // Update existing share - keep same ID and URL
      shareId = existing.id;
      r2Key = existing.r2_key;
      isUpdate = true;

      // Overwrite R2 object
      await env.SESSION_SHARES.put(r2Key, html, {
        httpMetadata: { contentType: 'text/html; charset=utf-8' },
      });

      // Update D1 metadata (reset TTL, update size/title)
      await env.DB.prepare(
        `UPDATE shared_sessions SET title = ?, size_bytes = ?, updated_at = ?, expires_at = ? WHERE id = ?`
      ).bind(title, html.length, now.toISOString(), expiresAt.toISOString(), shareId).run();
    } else {
      // Create new share
      shareId = generateShareId();
      r2Key = `shares/${shareId}.html`;

      await env.SESSION_SHARES.put(r2Key, html, {
        httpMetadata: { contentType: 'text/html; charset=utf-8' },
      });

      await env.DB.prepare(
        `INSERT INTO shared_sessions (id, user_id, session_id, title, r2_key, size_bytes, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(shareId, auth.userId, sessionId, title, r2Key, html.length, now.toISOString(), expiresAt.toISOString()).run();
    }

    // Build share URL - use share.nimbalyst.com in production, request origin otherwise
    const url = new URL(request.url);
    const isProduction = url.hostname === 'sync.nimbalyst.com' || url.hostname === 'share.nimbalyst.com';
    const shareBase = isProduction ? 'https://share.nimbalyst.com' : url.origin;
    const shareUrl = `${shareBase}/share/${shareId}`;

    log.debug('Share', isUpdate ? 'updated' : 'created', ':', shareId, 'size:', html.length, 'user:', auth.userId);

    return new Response(
      JSON.stringify({ shareId, url: shareUrl, isUpdate }),
      { status: 200, headers: jsonHeaders }
    );
  } catch (err) {
    log.error('Share upload failed:', err);
    return new Response(
      JSON.stringify({ error: 'Upload failed' }),
      { status: 500, headers: jsonHeaders }
    );
  }
}

/**
 * Handle share view: GET /share/{shareId}
 *
 * Public, no auth required. Serves the HTML file from R2.
 */
export async function handleShareView(
  shareId: string,
  env: Env
): Promise<Response> {
  // Validate share ID format (base62, 22 chars)
  if (!/^[a-zA-Z0-9]{22}$/.test(shareId)) {
    return new Response('Not found', { status: 404 });
  }

  try {
    // Look up in D1
    const record = await env.DB.prepare(
      `SELECT r2_key, expires_at, is_deleted FROM shared_sessions WHERE id = ?`
    ).bind(shareId).first<{ r2_key: string; expires_at: string | null; is_deleted: number }>();

    if (!record || record.is_deleted) {
      return new Response('Not found', { status: 404 });
    }

    if (record.expires_at && new Date(record.expires_at) < new Date()) {
      return new Response('This shared link has expired', { status: 410 });
    }

    // Increment view count (fire-and-forget, don't block response)
    env.DB.prepare(
      `UPDATE shared_sessions SET view_count = view_count + 1 WHERE id = ?`
    ).bind(shareId).run();

    // Serve from R2
    const object = await env.SESSION_SHARES.get(record.r2_key);
    if (!object) {
      return new Response('Not found', { status: 404 });
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    log.error('Share view failed:', err);
    return new Response('Internal server error', { status: 500 });
  }
}

/**
 * Handle share list: GET /shares
 *
 * Authenticated. Returns the user's shared sessions.
 */
export async function handleShareList(
  env: Env,
  auth: AuthResult,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

  try {
    const result = await env.DB.prepare(
      `SELECT id, session_id, title, size_bytes, created_at, expires_at, view_count
       FROM shared_sessions
       WHERE user_id = ? AND is_deleted = 0
       ORDER BY created_at DESC`
    ).bind(auth.userId).all();

    const url_origin = ''; // Will be set by client based on server URL
    const shares = (result.results || []).map((row: any) => ({
      shareId: row.id,
      sessionId: row.session_id,
      title: row.title,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      viewCount: row.view_count,
    }));

    return new Response(
      JSON.stringify({ shares }),
      { status: 200, headers: jsonHeaders }
    );
  } catch (err) {
    log.error('Share list failed:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to list shares' }),
      { status: 500, headers: jsonHeaders }
    );
  }
}

/**
 * Handle share delete: DELETE /share/{shareId}
 *
 * Authenticated. Soft-deletes the share and removes the R2 object.
 */
export async function handleShareDelete(
  shareId: string,
  env: Env,
  auth: AuthResult,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

  // Validate share ID format
  if (!/^[a-zA-Z0-9]{22}$/.test(shareId)) {
    return new Response(
      JSON.stringify({ error: 'Invalid share ID' }),
      { status: 400, headers: jsonHeaders }
    );
  }

  try {
    // Look up the share and verify ownership
    const record = await env.DB.prepare(
      `SELECT r2_key, user_id FROM shared_sessions WHERE id = ? AND is_deleted = 0`
    ).bind(shareId).first<{ r2_key: string; user_id: string }>();

    if (!record) {
      return new Response(
        JSON.stringify({ error: 'Share not found' }),
        { status: 404, headers: jsonHeaders }
      );
    }

    if (record.user_id !== auth.userId) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: jsonHeaders }
      );
    }

    // Soft-delete in D1
    await env.DB.prepare(
      `UPDATE shared_sessions SET is_deleted = 1 WHERE id = ?`
    ).bind(shareId).run();

    // Delete from R2
    await env.SESSION_SHARES.delete(record.r2_key);

    log.debug('Share deleted:', shareId, 'user:', auth.userId);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: jsonHeaders }
    );
  } catch (err) {
    log.error('Share delete failed:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to delete share' }),
      { status: 500, headers: jsonHeaders }
    );
  }
}
