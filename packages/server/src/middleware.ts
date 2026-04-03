import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload } from './auth.js';
import { queries } from './db.js';

export interface AuthRequest extends Request {
  user?: TokenPayload;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }
  let payload: TokenPayload;
  try {
    payload = verifyToken(header.slice(7));
  } catch {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
  queries.getUserById(payload.userId).then(user => {
    if (!user) {
      res.status(401).json({ error: 'Session expired. Please log in again.' });
      return;
    }
    req.user = payload;
    next();
  }).catch(next);
}
