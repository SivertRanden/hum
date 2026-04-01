import { Router, Request, Response } from 'express';
import { queries } from '../db.js';
import { hashPassword, verifyPassword, signToken } from '../auth.js';

const router = Router();

router.post('/register', async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: 'username and password required' });
    return;
  }
  if (username.length < 2 || username.length > 32) {
    res.status(400).json({ error: 'username must be 2–32 characters' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'password must be at least 6 characters' });
    return;
  }

  const existing = queries.getUserByUsername.get(username);
  if (existing) {
    res.status(409).json({ error: 'username already taken' });
    return;
  }

  const hash = await hashPassword(password);
  const result = queries.createUser.run(username, hash);
  const userId = Number(result.lastInsertRowid);
  const token = signToken({ userId, username });
  res.status(201).json({ token, user: { id: userId, username } });
});

router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: 'username and password required' });
    return;
  }

  const user = queries.getUserByUsername.get(username);
  if (!user) {
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }

  const token = signToken({ userId: user.id, username: user.username });
  res.json({ token, user: { id: user.id, username: user.username } });
});

export default router;
