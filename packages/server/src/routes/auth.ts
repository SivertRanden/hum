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

// ── Google OAuth ──────────────────────────────────────────────────────────────

router.get('/google', (req: Request, res: Response) => {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: `${process.env.OAUTH_CALLBACK_BASE ?? 'http://localhost:3001'}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/google/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  if (!code) { res.status(400).send('Missing code'); return; }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${process.env.OAUTH_CALLBACK_BASE ?? 'http://localhost:3001'}/auth/google/callback`,
      }),
    });
    const tokenData = await tokenRes.json() as { access_token?: string; id_token?: string };

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json() as { sub?: string; email?: string; name?: string; given_name?: string };

    if (!profile.sub) { res.status(400).send('OAuth profile missing id'); return; }

    let user = await queries.getUserByOAuth('google', profile.sub);
    if (!user) {
      const baseUsername = (profile.given_name ?? profile.name ?? profile.email?.split('@')[0] ?? 'user').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 28);
      let username = baseUsername || 'user';
      let attempt = 0;
      while (await queries.getUserByUsername(username)) {
        username = `${baseUsername}${++attempt}`;
      }
      await queries.createOAuthUser(username, 'google', profile.sub, profile.email);
      user = await queries.getUserByOAuth('google', profile.sub);
      if (!user) { res.status(500).send('Failed to create user'); return; }
    }

    const token = signToken({ userId: user.id, username: user.username });
    const clientOrigin = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';
    res.redirect(`${clientOrigin}/?oauth_token=${encodeURIComponent(token)}&oauth_username=${encodeURIComponent(user.username)}&oauth_userId=${user.id}`);
  } catch (err) {
    console.error('[oauth:google]', err);
    res.status(500).send('OAuth failed');
  }
});

// ── GitHub OAuth ──────────────────────────────────────────────────────────────

router.get('/github', (req: Request, res: Response) => {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID ?? '',
    redirect_uri: `${process.env.OAUTH_CALLBACK_BASE ?? 'http://localhost:3001'}/auth/github/callback`,
    scope: 'read:user user:email',
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

router.get('/github/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  if (!code) { res.status(400).send('Missing code'); return; }

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        client_id: process.env.GITHUB_CLIENT_ID ?? '',
        client_secret: process.env.GITHUB_CLIENT_SECRET ?? '',
        code,
        redirect_uri: `${process.env.OAUTH_CALLBACK_BASE ?? 'http://localhost:3001'}/auth/github/callback`,
      }),
    });
    const tokenData = await tokenRes.json() as { access_token?: string };

    if (!tokenData.access_token) { res.status(400).send('Failed to get GitHub access token'); return; }

    const profileRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'User-Agent': 'hum-app',
      },
    });
    const profile = await profileRes.json() as { id?: number; login?: string; email?: string | null };

    if (!profile.id) { res.status(400).send('OAuth profile missing id'); return; }

    // Get primary email if not provided on the profile
    let email = profile.email ?? undefined;
    if (!email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'User-Agent': 'hum-app',
        },
      });
      const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
      const primary = emails.find(e => e.primary && e.verified);
      email = primary?.email;
    }

    const oauthId = profile.id.toString();
    let user = await queries.getUserByOAuth('github', oauthId);
    if (!user) {
      const baseUsername = (profile.login ?? 'user').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 28);
      let username = baseUsername || 'user';
      let attempt = 0;
      while (await queries.getUserByUsername(username)) {
        username = `${baseUsername}${++attempt}`;
      }
      await queries.createOAuthUser(username, 'github', oauthId, email);
      user = await queries.getUserByOAuth('github', oauthId);
      if (!user) { res.status(500).send('Failed to create user'); return; }
    }

    const token = signToken({ userId: user.id, username: user.username });
    const clientOrigin = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';
    res.redirect(`${clientOrigin}/?oauth_token=${encodeURIComponent(token)}&oauth_username=${encodeURIComponent(user.username)}&oauth_userId=${user.id}`);
  } catch (err) {
    console.error('[oauth:github]', err);
    res.status(500).send('OAuth failed');
  }
});

export default router;
