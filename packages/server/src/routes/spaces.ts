import { Router, Response } from 'express';
import crypto from 'crypto';
import { queries, Channel } from '../db.js';
import { requireAuth, AuthRequest } from '../middleware.js';
import { broadcast, getOnlineUserIds } from '../ws.js';

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
    // Seed default channel and add creator as owner
    queries.createChannel.run(spaceId, 'general', 'text', req.user!.userId);
    queries.addSpaceMember.run(spaceId, req.user!.userId, 'owner');
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

router.delete('/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const space = queries.getSpaceById.get(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }
  if (space.created_by !== req.user!.userId) { res.status(403).json({ error: 'only the owner can delete this server' }); return; }
  queries.deleteSpace.run(spaceId, req.user!.userId);
  res.status(204).end();
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

router.patch('/:id/messages/:messageId', requireAuth, (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const messageId = Number(req.params.messageId);
  const { content } = req.body as { content?: string };

  if (!content?.trim()) { res.status(400).json({ error: 'content required' }); return; }

  const space = queries.getSpaceById.get(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }

  const message = queries.getMessageById.get(messageId);
  if (!message || message.space_id !== spaceId) { res.status(404).json({ error: 'message not found' }); return; }
  if (message.user_id !== req.user!.userId) { res.status(403).json({ error: "cannot edit another user's message" }); return; }

  const trimmed = content.trim();
  const result = queries.updateMessage.run(trimmed, messageId, req.user!.userId);
  if (result.changes === 0) { res.status(404).json({ error: 'message not found' }); return; }

  const updated = queries.getMessageById.get(messageId)!;
  const editedAt = updated.updated_at ?? Math.floor(Date.now() / 1000);

  broadcast(spaceId, message.channel, {
    type: 'message:edit',
    message: {
      id: messageId,
      spaceId,
      channelId: message.channel,
      userId: message.user_id,
      username: message.username ?? '',
      content: trimmed,
      createdAt: message.created_at,
      editedAt,
    },
  });

  res.json({ id: messageId, content: trimmed, editedAt });
});

router.delete('/:id/messages/:messageId', requireAuth, (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const messageId = Number(req.params.messageId);

  const space = queries.getSpaceById.get(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }

  const message = queries.getMessageById.get(messageId);
  if (!message || message.space_id !== spaceId) { res.status(404).json({ error: 'message not found' }); return; }
  if (message.user_id !== req.user!.userId) { res.status(403).json({ error: "cannot delete another user's message" }); return; }

  const result = queries.softDeleteMessage.run(messageId, req.user!.userId);
  if (result.changes === 0) { res.status(404).json({ error: 'message not found' }); return; }

  broadcast(spaceId, message.channel, {
    type: 'message:delete',
    messageId,
  });

  res.status(204).end();
});

// ── Members ──────────────────────────────────────────────────────────────────

router.get('/:id/members', requireAuth, (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const space = queries.getSpaceById.get(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }
  const members = queries.listSpaceMembers.all(spaceId);
  const onlineIds = getOnlineUserIds();
  res.json(members.map(m => ({ ...m, is_online: onlineIds.has(m.user_id) })));
});

// ── Invites ───────────────────────────────────────────────────────────────────

router.post('/:id/invites', requireAuth, (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const space = queries.getSpaceById.get(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }
  const token = crypto.randomBytes(8).toString('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days
  queries.createInviteToken.run(token, spaceId, req.user!.userId, expiresAt);
  res.status(201).json({ token, expiresAt });
});

export default router;
