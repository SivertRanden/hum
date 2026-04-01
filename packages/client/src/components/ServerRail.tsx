import { type Space } from '../api.js';

interface ServerRailProps {
  servers: Space[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onAdd: () => void;
}

function initials(name: string) {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function ServerRail({ servers, activeId, onSelect, onAdd }: ServerRailProps) {
  return (
    <div className="server-rail">
      <div className="server-rail-list">
        {servers.map(s => (
          <div key={s.id} className="server-rail-item">
            <button
              className={`server-icon${s.id === activeId ? ' active' : ''}`}
              onClick={() => onSelect(s.id)}
              title={s.name}
            >
              {initials(s.name)}
            </button>
          </div>
        ))}
      </div>
      <div className="server-rail-bottom">
        <button className="server-add-btn" onClick={onAdd} title="Add a server">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
