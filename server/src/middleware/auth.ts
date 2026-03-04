import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

export type UserRole = 'TEACHER' | 'STUDENT' | 'ADMIN';
export type JwtUser = { id: string; role: UserRole };

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('Server misconfigured: JWT_SECRET missing');
  return secret;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) return res.status(401).json({ error: 'Missing token' });

  let secret: string;
  try {
    secret = getSecret();
  } catch (e: any) {
    return res.status(500).json({ error: e.message ?? 'Server misconfigured' });
  }

  try {
    const payload = jwt.verify(token, secret) as JwtUser;
    (req as any).user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * Like requireAuth, but returns undefined if no token is present.
 * Useful for endpoints that can optionally accept an admin JWT.
 */
export function getOptionalAuthUser(req: Request): JwtUser | undefined {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return undefined;

  try {
    const secret = getSecret();
    return jwt.verify(token, secret) as JwtUser;
  } catch {
    return undefined;
  }
}

export function requireRole(...allowed: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as JwtUser | undefined;
    if (!user) return res.status(401).json({ error: 'Missing token' });

    if (!allowed.includes(user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}
