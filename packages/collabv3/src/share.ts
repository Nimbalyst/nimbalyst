/**
 * Session Share Handlers
 *
 * Handles uploading, serving, listing, and deleting shared session exports.
 * Shared sessions are stored encrypted in R2 with metadata in D1.
 *
 * All shares are client-side encrypted with AES-256-GCM. The decryption key
 * lives in the URL fragment (#key=...) and is never sent to the server.
 * The server only stores ciphertext -- admins cannot read user content.
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
const MAX_TTL_DAYS = 365;

/**
 * Parse X-TTL-Days header.
 * Returns a clamped day count [1, MAX_TTL_DAYS], or undefined for
 * invalid/missing/zero values (caller should use default).
 * "No expiration" is not supported - all shares must expire.
 */
function parseTtlDaysHeader(headerValue: string | null): number | undefined {
  if (headerValue === null) {
    return undefined;
  }

  const trimmed = headerValue.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return undefined;
  }

  const ttlDays = parseInt(trimmed, 10);
  if (ttlDays <= 0) {
    return undefined;
  }

  return Math.min(Math.max(ttlDays, 1), MAX_TTL_DAYS);
}

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
 * Authenticated. Accepts encrypted binary body, stores in R2,
 * records metadata in D1. Returns { shareId, url }.
 */
