import { type Space } from '../api.js';

// Static channel scaffold — a real server would fetch these from the API
const TEXT_CHANNELS = [
  { id: 'general', name: 'general' },
  { id: 'announcements', name: 'announcements' },
  { id: 'off-topic', name: 'off-topic' },
];

const VOICE_ROOMS = [
  { id: 'voice:lounge', name: 'Lounge' },
  { id: 'voice:gaming', name: 'Gaming' },
  { id: 'voice:music', name: 'Music' },
];

interface ChannelSidebarProps {
  server: Space | null;
  activeChannelId: string;
  onSelectChannel: (id: string) => void;
  username: string;
  onSignOut: () => void;
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

export function ChannelSidebar({ server, activeChannelId, onSelectChannel, username, onSignOut }: ChannelSidebarProps) {
  return (
    <div className="channel-sidebar">
      <div className="channel-sidebar-header">
        {server ? (
          <span className="channel-server-name">{server.name}</span>
        ) : (
          <span className="channel-server-name muted">No server selected</span>
        )}
      </div>

      <div className="channel-sidebar-body">
        <div className="channel-section">
          <div className="channel-section-label">Text Channels</div>
          <ul className="channel-list">
            {TEXT_CHANNELS.map(ch => (
              <li key={ch.id}>
                <button
                  className={`channel-item${activeChannelId === ch.id ? ' active' : ''}`}
                  onClick={() => onSelectChannel(ch.id)}
                  disabled={!server}
                >
                  <HashIcon />
                  <span>{ch.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="channel-section">
          <div className="channel-section-label">Voice Rooms</div>
          <ul className="channel-list">
            {VOICE_ROOMS.map(room => (
              <li key={room.id}>
                <button
                  className={`channel-item voice${activeChannelId === room.id ? ' active' : ''}`}
                  onClick={() => onSelectChannel(room.id)}
                  disabled={!server}
                >
                  <VolumeIcon />
                  <span>{room.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
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
