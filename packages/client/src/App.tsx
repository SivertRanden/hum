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
import './app.css';

interface AuthState {
  token: string;
  userId: number;
  username: string;
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

// ── Space sidebar ────────────────────────────────────────────────────────────
function Sidebar({
  spaces, activeId, onSelect, onCreateSpace,
}: {
  spaces: Space[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onCreateSpace: () => void;
}) {
  return (
    <nav className="sidebar">
      <div className="sidebar-header">spaces</div>
      <ul className="space-list">
        {spaces.map(s => (
          <li key={s.id}>
            <button
              className={`space-item ${s.id === activeId ? 'active' : ''}`}
              onClick={() => onSelect(s.id)}
            >
              # {s.name}
            </button>
          </li>
        ))}
      </ul>
      <button className="create-space-btn" onClick={onCreateSpace}>+ new space</button>
    </nav>
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

// ── Main app ─────────────────────────────────────────────────────────────────
export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(() => {
    const stored = localStorage.getItem('hum_auth');
    return stored ? JSON.parse(stored) as AuthState : null;
  });
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<number | null>(null);
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

  const handleSelectSpace = (id: number) => {
    setActiveSpaceId(id);
    setMessages([]);
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

  const { sendMessage } = useSocket(
    auth
      ? { token: auth.token, spaceId: activeSpaceId, onMessage, onHistory, onError }
      : { token: '', spaceId: null, onMessage, onHistory, onError }
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
      handleSelectSpace(space.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create space');
    }
  };

  if (!auth) return <AuthScreen onAuth={handleAuth} />;

  const activeSpace = spaces.find(s => s.id === activeSpaceId);

  return (
    <div className="layout">
      <Sidebar
        spaces={spaces}
        activeId={activeSpaceId}
        onSelect={handleSelectSpace}
        onCreateSpace={() => setShowCreateSpace(true)}
      />

      <div className="main">
        <header className="main-header">
          <span>{activeSpace ? `# ${activeSpace.name}` : 'pick a space'}</span>
          <Button variant="ghost" size="sm" onClick={handleSignOut} className="sign-out">
            sign out
          </Button>
        </header>

        {activeSpaceId
          ? <>
              <MessageList messages={messages} myUserId={auth.userId} />
              <form className="compose" onSubmit={handleSend}>
                <Input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder={`message #${activeSpace?.name ?? ''}…`}
                  autoFocus
                  className="flex-1"
                />
                <Button type="submit" disabled={!input.trim()} size="sm">send</Button>
              </form>
            </>
          : <div className="pick-space">pick a space to start talking</div>
        }
      </div>

      <Dialog open={showCreateSpace} onOpenChange={setShowCreateSpace}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>new space</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSpace} className="flex flex-col gap-3">
            <Input
              autoFocus
              value={newSpaceName}
              onChange={e => setNewSpaceName(e.target.value)}
              placeholder="space name"
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
