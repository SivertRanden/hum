import { useState, useEffect, useRef, useCallback } from 'react';
import { api, Space, Channel, SpaceMember } from './api.js';
import { useSocket, HumMessage, VoicePeer, PresenceUpdate } from './useSocket.js';
import { useVoiceChat } from './useVoiceChat.js';
import {
  Button,
  Input,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './components/ui/index.js';
import { ServerRail } from './components/ServerRail.js';
import { ChannelSidebar } from './components/ChannelSidebar.js';
import './app.css';

interface AuthState {
  token: string;
  userId: number;
  username: string;
}

const DEFAULT_CHANNEL = 'general';

function isVoiceChannel(id: string) {
  return id.startsWith('voice:');
}

function voiceRoomName(id: string) {
  return id.replace('voice:', '');
}

// ── Auth screen ──────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }: { onAuth: (auth: AuthState) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = mode === 'login'
        ? await api.login(username, password)
        : await api.register(username, password);
      onAuth({ token: res.token, userId: res.user.id, username: res.user.username });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <h1 className="logo">hum</h1>
      <p className="tagline">your voice. your people. your space.</p>
      <form onSubmit={submit} className="auth-form">
        <Input
          value={username} onChange={e => setUsername(e.target.value)}
          placeholder="username" autoComplete="username" required
        />
        <Input
          type="password" value={password} onChange={e => setPassword(e.target.value)}
          placeholder="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required
        />
        {error && <p className="error">{error}</p>}
        <Button type="submit" disabled={loading}>
          {loading ? '…' : mode === 'login' ? 'sign in' : 'create account'}
        </Button>
        <Button
          type="button"
          variant="link"
          onClick={() => setMode(m => m === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? 'no account? register' : 'have an account? sign in'}
        </Button>
      </form>
    </div>
  );
}

// ── Message list ─────────────────────────────────────────────────────────────
interface MessageListProps {
  messages: HumMessage[];
  myUserId: number;
  token: string;
  activeSpaceId: number | null;
  onEditMessage: (id: number, content: string) => void;
  onDeleteMessage: (id: number) => void;
}

