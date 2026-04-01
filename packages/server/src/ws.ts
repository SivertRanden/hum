import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { verifyToken } from './auth.js';
import { queries } from './db.js';

interface HumSocket extends WebSocket {
  userId?: number;
  username?: string;
  spaceId?: number;
}

interface ClientMessage {
  type: 'join' | 'message';
  spaceId?: number;
  content?: string;
  token?: string;
}

interface ServerMessage {
  type: 'joined' | 'message' | 'error' | 'history';
  spaceId?: number;
  message?: {
    id: number;
    spaceId: number;
    userId: number;
    username: string;
    content: string;
    createdAt: number;
  };
  messages?: ServerMessage['message'][];
  error?: string;
}

// Map of spaceId -> Set of connected sockets
const rooms = new Map<number, Set<HumSocket>>();

function broadcast(spaceId: number, payload: ServerMessage, exclude?: HumSocket) {
  const room = rooms.get(spaceId);
  if (!room) return;
  const data = JSON.stringify(payload);
  for (const client of room) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function joinRoom(socket: HumSocket, spaceId: number) {
  // Leave old room
  if (socket.spaceId !== undefined) {
    rooms.get(socket.spaceId)?.delete(socket);
  }
  socket.spaceId = spaceId;
  if (!rooms.has(spaceId)) rooms.set(spaceId, new Set());
  rooms.get(spaceId)!.add(socket);
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
        const space = queries.getSpaceById.get(spaceId);
        if (!space) {
          socket.send(JSON.stringify({ type: 'error', error: 'space not found' } satisfies ServerMessage));
          return;
        }

        joinRoom(socket, spaceId);

        // Send history
        const history = queries.getMessages.all(spaceId, 100).map((m) => ({
          id: m.id,
          spaceId: m.space_id,
          userId: m.user_id,
          username: m.username ?? '',
          content: m.content,
          createdAt: m.created_at,
        }));

        socket.send(JSON.stringify({ type: 'history', messages: history } satisfies ServerMessage));
        socket.send(JSON.stringify({ type: 'joined', spaceId } satisfies ServerMessage));
        return;
      }

      if (msg.type === 'message') {
        if (!socket.userId || socket.spaceId === undefined) {
          socket.send(JSON.stringify({ type: 'error', error: 'join a space first' } satisfies ServerMessage));
          return;
        }
        const content = msg.content?.trim();
        if (!content) {
          socket.send(JSON.stringify({ type: 'error', error: 'empty message' } satisfies ServerMessage));
          return;
        }

        const result = queries.insertMessage.run(socket.spaceId, socket.userId, content);
        const messageId = Number(result.lastInsertRowid);
        const now = Math.floor(Date.now() / 1000);

        const outbound: ServerMessage = {
          type: 'message',
          message: {
            id: messageId,
            spaceId: socket.spaceId,
            userId: socket.userId,
            username: socket.username ?? '',
            content,
            createdAt: now,
          },
        };

        // Broadcast to everyone in the room including sender
        broadcast(socket.spaceId, outbound);
        return;
      }

      socket.send(JSON.stringify({ type: 'error', error: 'unknown message type' } satisfies ServerMessage));
    });

    socket.on('close', () => {
      if (socket.spaceId !== undefined) {
        rooms.get(socket.spaceId)?.delete(socket);
      }
    });
  });

  return wss;
}
