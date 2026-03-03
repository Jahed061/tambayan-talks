import crypto from 'crypto';

/**
 * Generates a random token (for URLs) and its SHA-256 hash (for DB storage).
 *
 * Store the hash, send the raw token to the user.
 */
export function createTokenPair(bytes = 32): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(bytes).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