export async function handleShareUpload(
  request: Request,
  env: Env,
  auth: AuthResult,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

  const title = request.headers.get('X-Session-Title') || 'Encrypted session';
  const sessionId = request.headers.get('X-Session-Id') || '';
  const viewerType = request.headers.get('X-Viewer-Type') || null;

  const body = await request.arrayBuffer();
  const bodySize = body.byteLength;

  // Validate size
  if (bodySize > MAX_UPLOAD_SIZE) {
    return new Response(
      JSON.stringify({ error: 'File too large. Maximum size is 5 MB.' }),
      { status: 413, headers: jsonHeaders }
    );
  }

  if (bodySize === 0) {
    return new Response(
      JSON.stringify({ error: 'Empty body' }),
      { status: 400, headers: jsonHeaders }
    );
  }

  try {
    const now = new Date();

    // Determine TTL from client header, or use default.
    // All shares must expire - "no expiration" is not supported.
    const ttlDaysHeader = request.headers.get('X-TTL-Days');
    const parsedTtlDays = parseTtlDaysHeader(ttlDaysHeader);
    let expiresAt: Date;
    if (typeof parsedTtlDays === 'number') {
      expiresAt = new Date(now.getTime() + parsedTtlDays * 24 * 60 * 60 * 1000);
    } else {
      if (ttlDaysHeader !== null) {
        log.warn('Invalid X-TTL-Days header; falling back to default TTL', ttlDaysHeader);
      }
      expiresAt = new Date(now.getTime() + DEFAULT_TTL_MS);
    }

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
      r2Key = `shares/${shareId}.bin`;
      isUpdate = true;

      // Delete old R2 object if the key changed (e.g., previously .html)
      if (existing.r2_key !== r2Key) {
        await env.SESSION_SHARES.delete(existing.r2_key);
      }

      await env.SESSION_SHARES.put(r2Key, body, {
        httpMetadata: { contentType: 'application/octet-stream' },
      });

      await env.DB.prepare(
        `UPDATE shared_sessions SET title = ?, size_bytes = ?, updated_at = ?, expires_at = ?, r2_key = ?, viewer_type = ? WHERE id = ?`
      ).bind(title, bodySize, now.toISOString(), expiresAt.toISOString(), r2Key, viewerType, shareId).run();
    } else {
      // Create new share
      shareId = generateShareId();
      r2Key = `shares/${shareId}.bin`;

      await env.SESSION_SHARES.put(r2Key, body, {
        httpMetadata: { contentType: 'application/octet-stream' },
      });

      await env.DB.prepare(
        `INSERT INTO shared_sessions (id, user_id, session_id, title, r2_key, size_bytes, created_at, expires_at, viewer_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(shareId, auth.userId, sessionId, title, r2Key, bodySize, now.toISOString(), expiresAt.toISOString(), viewerType).run();
    }

    // Build share URL - use share.nimbalyst.com in production, request origin otherwise
    const url = new URL(request.url);
    const isProduction = url.hostname === 'sync.nimbalyst.com' || url.hostname === 'share.nimbalyst.com';
    const shareBase = isProduction ? 'https://share.nimbalyst.com' : url.origin;
    const shareUrl = `${shareBase}/share/${shareId}`;

    log.debug('Share', isUpdate ? 'updated' : 'created', ':', shareId, 'size:', bodySize, 'user:', auth.userId);

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
 * Public, no auth required. Serves a decryption viewer page that extracts
 * the key from the URL fragment and decrypts the content client-side.
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
      `SELECT expires_at, is_deleted, viewer_type FROM shared_sessions WHERE id = ?`
    ).bind(shareId).first<{ expires_at: string | null; is_deleted: number; viewer_type: string | null }>();

    if (!record || record.is_deleted) {
      return new Response('Not found', { status: 404 });
    }

    if (record.expires_at && new Date(record.expires_at) < new Date()) {
      return new Response('This shared link has expired', { status: 410 });
    }

    // Best-effort increment before responding. Un-awaited writes can be dropped
    // when the worker returns early, so explicitly await and swallow failures.
    try {
      await env.DB.prepare(
        `UPDATE shared_sessions SET view_count = view_count + 1 WHERE id = ?`
      ).bind(shareId).run();
    } catch (err) {
      log.warn('Failed to increment share view count:', shareId, err);
    }

    // Branch on viewer_type: extension viewers get a different shell page
    const viewerType = record.viewer_type;
    const viewerHtml = (viewerType && EXTENSION_VIEWER_ALLOWLIST.has(viewerType))
      ? getExtensionViewerHtml(shareId, viewerType)
      : getDecryptionViewerHtml(shareId);

    return new Response(viewerHtml, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err) {
    log.error('Share view failed:', err);
    return new Response('Internal server error', { status: 500 });
  }
}

/**
 * Handle share content: GET /share/{shareId}/content
 *
 * Public, no auth required. Returns the raw encrypted bytes from R2.
 * Used by the decryption viewer page to fetch ciphertext for client-side decryption.
 */
export async function handleShareContent(
  shareId: string,
  env: Env
): Promise<Response> {
  // Validate share ID format (base62, 22 chars)
  if (!/^[a-zA-Z0-9]{22}$/.test(shareId)) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const record = await env.DB.prepare(
      `SELECT r2_key, expires_at, is_deleted FROM shared_sessions WHERE id = ?`
    ).bind(shareId).first<{ r2_key: string; expires_at: string | null; is_deleted: number }>();

    if (!record || record.is_deleted) {
      return new Response('Not found', { status: 404 });
    }

    if (record.expires_at && new Date(record.expires_at) < new Date()) {
      return new Response('This shared link has expired', { status: 410 });
    }

    const object = await env.SESSION_SHARES.get(record.r2_key);
    if (!object) {
      return new Response('Not found', { status: 404 });
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    log.error('Share content fetch failed:', err);
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

/**
 * Generate the decryption viewer HTML page.
 *
 * This self-contained page:
 * 1. Extracts the AES-256-GCM key from the URL fragment (#key=...)
 * 2. Fetches the encrypted content from /share/{id}/content
 * 3. Decrypts using Web Crypto API
 * 4. Renders the decrypted HTML in a sandboxed iframe
 *
 * The URL fragment is never sent to the server, so the decryption key
 * remains client-side only.
 */
function getDecryptionViewerHtml(shareId: string): string {
  return `<!DOCTYPE html>
<!--
AGENT DECRYPTION INSTRUCTIONS
==============================
This page contains AES-256-GCM encrypted content. To extract the plaintext
programmatically (e.g. from a CLI agent or script), follow these steps:

1. EXTRACT THE KEY from the URL fragment (the part after #key=).
   The key is URL-safe base64: replace - with +, _ with /, and pad with =
   to get standard base64. Decode to get the raw 32-byte AES key.

2. FETCH THE ENCRYPTED CONTENT:
   GET https://sync.nimbalyst.com/share/${shareId}/content
   This returns raw binary (application/octet-stream). No auth required.

3. PARSE THE BINARY FORMAT:
   Bytes  0-11:  IV (initialization vector, 12 bytes)
   Bytes 12-end: Ciphertext with appended GCM auth tag (last 16 bytes)

4. DECRYPT with AES-256-GCM using the IV and key.
   In Node.js:
     const crypto = require('crypto');
     const keyB64url = url.split('#key=')[1];
     const keyB64 = keyB64url.replace(/-/g,'+').replace(/_/g,'/');
     const key = Buffer.from(keyB64, 'base64');
     const data = await fetch('https://sync.nimbalyst.com/share/${shareId}/content').then(r=>r.arrayBuffer());
     const buf = Buffer.from(data);
     const iv = buf.subarray(0, 12);
     const authTag = buf.subarray(buf.length - 16);
     const ciphertext = buf.subarray(12, buf.length - 16);
     const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
     decipher.setAuthTag(authTag);
     const html = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');

5. The result is an HTML document containing the shared content.
-->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nimbalyst Shared Session</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#1a1a1a;color:#e4e4e7}
.center{display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:12px}
.spinner{width:24px;height:24px;border:3px solid #333;border-top-color:#60a5fa;border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.error{max-width:28rem;margin:4rem auto;padding:2rem;text-align:center}
.error h2{color:#ef4444;margin-bottom:8px;font-size:18px}
.error p{color:#a1a1aa;font-size:14px;line-height:1.5}
iframe{border:0;width:100%;height:100vh;display:block}
.brand{position:fixed;bottom:12px;right:16px;font-size:11px;color:#52525b;z-index:10}
.brand a{color:#60a5fa;text-decoration:none}
</style>
</head>
<body>
<div id="loading" class="center">
<div class="spinner"></div>
<div style="color:#a1a1aa;font-size:14px">Decrypting session...</div>
</div>
<div id="error" class="error" style="display:none"></div>
<iframe id="viewer" style="display:none" sandbox="allow-scripts allow-same-origin allow-popups allow-downloads"></iframe>
<div class="brand">Shared via <a href="https://nimbalyst.com" target="_blank">Nimbalyst</a></div>
<script>
(async()=>{
  const errEl=document.getElementById('error');
  const loadEl=document.getElementById('loading');
  function showError(title,msg){
    loadEl.style.display='none';
    errEl.style.display='block';
    errEl.innerHTML='<h2>'+title+'</h2><p>'+msg+'</p>';
  }
  const hash=window.location.hash;
  if(!hash||!hash.startsWith('#key=')){
    showError('Missing decryption key','The URL is incomplete. Make sure you copied the full link including the part after the # symbol.');
    return;
  }
  const keyB64url=hash.slice(5);
  const keyB64=keyB64url.replace(/-/g,'+').replace(/_/g,'/');
  const padded=keyB64+'='.repeat((4-keyB64.length%4)%4);
  try{
    const resp=await fetch('/share/${shareId}/content');
    if(!resp.ok){
      if(resp.status===404)showError('Not found','This shared session was not found or has been removed.');
      else if(resp.status===410)showError('Expired','This shared link has expired.');
      else showError('Error','Failed to load the shared session (HTTP '+resp.status+').');
      return;
    }
    const data=await resp.arrayBuffer();
    if(data.byteLength<29){
      showError('Invalid content','The shared content appears to be corrupted.');
      return;
    }
    const iv=new Uint8Array(data,0,12);
    const ciphertext=new Uint8Array(data,12);
    const keyBytes=Uint8Array.from(atob(padded),c=>c.charCodeAt(0));
    const cryptoKey=await crypto.subtle.importKey('raw',keyBytes,{name:'AES-GCM'},false,['decrypt']);
    const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv:iv},cryptoKey,ciphertext);
    const html=new TextDecoder().decode(decrypted);
    loadEl.style.display='none';
    const iframe=document.getElementById('viewer');
    iframe.style.display='block';
    iframe.srcdoc=html;
  }catch(e){
    showError('Decryption failed','The decryption key may be incorrect or the content may be corrupted.');
  }
})();
</script>
</body>
</html>`;
}

// ============================================================================
// Extension Viewer System
// ============================================================================

/**
 * Server-side allowlist of extension types that have viewer bundles deployed.
 * Types not in this set fall back to the default static HTML iframe viewer.
 */
const EXTENSION_VIEWER_ALLOWLIST = new Set([
  'mindmap',
  'datamodellm',
  'excalidraw',
  'csv',
  'mockup',
]);

/**
 * Maps viewer_type to extension viewer bundle metadata.
 * The component name must match what the extension exports in its `components` map.
 */
const EXTENSION_VIEWER_REGISTRY: Record<string, {
  js: string;
  css: string | null;
  component: string;
  displayName: string;
}> = {
  mindmap: {
    js: '/viewer/ext/mindmap-viewer.js',
    css: '/viewer/ext/mindmap-viewer.css',
    component: 'MindmapEditor',
    displayName: 'Mindmap',
  },
  datamodellm: {
    js: '/viewer/ext/datamodellm-viewer.js',
    css: '/viewer/ext/datamodellm-viewer.css',
    component: 'DatamodelLMEditor',
    displayName: 'Data Model',
  },
  excalidraw: {
    js: '/viewer/ext/excalidraw-viewer.js',
    css: '/viewer/ext/excalidraw-viewer.css',
    component: 'ExcalidrawEditor',
    displayName: 'Excalidraw',
  },
  csv: {
    js: '/viewer/ext/csv-viewer.js',
    css: '/viewer/ext/csv-viewer.css',
    component: 'SpreadsheetEditor',
    displayName: 'Spreadsheet',
  },
  mockup: {
    js: '/viewer/ext/mockup-viewer.js',
    css: '/viewer/ext/mockup-viewer.css',
    component: 'MockupEditor',
    displayName: 'Mockup',
  },
};

/**
 * Generate the extension viewer HTML page.
 *
 * Like the decryption viewer, this page:
 * 1. Extracts the AES-256-GCM key from the URL fragment
 * 2. Fetches and decrypts the content
 * 3. Loads the extension viewer bundle via import map
 * 4. Creates a ReadOnlyEditorHost with the decrypted content
 * 5. Mounts the extension's React component
 */
function getExtensionViewerHtml(shareId: string, viewerType: string): string {
  const viewer = EXTENSION_VIEWER_REGISTRY[viewerType];
  if (!viewer) {
    // Shouldn't happen (allowlist checked before calling), but fall back gracefully
    return getDecryptionViewerHtml(shareId);
  }

  const cssLink = viewer.css
    ? `<link rel="stylesheet" href="${viewer.css}">`
    : '';
  const cssPreload = viewer.css
    ? `<link rel="preload" href="${viewer.css}" as="style">`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nimbalyst - ${viewer.displayName}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap">
${cssPreload}
<!-- Extension bundle loaded dynamically after import map is ready -->
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--nim-bg:#2d2d2d;--nim-bg-secondary:#1a1a1a;--nim-bg-tertiary:#3a3a3a;--nim-bg-active:#4a4a4a;--nim-bg-hover:rgba(255,255,255,0.05);--nim-bg-selected:rgba(96,165,250,0.15);--nim-text:#ffffff;--nim-text-muted:#b3b3b3;--nim-text-faint:#808080;--nim-text-disabled:#666666;--nim-border:#4a4a4a;--nim-border-focus:#60a5fa;--nim-primary:#60a5fa;--nim-primary-hover:#3b82f6;--nim-primary-rgb:96,165,250;--nim-link:#60a5fa;--nim-link-hover:#93c5fd;--nim-success:#4ade80;--nim-warning:#fbbf24;--nim-error:#ef4444;--nim-info:#60a5fa;--nim-purple:#a78bfa;--nim-code-bg:#1e1e1e;--nim-code-text:#d4d4d4;--nim-code-border:#4a4a4a;--nim-toolbar-bg:#2d2d2d;--nim-toolbar-border:#4a4a4a;--nim-toolbar-hover:#3a3a3a;--nim-toolbar-active:rgba(96,165,250,0.2);--nim-scrollbar-thumb:#4a4a4a;--nim-scrollbar-track:transparent}
[data-theme="light"]{--nim-bg:#ffffff;--nim-bg-secondary:#f9fafb;--nim-bg-tertiary:#f3f4f6;--nim-bg-active:#e5e7eb;--nim-bg-hover:rgba(0,0,0,0.04);--nim-bg-selected:rgba(59,130,246,0.1);--nim-text:#18181b;--nim-text-muted:#52525b;--nim-text-faint:#a1a1aa;--nim-text-disabled:#d4d4d8;--nim-border:#e4e4e7;--nim-border-focus:#3b82f6;--nim-primary:#3b82f6;--nim-primary-hover:#2563eb;--nim-primary-rgb:59,130,246;--nim-link:#3b82f6;--nim-link-hover:#2563eb;--nim-success:#22c55e;--nim-warning:#f59e0b;--nim-error:#ef4444;--nim-info:#3b82f6;--nim-purple:#8b5cf6;--nim-code-bg:#f5f5f5;--nim-code-text:#1e1e1e;--nim-code-border:#e4e4e7;--nim-toolbar-bg:#ffffff;--nim-toolbar-border:#e4e4e7;--nim-toolbar-hover:#f3f4f6;--nim-toolbar-active:rgba(59,130,246,0.15);--nim-scrollbar-thumb:#d4d4d8;--nim-scrollbar-track:transparent}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--nim-bg);color:var(--nim-text)}
.center{display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:12px}
.spinner{width:24px;height:24px;border:3px solid #333;border-top-color:#60a5fa;border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.error{max-width:28rem;margin:4rem auto;padding:2rem;text-align:center}
.error h2{color:#ef4444;margin-bottom:8px;font-size:18px}
.error p{color:#a1a1aa;font-size:14px;line-height:1.5}
#viewer-root{width:100%;height:100vh}
.viewer-chrome{position:fixed;top:0;left:0;right:0;height:40px;background:rgba(26,26,26,0.9);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:space-between;padding:0 16px;z-index:1000;border-bottom:1px solid #333}
[data-theme="light"] .viewer-chrome{background:rgba(255,255,255,0.9);border-bottom-color:#e4e4e7}
.viewer-chrome .brand{font-size:13px;color:#a1a1aa;font-weight:500}
.viewer-chrome .brand a{color:#60a5fa;text-decoration:none}
.viewer-chrome .actions{display:flex;gap:8px;align-items:center}
.theme-toggle{background:none;border:1px solid #444;color:#a1a1aa;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px}
.theme-toggle:hover{border-color:#60a5fa;color:#e4e4e7}
</style>
${cssLink}
<script type="importmap">
{
  "imports": {
    "react": "https://esm.sh/react@18.3.1",
    "react-dom": "https://esm.sh/react-dom@18.3.1?external=react",
    "react-dom/client": "https://esm.sh/react-dom@18.3.1/client?external=react",
    "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
    "react/jsx-dev-runtime": "https://esm.sh/react@18.3.1/jsx-dev-runtime",
    "@nimbalyst/extension-sdk": "/viewer/deps/extension-sdk.js",
    "@nimbalyst/runtime": "/viewer/deps/nimbalyst-runtime.js",
    "@nimbalyst/editor-context": "/viewer/deps/nimbalyst-editor-context.js",
    "lexical": "https://esm.sh/lexical@0.34.0?external=react",
    "@lexical/utils": "https://esm.sh/@lexical/utils@0.34.0?external=react,lexical",
    "@lexical/react/LexicalComposerContext": "https://esm.sh/@lexical/react@0.34.0/LexicalComposerContext?external=react,lexical",
    "@lexical/react/useLexicalEditable": "https://esm.sh/@lexical/react@0.34.0/useLexicalEditable?external=react,lexical",
    "@lexical/react/useLexicalNodeSelection": "https://esm.sh/@lexical/react@0.34.0/useLexicalNodeSelection?external=react,lexical"
  }
}
</script>
</head>
<body data-theme="dark">
<div class="viewer-chrome">
  <span class="brand">Shared via <a href="https://nimbalyst.com" target="_blank">Nimbalyst</a></span>
  <div class="actions">
    <button class="theme-toggle" id="theme-toggle">Light</button>
  </div>
</div>
<div id="loading" class="center">
  <div class="spinner"></div>
  <div style="color:#a1a1aa;font-size:14px">Loading ${viewer.displayName}...</div>
</div>
<div id="error" class="error" style="display:none"></div>
<div id="viewer-root" style="display:none;padding-top:40px"></div>
<script type="module">
import { createReadOnlyHost } from '/viewer/deps/extension-sdk.js';

const errEl = document.getElementById('error');
const loadEl = document.getElementById('loading');
const rootEl = document.getElementById('viewer-root');

function showError(title, msg) {
  loadEl.style.display = 'none';
  errEl.style.display = 'block';
  errEl.innerHTML = '<h2>' + title + '</h2><p>' + msg + '</p>';
}

// -- Parse hash params (key=..., theme=dark|light|system) --
const hashParams = new URLSearchParams(window.location.hash.slice(1));
const keyB64url = hashParams.get('key');
const themeParam = hashParams.get('theme');
const initialTheme = themeParam === 'light' ? 'light'
  : themeParam === 'dark' ? 'dark'
  : (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
document.body.setAttribute('data-theme', initialTheme);

if (!keyB64url) {
  showError('Missing decryption key', 'The URL is incomplete. Make sure you copied the full link including the part after the # symbol.');
} else {
  try {
    const keyB64 = keyB64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = keyB64 + '='.repeat((4 - keyB64.length % 4) % 4);

    const resp = await fetch('/share/${shareId}/content');
    if (!resp.ok) {
      if (resp.status === 404) showError('Not found', 'This shared file was not found or has been removed.');
      else if (resp.status === 410) showError('Expired', 'This shared link has expired.');
      else showError('Error', 'Failed to load the shared file (HTTP ' + resp.status + ').');
    } else {
      const data = await resp.arrayBuffer();
      if (data.byteLength < 29) {
        showError('Invalid content', 'The shared content appears to be corrupted.');
      } else {
        const iv = new Uint8Array(data, 0, 12);
        const ciphertext = new Uint8Array(data, 12);
        const keyBytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
        const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
        const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext);
        const content = new TextDecoder().decode(decrypted);

        // -- Create ReadOnlyEditorHost --
        const host = createReadOnlyHost(content, {
          theme: initialTheme,
          fileName: 'shared.${viewerType}',
        });

        // -- Load and mount extension component --
        const mod = await import('${viewer.js}');
        const Component = mod.components?.['${viewer.component}'];
        if (!Component) {
          showError('Extension error', 'Could not find the ${viewer.displayName} editor component.');
        } else {
          const React = await import('react');
          const ReactDOM = await import('react-dom/client');

          loadEl.style.display = 'none';
          rootEl.style.display = 'block';

          const root = ReactDOM.createRoot(rootEl);
          root.render(React.createElement(Component, { host }));

          // -- Theme toggle --
          const toggleBtn = document.getElementById('theme-toggle');
          let isDark = initialTheme === 'dark';
          toggleBtn.textContent = isDark ? 'Light' : 'Dark';
          toggleBtn.addEventListener('click', () => {
            isDark = !isDark;
            const theme = isDark ? 'dark' : 'light';
            document.body.setAttribute('data-theme', theme);
            host.setTheme(theme);
            toggleBtn.textContent = isDark ? 'Light' : 'Dark';
            // Update URL so the theme persists when sharing the link
            hashParams.set('theme', theme);
            history.replaceState(null, '', '#' + hashParams.toString());
          });
        }
      }
    }
  } catch (e) {
    console.error('Viewer error:', e);
    showError('Error', e?.message || 'The decryption key may be incorrect or the content may be corrupted.');
  }
}
</script>
</body>
</html>`;
}
