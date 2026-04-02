import { useState, useEffect, useCallback } from 'react';
import { api, AuditLogEntry, Space, SpaceMember } from '../api.js';

interface AdminDashboardProps {
  space: Space;
  members: SpaceMember[];
  token: string;
  onClose: () => void;
}

const ACTION_LABELS: Record<string, string> = {
  'message.edit': '✏️ edited message',
  'message.delete': '🗑️ deleted message',
  'channel.create': '➕ created channel',
  'channel.delete': '❌ deleted channel',
  'channel.topic': '📝 updated channel topic',
};

function formatTime(epoch: number): string {
  return new Date(epoch * 1000).toLocaleString();
}

function parseMeta(meta: string | null): string {
  if (!meta) return '';
  try {
    const obj = JSON.parse(meta) as Record<string, unknown>;
    return Object.entries(obj).map(([k, v]) => `${k}: ${String(v)}`).join(', ');
  } catch {
    return meta;
  }
}

export function AdminDashboard({ space, members, token, onClose }: AdminDashboardProps) {
  const [tab, setTab] = useState<'audit' | 'members'>('audit');
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAuditLogs(token, space.id);
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [token, space.id]);

  useEffect(() => {
    if (tab === 'audit') void loadLogs();
  }, [tab, loadLogs]);

  const onlineCount = members.filter(m => m.is_online).length;

  return (
    <div className="admin-dashboard-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="admin-dashboard">
        <div className="admin-dashboard-header">
          <h2 className="admin-dashboard-title">⚙️ Admin — {space.name}</h2>
          <button className="admin-close-btn" onClick={onClose} aria-label="Close admin dashboard">✕</button>
        </div>

        <div className="admin-tabs">
          <button
            className={`admin-tab${tab === 'audit' ? ' active' : ''}`}
            onClick={() => setTab('audit')}
          >
            Audit Log
          </button>
          <button
            className={`admin-tab${tab === 'members' ? ' active' : ''}`}
            onClick={() => setTab('members')}
          >
            Members ({members.length})
          </button>
        </div>

        <div className="admin-content">
          {tab === 'audit' && (
            <>
              <div className="admin-section-bar">
                <span className="admin-section-label">Recent actions</span>
                <button className="admin-refresh-btn" onClick={() => void loadLogs()} disabled={loading}>
                  {loading ? '…' : '↺ Refresh'}
                </button>
              </div>
              {error && <div className="admin-error">{error}</div>}
              {!loading && logs.length === 0 && !error && (
                <div className="admin-empty">No audit events recorded yet.</div>
              )}
              <ul className="audit-log-list">
                {logs.map(entry => (
                  <li key={entry.id} className="audit-log-entry">
                    <span className="audit-log-time">{formatTime(entry.created_at)}</span>
                    <span className="audit-log-actor">{entry.username}</span>
                    <span className="audit-log-action">{ACTION_LABELS[entry.action] ?? entry.action}</span>
                    {entry.meta && (
                      <span className="audit-log-meta">{parseMeta(entry.meta)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {tab === 'members' && (
            <>
              <div className="admin-stats-row">
                <div className="admin-stat">
                  <div className="admin-stat-value">{members.length}</div>
                  <div className="admin-stat-label">Total members</div>
                </div>
                <div className="admin-stat">
                  <div className="admin-stat-value">{onlineCount}</div>
                  <div className="admin-stat-label">Online now</div>
                </div>
              </div>
              <ul className="admin-member-list">
                {members.map(m => (
                  <li key={m.id} className="admin-member-entry">
                    <div className="member-avatar-wrap">
                      <div className="member-avatar">{m.username.slice(0, 2).toUpperCase()}</div>
                      <span className={m.is_online ? 'presence-dot online' : 'presence-dot offline'} />
                    </div>
                    <div className="admin-member-info">
                      <span className="admin-member-name">{m.username}</span>
                      {m.role === 'owner' && <span className="member-role">owner</span>}
                    </div>
                    <span className="admin-member-joined">
                      Joined {new Date(m.joined_at * 1000).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
