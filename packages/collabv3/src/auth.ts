/**
 * Authentication module for CollabV3 server.
 *
 * All authentication is done via Stytch session JWTs validated using JWKS.
 * The JWT 'sub' claim contains the user ID used for room authorization.
 */

import type { AuthContext } from './types';

// JWKS cache for Stytch public keys
let jwksCache: JsonWebKeySet | null = null;
let jwksCacheTime = 0;
const JWKS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

interface JsonWebKeySet {
  keys: JsonWebKey[];
}

interface JsonWebKey {
  kid: string;
  kty: string;
  use: string;
  alg: string;
  n?: string; // RSA modulus
  e?: string; // RSA exponent
  x?: string; // EC x coordinate
  y?: string; // EC y coordinate
  crv?: string; // EC curve
}

interface JWTHeader {
  alg: string;
  typ: string;
  kid: string;
}

interface StytchJWTPayload {
  sub: string; // User ID
  aud: string | string[]; // Project ID (can be array)
  iss: string; // Issuer
  iat: number; // Issued at
  exp: number; // Expiration
  nbf: number; // Not before
  session_id?: string;
}

/**
 * Authentication result
 */
export interface AuthResult extends AuthContext {
  session_id?: string;
}

/**
 * Configuration for authentication
 */
export interface AuthConfig {
  /** Stytch project ID for JWT validation (required) */
  stytchProjectId?: string;
  /** Stytch JWKS URL (defaults to Stytch's standard endpoint) */
  stytchJwksUrl?: string;
}

/**
 * Parse authentication from a request.
 * Accepts Stytch JWT from:
 * 1. Authorization header: "Bearer {jwt}"
 * 2. Query parameter: ?token={jwt} (for WebSocket connections which can't set headers)
 *
 * @param request - The incoming request
 * @param config - Authentication configuration
 * @returns AuthResult if valid, null if unauthorized
 */
export async function parseAuth(
  request: Request,
  config: AuthConfig = {}
): Promise<AuthResult | null> {
  let token: string | null = null;

  // Try Authorization header first: "Bearer {jwt}"
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  // Fall back to query parameter for WebSocket connections
  if (!token) {
    const url = new URL(request.url);
    token = url.searchParams.get('token');
  }

  if (!token) {
    console.log('[auth] No JWT found in header or query params');
    return null;
  }

  // Validate as JWT (must be 3 base64url parts separated by dots)
  if (!token.includes('.') || token.split('.').length !== 3) {
    console.log('[auth] Invalid JWT format');
    return null;
  }

  return validateJWT(token, config);
}

/**
 * Validate a Stytch JWT.
 *
 * @param token - The JWT token string
 * @param config - Authentication configuration
 * @returns AuthResult if valid, null if invalid
 */
async function validateJWT(
  token: string,
  config: AuthConfig
): Promise<AuthResult | null> {
  try {
    console.log('[auth] Validating JWT, token length:', token.length);

    // Decode header and payload (without verification first)
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.log('[auth] Invalid JWT structure, parts:', parts.length);
      return null;
    }

    const header: JWTHeader = JSON.parse(base64UrlDecode(parts[0]));
    const payload: StytchJWTPayload = JSON.parse(base64UrlDecode(parts[1]));

    console.log('[auth] JWT header:', JSON.stringify(header));
    console.log('[auth] JWT sub:', payload.sub, 'exp:', payload.exp, 'aud:', payload.aud);

    // Basic validation
    const now = Math.floor(Date.now() / 1000);
    console.log('[auth] Current time:', now, 'JWT exp:', payload.exp, 'diff:', payload.exp - now, 's');

    // Check expiration
    if (payload.exp && payload.exp < now) {
      console.log('[auth] JWT expired');
      return null;
    }

    // Check not before
    if (payload.nbf && payload.nbf > now) {
      console.log('[auth] JWT not yet valid');
      return null;
    }

    // Check issuer
    if (!payload.iss?.includes('stytch.com')) {
      console.log('[auth] JWT issuer not Stytch');
      return null;
    }

    // Validate audience if config has project ID
    // Note: Stytch JWT 'aud' can be a string or array of strings
    if (config.stytchProjectId) {
      const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!audiences.includes(config.stytchProjectId)) {
        console.log('[auth] JWT audience mismatch. Expected:', config.stytchProjectId, 'Got:', payload.aud);
        return null;
      }
    }

    // Verify signature using JWKS
    const isValid = await verifyJWTSignature(token, header, config);
    if (!isValid) {
      console.log('[auth] JWT signature verification failed');
      return null;
    }

    // Extract user ID from 'sub' claim
    return {
      user_id: payload.sub,
      session_id: payload.session_id,
    };
  } catch (error) {
    console.error('[auth] JWT validation error:', error);
    return null;
  }
}

/**
 * Verify JWT signature using Stytch's JWKS.
 */
