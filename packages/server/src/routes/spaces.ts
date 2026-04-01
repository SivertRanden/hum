import { Router, Response } from 'express';
import { queries } from '../db.js';
import { requireAuth, AuthRequest } from '../middleware.js';

const router = Router();

router.get('/', requireAuth, (_req: AuthRequest, res: Response) => {
  const spaces = queries.listSpaces.all();
  res.json(spaces);
});

router.post('/', requireAuth, (req: AuthRequest, res: Response) => {
  const { name, description } = req.body as { name?: string; description?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: 'name required' });
    return;
  }
  try {
    const result = queries.createSpace.run(name.trim(), description?.trim() ?? null, req.user!.userId);
    const space = queries.getSpaceById.get(Number(result.lastInsertRowid));
    res.status(201).json(space);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      res.status(409).json({ error: 'space name already taken' });
    } else {
      throw err;
    }
  }
});

router.get('/:id/messages', requireAuth, (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const channel = typeof req.query.channel === 'string' ? req.query.channel : 'general';
  const space = queries.getSpaceById.get(spaceId);
  if (!space) {
    res.status(404).json({ error: 'space not found' });
    return;
  }
  const messages = queries.getMessages.all(spaceId, channel, limit);
  res.json(messages);
});

export default router;
