import { useEffect, useRef, useCallback } from 'react';

export interface HumMessage {
  id: number;
  spaceId: number;
  channelId: string;
  userId: number;
  username: string;
  content: string;
  createdAt: number;
}

type ServerEvent =
  | { type: 'joined'; spaceId: number; channelId: string }
  | { type: 'history'; messages: HumMessage[] }
  | { type: 'message'; message: HumMessage }
  | { type: 'error'; error: string };

interface UseSocketOptions {
  token: string;
  spaceId: number | null;
  channelId: string | null;
  onMessage: (msg: HumMessage) => void;
  onHistory: (msgs: HumMessage[]) => void;
  onError: (err: string) => void;
}

export function useSocket({ token, spaceId, channelId, onMessage, onHistory, onError }: UseSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const joinedSpaceRef = useRef<number | null>(null);
  const joinedChannelRef = useRef<string | null>(null);

  // Always-current refs so async callbacks (onopen) never use stale closure values
  const spaceIdRef = useRef(spaceId);
  const channelIdRef = useRef(channelId);
  spaceIdRef.current = spaceId;
  channelIdRef.current = channelId;

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
    joinedChannelRef.current = null;

    ws.onopen = () => {
      // Use refs here so we always see the current spaceId/channelId,
      // even if the WS opened after the user already selected a server.
      const sid = spaceIdRef.current;
      const cid = channelIdRef.current;
      if (sid !== null && cid !== null) {
        ws.send(JSON.stringify({ type: 'join', spaceId: sid, channelId: cid, token }));
        joinedSpaceRef.current = sid;
        joinedChannelRef.current = cid;
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

  // Join new space/channel without reconnecting
  useEffect(() => {
    if (spaceId === null || channelId === null) return;
    if (joinedSpaceRef.current === spaceId && joinedChannelRef.current === channelId) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'join', spaceId, channelId, token }));
      joinedSpaceRef.current = spaceId;
      joinedChannelRef.current = channelId;
    }
  }, [spaceId, channelId, token]);

  return { sendMessage };
}
