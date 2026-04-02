import { Router, Response } from 'express';
import crypto from 'crypto';
import { AccessToken } from 'livekit-server-sdk';
import { queries, Channel, SpaceRole } from '../db.js';
import { requireAuth, AuthRequest } from '../middleware.js';
import { broadcast, getOnlineUserIds } from '../ws.js';

// Role hierarchy — higher number = more authority
const ROLE_RANK: Record<SpaceRole, number> = { owner: 4, admin: 3, moderator: 2, member: 1 };

function canManage(actor: SpaceRole, target: SpaceRole): boolean {
  return ROLE_RANK[actor] > ROLE_RANK[target];
}

const router = Router();

router.get('/', requireAuth, async (_req: AuthRequest, res: Response) => {
  const spaces = await queries.listSpaces();
  res.json(spaces);
});

router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const { name, description } = req.body as { name?: string; description?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: 'name required' });
    return;
  }
  try {
    const { id: spaceId } = await queries.createSpace(name.trim(), description?.trim() ?? null, req.user!.userId);
    // Seed default channel and add creator as owner
    await queries.createChannel(spaceId, 'general', 'text', req.user!.userId);
    await queries.addSpaceMember(spaceId, req.user!.userId, 'owner');
    const space = await queries.getSpaceById(spaceId);
    res.status(201).json(space);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE') || err instanceof Error && err.message.includes('unique')) {
      res.status(409).json({ error: 'space name already taken' });
    } else {
      throw err;
    }
  }
});

router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const space = await queries.getSpaceById(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }
  if (space.created_by !== req.user!.userId) { res.status(403).json({ error: 'only the owner can delete this server' }); return; }
  await queries.deleteSpace(spaceId, req.user!.userId);
  res.status(204).end();
});

router.get('/:id/channels', requireAuth, async (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const space = await queries.getSpaceById(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }
  const channels = await queries.listChannels(spaceId);
  res.json(channels);
});

router.post('/:id/channels', requireAuth, async (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const space = await queries.getSpaceById(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }
  const actor = await queries.getSpaceMember(spaceId, req.user!.userId);
  if (!actor || ROLE_RANK[actor.role as SpaceRole] < ROLE_RANK.admin) {
    res.status(403).json({ error: 'only admins and owners can create channels' }); return;
  }
  const { name, type = 'text' } = req.body as { name?: string; type?: string };
  if (!name?.trim()) { res.status(400).json({ error: 'name required' }); return; }
  if (type !== 'text' && type !== 'voice') { res.status(400).json({ error: 'type must be text or voice' }); return; }
  try {
    const { id: channelId } = await queries.createChannel(spaceId, name.trim(), type, req.user!.userId);
    const channel = await queries.getChannelById(channelId);
    res.status(201).json(channel);
  } catch (err: unknown) {
    if (err instanceof Error && (err.message.includes('UNIQUE') || err.message.includes('unique'))) {
      res.status(409).json({ error: 'channel already exists' });
    } else {
      throw err;
    }
  }
});

router.delete('/:id/channels/:channelId', requireAuth, async (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const channelId = Number(req.params.channelId);
  const space = await queries.getSpaceById(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }
  const actor = await queries.getSpaceMember(spaceId, req.user!.userId);
  if (!actor || ROLE_RANK[actor.role as SpaceRole] < ROLE_RANK.admin) {
    res.status(403).json({ error: 'only admins and owners can delete channels' }); return;
  }
  const channel = await queries.getChannelById(channelId) as Channel | undefined;
  if (!channel || channel.space_id !== spaceId) { res.status(404).json({ error: 'channel not found' }); return; }
  await queries.deleteChannel(channelId, spaceId);
  res.status(204).end();
});

router.get('/:id/messages', requireAuth, async (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const channel = typeof req.query.channel === 'string' ? req.query.channel : 'general';
  const space = await queries.getSpaceById(spaceId);
  if (!space) {
    res.status(404).json({ error: 'space not found' });
    return;
  }
  const messages = await queries.getMessages(spaceId, channel, limit);
  if (messages.length > 0) {
    const msgIds = messages.map(m => m.id);
    const attachmentMap = await queries.getAttachmentsForMessages(msgIds);
    for (const m of messages) {
      m.attachments = attachmentMap[m.id] ?? [];
    }
  }
  res.json(messages);
});

