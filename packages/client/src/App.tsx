import { useState, useEffect, useRef, useCallback } from 'react';
import { api, Space, Channel, SpaceMember, SpaceRole, DmChannel, SearchResult } from './api.js';
import { useSocket, HumMessage, VoicePeer, PresenceUpdate, MentionEvent, ChannelNewMessageEvent, ReactionGroup, ReactionEvent, LinkPreviewEvent, LinkPreview } from './useSocket.js';
import { useLiveKitVoice, RemoteScreen } from './useLiveKitVoice.js';
import { UserSettingsDialog, HumSettings, DEFAULT_SETTINGS } from './components/UserSettingsDialog.js';

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
import { ThreadPanel } from './components/ThreadPanel.js';
import { AdminDashboard } from './components/AdminDashboard.js';
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

function isDmChannel(id: string) {
  return id.startsWith('dm:');
}

function voiceRoomName(id: string) {
  return id.replace('voice:', '');
}

// ── Auth screen ──────────────────────────────────────────────────────────────
function AuthScreen({ onAuth, onForgotPassword }: { onAuth: (auth: AuthState) => void; onForgotPassword: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
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
        : await api.register(username, password, email || undefined);
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
        {mode === 'register' && (
          <Input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="email (optional, for password reset)" autoComplete="email"
          />
        )}
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
          onClick={() => { setMode(m => m === 'login' ? 'register' : 'login'); setError(''); }}
        >
          {mode === 'login' ? 'no account? register' : 'have an account? sign in'}
        </Button>
        {mode === 'login' && (
          <Button type="button" variant="link" onClick={onForgotPassword}>
            forgot password?
          </Button>
        )}
      </form>
    </div>
  );
}

// ── Forgot password screen ────────────────────────────────────────────────────
function ForgotPasswordScreen({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <h1 className="logo">hum</h1>
      <p className="tagline">reset your password</p>
      {sent ? (
        <div className="auth-form">
          <p style={{ textAlign: 'center', fontSize: '0.9rem' }}>
            If that email is registered, a reset link has been sent. Check your inbox.
          </p>
          <Button type="button" variant="link" onClick={onBack}>back to sign in</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="auth-form">
          <Input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="your email address" autoComplete="email" required
          />
          {error && <p className="error">{error}</p>}
          <Button type="submit" disabled={loading}>{loading ? '…' : 'send reset link'}</Button>
          <Button type="button" variant="link" onClick={onBack}>back to sign in</Button>
        </form>
      )}
    </div>
  );
}

// ── Reset password screen ─────────────────────────────────────────────────────
function ResetPasswordScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('passwords do not match'); return; }
    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <h1 className="logo">hum</h1>
      <p className="tagline">choose a new password</p>
      {success ? (
        <div className="auth-form">
          <p style={{ textAlign: 'center', fontSize: '0.9rem' }}>Password updated! You can now sign in.</p>
          <Button type="button" onClick={onDone}>sign in</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="auth-form">
          <Input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="new password" autoComplete="new-password" required
          />
          <Input
            type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
            placeholder="confirm new password" autoComplete="new-password" required
          />
          {error && <p className="error">{error}</p>}
          <Button type="submit" disabled={loading}>{loading ? '…' : 'update password'}</Button>
        </form>
      )}
    </div>
  );
}

// ── @mention rendering ────────────────────────────────────────────────────────

function renderMessageContent(content: string, myUsername: string): React.ReactNode {
  const parts = content.split(/(@[a-zA-Z0-9_-]{2,32})/g);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      const mentioned = part.slice(1).toLowerCase();
      const isMe = mentioned === myUsername.toLowerCase();
      return (
        <span key={i} className={`mention${isMe ? ' mention-me' : ''}`}>{part}</span>
      );
    }
    return part;
  });
}

// ── Link preview card ─────────────────────────────────────────────────────────

