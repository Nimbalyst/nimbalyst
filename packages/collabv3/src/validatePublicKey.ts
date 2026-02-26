/**
 * Shared ECDH P-256 public key validation.
 *
 * Used by DocumentRoom, TeamRoom, and REST endpoints to validate
 * senderPublicKey fields before storing them.
 */

/**
 * Validate that a string is a well-formed ECDH P-256 public key JWK.
 * @returns null if valid, or an error message string if invalid.
 */
export function validateP256PublicKey(jwkString: string): string | null {
  let jwk: Record<string, unknown>;
  try {
    jwk = JSON.parse(jwkString);
  } catch {
    return 'senderPublicKey must be valid JSON';
  }

  if (typeof jwk !== 'object' || jwk === null || Array.isArray(jwk)) {
    return 'senderPublicKey must be a JSON object';
  }

  if (jwk.kty !== 'EC') {
    return 'Key type (kty) must be EC';
  }

  if (jwk.crv !== 'P-256') {
    return 'Curve (crv) must be P-256';
  }

  if (typeof jwk.x !== 'string' || jwk.x.length === 0) {
    return 'Missing or invalid x coordinate';
  }

  if (typeof jwk.y !== 'string' || jwk.y.length === 0) {
    return 'Missing or invalid y coordinate';
  }

  if ('d' in jwk) {
    return 'Must be a public key (private component d must not be present)';
  }

  return null;
}
