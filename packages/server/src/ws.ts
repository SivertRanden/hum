import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { verifyToken } from './auth.js';
import { queries } from './db.js';
import { extractUrls, fetchLinkPreview, LinkPreview } from './ogFetch.js';

interface HumSocket extends WebSocket {
  userId?: number;
  username?: string;
  spaceId?: number;
  channelId?: string;
}

// ── Text chat types ───────────────────────────────────────────────────────────

interface ClientMessage {
  type: 'join' | 'message' | 'voice:join' | 'voice:leave' | 'typing_start' | 'typing_stop' | 'reaction:toggle';
  spaceId?: number;
  channelId?: string;
  content?: string;
  token?: string;
  // reaction fields
  messageId?: number;
  emoji?: string;
  // attachment fields
  attachmentId?: number;
}

interface ReactionGroup {
  emoji: string;
  userIds: number[];
  usernames: string[];
}

interface ServerMessage {
  type: 'joined' | 'message' | 'message:edit' | 'message:delete' | 'error' | 'history'
      | 'voice:joined' | 'voice:presence' | 'voice:peer_left'
      | 'typing' | 'presence_update' | 'mention' | 'channel:new_message' | 'message:reaction'
      | 'message:link_preview' | 'member:role_update' | 'member:kick' | 'member:joined';
  role?: string;
  // member:joined payload
  member?: { userId: number; username: string; role: string; joinedAt: number };
  // link preview fields
  linkPreview?: { messageId: number; previews: LinkPreview[] };
  spaceId?: number;
  channelId?: string;
  // typing indicator fields
  isTyping?: boolean;
  username?: string;
  message?: {
    id: number;
    spaceId: number;
    channelId: string;
    userId: number;
    username: string;
    content: string;
    createdAt: number;
    editedAt?: number;
    pinnedAt?: number | null;
    reactions?: ReactionGroup[];
    attachments?: { id: number; filename: string; url: string; mimeType: string; size: number }[];
    linkPreviews?: LinkPreview[];
    replyCount?: number;
  };
  messages?: ServerMessage['message'][];
  messageId?: number;
  error?: string;
  // voice presence fields
  peers?: Array<{ userId: number; username: string }>;
  userId?: number;
  // presence fields
  isOnline?: boolean;
  lastSeenAt?: number;
  // reaction fields
  reaction?: { messageId: number; emoji: string; userId: number; username: string; action: 'add' | 'remove' };
}

// ── Room key ─────────────────────────────────────────────────────────────────

function roomKey(spaceId: number, channelId: string): string {
  return `${spaceId}:${channelId}`;
}

// ── @mention parser ───────────────────────────────────────────────────────────

function parseMentions(content: string): string[] {
  const matches = content.matchAll(/@([a-zA-Z0-9_-]{2,32})/g);
  return [...new Set([...matches].map(m => m[1].toLowerCase()))];
}

// ── WebSocket message rate limiter ────────────────────────────────────────────
// 20 messages per 10 seconds per user

const WS_RATE_WINDOW_MS = 10_000;
const WS_RATE_MAX = 20;

interface RateEntry { count: number; windowStart: number }
const wsRateLimits = new Map<number, RateEntry>();

function isWsRateLimited(userId: number): boolean {
  const now = Date.now();
  const entry = wsRateLimits.get(userId);
  if (!entry || now - entry.windowStart >= WS_RATE_WINDOW_MS) {
    wsRateLimits.set(userId, { count: 1, windowStart: now });
    return false;
  }
  if (entry.count >= WS_RATE_MAX) return true;
  entry.count++;
  return false;
}

// ── Typing state ──────────────────────────────────────────────────────────────
// roomKey -> Map<userId, auto-clear timer>

const typingTimers = new Map<string, Map<number, ReturnType<typeof setTimeout>>>();

function broadcastTyping(spaceId: number, channelId: string, socket: HumSocket, isTyping: boolean) {
  if (socket.userId === undefined || !socket.username) return;
  broadcast(spaceId, channelId, {
    type: 'typing',
    userId: socket.userId,
    username: socket.username,
    isTyping,
  }, socket);
}

function clearTypingTimer(key: string, userId: number) {
  const timers = typingTimers.get(key);
  if (!timers) return;
  const t = timers.get(userId);
  if (t !== undefined) { clearTimeout(t); timers.delete(userId); }
  if (timers.size === 0) typingTimers.delete(key);
}

