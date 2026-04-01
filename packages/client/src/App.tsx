import { useState, useEffect, useRef, useCallback } from 'react';
import { api, Space } from './api.js';
import { useSocket, HumMessage } from './useSocket.js';
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
function MessageList({ messages, myUserId }: { messages: HumMessage[]; myUserId: number }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return <div className="empty-state">no messages yet. say something.</div>;
  }

  return (
    <div className="message-list">
      {messages.map(m => (
        <div key={m.id} className={`message ${m.userId === myUserId ? 'mine' : ''}`}>
          <span className="msg-username">{m.username}</span>
          <span className="msg-content">{m.content}</span>
          <span className="msg-time">{new Date(m.createdAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

// ── Voice room placeholder ────────────────────────────────────────────────────
function VoiceRoomView({ roomId }: { roomId: string }) {
  const name = voiceRoomName(roomId);
  return (
    <div className="voice-room-view">
      <div className="voice-room-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
        </svg>
      </div>
      <div className="voice-room-name">{name}</div>
      <div className="voice-room-hint">Join the room to start talking with others in real time.</div>
      <button className="voice-join-btn">Join Voice</button>
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
  const [messages, setMessages] = useState<HumMessage[]>([]);
  const [input, setInput] = useState('');
  const [showCreateSpace, setShowCreateSpace] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');

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

  const handleSelectServer = (id: number) => {
    setActiveSpaceId(id);
    setActiveChannelId(DEFAULT_CHANNEL);
    setMessages([]);
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

  const socketChannelId = isVoiceChannel(activeChannelId) ? null : activeChannelId;

  const { sendMessage } = useSocket(
    auth
      ? { token: auth.token, spaceId: activeSpaceId, channelId: socketChannelId, onMessage, onHistory, onError }
      : { token: '', spaceId: null, channelId: null, onMessage, onHistory, onError }
  );

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage(input.trim());
    setInput('');
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
      />

      {/* Column 2: channel sidebar */}
      <ChannelSidebar
        server={activeSpace}
        activeChannelId={activeChannelId}
        onSelectChannel={handleSelectChannel}
        username={auth.username}
        onSignOut={handleSignOut}
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
              <VoiceRoomView roomId={activeChannelId} />
            ) : (
              <>
                <MessageList messages={messages} myUserId={auth.userId} />
                <form className="compose" onSubmit={handleSend}>
                  <Input
                    value={input}
                    onChange={e => setInput(e.target.value)}
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
