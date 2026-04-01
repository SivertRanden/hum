import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import authRouter from './routes/auth.js';
import spacesRouter from './routes/spaces.js';
import { createWsServer } from './ws.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173' }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/spaces', spacesRouter);

const server = createServer(app);
createWsServer(server);

server.listen(PORT, () => {
  console.log(`[hum] server listening on http://localhost:${PORT}`);
});