async function verifyJWTSignature(
  token: string,
  header: JWTHeader,
  config: AuthConfig
): Promise<boolean> {
  try {
    // Get JWKS
    const jwks = await fetchJWKS(config);
    if (!jwks) {
      console.log('[auth] Failed to fetch JWKS');
      return false;
    }
    console.log('[auth] JWKS fetched, keys:', jwks.keys.length);

    // Find the key by kid
    const key = jwks.keys.find((k) => k.kid === header.kid);
    if (!key) {
      console.log('[auth] Key not found in JWKS. Looking for kid:', header.kid, 'Available kids:', jwks.keys.map(k => k.kid));
      return false;
    }
    console.log('[auth] Found key with kid:', key.kid);

    // Import the public key
    const cryptoKey = await importJWK(key, header.alg);
    if (!cryptoKey) {
      console.log('[auth] Failed to import JWK');
      return false;
    }
    console.log('[auth] JWK imported successfully');

    // Verify signature
    const parts = token.split('.');
    const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = base64UrlToArrayBuffer(parts[2]);

    const algorithm = getVerifyAlgorithm(header.alg);
    console.log('[auth] Verifying signature with algorithm:', algorithm);
    const isValid = await crypto.subtle.verify(
      algorithm,
      cryptoKey,
      signature,
      signedData
    );

    console.log('[auth] Signature verification result:', isValid);
    return isValid;
  } catch (error) {
    console.error('[auth] Signature verification error:', error);
    return false;
  }
}

/**
 * Fetch JWKS from Stytch (with caching).
 */
async function fetchJWKS(config: AuthConfig): Promise<JsonWebKeySet | null> {
  // Check cache
  if (jwksCache && Date.now() - jwksCacheTime < JWKS_CACHE_TTL) {
    return jwksCache;
  }

  try {
    // Stytch JWKS URL format depends on test vs live project
    // Test: https://test.stytch.com/v1/sessions/jwks/{project_id}
    // Live: https://api.stytch.com/v1/sessions/jwks/{project_id}
    let jwksUrl = config.stytchJwksUrl;

    if (!jwksUrl && config.stytchProjectId) {
      const isTestProject = config.stytchProjectId.startsWith('project-test-');
      const apiBase = isTestProject ? 'https://test.stytch.com' : 'https://api.stytch.com';
      jwksUrl = `${apiBase}/v1/sessions/jwks/${config.stytchProjectId}`;
    }

    if (!jwksUrl) {
      console.log('[auth] No JWKS URL configured');
      return null;
    }

    console.log('[auth] Fetching JWKS from:', jwksUrl);
    const response = await fetch(jwksUrl);
    if (!response.ok) {
      console.error('[auth] JWKS fetch failed:', response.status);
      return null;
    }

    jwksCache = await response.json();
    jwksCacheTime = Date.now();
    return jwksCache;
  } catch (error) {
    console.error('[auth] JWKS fetch error:', error);
    return null;
  }
}

/**
 * Import a JWK as a CryptoKey for verification.
 */
async function importJWK(
  jwk: JsonWebKey,
  algorithm: string
): Promise<CryptoKey | null> {
  try {
    const keyAlgorithm = getImportAlgorithm(algorithm, jwk);
    if (!keyAlgorithm) {
      return null;
    }

    return await crypto.subtle.importKey(
      'jwk',
      jwk,
      keyAlgorithm,
      false,
      ['verify']
    );
  } catch (error) {
    console.error('[auth] JWK import error:', error);
    return null;
  }
}

/**
 * Get the algorithm parameters for importing a JWK.
 */
function getImportAlgorithm(
  alg: string,
  jwk: JsonWebKey
): AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams | null {
  switch (alg) {
    case 'RS256':
      return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
    case 'RS384':
      return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' };
    case 'RS512':
      return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' };
    case 'ES256':
      return { name: 'ECDSA', namedCurve: jwk.crv || 'P-256' };
    case 'ES384':
      return { name: 'ECDSA', namedCurve: jwk.crv || 'P-384' };
    case 'ES512':
      return { name: 'ECDSA', namedCurve: jwk.crv || 'P-521' };
    default:
      console.error('[auth] Unsupported algorithm:', alg);
      return null;
  }
}

/**
 * Get the algorithm parameters for verifying a signature.
 */
function getVerifyAlgorithm(
  alg: string
): AlgorithmIdentifier | RsaPssParams | EcdsaParams {
  switch (alg) {
    case 'RS256':
    case 'RS384':
    case 'RS512':
      return { name: 'RSASSA-PKCS1-v1_5' };
    case 'ES256':
      return { name: 'ECDSA', hash: 'SHA-256' };
    case 'ES384':
      return { name: 'ECDSA', hash: 'SHA-384' };
    case 'ES512':
      return { name: 'ECDSA', hash: 'SHA-512' };
    default:
      return { name: 'RSASSA-PKCS1-v1_5' };
  }
}

/**
 * Decode a base64url string to a regular string.
 */
function base64UrlDecode(str: string): string {
  // Add padding if needed
  const pad = str.length % 4;
  const padded = pad ? str + '='.repeat(4 - pad) : str;

  // Convert base64url to base64
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');

  // Decode
  return atob(base64);
}

/**
 * Decode a base64url string to an ArrayBuffer.
 */
function base64UrlToArrayBuffer(str: string): ArrayBuffer {
  const decoded = base64UrlDecode(str);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    bytes[i] = decoded.charCodeAt(i);
  }
  return bytes.buffer;
}