function LinkPreviewCard({ preview }: { preview: LinkPreview }) {
  return (
    <a className="link-preview" href={preview.url} target="_blank" rel="noopener noreferrer">
      {preview.image && (
        <img className="link-preview-image" src={preview.image} alt="" loading="lazy" />
      )}
      <div className="link-preview-body">
        {preview.siteName && <span className="link-preview-site">{preview.siteName}</span>}
        {preview.title && <span className="link-preview-title">{preview.title}</span>}
        {preview.description && <span className="link-preview-description">{preview.description}</span>}
        <span className="link-preview-url">{preview.url}</span>
      </div>
    </a>
  );
}

// ── Reaction pills ────────────────────────────────────────────────────────────
const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];

interface ReactionPillsProps {
  reactions: ReactionGroup[];
  myUserId: number;
  onToggle: (emoji: string) => void;
}

function ReactionPills({ reactions, myUserId, onToggle }: ReactionPillsProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="msg-reactions">
      {reactions.map(rg => {
        const mine = rg.userIds.includes(myUserId);
        return (
          <button
            key={rg.emoji}
            className={`reaction-pill${mine ? ' mine' : ''}`}
            onClick={() => onToggle(rg.emoji)}
            title={rg.usernames.join(', ')}
          >
            {rg.emoji} {rg.userIds.length}
          </button>
        );
      })}
      <div className="reaction-add-wrap">
        <button className="reaction-add-btn" onClick={() => setPickerOpen(p => !p)} title="Add reaction">+</button>
        {pickerOpen && (
          <div className="reaction-picker">
            {QUICK_EMOJIS.map(e => (
              <button
                key={e}
                className="reaction-quick-btn"
                onClick={() => { onToggle(e); setPickerOpen(false); }}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Message list ─────────────────────────────────────────────────────────────
interface MessageListProps {
  messages: HumMessage[];
  myUserId: number;
  myUsername: string;
  token: string;
  activeSpaceId: number | null;
  openThreadMessageId: number | null;
  onEditMessage: (id: number, content: string) => void;
  onDeleteMessage: (id: number) => void;
  reactions: Record<number, ReactionGroup[]>;
  onToggleReaction: (messageId: number, emoji: string) => void;
  linkPreviews: Record<number, LinkPreview[]>;
  onOpenThread: (msg: HumMessage) => void;
}

function MessageList({ messages, myUserId, myUsername, token, activeSpaceId, openThreadMessageId, onEditMessage, onDeleteMessage, reactions, onToggleReaction, linkPreviews, onOpenThread }: MessageListProps) {
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
                {renderMessageContent(m.content, myUsername)}
                {m.editedAt && <span className="msg-edited"> (edited)</span>}
              </span>
              {(linkPreviews[m.id] ?? m.linkPreviews ?? []).map((preview, i) => (
                <LinkPreviewCard key={i} preview={preview} />
              ))}
              {(m.attachments ?? []).length > 0 && (
                <div className="msg-attachments">
                  {(m.attachments ?? []).map(att => (
                    <div key={att.id} className="msg-attachment">
                      {att.mimeType.startsWith('image/') ? (
                        <a href={att.url} target="_blank" rel="noopener noreferrer">
                          <img src={att.url} alt={att.filename} className="msg-attachment-image" />
                        </a>
                      ) : (
                        <a href={att.url} download={att.filename} className="msg-attachment-file">
                          📎 {att.filename}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <span className="msg-actions">
                <button className="msg-action-btn msg-action-reply" onClick={() => onOpenThread(m)} title="Reply in thread">↩</button>
                {m.userId === myUserId && (
                  <>
                    <button className="msg-action-btn" onClick={() => startEdit(m)} title="Edit">✎</button>
                    <button className="msg-action-btn msg-action-delete" onClick={() => void handleDelete(m)} title="Delete">✕</button>
                  </>
                )}
              </span>
              {(m.replyCount ?? 0) > 0 && (
                <button
                  className={`msg-reply-count${openThreadMessageId === m.id ? ' active' : ''}`}
                  onClick={() => onOpenThread(m)}
                >
                  {m.replyCount} {m.replyCount === 1 ? 'reply' : 'replies'}
                </button>
              )}
              <ReactionPills
                reactions={reactions[m.id] ?? []}
                myUserId={myUserId}
                onToggle={(emoji) => onToggleReaction(m.id, emoji)}
              />
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
  isScreenSharing: boolean;
  participants: VoicePeer[];
  remoteScreens: RemoteScreen[];
  myUserId: number;
  onJoin: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
  onStartScreenShare: () => void;
  onStopScreenShare: () => void;
  joinError: string | null;
}

function ScreenView({ screen }: { screen: RemoteScreen }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    screen.track.attach(el);
    return () => { screen.track.detach(el); };
  }, [screen.track]);
  return (
    <div className="screen-share-view">
      <div className="screen-share-label">{screen.username}'s screen</div>
      <video ref={videoRef} autoPlay playsInline className="screen-share-video" />
    </div>
  );
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
  roomId, isInRoom, isMuted, isScreenSharing, participants, remoteScreens, myUserId,
  onJoin, onLeave, onToggleMute, onStartScreenShare, onStopScreenShare, joinError,
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
          <button
            className={`voice-ctrl-btn${isScreenSharing ? ' screen-sharing' : ''}`}
            onClick={isScreenSharing ? onStopScreenShare : onStartScreenShare}
            title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/>
            </svg>
            {isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
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

      {isScreenSharing && (
        <div className="screen-share-self-indicator">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/>
          </svg>
          You are sharing your screen
        </div>
      )}

      {remoteScreens.length > 0 && (
        <div className="screen-share-area">
          {remoteScreens.map(screen => (
            <ScreenView key={screen.userId} screen={screen} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Search panel ─────────────────────────────────────────────────────────────
function highlightContent(content: string, query: string): React.ReactNode {
  const terms = query.trim().split(/\s+/).filter(t => t.length > 0);
  if (terms.length === 0) return content;
  const pattern = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const parts = content.split(pattern);
  return parts.map((part, i) =>
    pattern.test(part) ? <mark key={i} className="search-highlight">{part}</mark> : part
  );
}

interface SearchPanelProps {
  spaceId: number;
  token: string;
  onClose: () => void;
  onJumpTo: (channelId: string) => void;
}

function SearchPanel({ spaceId, token, onClose, onJumpTo }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await api.searchMessages(token, spaceId, q);
      setResults(res);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [token, spaceId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runSearch(q), 300);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="search-overlay" role="dialog" aria-label="Search messages">
      <div className="search-panel">
        <div className="search-input-row">
          <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          <input
            ref={inputRef}
            className="search-input"
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Search messages…"
          />
          <button className="search-close-btn" onClick={onClose} aria-label="Close search">✕</button>
        </div>
        <div className="search-results">
          {loading && <div className="search-status">Searching…</div>}
          {!loading && query.trim() && results.length === 0 && (
            <div className="search-status">No results for "{query}"</div>
          )}
          {results.map(r => (
            <button
              key={r.id}
              className="search-result-item"
              onClick={() => { onJumpTo(r.channel); onClose(); }}
            >
              <span className="search-result-meta">
                <span className="search-result-channel">#{r.channel}</span>
                <span className="search-result-username">{r.username}</span>
                <span className="search-result-time">
                  {new Date(r.created_at * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                </span>
              </span>
              <span className="search-result-content">
                {highlightContent(r.content, query)}
              </span>
            </button>
          ))}
        </div>
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

  const [authView, setAuthView] = useState<'login' | 'forgot'>(() => 'login');

  const [settings, setSettings] = useState<HumSettings>(() => {
    const stored = localStorage.getItem('hum_settings');
    return stored ? { ...DEFAULT_SETTINGS, ...(JSON.parse(stored) as Partial<HumSettings>) } : DEFAULT_SETTINGS;
  });
  const [showSettings, setShowSettings] = useState(false);

  const handleSettingsChange = useCallback((next: HumSettings) => {
    localStorage.setItem('hum_settings', JSON.stringify(next));
    setSettings(next);
  }, []);

  // Check for password reset token in URL
  const resetToken = new URLSearchParams(window.location.search).get('reset_token');
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<number | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<string>(DEFAULT_CHANNEL);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [messages, setMessages] = useState<HumMessage[]>([]);
  const [openThread, setOpenThread] = useState<HumMessage | null>(null);
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [input, setInput] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<{ id: number; url: string; filename: string; mimeType: string; size: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showCreateSpace, setShowCreateSpace] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [editingTopic, setEditingTopic] = useState(false);
  const [topicInput, setTopicInput] = useState('');
  const [typingUsers, setTypingUsers] = useState<Map<number, string>>(new Map());
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const [unreadCounts, setUnreadCounts] = useState<Map<string, number>>(new Map());
  const [mobileView, setMobileView] = useState<'servers' | 'channels' | 'chat'>('servers');
  const [showAdmin, setShowAdmin] = useState(false);
  const [reactions, setReactions] = useState<Record<number, ReactionGroup[]>>({});
  const [msgLinkPreviews, setMsgLinkPreviews] = useState<Record<number, LinkPreview[]>>({});
  const [dms, setDms] = useState<DmChannel[]>([]);
  const activeSpaceIdRef = useRef(activeSpaceId);
  const activeChannelIdRef = useRef(activeChannelId);
  activeSpaceIdRef.current = activeSpaceId;
  activeChannelIdRef.current = activeChannelId;

  const handleAuth = useCallback((a: AuthState) => {
    localStorage.setItem('hum_auth', JSON.stringify(a));
    setAuth(a);
  }, []);

  const handleSignOut = () => {
    localStorage.removeItem('hum_auth');
    setAuth(null);
  };

  // Apply theme to document root
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  // Request browser notification permission once authenticated
  useEffect(() => {
    if (!auth) return;
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, [auth]);

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

  useEffect(() => {
    if (!auth || !activeSpaceId) { setUnreadCounts(new Map()); return; }
    api.getUnreadCounts(auth.token, activeSpaceId).then(counts => {
      setUnreadCounts(new Map(Object.entries(counts).map(([k, v]) => [k, Number(v)])));
    }).catch(console.error);
  }, [auth, activeSpaceId]);

  useEffect(() => {
    if (!auth || !activeSpaceId) { setDms([]); return; }
    api.listDms(auth.token, activeSpaceId).then(setDms).catch(console.error);
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
    setMobileView('channels');
    setReactions({});
    setDms([]);
    setOpenThread(null);
  };

  const handleOpenDm = async (targetUserId: number) => {
    if (!auth || !activeSpaceId) return;
    const { channelId } = await api.openDm(auth.token, activeSpaceId, targetUserId);
    // Refresh DM list
    const updatedDms = await api.listDms(auth.token, activeSpaceId);
    setDms(updatedDms);
    handleSelectChannel(`dm:${channelId}`);
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
    if (!isVoiceChannel(id)) {
      setMessages([]);
      setReactions({});
      setMsgLinkPreviews({});
      // Clear unread for this channel
      setUnreadCounts(prev => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    }
    setMobileView('chat');
  };

  const onMessage = useCallback((msg: HumMessage) => {
    setMessages(prev => [...prev, msg]);
    if (auth && activeSpaceIdRef.current && msg.channelId === activeChannelIdRef.current) {
      void api.markChannelRead(auth.token, msg.spaceId, msg.channelId, msg.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onHistory = useCallback((msgs: HumMessage[]) => {
    setMessages(msgs);
    // Extract reactions embedded in history messages
    const initialReactions: Record<number, ReactionGroup[]> = {};
    for (const msg of msgs) {
      if (msg.reactions && msg.reactions.length > 0) {
        initialReactions[msg.id] = msg.reactions;
      }
    }
    setReactions(initialReactions);
    if (msgs.length > 0 && auth && activeSpaceIdRef.current) {
      const lastId = msgs[msgs.length - 1].id;
      const ch = activeChannelIdRef.current;
      const sid = activeSpaceIdRef.current;
      void api.markChannelRead(auth.token, sid, ch, lastId);
      setUnreadCounts(prev => { const next = new Map(prev); next.delete(ch); return next; });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onError = useCallback((err: string) => {
    console.error('[ws]', err);
  }, []);

  const onChannelNewMessage = useCallback((event: ChannelNewMessageEvent) => {
    if (event.channelId === activeChannelIdRef.current) return;
    setUnreadCounts(prev => {
      const next = new Map(prev);
      next.set(event.channelId, (next.get(event.channelId) ?? 0) + 1);
      return next;
    });
  }, []);

  const onReaction = useCallback((event: ReactionEvent) => {
    const { messageId, emoji, userId, username, action } = event.reaction;
    setReactions(prev => {
      const groups = [...(prev[messageId] ?? [])];
      const idx = groups.findIndex(g => g.emoji === emoji);
      if (action === 'add') {
        if (idx === -1) {
          groups.push({ emoji, userIds: [userId], usernames: [username] });
        } else if (!groups[idx].userIds.includes(userId)) {
          groups[idx] = { ...groups[idx], userIds: [...groups[idx].userIds, userId], usernames: [...groups[idx].usernames, username] };
        }
      } else {
        if (idx !== -1) {
          const updated = { ...groups[idx], userIds: groups[idx].userIds.filter(id => id !== userId), usernames: groups[idx].usernames.filter(n => n !== username) };
          if (updated.userIds.length === 0) groups.splice(idx, 1);
          else groups[idx] = updated;
        }
      }
      return { ...prev, [messageId]: groups };
    });
  }, []);

  const onLinkPreview = useCallback((event: LinkPreviewEvent) => {
    const { messageId, previews } = event.linkPreview;
    setMsgLinkPreviews(prev => ({ ...prev, [messageId]: previews }));
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

  const handleReplyCountUpdate = useCallback((messageId: number, replyCount: number) => {
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, replyCount } : m));
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

  const onMention = useCallback((event: MentionEvent) => {
    if (!settings.notifyOnMention) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const { message } = event;
    new Notification(`${message.username} mentioned you in #${message.channelId}`, {
      body: message.content,
      tag: `mention-${message.id}`,
    });
  }, [settings.notifyOnMention]);

  // Clear typing state when switching channels or spaces
  useEffect(() => {
    setTypingUsers(new Map());
  }, [activeChannelId, activeSpaceId]);

  // Reset topic editing when channel changes
  useEffect(() => {
    setEditingTopic(false);
  }, [activeChannelId, activeSpaceId]);

  const activeChannel = channels.find(ch => {
    const clientId = ch.type === 'voice' ? `voice:${ch.name}` : ch.name;
    return clientId === activeChannelId;
  }) ?? null;

  const handleUpdateTopic = async (topic: string | null) => {
    if (!auth || !activeSpaceId || !activeChannel) return;
    try {
      const result = await api.updateChannelTopic(auth.token, activeSpaceId, activeChannel.id, topic);
      setChannels(prev => prev.map(ch => ch.id === activeChannel.id ? { ...ch, topic: result.topic } : ch));
    } catch (err) {
      console.error('[topic]', err);
    }
    setEditingTopic(false);
  };

  const socketChannelId = isVoiceChannel(activeChannelId) ? null : activeChannelId;
  const activeDm = isDmChannel(activeChannelId)
    ? dms.find(d => `dm:${d.id}` === activeChannelId)
    : null;

  const { sendMessage, sendTypingStart, sendTypingStop, send, toggleReaction } = useSocket(
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
          onTyping,
          onPresenceUpdate,
          onMention,
          onChannelNewMessage,
          onReaction,
          onLinkPreview,
        }
      : { token: '', spaceId: null, channelId: null, onMessage, onHistory, onError }
  );

  const {
    isInRoom,
    isMuted,
    isScreenSharing,
    participants,
    remoteScreens,
    join: joinVoice,
    leave: leaveVoice,
    toggleMute,
    startScreenShare,
    stopScreenShare,
    handleVoiceEvent,
  } = useLiveKitVoice({ send, spaceId: activeSpaceId, authToken: auth?.token ?? '', micDeviceId: settings.micDeviceId });

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
    if (!input.trim() && !pendingAttachment) return;
    sendMessage(input.trim(), pendingAttachment?.id);
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    if (isTypingRef.current) { sendTypingStop(); isTypingRef.current = false; }
    setInput('');
    setPendingAttachment(null);
  };

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !auth) return;
    e.target.value = '';
    setUploadError(null);
    try {
      const result = await api.uploadFile(auth.token, file);
      setPendingAttachment(result);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  const handleCreateInvite = async (): Promise<string> => {
    if (!auth || !activeSpaceId) throw new Error('no active space');
    const { token } = await api.createInvite(auth.token, activeSpaceId);
    return token;
  };

  const handleUpdateMemberRole = async (userId: number, role: SpaceRole) => {
    if (!auth || !activeSpaceId) return;
    await api.updateMemberRole(auth.token, activeSpaceId, userId, role);
    setMembers(prev => prev.map(m => m.user_id === userId ? { ...m, role } : m));
  };

  const handleKickMember = async (userId: number) => {
    if (!auth || !activeSpaceId) return;
    await api.kickMember(auth.token, activeSpaceId, userId);
    setMembers(prev => prev.filter(m => m.user_id !== userId));
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

  if (!auth) {
    if (resetToken) {
      return <ResetPasswordScreen token={resetToken} onDone={() => {
        // Clear the token from the URL and show login
        window.history.replaceState({}, '', window.location.pathname);
        setAuthView('login');
      }} />;
    }
    if (authView === 'forgot') {
      return <ForgotPasswordScreen onBack={() => setAuthView('login')} />;
    }
    return <AuthScreen onAuth={handleAuth} onForgotPassword={() => setAuthView('forgot')} />;
  }

  const activeSpace = spaces.find(s => s.id === activeSpaceId) ?? null;
  const inVoice = isVoiceChannel(activeChannelId);
  const inDm = isDmChannel(activeChannelId);

  return (
    <div className="app-shell" data-mobile-view={mobileView}>
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
        currentUserId={auth.userId}
        onSignOut={handleSignOut}
        onOpenSettings={() => setShowSettings(true)}
        channels={channels}
        onCreateChannel={handleCreateChannel}
        onDeleteChannel={handleDeleteChannel}
        voiceParticipants={participants}
        activeVoiceRoomId={isInRoom ? activeChannelId : null}
        members={members}
        onCreateInvite={handleCreateInvite}
        onUpdateMemberRole={handleUpdateMemberRole}
        onKickMember={handleKickMember}
        unreadCounts={unreadCounts}
        onMobileBack={() => setMobileView('servers')}
        dms={dms}
        onOpenDm={handleOpenDm}
      />

      {/* Column 3: main content */}
      <div className="main">
        {activeSpace ? (
          <>
            <header className="main-header">
              <button className="mobile-back-btn" onClick={() => setMobileView('channels')} aria-label="Back to channels">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
              </button>
              <span className="main-header-icon" aria-hidden>
                {inVoice
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
                  : inDm
                    ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
                    : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 3L9 3.41 6.41 16H3v2h3l-.59 2.59.97.41H8l.59-2.59.97.41H11L10.41 16H14l.59 2.59.97.41H17l.59-2.59.97.41H20v-2h-2l2.59-13H19l-2.59 13H13l2.59-13H14l-2.59 13H8l2.59-13z"/></svg>
                }
              </span>
              <span>{inVoice ? voiceRoomName(activeChannelId) : inDm ? (activeDm?.other_display_name ?? activeDm?.other_username ?? activeChannelId) : activeChannelId}</span>
              {!inVoice && !inDm && activeChannel && (
                editingTopic ? (
                  <form
                    className="main-header-topic-form"
                    onSubmit={e => { e.preventDefault(); void handleUpdateTopic(topicInput.trim() || null); }}
                  >
                    <input
                      className="main-header-topic-input"
                      value={topicInput}
                      onChange={e => setTopicInput(e.target.value)}
                      placeholder="Set a topic…"
                      autoFocus
                      onBlur={() => void handleUpdateTopic(topicInput.trim() || null)}
                      onKeyDown={e => { if (e.key === 'Escape') setEditingTopic(false); }}
                    />
                  </form>
                ) : (
                  <span
                    className="main-header-topic"
                    onClick={() => { setTopicInput(activeChannel.topic ?? ''); setEditingTopic(true); }}
                    title="Click to set topic"
                  >
                    {activeChannel.topic ?? 'Set a topic…'}
                  </span>
                )
              )}
              {members.some(m => m.user_id === auth.userId && m.role === 'owner') && (
                <button
                  className="header-search-btn"
                  onClick={() => setShowAdmin(true)}
                  aria-label="Admin dashboard"
                  title="Admin"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
                  </svg>
                </button>
              )}
              <button
                className="header-search-btn"
                onClick={() => setShowSearch(true)}
                aria-label="Search messages"
                title="Search (⌘K)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
              </button>
            </header>
            {showSearch && (
              <SearchPanel
                spaceId={activeSpaceId!}
                token={auth.token}
                onClose={() => setShowSearch(false)}
                onJumpTo={handleSelectChannel}
              />
            )}

            {inVoice ? (
              <VoiceRoomView
                roomId={activeChannelId}
                isInRoom={isInRoom}
                isMuted={isMuted}
                isScreenSharing={isScreenSharing}
                participants={participants}
                remoteScreens={remoteScreens}
                myUserId={auth.userId}
                onJoin={handleJoinVoice}
                onLeave={leaveVoice}
                onToggleMute={toggleMute}
                onStartScreenShare={startScreenShare}
                onStopScreenShare={stopScreenShare}
                joinError={joinError}
              />
            ) : (
              <>
                <MessageList
                  messages={messages}
                  myUserId={auth.userId}
                  myUsername={auth.username}
                  token={auth.token}
                  activeSpaceId={activeSpaceId}
                  openThreadMessageId={openThread?.id ?? null}
                  onEditMessage={handleEditMessage}
                  onDeleteMessage={handleDeleteMessage}
                  reactions={reactions}
                  onToggleReaction={(messageId, emoji) => toggleReaction(messageId, emoji)}
                  linkPreviews={msgLinkPreviews}
                  onOpenThread={setOpenThread}
                />
                {typingUsers.size > 0 && (
                  <div className="typing-indicator">
                    {Array.from(typingUsers.values()).join(', ')} {typingUsers.size === 1 ? 'is' : 'are'} typing…
                  </div>
                )}
                {uploadError && (
                  <div className="upload-error">{uploadError}</div>
                )}
                {pendingAttachment && (
                  <div className="pending-attachment">
                    {pendingAttachment.mimeType.startsWith('image/') ? (
                      <img src={pendingAttachment.url} alt={pendingAttachment.filename} className="pending-attachment-preview" />
                    ) : (
                      <span className="pending-attachment-name">📎 {pendingAttachment.filename}</span>
                    )}
                    <button type="button" className="pending-attachment-remove" onClick={() => setPendingAttachment(null)}>✕</button>
                  </div>
                )}
                <form className="compose" onSubmit={handleSend}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                    accept="image/*,application/pdf,text/*,.zip,.doc,.docx,.xls,.xlsx"
                  />
                  <Button type="button" variant="ghost" size="sm" onClick={handleAttachClick} title="Attach file">
                    📎
                  </Button>
                  <Input
                    value={input}
                    onChange={handleInputChange}
                    placeholder={inDm ? `Message ${activeDm?.other_display_name ?? activeDm?.other_username ?? '…'}` : `Message #${activeChannelId}…`}
                    autoFocus
                    className="flex-1"
                  />
                  <Button type="submit" disabled={!input.trim() && !pendingAttachment} size="sm">send</Button>
                </form>
              </>
            )}
          </>
        ) : (
          <div className="pick-space">Select a server to start talking</div>
        )}
      </div>

      <UserSettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
        settings={settings}
        onSettingsChange={handleSettingsChange}
      />

      {openThread && auth && activeSpaceId && (
        <ThreadPanel
          token={auth.token}
          spaceId={activeSpaceId}
          message={openThread}
          myUserId={auth.userId}
          myUsername={auth.username}
          onClose={() => setOpenThread(null)}
          onReplyCountUpdate={handleReplyCountUpdate}
        />
      )}

      {showAdmin && activeSpace && (
        <AdminDashboard
          space={activeSpace}
          members={members}
          token={auth.token}
          onClose={() => setShowAdmin(false)}
        />
      )}

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
