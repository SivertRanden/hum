import { type Space } from '../api.js';

interface ServerRailProps {
  servers: Space[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onAdd: () => void;
  onDelete?: (id: number) => void;
}

function initials(name: string) {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
    </svg>
  );
}

export function ServerRail({ servers, activeId, onSelect, onAdd, onDelete }: ServerRailProps) {
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
            {onDelete && (
              <button
                className="server-delete-btn"
                onClick={e => { e.stopPropagation(); onDelete(s.id); }}
                title={`Delete ${s.name}`}
              >
                <TrashIcon />
              </button>
            )}
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
