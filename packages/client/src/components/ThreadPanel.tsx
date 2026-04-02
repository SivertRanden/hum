import { useState, useEffect, useRef, useCallback } from 'react';
import { api, ThreadData, ThreadReplyData } from '../api.js';
import { HumMessage } from '../useSocket.js';

interface ThreadPanelProps {
  token: string;
  spaceId: number;
  message: HumMessage;
  myUserId: number;
  myUsername: string;
  onClose: () => void;
  onReplyCountUpdate: (messageId: number, replyCount: number) => void;
}

function formatTime(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ThreadPanel({ token, spaceId, message, myUserId, myUsername, onClose, onReplyCountUpdate }: ThreadPanelProps) {
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadThread = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getThread(token, spaceId, message.id);
      setThread(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load thread');
    } finally {
      setLoading(false);
    }
  }, [token, spaceId, message.id]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread?.replies.length]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      const reply = await api.postThreadReply(token, spaceId, message.id, input.trim());
      setInput('');
      setThread((prev: ThreadData | null) => {
        if (!prev) return prev;
        return {
          parent: { ...prev.parent, reply_count: reply.reply_count ?? 0 },
          replies: [...prev.replies, reply],
        };
      });
      onReplyCountUpdate(message.id, reply.reply_count ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="thread-panel">
      <div className="thread-panel-header">
        <span className="thread-panel-title">Thread</span>
        <button className="thread-panel-close" onClick={onClose} title="Close thread">✕</button>
      </div>

      {/* Parent message */}
      <div className="thread-parent">
        <span className="msg-username">{message.username}</span>
        <span className="msg-content">{message.content}</span>
        <span className="msg-time">{formatTime(message.createdAt)}</span>
        {thread && thread.replies.length > 0 && (
          <span className="thread-reply-count">{thread.replies.length} {thread.replies.length === 1 ? 'reply' : 'replies'}</span>
        )}
      </div>

      <div className="thread-divider">
        <span>Replies</span>
      </div>

      {/* Replies */}
      <div className="thread-replies">
        {loading ? (
          <div className="thread-loading">Loading…</div>
        ) : error ? (
          <div className="error">{error}</div>
        ) : thread?.replies.length === 0 ? (
          <div className="thread-empty">No replies yet. Start the conversation!</div>
        ) : (
          thread?.replies.map((reply: ThreadReplyData) => (
            <div key={reply.id} className={`message ${reply.user_id === myUserId ? 'mine' : ''}`}>
              <span className="msg-username">{reply.username}</span>
              <span className="msg-content">{reply.content}</span>
              <span className="msg-time">{formatTime(reply.created_at)}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Reply compose */}
      <form className="thread-compose" onSubmit={e => void handleSend(e)}>
        <input
          className="thread-compose-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={`Reply as ${myUsername}…`}
          disabled={sending}
          autoFocus
        />
        <button type="submit" className="thread-compose-send" disabled={!input.trim() || sending}>
          {sending ? '…' : 'Reply'}
        </button>
      </form>
    </div>
  );
}
