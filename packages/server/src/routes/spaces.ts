import { Router, Response } from 'express';
import { queries, Channel } from '../db.js';
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
    const spaceId = Number(result.lastInsertRowid);
    // Seed default channels for new space
    queries.createChannel.run(spaceId, 'general', 'text', req.user!.userId);
    const space = queries.getSpaceById.get(spaceId);
    res.status(201).json(space);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      res.status(409).json({ error: 'space name already taken' });
    } else {
      throw err;
    }
  }
});

router.get('/:id/channels', requireAuth, (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const space = queries.getSpaceById.get(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }
  const channels = queries.listChannels.all(spaceId);
  res.json(channels);
});

router.post('/:id/channels', requireAuth, (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const space = queries.getSpaceById.get(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }
  const { name, type = 'text' } = req.body as { name?: string; type?: string };
  if (!name?.trim()) { res.status(400).json({ error: 'name required' }); return; }
  if (type !== 'text' && type !== 'voice') { res.status(400).json({ error: 'type must be text or voice' }); return; }
  try {
    const result = queries.createChannel.run(spaceId, name.trim(), type, req.user!.userId);
    const channel = queries.getChannelById.get(Number(result.lastInsertRowid));
    res.status(201).json(channel);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      res.status(409).json({ error: 'channel already exists' });
    } else {
      throw err;
    }
  }
});

router.delete('/:id/channels/:channelId', requireAuth, (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const channelId = Number(req.params.channelId);
  const space = queries.getSpaceById.get(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }
  const channel = queries.getChannelById.get(channelId) as Channel | undefined;
  if (!channel || channel.space_id !== spaceId) { res.status(404).json({ error: 'channel not found' }); return; }
  queries.deleteChannel.run(channelId, spaceId);
  res.status(204).end();
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
