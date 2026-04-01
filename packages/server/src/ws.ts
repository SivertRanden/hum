import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { verifyToken } from './auth.js';
import { queries } from './db.js';

interface HumSocket extends WebSocket {
  userId?: number;
  username?: string;
  spaceId?: number;
  channelId?: string;
}

// ── Text chat types ───────────────────────────────────────────────────────────

interface ClientMessage {
  type: 'join' | 'message' | 'voice:join' | 'voice:leave' | 'voice:offer' | 'voice:answer' | 'voice:ice' | 'typing_start' | 'typing_stop';
  spaceId?: number;
  channelId?: string;
  content?: string;
  token?: string;
  // voice signaling fields
  targetUserId?: number;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

interface ServerMessage {
  type: 'joined' | 'message' | 'message:edit' | 'message:delete' | 'error' | 'history'
      | 'voice:joined' | 'voice:presence' | 'voice:offer' | 'voice:answer' | 'voice:ice' | 'voice:peer_left'
      | 'typing' | 'presence_update';
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
  };
  messages?: ServerMessage['message'][];
  messageId?: number;
  error?: string;
  // voice signaling fields
  peers?: Array<{ userId: number; username: string }>;
  fromUserId?: number;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  userId?: number;
  // presence fields
  isOnline?: boolean;
  lastSeenAt?: number;
}

// ── Room key ─────────────────────────────────────────────────────────────────

function roomKey(spaceId: number, channelId: string): string {
  return `${spaceId}:${channelId}`;
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

function broadcastToSpace(spaceId: number, payload: ServerMessage, exclude?: HumSocket) {
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

  wss.on('connection', (socket: HumSocket, _req: IncomingMessage) => {
    // Track which voice rooms this socket has joined (for cleanup on disconnect)
    const activeVoiceRooms = new Set<string>(); // "<spaceId>:<channelId>"

    socket.on('message', async (raw) => {
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

        const history = (await queries.getMessages(spaceId, channelId, 100)).map((m) => ({
          id: m.id,
          spaceId: m.space_id,
          channelId: m.channel,
          userId: m.user_id,
          username: m.username ?? '',
          content: m.content,
          createdAt: m.created_at,
          editedAt: m.updated_at ?? undefined,
        }));

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
        const content = msg.content?.trim();
        if (!content) {
          socket.send(JSON.stringify({ type: 'error', error: 'empty message' } satisfies ServerMessage));
          return;
        }

        const { id: messageId } = await queries.insertMessage(socket.spaceId, socket.userId, socket.channelId, content);
        const now = Math.floor(Date.now() / 1000);

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
          },
        };

        broadcast(socket.spaceId, socket.channelId, outbound);
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

      // ── voice signaling: offer / answer / ice ─────────────────────────────
      if (msg.type === 'voice:offer' || msg.type === 'voice:answer' || msg.type === 'voice:ice') {
        if (!socket.userId || msg.targetUserId === undefined) return;
        const spaceId = Number(msg.spaceId);
        const channelId = msg.channelId ?? '';
        const key = roomKey(spaceId, channelId);
        const targetSocket = voiceRooms.get(key)?.get(msg.targetUserId);
        if (!targetSocket || targetSocket.readyState !== WebSocket.OPEN) return;

        if (msg.type === 'voice:offer') {
          targetSocket.send(JSON.stringify({
            type: 'voice:offer',
            fromUserId: socket.userId,
            sdp: msg.sdp,
          } satisfies ServerMessage));
        } else if (msg.type === 'voice:answer') {
          targetSocket.send(JSON.stringify({
            type: 'voice:answer',
            fromUserId: socket.userId,
            sdp: msg.sdp,
          } satisfies ServerMessage));
        } else {
          targetSocket.send(JSON.stringify({
            type: 'voice:ice',
            fromUserId: socket.userId,
            candidate: msg.candidate,
          } satisfies ServerMessage));
        }
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

      socket.send(JSON.stringify({ type: 'error', error: 'unknown message type' } satisfies ServerMessage));
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
