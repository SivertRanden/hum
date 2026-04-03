import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { initDb, queries } from './db.js';
import { sendDigestEmail } from './email.js';
import authRouter from './routes/auth.js';
import spacesRouter from './routes/spaces.js';
import invitesRouter from './routes/invites.js';
import { createWsServer } from './ws.js';
import { requireAuth, AuthRequest } from './middleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

// ── Uploads directory ──────────────────────────────────────────────────────────
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf', 'text/plain', 'text/markdown',
  'application/zip', 'application/gzip',
  'video/mp4', 'video/webm', 'audio/mpeg', 'audio/ogg',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  },
});

app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173' }));
app.use(express.json());

// Serve uploaded files
app.use('/uploads', express.static(UPLOADS_DIR));

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

// ── File upload endpoint ───────────────────────────────────────────────────────
app.post('/api/upload', apiLimiter, requireAuth, (req: AuthRequest, res) => {
  upload.single('file')(req as express.Request, res, async (err) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)` });
      return;
    }
    if (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Upload failed' });
      return;
    }
    const file = (req as express.Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }
    const { id } = await queries.insertAttachment(
      file.originalname,
      file.filename,
      file.mimetype,
      file.size,
    );
    res.status(201).json({
      id,
      url: `/uploads/${file.filename}`,
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    });
  });
});

app.use('/api/auth', authLimiter, authRouter);
app.use('/api/spaces', apiLimiter, spacesRouter);
app.use('/api/invite', apiLimiter, invitesRouter);

// Global error handler — must be defined after all routes
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[hum] unhandled error:', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error' });
});

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
