import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import rateLimit from 'express-rate-limit';
import authRouter from './routes/auth.js';
import spacesRouter from './routes/spaces.js';
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
});

// General API: 200 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/spaces', apiLimiter, spacesRouter);

const server = createServer(app);
createWsServer(server);

server.listen(PORT, () => {
  console.log(`[hum] server listening on http://localhost:${PORT}`);
});
