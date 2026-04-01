import { useCallback, useEffect, useRef, useState } from 'react';
import { VoicePeer, VoiceServerEvent } from './useSocket.js';

interface UseVoiceChatOptions {
  send: (data: unknown) => void;
  spaceId: number | null;
}

export interface UseVoiceChatReturn {
  isInRoom: boolean;
  isMuted: boolean;
  participants: VoicePeer[];
  activeRoomId: string | null;
  join: (channelId: string) => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
  handleVoiceEvent: (event: VoiceServerEvent) => void;
}

const PC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export function useVoiceChat({ send, spaceId }: UseVoiceChatOptions): UseVoiceChatReturn {
  const [isInRoom, setIsInRoom] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [participants, setParticipants] = useState<VoicePeer[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  // Keep stable refs for use inside async closures
  const spaceIdRef = useRef(spaceId);
  spaceIdRef.current = spaceId;

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<number, RTCPeerConnection>>(new Map());
  const activeRoomIdRef = useRef<string | null>(null);
  activeRoomIdRef.current = activeRoomId;

  const createPeerConnection = useCallback((peerId: number, channelId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection(PC_CONFIG);

    // Add local tracks to the peer connection
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        pc.addTrack(track, localStreamRef.current);
      }
    }

    // Play remote audio
    pc.ontrack = (evt) => {
      const audio = new Audio();
      audio.srcObject = evt.streams[0];
      audio.autoplay = true;
    };

    // Forward ICE candidates to the peer via signaling server
    pc.onicecandidate = (evt) => {
      if (evt.candidate && spaceIdRef.current !== null) {
        send({
          type: 'voice:ice',
          spaceId: spaceIdRef.current,
          channelId,
          targetUserId: peerId,
          candidate: evt.candidate.toJSON(),
        });
      }
    };

    peersRef.current.set(peerId, pc);
    return pc;
  }, [send]);

  const closePeerConnections = useCallback(() => {
    for (const pc of peersRef.current.values()) {
      pc.close();
    }
    peersRef.current.clear();
  }, []);

  const join = useCallback(async (channelId: string) => {
    if (spaceIdRef.current === null) return;

    // Get microphone access
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStreamRef.current = stream;

    setIsInRoom(true);
    setActiveRoomId(channelId);

    send({ type: 'voice:join', spaceId: spaceIdRef.current, channelId });
  }, [send]);

  const leave = useCallback(() => {
    const channelId = activeRoomIdRef.current;
    if (spaceIdRef.current !== null && channelId !== null) {
      send({ type: 'voice:leave', spaceId: spaceIdRef.current, channelId });
    }

    // Stop local stream
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
      localStreamRef.current = null;
    }

    closePeerConnections();
    setIsInRoom(false);
    setIsMuted(false);
    setParticipants([]);
    setActiveRoomId(null);
  }, [send, closePeerConnections]);

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    const audioTrack = localStreamRef.current.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = !audioTrack.enabled;
    setIsMuted(!audioTrack.enabled);
  }, []);

  const handleVoiceEvent = useCallback((event: VoiceServerEvent) => {
    const channelId = activeRoomIdRef.current;

    if (event.type === 'voice:presence') {
      setParticipants(event.peers);
      return;
    }

    if (event.type === 'voice:joined') {
      // We just joined; create offers to all existing peers
      setParticipants(event.peers);
      for (const peer of event.peers) {
        const pc = createPeerConnection(peer.userId, event.channelId);
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            if (pc.localDescription && spaceIdRef.current !== null) {
              send({
                type: 'voice:offer',
                spaceId: spaceIdRef.current,
                channelId: event.channelId,
                targetUserId: peer.userId,
                sdp: pc.localDescription,
              });
            }
          })
          .catch(console.error);
      }
      return;
    }

    if (event.type === 'voice:offer') {
      // A peer wants to connect with us; answer them
      if (!channelId) return;
      const pc = createPeerConnection(event.fromUserId, channelId);
      pc.setRemoteDescription(event.sdp)
        .then(() => pc.createAnswer())
        .then((answer) => pc.setLocalDescription(answer))
        .then(() => {
          if (pc.localDescription && spaceIdRef.current !== null) {
            send({
              type: 'voice:answer',
              spaceId: spaceIdRef.current,
              channelId,
              targetUserId: event.fromUserId,
              sdp: pc.localDescription,
            });
          }
        })
        .catch(console.error);
      return;
    }

    if (event.type === 'voice:answer') {
      const pc = peersRef.current.get(event.fromUserId);
      pc?.setRemoteDescription(event.sdp).catch(console.error);
      return;
    }

    if (event.type === 'voice:ice') {
      const pc = peersRef.current.get(event.fromUserId);
      pc?.addIceCandidate(new RTCIceCandidate(event.candidate)).catch(console.error);
      return;
    }

    if (event.type === 'voice:peer_left') {
      const pc = peersRef.current.get(event.userId);
      if (pc) {
        pc.close();
        peersRef.current.delete(event.userId);
      }
      return;
    }
  }, [createPeerConnection, send]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          track.stop();
        }
      }
      closePeerConnections();
    };
  }, [closePeerConnections]);

  return { isInRoom, isMuted, participants, activeRoomId, join, leave, toggleMute, handleVoiceEvent };
}
