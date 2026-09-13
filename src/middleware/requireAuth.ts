import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { requireEnv } from '../config';

const JWT_SECRET = requireEnv('JWT_SECRET');

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  const [scheme, token] = header?.split(' ') ?? [];

  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'Missing or malformed Authorization header.' });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload & { sub: number; email: string };
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}