router.patch('/:id/messages/:messageId', requireAuth, async (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const messageId = Number(req.params.messageId);
  const { content } = req.body as { content?: string };

  if (!content?.trim()) { res.status(400).json({ error: 'content required' }); return; }

  const space = await queries.getSpaceById(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }

  const message = await queries.getMessageById(messageId);
  if (!message || message.space_id !== spaceId) { res.status(404).json({ error: 'message not found' }); return; }
  if (message.user_id !== req.user!.userId) { res.status(403).json({ error: "cannot edit another user's message" }); return; }

  const trimmed = content.trim();
  const updated = await queries.updateMessage(trimmed, messageId, req.user!.userId);
  if (!updated) { res.status(404).json({ error: 'message not found' }); return; }

  const fresh = await queries.getMessageById(messageId);
  const editedAt = fresh?.updated_at ?? Math.floor(Date.now() / 1000);

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

router.delete('/:id/messages/:messageId', requireAuth, async (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const messageId = Number(req.params.messageId);

  const space = await queries.getSpaceById(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }

  const message = await queries.getMessageById(messageId);
  if (!message || message.space_id !== spaceId) { res.status(404).json({ error: 'message not found' }); return; }
  if (message.user_id !== req.user!.userId) { res.status(403).json({ error: "cannot delete another user's message" }); return; }

  const deleted = await queries.softDeleteMessage(messageId, req.user!.userId);
  if (!deleted) { res.status(404).json({ error: 'message not found' }); return; }

  broadcast(spaceId, message.channel, {
    type: 'message:delete',
    messageId,
  });

  res.status(204).end();
});

// ── Full-text search ─────────────────────────────────────────────────────────

router.get('/:id/search', requireAuth, async (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const channel = typeof req.query.channel === 'string' ? req.query.channel : null;
  const limit = Math.min(Number(req.query.limit) || 25, 100);

  if (!q) { res.json([]); return; }
  const space = await queries.getSpaceById(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }
  const results = await queries.searchMessages(spaceId, q, channel, limit);
  res.json(results);
});

router.patch('/:id/channels/:channelId/topic', requireAuth, async (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const channelId = Number(req.params.channelId);
  const { topic } = req.body as { topic?: string | null };

  const space = await queries.getSpaceById(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }

  const channel = await queries.getChannelById(channelId) as Channel | undefined;
  if (!channel || channel.space_id !== spaceId) { res.status(404).json({ error: 'channel not found' }); return; }

  const topicValue = typeof topic === 'string' ? topic.trim() || null : null;
  const updated = await queries.updateChannelTopic(channelId, spaceId, topicValue, req.user!.userId);
  if (!updated) { res.status(403).json({ error: 'not authorized to edit this channel' }); return; }

  res.json({ id: channelId, topic: topicValue });
});

// ── Members ──────────────────────────────────────────────────────────────────

router.get('/:id/members', requireAuth, async (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const space = await queries.getSpaceById(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }
  const members = await queries.listSpaceMembers(spaceId);
  const onlineIds = getOnlineUserIds();
  res.json(members.map(m => ({ ...m, is_online: onlineIds.has(m.user_id) })));
});

router.patch('/:id/members/:userId', requireAuth, async (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const targetUserId = Number(req.params.userId);
  const { role } = req.body as { role?: string };
  const validRoles: SpaceRole[] = ['admin', 'moderator', 'member'];
  if (!role || !validRoles.includes(role as SpaceRole)) {
    res.status(400).json({ error: 'role must be one of: admin, moderator, member' }); return;
  }
  const space = await queries.getSpaceById(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }
  const actor = await queries.getSpaceMember(spaceId, req.user!.userId);
  if (!actor) { res.status(403).json({ error: 'not a member' }); return; }
  const target = await queries.getSpaceMember(spaceId, targetUserId);
  if (!target) { res.status(404).json({ error: 'member not found' }); return; }
  if (target.role === 'owner') { res.status(403).json({ error: 'cannot change the owner\'s role' }); return; }
  // Actor must outrank the target and the new role
  if (!canManage(actor.role as SpaceRole, target.role as SpaceRole)) {
    res.status(403).json({ error: 'insufficient permissions' }); return;
  }
  if (!canManage(actor.role as SpaceRole, role as SpaceRole)) {
    res.status(403).json({ error: 'cannot assign a role equal to or higher than your own' }); return;
  }
  await queries.updateMemberRole(spaceId, targetUserId, role as SpaceRole);
  broadcast(spaceId, 'general', { type: 'member:role_update', spaceId, userId: targetUserId, role });
  res.json({ userId: targetUserId, role });
});

router.delete('/:id/members/:userId', requireAuth, async (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const targetUserId = Number(req.params.userId);
  const space = await queries.getSpaceById(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }
  const actor = await queries.getSpaceMember(spaceId, req.user!.userId);
  if (!actor) { res.status(403).json({ error: 'not a member' }); return; }
  const target = await queries.getSpaceMember(spaceId, targetUserId);
  if (!target) { res.status(404).json({ error: 'member not found' }); return; }
  if (target.role === 'owner') { res.status(403).json({ error: 'cannot kick the owner' }); return; }
  if (!canManage(actor.role as SpaceRole, target.role as SpaceRole)) {
    res.status(403).json({ error: 'insufficient permissions to kick this member' }); return;
  }
  await queries.removeMember(spaceId, targetUserId);
  broadcast(spaceId, 'general', { type: 'member:kick', spaceId, userId: targetUserId });
  res.status(204).end();
});

// ── Unread counts ─────────────────────────────────────────────────────────────

router.get('/:id/unread', requireAuth, async (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const space = await queries.getSpaceById(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }
  const rows = await queries.getUnreadCounts(req.user!.userId, spaceId);
  const result: Record<string, number> = {};
  for (const row of rows) { result[row.channel] = Number(row.count); }
  res.json(result);
});

router.post('/:id/channels/:channelName/read', requireAuth, async (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const channelName = req.params.channelName;
  const { lastReadMessageId } = req.body as { lastReadMessageId?: number };
  if (typeof lastReadMessageId !== 'number') { res.status(400).json({ error: 'lastReadMessageId required' }); return; }
  const space = await queries.getSpaceById(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }
  await queries.markChannelRead(req.user!.userId, spaceId, channelName, lastReadMessageId);
  res.status(204).end();
});

// ── Direct Messages ───────────────────────────────────────────────────────────

router.get('/:id/dms', requireAuth, async (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const space = await queries.getSpaceById(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }
  const member = await queries.getSpaceMember(spaceId, req.user!.userId);
  if (!member) { res.status(403).json({ error: 'not a member' }); return; }
  const onlineIds = getOnlineUserIds();
  const dms = await queries.listDmChannels(spaceId, req.user!.userId);
  res.json(dms.map(dm => ({ ...dm, is_online: onlineIds.has(dm.other_user_id) })));
});

router.post('/:id/dms', requireAuth, async (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const space = await queries.getSpaceById(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }
  const member = await queries.getSpaceMember(spaceId, req.user!.userId);
  if (!member) { res.status(403).json({ error: 'not a member' }); return; }

  const { targetUserId } = req.body as { targetUserId?: number };
  if (!targetUserId || isNaN(Number(targetUserId))) { res.status(400).json({ error: 'targetUserId required' }); return; }
  const targetId = Number(targetUserId);
  if (targetId === req.user!.userId) { res.status(400).json({ error: 'cannot DM yourself' }); return; }

  const targetMember = await queries.getSpaceMember(spaceId, targetId);
  if (!targetMember) { res.status(404).json({ error: 'target user is not a member of this space' }); return; }

  const existing = await queries.findDmChannel(spaceId, req.user!.userId, targetId);
  if (existing) {
    res.json({ channelId: existing.id });
    return;
  }
  const { id } = await queries.createDmChannel(spaceId, req.user!.userId, targetId, req.user!.userId);
  res.status(201).json({ channelId: id });
});

// ── Invites ───────────────────────────────────────────────────────────────────

router.post('/:id/invites', requireAuth, async (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const space = await queries.getSpaceById(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }
  const token = crypto.randomBytes(8).toString('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days
  await queries.createInviteToken(token, spaceId, req.user!.userId, expiresAt);
  res.status(201).json({ token, expiresAt });
});

// ── Message reactions ─────────────────────────────────────────────────────────

router.post('/:id/messages/:messageId/reactions', requireAuth, async (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const messageId = Number(req.params.messageId);
  const { emoji } = req.body as { emoji?: string };
  if (!emoji?.trim()) { res.status(400).json({ error: 'emoji required' }); return; }

  const space = await queries.getSpaceById(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }

  const message = await queries.getMessageById(messageId);
  if (!message || message.space_id !== spaceId) { res.status(404).json({ error: 'message not found' }); return; }

  await queries.addReaction(messageId, req.user!.userId, emoji.trim());

  broadcast(spaceId, message.channel, {
    type: 'message:reaction',
    reaction: { messageId, emoji: emoji.trim(), userId: req.user!.userId, username: req.user!.username, action: 'add' },
  });

  res.status(204).end();
});

router.delete('/:id/messages/:messageId/reactions/:emoji', requireAuth, async (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const messageId = Number(req.params.messageId);
  const emoji = decodeURIComponent(req.params.emoji);

  const space = await queries.getSpaceById(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }

  const message = await queries.getMessageById(messageId);
  if (!message || message.space_id !== spaceId) { res.status(404).json({ error: 'message not found' }); return; }

  await queries.removeReaction(messageId, req.user!.userId, emoji);

  broadcast(spaceId, message.channel, {
    type: 'message:reaction',
    reaction: { messageId, emoji, userId: req.user!.userId, username: req.user!.username, action: 'remove' },
  });

  res.status(204).end();
});

// ── LiveKit voice token ────────────────────────────────────────────────────────

router.get('/:id/channels/:channelId/voice-token', requireAuth, async (req: AuthRequest, res: Response) => {
  const spaceId = Number(req.params.id);
  const { channelId } = req.params;

  const space = await queries.getSpaceById(spaceId);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const livekitUrl = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !livekitUrl) {
    res.status(503).json({ error: 'voice service unavailable' });
    return;
  }

  const roomName = `${spaceId}:${channelId}`;
  const identity = String(req.user!.userId);

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name: req.user!.username,
    ttl: 3600,
  });
  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });

  const token = await at.toJwt();
  res.json({ token, url: livekitUrl });
});

export default router;
