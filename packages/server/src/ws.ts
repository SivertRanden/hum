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

interface ClientMessage {
  type: 'join' | 'message';
  spaceId?: number;
  channelId?: string;
  content?: string;
  token?: string;
}

interface ServerMessage {
  type: 'joined' | 'message' | 'error' | 'history';
  spaceId?: number;
  channelId?: string;
  message?: {
    id: number;
    spaceId: number;
    channelId: string;
    userId: number;
    username: string;
    content: string;
    createdAt: number;
  };
  messages?: ServerMessage['message'][];
  error?: string;
}

// Room key: "<spaceId>:<channelId>"
function roomKey(spaceId: number, channelId: string): string {
  return `${spaceId}:${channelId}`;
}

const rooms = new Map<string, Set<HumSocket>>();

function broadcast(spaceId: number, channelId: string, payload: ServerMessage, exclude?: HumSocket) {
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
  // Leave old room
  if (socket.spaceId !== undefined && socket.channelId !== undefined) {
    rooms.get(roomKey(socket.spaceId, socket.channelId))?.delete(socket);
  }
  socket.spaceId = spaceId;
  socket.channelId = channelId;
  const key = roomKey(spaceId, channelId);
  if (!rooms.has(key)) rooms.set(key, new Set());
  rooms.get(key)!.add(socket);
}

export function createWsServer(server: import('http').Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket: HumSocket, _req: IncomingMessage) => {
    socket.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        socket.send(JSON.stringify({ type: 'error', error: 'invalid JSON' } satisfies ServerMessage));
        return;
      }

      if (msg.type === 'join') {
        // Authenticate on first join
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

        const space = queries.getSpaceById.get(spaceId);
        if (!space) {
          socket.send(JSON.stringify({ type: 'error', error: 'space not found' } satisfies ServerMessage));
          return;
        }

        joinRoom(socket, spaceId, channelId);

        // Send channel history
        const history = queries.getMessages.all(spaceId, channelId, 100).map((m) => ({
          id: m.id,
          spaceId: m.space_id,
          channelId: m.channel,
          userId: m.user_id,
          username: m.username ?? '',
          content: m.content,
          createdAt: m.created_at,
        }));

        socket.send(JSON.stringify({ type: 'history', messages: history } satisfies ServerMessage));
        socket.send(JSON.stringify({ type: 'joined', spaceId, channelId } satisfies ServerMessage));
        return;
      }

      if (msg.type === 'message') {
        if (!socket.userId || socket.spaceId === undefined || socket.channelId === undefined) {
          socket.send(JSON.stringify({ type: 'error', error: 'join a space first' } satisfies ServerMessage));
          return;
        }
        const content = msg.content?.trim();
        if (!content) {
          socket.send(JSON.stringify({ type: 'error', error: 'empty message' } satisfies ServerMessage));
          return;
        }

        const result = queries.insertMessage.run(socket.spaceId, socket.userId, socket.channelId, content);
        const messageId = Number(result.lastInsertRowid);
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

        // Broadcast to everyone in the channel room including sender
        broadcast(socket.spaceId, socket.channelId, outbound);
        return;
      }

      socket.send(JSON.stringify({ type: 'error', error: 'unknown message type' } satisfies ServerMessage));
    });

    socket.on('close', () => {
      if (socket.spaceId !== undefined && socket.channelId !== undefined) {
        rooms.get(roomKey(socket.spaceId, socket.channelId))?.delete(socket);
      }
    });
  });

  return wss;
}
