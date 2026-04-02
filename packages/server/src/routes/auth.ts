import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { queries } from '../db.js';
import { hashPassword, verifyPassword, signToken } from '../auth.js';
import { sendPasswordResetEmail } from '../email.js';

const router = Router();

const RESET_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

router.post('/register', async (req: Request, res: Response) => {
  const { username, password, email } = req.body as { username?: string; password?: string; email?: string };
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

  const existing = await queries.getUserByUsername(username);
  if (existing) {
    res.status(409).json({ error: 'username already taken' });
    return;
  }

  if (email) {
    const emailUser = await queries.getUserByEmail(email);
    if (emailUser) {
      res.status(409).json({ error: 'email already in use' });
      return;
    }
  }

  const hash = await hashPassword(password);
  const { id: userId } = await queries.createUser(username, hash, email);
  const token = signToken({ userId, username });
  res.status(201).json({ token, user: { id: userId, username } });
});

router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: 'username and password required' });
    return;
  }

  const user = await queries.getUserByUsername(username);
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

router.post('/forgot-password', async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };
  if (!email) {
    res.status(400).json({ error: 'email required' });
    return;
  }

  // Always return the same response to avoid user enumeration
  const genericOk = { message: 'If that email is registered, a reset link has been sent.' };

  const user = await queries.getUserByEmail(email);
  if (!user) {
    res.json(genericOk);
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + RESET_TOKEN_TTL_SECONDS;
  await queries.createPasswordResetToken(user.id, token, expiresAt);

  await sendPasswordResetEmail(email, user.username, token);

  res.json(genericOk);
});

router.post('/reset-password', async (req: Request, res: Response) => {
  const { token, password } = req.body as { token?: string; password?: string };
  if (!token || !password) {
    res.status(400).json({ error: 'token and password required' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'password must be at least 6 characters' });
    return;
  }

  const record = await queries.getPasswordResetToken(token);
  if (!record) {
    res.status(400).json({ error: 'invalid or expired reset token' });
    return;
  }
  if (record.used_at !== null) {
    res.status(400).json({ error: 'reset token already used' });
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  if (record.expires_at < now) {
    res.status(400).json({ error: 'reset token has expired' });
    return;
  }

  const hash = await hashPassword(password);
  await queries.updateUserPassword(record.user_id, hash);
  await queries.markPasswordResetTokenUsed(token);

  res.json({ message: 'Password updated successfully.' });
});

export default router;