function MessageList({ messages, myUserId, token, activeSpaceId, onEditMessage, onDeleteMessage }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const startEdit = (msg: HumMessage) => {
    setEditingId(msg.id);
    setEditContent(msg.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent('');
  };

  const submitEdit = async (msg: HumMessage) => {
    if (!editContent.trim() || !activeSpaceId) return;
    try {
      await api.editMessage(token, activeSpaceId, msg.id, editContent.trim());
      onEditMessage(msg.id, editContent.trim());
    } catch (err) {
      console.error('[edit]', err);
    }
    setEditingId(null);
    setEditContent('');
  };

  const handleDelete = async (msg: HumMessage) => {
    if (!activeSpaceId) return;
    try {
      await api.deleteMessage(token, activeSpaceId, msg.id);
      onDeleteMessage(msg.id);
    } catch (err) {
      console.error('[delete]', err);
    }
  };

  if (messages.length === 0) {
    return <div className="empty-state">no messages yet. say something.</div>;
  }

  return (
    <div className="message-list">
      {messages.map(m => (
        <div key={m.id} className={`message ${m.userId === myUserId ? 'mine' : ''}`}>
          <span className="msg-username">{m.username}</span>
          {editingId === m.id ? (
            <span className="msg-edit-form">
              <input
                className="msg-edit-input"
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submitEdit(m); }
                  if (e.key === 'Escape') cancelEdit();
                }}
                autoFocus
              />
              <button className="msg-edit-save" onClick={() => void submitEdit(m)}>save</button>
              <button className="msg-edit-cancel" onClick={cancelEdit}>cancel</button>
            </span>
          ) : (
            <>
              <span className="msg-content">
                {m.content}
                {m.editedAt && <span className="msg-edited"> (edited)</span>}
              </span>
              {m.userId === myUserId && (
                <span className="msg-actions">
                  <button className="msg-action-btn" onClick={() => startEdit(m)} title="Edit">✎</button>
                  <button className="msg-action-btn msg-action-delete" onClick={() => void handleDelete(m)} title="Delete">✕</button>
                </span>
              )}
            </>
          )}
          <span className="msg-time">{new Date(m.createdAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

// ── Voice room view ───────────────────────────────────────────────────────────
interface VoiceRoomViewProps {
  roomId: string;
  isInRoom: boolean;
  isMuted: boolean;
  participants: VoicePeer[];
  myUserId: number;
  onJoin: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
  joinError: string | null;
}

function MicIcon({ muted }: { muted: boolean }) {
  if (muted) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
    </svg>
  );
}

function VoiceRoomView({
  roomId, isInRoom, isMuted, participants, myUserId,
  onJoin, onLeave, onToggleMute, joinError,
}: VoiceRoomViewProps) {
  const name = voiceRoomName(roomId);

  if (!isInRoom) {
    return (
      <div className="voice-room-view">
        <div className="voice-room-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
          </svg>
        </div>
        <div className="voice-room-name">{name}</div>
        <div className="voice-room-hint">Join the room to start talking with others in real time.</div>
        {joinError && <p className="error">{joinError}</p>}
        <button className="voice-join-btn" onClick={onJoin}>Join Voice</button>
      </div>
    );
  }

  return (
    <div className="voice-room-active">
      <div className="voice-room-active-header">
        <div className="voice-live-indicator">
          <span className="voice-live-dot" />
          Live — {name}
        </div>
        <div className="voice-controls">
          <button
            className={`voice-ctrl-btn${isMuted ? ' muted' : ''}`}
            onClick={onToggleMute}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            <MicIcon muted={isMuted} />
            {isMuted ? 'Unmute' : 'Mute'}
          </button>
          <button className="voice-ctrl-btn leave" onClick={onLeave} title="Leave voice">
            Leave
          </button>
        </div>
      </div>

      <div className="voice-participants">
        {participants.length === 0 ? (
          <p className="voice-room-hint">You're the only one here. Invite someone!</p>
        ) : (
          participants.map(p => (
            <div key={p.userId} className={`voice-participant${p.userId === myUserId ? ' me' : ''}`}>
              <div className="voice-participant-avatar">
                {p.username.slice(0, 2).toUpperCase()}
              </div>
              <span className="voice-participant-name">
                {p.username}{p.userId === myUserId ? ' (you)' : ''}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Main app ─────────────────────────────────────────────────────────────────
export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(() => {
    const stored = localStorage.getItem('hum_auth');
    return stored ? JSON.parse(stored) as AuthState : null;
  });
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<number | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<string>(DEFAULT_CHANNEL);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [messages, setMessages] = useState<HumMessage[]>([]);
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [input, setInput] = useState('');
  const [showCreateSpace, setShowCreateSpace] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<Map<number, string>>(new Map());
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  const handleAuth = useCallback((a: AuthState) => {
    localStorage.setItem('hum_auth', JSON.stringify(a));
    setAuth(a);
  }, []);

  const handleSignOut = () => {
    localStorage.removeItem('hum_auth');
    setAuth(null);
  };

  useEffect(() => {
    if (!auth) return;
    api.listSpaces(auth.token).then(setSpaces).catch(console.error);
  }, [auth]);

  useEffect(() => {
    if (!auth || !activeSpaceId) { setChannels([]); return; }
    api.listChannels(auth.token, activeSpaceId).then(setChannels).catch(console.error);
  }, [auth, activeSpaceId]);

  useEffect(() => {
    if (!auth || !activeSpaceId) { setMembers([]); return; }
    api.listMembers(auth.token, activeSpaceId).then(setMembers).catch(console.error);
  }, [auth, activeSpaceId]);

  // Auto-join via invite token in URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteToken = params.get('invite');
    if (!inviteToken || !auth) return;
    // Clear the token from URL
    window.history.replaceState({}, '', window.location.pathname);
    api.joinByInvite(auth.token, inviteToken)
      .then(({ space }) => {
        setSpaces(prev => prev.some(s => s.id === space.id) ? prev : [...prev, space]);
        handleSelectServer(space.id);
      })
      .catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  const handleSelectServer = (id: number) => {
    setActiveSpaceId(id);
    setActiveChannelId(DEFAULT_CHANNEL);
    setMessages([]);
  };

  const handleCreateChannel = async (name: string, type: 'text' | 'voice') => {
    if (!auth || !activeSpaceId) return;
    const ch = await api.createChannel(auth.token, activeSpaceId, name, type);
    setChannels(prev => [...prev, ch]);
    const clientId = type === 'voice' ? `voice:${name}` : name;
    setActiveChannelId(clientId);
    if (type !== 'voice') setMessages([]);
  };

  const handleDeleteChannel = async (channelId: number) => {
    if (!auth || !activeSpaceId) return;
    await api.deleteChannel(auth.token, activeSpaceId, channelId);
    setChannels(prev => {
      const remaining = prev.filter(ch => ch.id !== channelId);
      // If deleted channel was active, switch to first available text channel or default
      const deletedCh = prev.find(ch => ch.id === channelId);
      if (deletedCh) {
        const deletedClientId = deletedCh.type === 'voice' ? `voice:${deletedCh.name}` : deletedCh.name;
        if (activeChannelId === deletedClientId) {
          const firstText = remaining.find(ch => ch.type === 'text');
          setActiveChannelId(firstText ? firstText.name : DEFAULT_CHANNEL);
          setMessages([]);
        }
      }
      return remaining;
    });
  };

  const handleSelectChannel = (id: string) => {
    setActiveChannelId(id);
    if (!isVoiceChannel(id)) setMessages([]);
  };

  const onMessage = useCallback((msg: HumMessage) => {
    setMessages(prev => [...prev, msg]);
  }, []);

  const onHistory = useCallback((msgs: HumMessage[]) => {
    setMessages(msgs);
  }, []);

  const onError = useCallback((err: string) => {
    console.error('[ws]', err);
  }, []);

  const onMessageEdit = useCallback((msg: HumMessage) => {
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: msg.content, editedAt: msg.editedAt } : m));
  }, []);

  const onMessageDelete = useCallback((messageId: number) => {
    setMessages(prev => prev.filter(m => m.id !== messageId));
  }, []);

  const onPresenceUpdate = useCallback((update: PresenceUpdate) => {
    setMembers(prev => prev.map(m =>
      m.user_id === update.userId
        ? { ...m, is_online: update.isOnline, last_seen_at: update.lastSeenAt }
        : m
    ));
  }, []);

  const handleEditMessage = useCallback((id: number, content: string) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, content, editedAt: Math.floor(Date.now() / 1000) } : m));
  }, []);

  const handleDeleteMessage = useCallback((id: number) => {
    setMessages(prev => prev.filter(m => m.id !== id));
  }, []);

  const onTyping = useCallback((userId: number, username: string, isTyping: boolean) => {
    setTypingUsers(prev => {
      const next = new Map(prev);
      if (isTyping) next.set(userId, username);
      else next.delete(userId);
      return next;
    });
  }, []);

  // Clear typing state when switching channels or spaces
  useEffect(() => {
    setTypingUsers(new Map());
  }, [activeChannelId, activeSpaceId]);

  const socketChannelId = isVoiceChannel(activeChannelId) ? null : activeChannelId;

  const { sendMessage, sendTypingStart, sendTypingStop, send } = useSocket(
    auth
      ? {
          token: auth.token,
          spaceId: activeSpaceId,
          channelId: socketChannelId,
          onMessage,
          onHistory,
          onError,
          onMessageEdit,
          onMessageDelete,
          onVoiceEvent: (evt) => handleVoiceEvent(evt),
<<<<<<< HEAD
          onPresenceUpdate,
=======
          onTyping,
>>>>>>> origin/main
        }
      : { token: '', spaceId: null, channelId: null, onMessage, onHistory, onError }
  );

  const {
    isInRoom,
    isMuted,
    participants,
    join: joinVoice,
    leave: leaveVoice,
    toggleMute,
    handleVoiceEvent,
  } = useVoiceChat({ send, spaceId: activeSpaceId });

  const handleJoinVoice = async () => {
    setJoinError(null);
    try {
      await joinVoice(activeChannelId);
    } catch {
      setJoinError('Microphone access denied. Please allow mic access and try again.');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    if (!isTypingRef.current) {
      sendTypingStart();
      isTypingRef.current = true;
    }
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = setTimeout(() => {
      sendTypingStop();
      isTypingRef.current = false;
    }, 3000);
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage(input.trim());
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    if (isTypingRef.current) { sendTypingStop(); isTypingRef.current = false; }
    setInput('');
  };

  const handleCreateInvite = async (): Promise<string> => {
    if (!auth || !activeSpaceId) throw new Error('no active space');
    const { token } = await api.createInvite(auth.token, activeSpaceId);
    return token;
  };

  const handleDeleteSpace = async (id: number) => {
    if (!auth) return;
    await api.deleteSpace(auth.token, id);
    setSpaces(prev => prev.filter(s => s.id !== id));
    if (activeSpaceId === id) {
      setActiveSpaceId(null);
      setChannels([]);
      setMessages([]);
    }
  };

  const handleCreateSpace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth || !newSpaceName.trim()) return;
    try {
      const space = await api.createSpace(auth.token, newSpaceName.trim());
      setSpaces(prev => [...prev, space]);
      setShowCreateSpace(false);
      setNewSpaceName('');
      handleSelectServer(space.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create server');
    }
  };

  if (!auth) return <AuthScreen onAuth={handleAuth} />;

  const activeSpace = spaces.find(s => s.id === activeSpaceId) ?? null;
  const inVoice = isVoiceChannel(activeChannelId);

  return (
    <div className="app-shell">
      {/* Column 1: server rail */}
      <ServerRail
        servers={spaces}
        activeId={activeSpaceId}
        onSelect={handleSelectServer}
        onAdd={() => setShowCreateSpace(true)}
        onDelete={handleDeleteSpace}
      />

      {/* Column 2: channel sidebar */}
      <ChannelSidebar
        server={activeSpace}
        activeChannelId={activeChannelId}
        onSelectChannel={handleSelectChannel}
        username={auth.username}
        onSignOut={handleSignOut}
        channels={channels}
        onCreateChannel={handleCreateChannel}
        onDeleteChannel={handleDeleteChannel}
        voiceParticipants={participants}
        activeVoiceRoomId={isInRoom ? activeChannelId : null}
        members={members}
        onCreateInvite={handleCreateInvite}
      />

      {/* Column 3: main content */}
      <div className="main">
        {activeSpace ? (
          <>
            <header className="main-header">
              <span className="main-header-icon" aria-hidden>
                {inVoice
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 3L9 3.41 6.41 16H3v2h3l-.59 2.59.97.41H8l.59-2.59.97.41H11L10.41 16H14l.59 2.59.97.41H17l.59-2.59.97.41H20v-2h-2l2.59-13H19l-2.59 13H13l2.59-13H14l-2.59 13H8l2.59-13z"/></svg>
                }
              </span>
              <span>{inVoice ? voiceRoomName(activeChannelId) : activeChannelId}</span>
            </header>

            {inVoice ? (
              <VoiceRoomView
                roomId={activeChannelId}
                isInRoom={isInRoom}
                isMuted={isMuted}
                participants={participants}
                myUserId={auth.userId}
                onJoin={handleJoinVoice}
                onLeave={leaveVoice}
                onToggleMute={toggleMute}
                joinError={joinError}
              />
            ) : (
              <>
                <MessageList
                  messages={messages}
                  myUserId={auth.userId}
                  token={auth.token}
                  activeSpaceId={activeSpaceId}
                  onEditMessage={handleEditMessage}
                  onDeleteMessage={handleDeleteMessage}
                />
                {typingUsers.size > 0 && (
                  <div className="typing-indicator">
                    {Array.from(typingUsers.values()).join(', ')} {typingUsers.size === 1 ? 'is' : 'are'} typing…
                  </div>
                )}
                <form className="compose" onSubmit={handleSend}>
                  <Input
                    value={input}
                    onChange={handleInputChange}
                    placeholder={`Message #${activeChannelId}…`}
                    autoFocus
                    className="flex-1"
                  />
                  <Button type="submit" disabled={!input.trim()} size="sm">send</Button>
                </form>
              </>
            )}
          </>
        ) : (
          <div className="pick-space">Select a server to start talking</div>
        )}
      </div>

      <Dialog open={showCreateSpace} onOpenChange={setShowCreateSpace}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>new server</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSpace} className="flex flex-col gap-3">
            <Input
              autoFocus
              value={newSpaceName}
              onChange={e => setNewSpaceName(e.target.value)}
              placeholder="server name"
              required
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreateSpace(false)}>
                cancel
              </Button>
              <Button type="submit">create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
