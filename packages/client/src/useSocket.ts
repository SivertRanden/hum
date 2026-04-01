import { useEffect, useRef, useCallback } from 'react';

export interface HumMessage {
  id: number;
  spaceId: number;
  userId: number;
  username: string;
  content: string;
  createdAt: number;
}

type ServerEvent =
  | { type: 'joined'; spaceId: number }
  | { type: 'history'; messages: HumMessage[] }
  | { type: 'message'; message: HumMessage }
  | { type: 'error'; error: string };

interface UseSocketOptions {
  token: string;
  spaceId: number | null;
  onMessage: (msg: HumMessage) => void;
  onHistory: (msgs: HumMessage[]) => void;
  onError: (err: string) => void;
}

export function useSocket({ token, spaceId, onMessage, onHistory, onError }: UseSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const joinedSpaceRef = useRef<number | null>(null);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const sendMessage = useCallback((content: string) => {
    send({ type: 'message', content });
  }, [send]);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);
    wsRef.current = ws;
    joinedSpaceRef.current = null;

    ws.onopen = () => {
      if (spaceId !== null) {
        ws.send(JSON.stringify({ type: 'join', spaceId, token }));
        joinedSpaceRef.current = spaceId;
      }
    };

    ws.onmessage = (evt) => {
      const event = JSON.parse(evt.data as string) as ServerEvent;
      if (event.type === 'history') onHistory(event.messages);
      else if (event.type === 'message') onMessage(event.message);
      else if (event.type === 'error') onError(event.error);
    };

    ws.onclose = () => { wsRef.current = null; };

    return () => { ws.close(); };
  }, [token]); // reconnect only if token changes

  // Join new space without reconnecting
  useEffect(() => {
    if (spaceId === null) return;
    if (joinedSpaceRef.current === spaceId) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'join', spaceId, token }));
      joinedSpaceRef.current = spaceId;
    }
  }, [spaceId, token]);

  return { sendMessage };
}
