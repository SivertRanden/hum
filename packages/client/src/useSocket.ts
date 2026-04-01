import { useEffect, useRef, useCallback } from 'react';

export interface HumMessage {
  id: number;
  spaceId: number;
  channelId: string;
  userId: number;
  username: string;
  content: string;
  createdAt: number;
  editedAt?: number;
}

export interface VoicePeer {
  userId: number;
  username: string;
}

export type VoiceServerEvent =
  | { type: 'voice:joined'; spaceId: number; channelId: string; peers: VoicePeer[] }
  | { type: 'voice:presence'; spaceId: number; channelId: string; peers: VoicePeer[] }
  | { type: 'voice:offer'; fromUserId: number; sdp: RTCSessionDescriptionInit }
  | { type: 'voice:answer'; fromUserId: number; sdp: RTCSessionDescriptionInit }
  | { type: 'voice:ice'; fromUserId: number; candidate: RTCIceCandidateInit }
  | { type: 'voice:peer_left'; userId: number };

export interface PresenceUpdate {
  type: 'presence_update';
  userId: number;
  isOnline: boolean;
  lastSeenAt: number;
}

type ServerEvent =
  | { type: 'joined'; spaceId: number; channelId: string }
  | { type: 'history'; messages: HumMessage[] }
  | { type: 'message'; message: HumMessage }
  | { type: 'message:edit'; message: HumMessage }
  | { type: 'message:delete'; messageId: number }
  | { type: 'error'; error: string }
  | { type: 'typing'; userId: number; username: string; isTyping: boolean }
  | VoiceServerEvent
  | PresenceUpdate;

interface UseSocketOptions {
  token: string;
  spaceId: number | null;
  channelId: string | null;
  onMessage: (msg: HumMessage) => void;
  onHistory: (msgs: HumMessage[]) => void;
  onError: (err: string) => void;
  onMessageEdit?: (msg: HumMessage) => void;
  onMessageDelete?: (messageId: number) => void;
  onVoiceEvent?: (event: VoiceServerEvent) => void;
  onTyping?: (userId: number, username: string, isTyping: boolean) => void;
  onPresenceUpdate?: (update: PresenceUpdate) => void;
}

export function useSocket({ token, spaceId, channelId, onMessage, onHistory, onError, onMessageEdit, onMessageDelete, onVoiceEvent, onTyping, onPresenceUpdate }: UseSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const joinedSpaceRef = useRef<number | null>(null);
  const joinedChannelRef = useRef<string | null>(null);

  // Always-current refs so async callbacks (onopen) never use stale closure values
  const spaceIdRef = useRef(spaceId);
  const channelIdRef = useRef(channelId);
  spaceIdRef.current = spaceId;
  channelIdRef.current = channelId;

  const onVoiceEventRef = useRef(onVoiceEvent);
  onVoiceEventRef.current = onVoiceEvent;

  const onPresenceUpdateRef = useRef(onPresenceUpdate);
  onPresenceUpdateRef.current = onPresenceUpdate;

  const onMessageEditRef = useRef(onMessageEdit);
  onMessageEditRef.current = onMessageEdit;

  const onMessageDeleteRef = useRef(onMessageDelete);
  onMessageDeleteRef.current = onMessageDelete;

  const onTypingRef = useRef(onTyping);
  onTypingRef.current = onTyping;

  const onPresenceUpdateRef = useRef(onPresenceUpdate);
  onPresenceUpdateRef.current = onPresenceUpdate;

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const sendMessage = useCallback((content: string) => {
    send({ type: 'message', content });
  }, [send]);

  const sendTypingStart = useCallback(() => send({ type: 'typing_start' }), [send]);
  const sendTypingStop = useCallback(() => send({ type: 'typing_stop' }), [send]);

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
      else if (event.type === 'message:edit') onMessageEditRef.current?.(event.message);
      else if (event.type === 'message:delete') onMessageDeleteRef.current?.(event.messageId);
      else if (event.type === 'error') onError(event.error);
      else if (event.type === 'typing') onTypingRef.current?.(event.userId, event.username, event.isTyping);
      else if (event.type === 'presence_update') {
        onPresenceUpdateRef.current?.(event as PresenceUpdate);
      }
      else if (event.type.startsWith('voice:')) {
        onVoiceEventRef.current?.(event as VoiceServerEvent);
      }
    };

    ws.onclose = () => { if (wsRef.current === ws) wsRef.current = null; };

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

  return { sendMessage, sendTypingStart, sendTypingStop, send };
}