// ── Presence tracking ─────────────────────────────────────────────────────────
// connectedUsers: userId -> all sockets for that user (across tabs)
const connectedUsers = new Map<number, Set<HumSocket>>();
// spaceConnections: spaceId -> all authenticated sockets currently in that space
const spaceConnections = new Map<number, Set<HumSocket>>();

export function getOnlineUserIds(): Set<number> {
  return new Set(connectedUsers.keys());
}

export function broadcastToSpace(spaceId: number, payload: ServerMessage, exclude?: HumSocket) {
  const conns = spaceConnections.get(spaceId);
  if (!conns) return;
  const data = JSON.stringify(payload);
  for (const s of conns) {
    if (s !== exclude && s.readyState === WebSocket.OPEN) s.send(data);
  }
}

// ── Text chat rooms ───────────────────────────────────────────────────────────

const rooms = new Map<string, Set<HumSocket>>();

export function broadcast(spaceId: number, channelId: string, payload: ServerMessage, exclude?: HumSocket) {
  const room = rooms.get(roomKey(spaceId, channelId));
  if (!room) return;
  const data = JSON.stringify(payload);
  for (const client of room) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function joinRoom(socket: HumSocket, spaceId: number, channelId: string) {
  // Leave old room and update space tracking if switching spaces
  if (socket.spaceId !== undefined && socket.channelId !== undefined) {
    rooms.get(roomKey(socket.spaceId, socket.channelId))?.delete(socket);
    if (socket.spaceId !== spaceId) {
      spaceConnections.get(socket.spaceId)?.delete(socket);
    }
  }
  socket.spaceId = spaceId;
  socket.channelId = channelId;
  const key = roomKey(spaceId, channelId);
  if (!rooms.has(key)) rooms.set(key, new Set());
  rooms.get(key)!.add(socket);
  // Track space-level connection for presence broadcasts
  if (!spaceConnections.has(spaceId)) spaceConnections.set(spaceId, new Set());
  spaceConnections.get(spaceId)!.add(socket);
}

// ── Voice rooms ───────────────────────────────────────────────────────────────
// voiceRooms: key = "<spaceId>:<channelId>", value = Map<userId, socket>

const voiceRooms = new Map<string, Map<number, HumSocket>>();

function voiceRoomParticipants(key: string): Array<{ userId: number; username: string }> {
  const room = voiceRooms.get(key);
  if (!room) return [];
  return Array.from(room.entries()).map(([userId, s]) => ({ userId, username: s.username ?? '' }));
}

function broadcastVoicePresence(spaceId: number, channelId: string) {
  const key = roomKey(spaceId, channelId);
  const room = voiceRooms.get(key);
  if (!room) return;
  const peers = voiceRoomParticipants(key);
  const data = JSON.stringify({ type: 'voice:presence', spaceId, channelId, peers } satisfies ServerMessage);
  for (const s of room.values()) {
    if (s.readyState === WebSocket.OPEN) s.send(data);
  }
}

function leaveVoiceRoom(socket: HumSocket, spaceId: number, channelId: string) {
  const key = roomKey(spaceId, channelId);
  const room = voiceRooms.get(key);
  if (!room || socket.userId === undefined) return;
  room.delete(socket.userId);
  if (room.size === 0) {
    voiceRooms.delete(key);
  }
  // Notify remaining peers that this user left
  const leaveMsg = JSON.stringify({ type: 'voice:peer_left', userId: socket.userId } satisfies ServerMessage);
  for (const s of (voiceRooms.get(key)?.values() ?? [])) {
    if (s.readyState === WebSocket.OPEN) s.send(leaveMsg);
  }
  broadcastVoicePresence(spaceId, channelId);
}

// ── WebSocket server ──────────────────────────────────────────────────────────

export function createWsServer(server: import('http').Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Absorb server-level errors (e.g. ECONNRESET during Vite proxy teardown in E2E).
  wss.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
      console.error('[ws] server error:', err);
    }
  });

  wss.on('connection', (socket: HumSocket, _req: IncomingMessage) => {
    // Track which voice rooms this socket has joined (for cleanup on disconnect)
    const activeVoiceRooms = new Set<string>(); // "<spaceId>:<channelId>"

    // Absorb EPIPE/ECONNRESET emitted when a browser navigates away mid-connection.
    // Without this handler Node.js treats the error event as an uncaught exception
    // and terminates the process, taking down all subsequent E2E tests.
    socket.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
        console.error('[ws] socket error:', err);
      }
    });

    socket.on('message', async (raw) => {
      try {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        socket.send(JSON.stringify({ type: 'error', error: 'invalid JSON' } satisfies ServerMessage));
        return;
      }

      // ── join (text channel) ───────────────────────────────────────────────
      if (msg.type === 'join') {
        if (!socket.userId) {
          if (!msg.token) {
            socket.send(JSON.stringify({ type: 'error', error: 'token required' } satisfies ServerMessage));
            return;
          }
          try {
            const payload = verifyToken(msg.token);
            socket.userId = payload.userId;
            socket.username = payload.username;
          } catch {
            socket.send(JSON.stringify({ type: 'error', error: 'invalid token' } satisfies ServerMessage));
            return;
          }
        }

        const spaceId = Number(msg.spaceId);
        const channelId = msg.channelId ?? 'general';

        const space = await queries.getSpaceById(spaceId);
        if (!space) {
          socket.send(JSON.stringify({ type: 'error', error: 'space not found' } satisfies ServerMessage));
          return;
        }

        // For DM channels, verify the user is a member of that DM
        if (channelId.startsWith('dm:')) {
          const dmChannelId = Number(channelId.slice(3));
          const isMember = await queries.isUserDmMember(dmChannelId, socket.userId);
          if (!isMember) {
            socket.send(JSON.stringify({ type: 'error', error: 'not a member of this DM' } satisfies ServerMessage));
            return;
          }
        }

        // Track presence: register user connection before joining room
        const wasOffline = !connectedUsers.has(socket.userId);
        if (!connectedUsers.has(socket.userId)) connectedUsers.set(socket.userId, new Set());
        connectedUsers.get(socket.userId)!.add(socket);

        joinRoom(socket, spaceId, channelId);

        // Broadcast online presence to others in space when user first connects
        if (wasOffline) {
          void queries.updateLastSeen(socket.userId);
          const now = Math.floor(Date.now() / 1000);
          broadcastToSpace(spaceId, {
            type: 'presence_update',
            userId: socket.userId,
            isOnline: true,
            lastSeenAt: now,
          }, socket);
        }

        const rawHistory = await queries.getMessages(spaceId, channelId, 100);
        const messageIds = rawHistory.map(m => m.id);
        const reactionsMap = await queries.getReactionsForMessages(messageIds);

        const history = rawHistory.map((m) => {
          const msgReactions = reactionsMap[m.id] ?? [];
          const grouped: ReactionGroup[] = [];
          for (const r of msgReactions) {
            const existing = grouped.find(g => g.emoji === r.emoji);
            if (existing) {
              existing.userIds.push(r.user_id);
              existing.usernames.push(r.username ?? '');
            } else {
              grouped.push({ emoji: r.emoji, userIds: [r.user_id], usernames: [r.username ?? ''] });
            }
          }
          let linkPreviews: LinkPreview[] | undefined;
          if (m.link_previews) {
            try { linkPreviews = JSON.parse(m.link_previews) as LinkPreview[]; } catch { /* ignore */ }
          }
          return {
            id: m.id,
            spaceId: m.space_id,
            channelId: m.channel,
            userId: m.user_id,
            username: m.username ?? '',
            content: m.content,
            createdAt: m.created_at,
            editedAt: m.updated_at ?? undefined,
            pinnedAt: m.pinned_at ?? undefined,
            reactions: grouped.length > 0 ? grouped : undefined,
            linkPreviews,
            replyCount: m.reply_count ?? 0,
          };
        });

        socket.send(JSON.stringify({ type: 'history', messages: history } satisfies ServerMessage));
        socket.send(JSON.stringify({ type: 'joined', spaceId, channelId } satisfies ServerMessage));
        return;
      }

      // ── message (text chat) ───────────────────────────────────────────────
      if (msg.type === 'message') {
        if (!socket.userId || socket.spaceId === undefined || socket.channelId === undefined) {
          socket.send(JSON.stringify({ type: 'error', error: 'join a space first' } satisfies ServerMessage));
          return;
        }
        if (isWsRateLimited(socket.userId)) {
          socket.send(JSON.stringify({ type: 'error', error: 'rate limit exceeded \u2014 slow down' } satisfies ServerMessage));
          return;
        }
        const content = msg.content?.trim() ?? '';
        if (!content && !msg.attachmentId) {
          socket.send(JSON.stringify({ type: 'error', error: 'empty message' } satisfies ServerMessage));
          return;
        }

        const { id: messageId } = await queries.insertMessage(socket.spaceId, socket.userId, socket.channelId, content || '');
        const now = Math.floor(Date.now() / 1000);

        // Link pending attachment to message if provided
        let attachments: { id: number; filename: string; url: string; mimeType: string; size: number }[] = [];
        if (msg.attachmentId) {
          await queries.linkAttachmentToMessage(msg.attachmentId, messageId);
          const map = await queries.getAttachmentsForMessages([messageId]);
          attachments = (map[messageId] ?? []).map(a => ({
            id: a.id,
            filename: a.filename,
            url: `/uploads/${a.storage_key}`,
            mimeType: a.mime_type,
            size: a.size,
          }));
        }

        const outbound: ServerMessage = {
          type: 'message',
          message: {
            id: messageId,
            spaceId: socket.spaceId,
            channelId: socket.channelId,
            userId: socket.userId,
            username: socket.username ?? '',
            content,
            createdAt: now,
            attachments,
          },
        };

        broadcast(socket.spaceId, socket.channelId, outbound);

        // ── Async URL unfurling ───────────────────────────────────────────
        {
          const urls = extractUrls(content);
          if (urls.length > 0) {
            const spaceId = socket.spaceId;
            const channelId = socket.channelId;
            void (async () => {
              try {
                const results = await Promise.all(urls.map(u => fetchLinkPreview(u)));
                const previews = results.filter((p): p is LinkPreview => p !== null);
                if (previews.length > 0) {
                  await queries.storeLinkPreviews(messageId, JSON.stringify(previews));
                  broadcast(spaceId, channelId, {
                    type: 'message:link_preview',
                    linkPreview: { messageId, previews },
                  });
                }
              } catch {
                // Non-fatal — link preview fetch failures don't affect message delivery
              }
            })();
          }
        }

        // ── Notify other channels in space of new unread message ──────────
        {
          const newMsgPayload = JSON.stringify({
            type: 'channel:new_message',
            spaceId: socket.spaceId,
            channelId: socket.channelId,
          } satisfies ServerMessage);
          const conns = spaceConnections.get(socket.spaceId);
          if (conns) {
            for (const s of conns) {
              // Only notify sockets in a different channel (they didn't receive the full message)
              if (s !== socket && s.channelId !== socket.channelId && s.readyState === WebSocket.OPEN) {
                s.send(newMsgPayload);
              }
            }
          }
        }

        // ── @mention detection ────────────────────────────────────────────
        const mentionedUsernames = parseMentions(content);
        if (mentionedUsernames.length > 0) {
          const members = await queries.listSpaceMembers(socket.spaceId);
          const mentionPayload = JSON.stringify({
            type: 'mention',
            message: outbound.message,
          } satisfies ServerMessage);
          for (const member of members) {
            if (
              member.user_id !== socket.userId &&
              mentionedUsernames.includes(member.username.toLowerCase())
            ) {
              const sockets = connectedUsers.get(member.user_id);
              if (sockets) {
                for (const s of sockets) {
                  if (s.readyState === WebSocket.OPEN) s.send(mentionPayload);
                }
              } else {
                // User is offline — enqueue for email digest
                void queries.enqueueNotification(member.user_id, messageId, socket.spaceId, socket.channelId);
              }
            }
          }
        }

        return;
      }

      // ── voice:join ────────────────────────────────────────────────────────
      if (msg.type === 'voice:join') {
        if (!socket.userId) {
          socket.send(JSON.stringify({ type: 'error', error: 'not authenticated' } satisfies ServerMessage));
          return;
        }
        const spaceId = Number(msg.spaceId);
        const channelId = msg.channelId ?? '';
        if (!channelId) {
          socket.send(JSON.stringify({ type: 'error', error: 'channelId required' } satisfies ServerMessage));
          return;
        }

        const key = roomKey(spaceId, channelId);
        if (!voiceRooms.has(key)) voiceRooms.set(key, new Map());
        const room = voiceRooms.get(key)!;

        // Get existing peers before adding self
        const existingPeers = voiceRoomParticipants(key);

        // Add self
        room.set(socket.userId, socket);
        activeVoiceRooms.add(key);

        // Send back list of existing peers so client knows who to call
        socket.send(JSON.stringify({
          type: 'voice:joined',
          spaceId,
          channelId,
          peers: existingPeers,
        } satisfies ServerMessage));

        // Broadcast updated presence to all in room
        broadcastVoicePresence(spaceId, channelId);
        return;
      }

      // ── voice:leave ───────────────────────────────────────────────────────
      if (msg.type === 'voice:leave') {
        if (!socket.userId) return;
        const spaceId = Number(msg.spaceId);
        const channelId = msg.channelId ?? '';
        const key = roomKey(spaceId, channelId);
        activeVoiceRooms.delete(key);
        leaveVoiceRoom(socket, spaceId, channelId);
        return;
      }

      // ── typing_start / typing_stop ────────────────────────────────────────
      if (msg.type === 'typing_start' || msg.type === 'typing_stop') {
        if (!socket.userId || socket.spaceId === undefined || socket.channelId === undefined) return;
        const key = roomKey(socket.spaceId, socket.channelId);
        if (msg.type === 'typing_start') {
          broadcastTyping(socket.spaceId, socket.channelId, socket, true);
          clearTypingTimer(key, socket.userId);
          if (!typingTimers.has(key)) typingTimers.set(key, new Map());
          typingTimers.get(key)!.set(socket.userId, setTimeout(() => {
            if (socket.spaceId !== undefined && socket.channelId !== undefined) {
              broadcastTyping(socket.spaceId, socket.channelId, socket, false);
            }
            clearTypingTimer(key, socket.userId!);
          }, 3000));
        } else {
          broadcastTyping(socket.spaceId, socket.channelId, socket, false);
          clearTypingTimer(key, socket.userId);
        }
        return;
      }

      // ── reaction:toggle ───────────────────────────────────────────────────
      if (msg.type === 'reaction:toggle') {
        if (!socket.userId || socket.spaceId === undefined || socket.channelId === undefined) {
          socket.send(JSON.stringify({ type: 'error', error: 'join a space first' } satisfies ServerMessage));
          return;
        }
        const messageId = Number(msg.messageId);
        const emoji = msg.emoji?.trim();
        if (!messageId || !emoji) {
          socket.send(JSON.stringify({ type: 'error', error: 'messageId and emoji required' } satisfies ServerMessage));
          return;
        }
        const message = await queries.getMessageById(messageId);
        if (!message || message.space_id !== socket.spaceId) {
          socket.send(JSON.stringify({ type: 'error', error: 'message not found' } satisfies ServerMessage));
          return;
        }
        const existing = await queries.getReactionsForMessages([messageId]);
        const msgReactions = existing[messageId] ?? [];
        const alreadyReacted = msgReactions.some(r => r.user_id === socket.userId && r.emoji === emoji);

        if (alreadyReacted) {
          await queries.removeReaction(messageId, socket.userId, emoji);
          broadcast(socket.spaceId, socket.channelId, {
            type: 'message:reaction',
            reaction: { messageId, emoji, userId: socket.userId, username: socket.username ?? '', action: 'remove' },
          });
        } else {
          await queries.addReaction(messageId, socket.userId, emoji);
          broadcast(socket.spaceId, socket.channelId, {
            type: 'message:reaction',
            reaction: { messageId, emoji, userId: socket.userId, username: socket.username ?? '', action: 'add' },
          });
        }
        return;
      }

      socket.send(JSON.stringify({ type: 'error', error: 'unknown message type' } satisfies ServerMessage));
      } catch (err) {
        console.error('[ws] unhandled error in message handler:', err);
        try {
          socket.send(JSON.stringify({ type: 'error', error: 'internal server error' } satisfies ServerMessage));
        } catch { /* socket may be closed */ }
      }
    });

    socket.on('close', () => {
      // Clean up text chat room and typing state
      if (socket.spaceId !== undefined && socket.channelId !== undefined) {
        rooms.get(roomKey(socket.spaceId, socket.channelId))?.delete(socket);
        if (socket.userId !== undefined) {
          const key = roomKey(socket.spaceId, socket.channelId);
          broadcastTyping(socket.spaceId, socket.channelId, socket, false);
          clearTypingTimer(key, socket.userId);
        }
      }
      // Clean up space connections
      if (socket.spaceId !== undefined) {
        spaceConnections.get(socket.spaceId)?.delete(socket);
      }
      // Clean up presence tracking and broadcast offline status
      if (socket.userId !== undefined) {
        const userSockets = connectedUsers.get(socket.userId);
        if (userSockets) {
          userSockets.delete(socket);
          if (userSockets.size === 0) {
            connectedUsers.delete(socket.userId);
            void queries.updateLastSeen(socket.userId);
            const now = Math.floor(Date.now() / 1000);
            if (socket.spaceId !== undefined) {
              broadcastToSpace(socket.spaceId, {
                type: 'presence_update',
                userId: socket.userId,
                isOnline: false,
                lastSeenAt: now,
              });
            }
          }
        }
      }
      // Clean up all voice rooms this socket was in
      for (const key of activeVoiceRooms) {
        const [spaceIdStr, ...rest] = key.split(':');
        const channelId = rest.join(':');
        const spaceId = Number(spaceIdStr);
        leaveVoiceRoom(socket, spaceId, channelId);
      }
    });
  });

  return wss;
}
