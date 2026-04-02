import { useState } from 'react';
import { type Space, type Channel, type SpaceMember, type DmChannel } from '../api.js';
import { type VoicePeer } from '../useSocket.js';

interface ChannelSidebarProps {
  server: Space | null;
  activeChannelId: string;
  onSelectChannel: (id: string) => void;
  username: string;
  onSignOut: () => void;
  channels: Channel[];
  onCreateChannel: (name: string, type: 'text' | 'voice') => Promise<void>;
  onDeleteChannel: (channelId: number) => Promise<void>;
  voiceParticipants: VoicePeer[];
  activeVoiceRoomId: string | null;
  members: SpaceMember[];
  onCreateInvite: () => Promise<string>;
  unreadCounts?: Map<string, number>;
  onMobileBack?: () => void;
  dms?: DmChannel[];
  onOpenDm?: (targetUserId: number) => Promise<void>;
}

function channelClientId(ch: Channel): string {
  return ch.type === 'voice' ? `voice:${ch.name}` : ch.name;
}

function HashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M10.59 3L9 3.41 6.41 16H3v2h3l-.59 2.59.97.41H8l.59-2.59.97.41H11L10.41 16H14l.59 2.59.97.41H17l.59-2.59.97.41H20v-2h-2l2.59-13H19l-2.59 13H13l2.59-13H14l-2.59 13H8l2.59-13z"/>
    </svg>
  );
}

function VolumeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
    </svg>
  );
}


function LinkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
    </svg>
  );
}

