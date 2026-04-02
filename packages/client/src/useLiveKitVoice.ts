import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, RemoteVideoTrack } from 'livekit-client';
import { VoicePeer, VoiceServerEvent } from './useSocket.js';

interface UseLiveKitVoiceOptions {
  send: (data: unknown) => void;
  spaceId: number | null;
  authToken: string;
  micDeviceId?: string | null;
}

export interface RemoteScreen {
  userId: number;
  username: string;
  track: RemoteVideoTrack;
}

export interface UseLiveKitVoiceReturn {
  isInRoom: boolean;
  isMuted: boolean;
  isScreenSharing: boolean;
  participants: VoicePeer[];
  activeRoomId: string | null;
  remoteScreens: RemoteScreen[];
  join: (channelId: string) => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
  handleVoiceEvent: (event: VoiceServerEvent) => void;
}

export function useLiveKitVoice({ send, spaceId, authToken, micDeviceId }: UseLiveKitVoiceOptions): UseLiveKitVoiceReturn {
  const [isInRoom, setIsInRoom] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [participants, setParticipants] = useState<VoicePeer[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [remoteScreens, setRemoteScreens] = useState<RemoteScreen[]>([]);

  const roomRef = useRef<Room | null>(null);
  const spaceIdRef = useRef(spaceId);
  spaceIdRef.current = spaceId;
  const micDeviceIdRef = useRef(micDeviceId);
  micDeviceIdRef.current = micDeviceId;
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

    // Listen for remote screen share tracks
    room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      if (track.source === Track.Source.ScreenShare && track instanceof RemoteVideoTrack) {
        const userId = parseInt(participant.identity, 10);
        const username = participant.name ?? participant.identity;
        setRemoteScreens(prev => [
          ...prev.filter(s => s.userId !== userId),
          { userId, username, track },
        ]);
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
      if (track.source === Track.Source.ScreenShare) {
        const userId = parseInt(participant.identity, 10);
        setRemoteScreens(prev => prev.filter(s => s.userId !== userId));
      }
    });

    await room.connect(url, token);
    if (micDeviceIdRef.current) {
      await room.switchActiveDevice('audioinput', micDeviceIdRef.current);
    }
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
    setIsScreenSharing(false);
    setParticipants([]);
    setActiveRoomId(null);
    setRemoteScreens([]);
  }, [send]);

  const toggleMute = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    const newMuted = !isMutedRef.current;
    void room.localParticipant.setMicrophoneEnabled(!newMuted);
    setIsMuted(newMuted);
  }, []);

  const startScreenShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.setScreenShareEnabled(true);
    setIsScreenSharing(true);
  }, []);

  const stopScreenShare = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    void room.localParticipant.setScreenShareEnabled(false);
    setIsScreenSharing(false);
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

  return {
    isInRoom, isMuted, isScreenSharing, participants, activeRoomId, remoteScreens,
    join, leave, toggleMute, startScreenShare, stopScreenShare, handleVoiceEvent,
  };
}
