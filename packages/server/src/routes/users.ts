import { Router, Response } from 'express';
import { queries } from '../db.js';
import { requireAuth, AuthRequest } from '../middleware.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Avatar storage: write base64 data URLs to the uploads directory
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.join(__dirname, '../../../uploads');
const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2 MB

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

// GET /api/users/:id — get user profile
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = Number(req.params.id);
  const user = await queries.getUserById(userId);
  if (!user) { res.status(404).json({ error: 'user not found' }); return; }
  res.json({
    id: user.id,
    username: user.username,
    displayName: user.display_name ?? null,
    avatarUrl: user.avatar_url ?? null,
  });
});

// PATCH /api/users/:id — update display name
router.patch('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = Number(req.params.id);
  if (req.user!.userId !== userId) {
    res.status(403).json({ error: 'cannot update another user\'s profile' });
    return;
  }
  const { displayName } = req.body as { displayName?: string | null };
  await queries.updateUserProfile(userId, displayName ?? null);
  const user = await queries.getUserById(userId);
  res.json({
    id: user!.id,
    username: user!.username,
    displayName: user!.display_name ?? null,
    avatarUrl: user!.avatar_url ?? null,
  });
});

// POST /api/users/:id/avatar — upload avatar as base64 data URL
router.post('/:id/avatar', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = Number(req.params.id);
  if (req.user!.userId !== userId) {
    res.status(403).json({ error: 'cannot update another user\'s avatar' });
    return;
  }
  const { dataUrl } = req.body as { dataUrl?: string };
  if (!dataUrl?.startsWith('data:image/')) {
    res.status(400).json({ error: 'invalid image data' });
    return;
  }
  const matches = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
  if (!matches) { res.status(400).json({ error: 'invalid data URL format' }); return; }
  const [, mimeType, base64Data] = matches;
  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length > MAX_AVATAR_SIZE) {
    res.status(400).json({ error: 'image too large (max 2 MB)' });
    return;
  }

  const ext = mimeType.split('/')[1].replace('jpeg', 'jpg').replace('+xml', '');
  ensureUploadsDir();
  const filename = `avatar_${userId}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const filePath = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(filePath, buffer);

  const avatarUrl = `/uploads/${filename}`;
  const user = await queries.getUserById(userId);
  await queries.updateUserProfile(userId, user?.display_name ?? null, avatarUrl);

  res.json({ avatarUrl });
});

// DELETE /api/users/:id/avatar — remove avatar
router.delete('/:id/avatar', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = Number(req.params.id);
  if (req.user!.userId !== userId) {
    res.status(403).json({ error: 'cannot update another user\'s avatar' });
    return;
  }
  const user = await queries.getUserById(userId);
  if (user?.avatar_url) {
    if (user.avatar_url.startsWith('/uploads/')) {
      const filePath = path.join(UPLOADS_DIR, path.basename(user.avatar_url));
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  }
  await queries.updateUserProfile(userId, user?.display_name ?? null, null);
  res.status(204).end();
});

export default router;