export function ChannelSidebar({
  server,
  activeChannelId,
  onSelectChannel,
  username,
  onSignOut,
  channels,
  onCreateChannel,
  onDeleteChannel,
  voiceParticipants,
  activeVoiceRoomId,
  members,
  onCreateInvite,
  unreadCounts = new Map(),
  onMobileBack,
  dms = [],
  onOpenDm,
}: ChannelSidebarProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'text' | 'voice'>('text');
  const [creating, setCreating] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [showDmPicker, setShowDmPicker] = useState(false);

  const textChannels = channels.filter(ch => ch.type === 'text');
  const voiceChannels = channels.filter(ch => ch.type === 'voice');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await onCreateChannel(newName.trim(), newType);
      setNewName('');
      setShowCreate(false);
    } finally {
      setCreating(false);
    }
  };

  const handleInvite = async () => {
    try {
      const inviteToken = await onCreateInvite();
      const url = `${window.location.origin}?invite=${inviteToken}`;
      await navigator.clipboard.writeText(url);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="channel-sidebar">
      <div className="channel-sidebar-header">
        {onMobileBack && (
          <button className="mobile-back-btn" onClick={onMobileBack} aria-label="Back to servers">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
          </button>
        )}
        {server ? (
          <span className="channel-server-name">{server.name}</span>
        ) : (
          <span className="channel-server-name muted">No server selected</span>
        )}
      </div>

      <div className="channel-sidebar-body">
        <div className="channel-section">
          <div className="channel-section-label">
            Text Channels
            {server && (
              <button
                className="channel-add-btn"
                onClick={() => { setNewType('text'); setShowCreate(s => !s); }}
                title="Add text channel"
              >
                <PlusIcon />
              </button>
            )}
          </div>
          <ul className="channel-list">
            {textChannels.map(ch => {
              const clientId = channelClientId(ch);
              return (
                <li key={ch.id} className="channel-list-item">
                  <button
                    className={`channel-item${activeChannelId === clientId ? ' active' : ''}`}
                    onClick={() => onSelectChannel(clientId)}
                    disabled={!server}
                  >
                    <HashIcon />
                    <span className="flex-1">{ch.name}</span>
                    {(unreadCounts.get(ch.name) ?? 0) > 0 && (
                      <span className="unread-dot" title={`${unreadCounts.get(ch.name)} unread`} />
                    )}
                  </button>
                  <button
                    className="channel-delete-btn"
                    onClick={() => onDeleteChannel(ch.id)}
                    title={`Delete #${ch.name}`}
                  >
                    <TrashIcon />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="channel-section">
          <div className="channel-section-label">
            Voice Rooms
            {server && (
              <button
                className="channel-add-btn"
                onClick={() => { setNewType('voice'); setShowCreate(s => !s); }}
                title="Add voice room"
              >
                <PlusIcon />
              </button>
            )}
          </div>
          <ul className="channel-list">
            {voiceChannels.map(ch => {
              const clientId = channelClientId(ch);
              const isActive = activeChannelId === clientId;
              const isLive = activeVoiceRoomId === clientId;
              const count = isLive ? voiceParticipants.length : 0;
              return (
                <li key={ch.id}>
                  <div className="channel-list-item">
                    <button
                      className={`channel-item voice${isActive ? ' active' : ''}`}
                      onClick={() => onSelectChannel(clientId)}
                      disabled={!server}
                    >
                      <VolumeIcon />
                      <span className="flex-1">{ch.name}</span>
                      {isLive && count > 0 && (
                        <span className="voice-count">{count}</span>
                      )}
                    </button>
                    <button
                      className="channel-delete-btn"
                      onClick={() => onDeleteChannel(ch.id)}
                      title={`Delete ${ch.name}`}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                  {isLive && voiceParticipants.length > 0 && (
                    <ul className="voice-participant-list">
                      {voiceParticipants.map(p => (
                        <li key={p.userId} className="voice-participant-entry">
                          <span className="voice-participant-dot" />
                          {p.username}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {server && (
          <div className="channel-section">
            <div className="channel-section-label">
              Direct Messages
              {onOpenDm && (
                <button
                  className="channel-add-btn"
                  onClick={() => setShowDmPicker(s => !s)}
                  title="Start new DM"
                >
                  <PlusIcon />
                </button>
              )}
            </div>
            {showDmPicker && (
              <ul className="channel-list">
                {members.filter(m => m.username !== username).map(m => (
                  <li key={m.user_id}>
                    <button
                      className="channel-item"
                      onClick={() => { void onOpenDm?.(m.user_id); setShowDmPicker(false); }}
                    >
                      <span className={m.is_online ? 'presence-dot online' : 'presence-dot offline'} style={{ marginRight: 4 }} />
                      {m.username}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <ul className="channel-list">
              {dms.map(dm => {
                const clientId = `dm:${dm.id}`;
                const displayName = dm.other_display_name ?? dm.other_username;
                return (
                  <li key={dm.id} className="channel-list-item">
                    <button
                      className={`channel-item${activeChannelId === clientId ? ' active' : ''}`}
                      onClick={() => onSelectChannel(clientId)}
                    >
                      <span className={dm.is_online ? 'presence-dot online' : 'presence-dot offline'} style={{ marginRight: 4 }} />
                      <span className="flex-1">{displayName}</span>
                      {(unreadCounts.get(clientId) ?? 0) > 0 && (
                        <span className="unread-dot" title={`${unreadCounts.get(clientId)} unread`} />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {server && members.length > 0 && (
          <div className="channel-section">
            <div className="channel-section-label">
              <button
                className="channel-section-toggle"
                onClick={() => setShowMembers(s => !s)}
              >
                Members ({members.length})
              </button>
              <button
                className="channel-add-btn"
                onClick={handleInvite}
                title={inviteCopied ? 'Copied!' : 'Copy invite link'}
              >
                <LinkIcon />
              </button>
            </div>
            {showMembers && (
              <ul className="channel-list">
                {members.map((m: SpaceMember) => (
                  <li key={m.id} className="member-entry">
                    <div className="member-avatar-wrap">
                      <div className="member-avatar">{m.username.slice(0, 2).toUpperCase()}</div>
                      <span className={m.is_online ? 'presence-dot online' : 'presence-dot offline'} />
                    </div>
                    <span className="member-name">{m.username}</span>
                    {m.role === 'owner' && <span className="member-role">owner</span>}
                  </li>
                ))}
              </ul>
            )}
            {inviteCopied && (
              <div className="invite-copied-toast">Invite link copied!</div>
            )}
          </div>
        )}

        {showCreate && server && (
          <form onSubmit={handleCreate} className="channel-create-form">
            <input
              autoFocus
              className="channel-create-input"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder={newType === 'text' ? 'channel-name' : 'room-name'}
              required
            />
            <button type="submit" disabled={creating} className="channel-create-submit">
              {creating ? '…' : 'add'}
            </button>
            <button type="button" onClick={() => setShowCreate(false)} className="channel-create-cancel">
              ✕
            </button>
          </form>
        )}
      </div>

      <div className="channel-sidebar-footer">
        <div className="user-panel">
          <div className="user-avatar">{username.slice(0, 2).toUpperCase()}</div>
          <div className="user-info">
            <div className="user-name">{username}</div>
            <div className="user-status">
              <span className="status-dot" />
              Online
            </div>
          </div>
          <button className="user-signout-btn" onClick={onSignOut} title="Sign out">
            <SignOutIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
