import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import rateLimit from 'express-rate-limit';
import { initDb, queries } from './db.js';
import { sendDigestEmail } from './email.js';
import authRouter from './routes/auth.js';
import spacesRouter from './routes/spaces.js';
import invitesRouter from './routes/invites.js';
import { createWsServer } from './ws.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173' }));
app.use(express.json());

// ── Rate limiters ─────────────────────────────────────────────────────────────

// Auth endpoints: 10 attempts per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: () => !!process.env.DISABLE_RATE_LIMIT,
});

// General API: 200 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: () => !!process.env.DISABLE_RATE_LIMIT,
});

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

app.get('/health', (_req, res) => res.json({ ok: true }));

// Invite redirect: GET /invite/:token -> redirect to SPA with token in query
app.get('/invite/:token', (req, res) => {
  res.redirect(`${CLIENT_ORIGIN}?invite=${encodeURIComponent(req.params.token)}`);
});

app.use('/api/auth', authLimiter, authRouter);
app.use('/api/spaces', apiLimiter, spacesRouter);
app.use('/api/invite', apiLimiter, invitesRouter);

const server = createServer(app);
createWsServer(server);

// ── Email digest runner ────────────────────────────────────────────────────────
// Runs every 5 minutes; groups pending notifications by user and sends one email per user.

const DIGEST_INTERVAL_MS = 5 * 60 * 1000;

async function runDigest() {
  try {
    const pending = await queries.getPendingNotifications();
    if (pending.length === 0) return;

    // Group by user
    const byUser = new Map<number, typeof pending>();
    for (const n of pending) {
      if (!byUser.has(n.user_id)) byUser.set(n.user_id, []);
      byUser.get(n.user_id)!.push(n);
    }

    const sentIds: number[] = [];
    for (const [, notifs] of byUser) {
      const { email, username } = notifs[0];
      try {
        await sendDigestEmail(email, username, notifs);
        sentIds.push(...notifs.map(n => n.id));
      } catch (err) {
        console.error('[digest] failed to send email to', email, err);
      }
    }

    if (sentIds.length > 0) {
      await queries.markNotificationsSent(sentIds);
      console.log(`[digest] sent ${sentIds.length} notification(s) to ${byUser.size} user(s)`);
    }
  } catch (err) {
    console.error('[digest] runner error:', err);
  }
}

initDb().then(() => {
  server.listen(PORT, () => {
    console.log(`[hum] server listening on http://localhost:${PORT}`);
  });
  setInterval(() => { void runDigest(); }, DIGEST_INTERVAL_MS);
}).catch((err) => {
  console.error('[hum] failed to initialize database:', err);
  process.exit(1);
});
