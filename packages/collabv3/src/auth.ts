/**
 * Authentication module for CollabV3 server.
 *
 * All authentication is done via Stytch session JWTs validated using JWKS.
 * The JWT 'sub' claim contains the user ID used for room authorization.
 */

import type { AuthContext } from './types';
import { createLogger } from './logger';

const log = createLogger('auth');

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
    log.debug('No JWT found in header or query params');
    return null;
  }

  // Validate as JWT (must be 3 base64url parts separated by dots)
  if (!token.includes('.') || token.split('.').length !== 3) {
    log.warn('Invalid JWT format');
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
    log.debug('Validating JWT, token length:', token.length);

    // Decode header and payload (without verification first)
    const parts = token.split('.');
    if (parts.length !== 3) {
      log.warn('Invalid JWT structure, parts:', parts.length);
      return null;
    }

    const header: JWTHeader = JSON.parse(base64UrlDecode(parts[0]));
    const payload: StytchJWTPayload = JSON.parse(base64UrlDecode(parts[1]));

    log.debug('JWT sub:', payload.sub, 'exp:', payload.exp);

    // Basic validation
    const now = Math.floor(Date.now() / 1000);

    // Check expiration
    if (payload.exp && payload.exp < now) {
      log.warn('JWT expired');
      return null;
    }

    // Check not before
    if (payload.nbf && payload.nbf > now) {
      log.warn('JWT not yet valid');
      return null;
    }

    // Check issuer
    if (!payload.iss?.includes('stytch.com')) {
      log.warn('JWT issuer not Stytch');
      return null;
    }

    // Validate audience if config has project ID
    // Note: Stytch JWT 'aud' can be a string or array of strings
    if (config.stytchProjectId) {
      const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!audiences.includes(config.stytchProjectId)) {
        log.warn('JWT audience mismatch. Expected:', config.stytchProjectId, 'Got:', payload.aud);
        return null;
      }
    }

    // Verify signature using JWKS
    const isValid = await verifyJWTSignature(token, header, config);
    if (!isValid) {
      log.warn('JWT signature verification failed');
      return null;
    }

    // Extract user ID from 'sub' claim
    return {
      userId: payload.sub,
      session_id: payload.session_id,
    };
  } catch (error) {
    log.error('JWT validation error:', error);
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
      log.warn('Failed to fetch JWKS');
      return false;
    }

    // Find the key by kid
    const key = jwks.keys.find((k) => k.kid === header.kid);
    if (!key) {
      log.warn('Key not found in JWKS. Looking for kid:', header.kid);
      return false;
    }

    // Import the public key
    const cryptoKey = await importJWK(key, header.alg);
    if (!cryptoKey) {
      log.warn('Failed to import JWK');
      return false;
    }

    // Verify signature
    const parts = token.split('.');
    const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = base64UrlToArrayBuffer(parts[2]);

    const algorithm = getVerifyAlgorithm(header.alg);
    const isValid = await crypto.subtle.verify(
      algorithm,
      cryptoKey,
      signature,
      signedData
    );

    if (!isValid) {
      log.warn('Signature verification failed');
    }
    return isValid;
  } catch (error) {
    log.error('Signature verification error:', error);
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
      log.warn('No JWKS URL configured');
      return null;
    }

    log.debug('Fetching JWKS from:', jwksUrl);
    const response = await fetch(jwksUrl);
    if (!response.ok) {
      log.error('JWKS fetch failed:', response.status);
      return null;
    }

    jwksCache = await response.json();
    jwksCacheTime = Date.now();
    return jwksCache;
  } catch (error) {
    log.error('JWKS fetch error:', error);
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
    log.error('JWK import error:', error);
    return null;
  }
}

/**
 * Get the algorithm parameters for importing a JWK.
 */
function getImportAlgorithm(
  alg: string,
  jwk: JsonWebKey
): { name: string; hash?: string; namedCurve?: string } | null {
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
      log.error('Unsupported algorithm:', alg);
      return null;
  }
}

/**
 * Get the algorithm parameters for verifying a signature.
 */
function getVerifyAlgorithm(
  alg: string
): { name: string; hash?: string } {
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

