/**
 * Authentication module for CollabV3 server.
 *
 * Supports two authentication methods:
 * 1. Simple auth: Legacy format "Bearer {userId}:{token}" or query params
 * 2. JWT auth: Stytch session JWTs validated using JWKS
 *
 * The server supports both methods simultaneously for backward compatibility
 * during migration to Stytch authentication.
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
  aud: string; // Project ID
  iss: string; // Issuer
  iat: number; // Issued at
  exp: number; // Expiration
  nbf: number; // Not before
  session_id?: string;
}

/**
 * Authentication result with method indicator
 */
export interface AuthResult extends AuthContext {
  method: 'simple' | 'jwt';
  session_id?: string;
}

/**
 * Configuration for authentication
 */
export interface AuthConfig {
  /** Stytch project ID for JWT validation (required for JWT auth) */
  stytchProjectId?: string;
  /** Stytch JWKS URL (defaults to Stytch's standard endpoint) */
  stytchJwksUrl?: string;
  /** Allow simple auth (default: true for backward compatibility) */
  allowSimpleAuth?: boolean;
}

/**
 * Parse authentication from a request.
 * Supports both simple auth (legacy) and JWT auth (Stytch).
 *
 * @param request - The incoming request
 * @param config - Authentication configuration
 * @returns AuthResult if valid, null if unauthorized
 */
export async function parseAuth(
  request: Request,
  config: AuthConfig = {}
): Promise<AuthResult | null> {
  const { allowSimpleAuth = true } = config;

  // Check for JWT first (Authorization: Bearer {jwt})
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    // Check if it looks like a JWT (3 base64url parts separated by dots)
    if (token.includes('.') && token.split('.').length === 3) {
      // Try to validate as JWT
      const jwtResult = await validateJWT(token, config);
      if (jwtResult) {
        return jwtResult;
      }
      // If JWT validation fails, fall through to simple auth if allowed
    }

    // Try simple auth format: {userId}:{token}
    if (allowSimpleAuth) {
      const parts = token.split(':');
      if (parts.length >= 2) {
        return {
          user_id: parts[0],
          method: 'simple',
        };
      }
    }
  }

  // Try query params (simple auth only)
  if (allowSimpleAuth) {
    const url = new URL(request.url);
    const userId = url.searchParams.get('user_id');
    const token = url.searchParams.get('token');
    if (userId && token) {
      return {
        user_id: userId,
        method: 'simple',
      };
    }
  }

  return null;
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
    // Decode header and payload (without verification first)
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const header: JWTHeader = JSON.parse(base64UrlDecode(parts[0]));
    const payload: StytchJWTPayload = JSON.parse(base64UrlDecode(parts[1]));

    // Basic validation
    const now = Math.floor(Date.now() / 1000);

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
    if (config.stytchProjectId && payload.aud !== config.stytchProjectId) {
      console.log('[auth] JWT audience mismatch');
      return null;
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
      method: 'jwt',
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

    // Find the key by kid
    const key = jwks.keys.find((k) => k.kid === header.kid);
    if (!key) {
      console.log('[auth] Key not found in JWKS:', header.kid);
      return false;
    }

    // Import the public key
    const cryptoKey = await importJWK(key, header.alg);
    if (!cryptoKey) {
      console.log('[auth] Failed to import JWK');
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
    // Stytch JWKS URL format: https://stytch.com/v1/sessions/jwks/{project_id}
    const jwksUrl =
      config.stytchJwksUrl ||
      (config.stytchProjectId
        ? `https://stytch.com/v1/sessions/jwks/${config.stytchProjectId}`
        : null);

    if (!jwksUrl) {
      console.log('[auth] No JWKS URL configured');
      return null;
    }

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

/**
 * Validate a device token.
 * Device tokens are used by mobile devices that don't have direct Stytch auth.
 *
 * Note: This is a placeholder. Actual device token validation requires
 * a database lookup to verify the token is valid and not revoked.
 *
 * @param token - The device token
 * @param env - Environment with database access
 * @returns User ID if valid, null if invalid
 */
export async function validateDeviceToken(
  token: string,
  _env: unknown
): Promise<{ userId: string; deviceId: string } | null> {
  // TODO: Implement device token validation against database
  // For now, device tokens are managed client-side
  // This function would:
  // 1. Look up token in D1 database
  // 2. Check if token is not revoked
  // 3. Check if associated user account is still active
  // 4. Return user ID if valid

  console.log('[auth] Device token validation not yet implemented');
  return null;
}
