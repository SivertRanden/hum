import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent } from 'livekit-client';
import { VoicePeer, VoiceServerEvent } from './useSocket.js';

interface UseLiveKitVoiceOptions {
  send: (data: unknown) => void;
  spaceId: number | null;
  authToken: string;
}

export interface UseLiveKitVoiceReturn {
  isInRoom: boolean;
  isMuted: boolean;
  participants: VoicePeer[];
  activeRoomId: string | null;
  join: (channelId: string) => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
  handleVoiceEvent: (event: VoiceServerEvent) => void;
}

export function useLiveKitVoice({ send, spaceId, authToken }: UseLiveKitVoiceOptions): UseLiveKitVoiceReturn {
  const [isInRoom, setIsInRoom] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [participants, setParticipants] = useState<VoicePeer[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);
  const spaceIdRef = useRef(spaceId);
  spaceIdRef.current = spaceId;
  const activeRoomIdRef = useRef<string | null>(null);
  activeRoomIdRef.current = activeRoomId;
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;

  const join = useCallback(async (channelId: string) => {
    if (spaceIdRef.current === null) return;

    const res = await fetch(
      `/api/spaces/${spaceIdRef.current}/channels/${encodeURIComponent(channelId)}/voice-token`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );
    if (!res.ok) {
      const data = await res.json() as { error?: string };
      throw new Error(data.error ?? 'voice service unavailable');
    }
    const { token, url } = await res.json() as { token: string; url: string };

    const room = new Room();
    roomRef.current = room;

    await room.connect(url, token);
    await room.localParticipant.setMicrophoneEnabled(true);

    setIsInRoom(true);
    setIsMuted(false);
    setActiveRoomId(channelId);

    // Notify server via WS for sidebar presence tracking
    send({ type: 'voice:join', spaceId: spaceIdRef.current, channelId });
  }, [send, authToken]);

  const leave = useCallback(() => {
    const channelId = activeRoomIdRef.current;
    if (spaceIdRef.current !== null && channelId !== null) {
      send({ type: 'voice:leave', spaceId: spaceIdRef.current, channelId });
    }

    roomRef.current?.disconnect();
    roomRef.current = null;

    setIsInRoom(false);
    setIsMuted(false);
    setParticipants([]);
    setActiveRoomId(null);
  }, [send]);

  const toggleMute = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    const newMuted = !isMutedRef.current;
    void room.localParticipant.setMicrophoneEnabled(!newMuted);
    setIsMuted(newMuted);
  }, []);

  // Handle WS voice presence events (used for sidebar participant list)
  const handleVoiceEvent = useCallback((event: VoiceServerEvent) => {
    if (event.type === 'voice:joined' || event.type === 'voice:presence') {
      setParticipants(event.peers);
    }
  }, []);

  useEffect(() => {
    return () => {
      roomRef.current?.disconnect();
    };
  }, []);

  // Suppress unused import warning for RoomEvent - it may be used in future event handlers
  void RoomEvent;

  return { isInRoom, isMuted, participants, activeRoomId, join, leave, toggleMute, handleVoiceEvent };
}
