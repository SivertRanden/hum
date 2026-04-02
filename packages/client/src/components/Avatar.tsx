interface AvatarProps {
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const sizes = { sm: 28, md: 36, lg: 56 };

export function Avatar({ username, displayName, avatarUrl, size = 'md', onClick }: AvatarProps) {
  const px = sizes[size];
  const label = displayName || username;

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={label}
        title={label}
        width={px}
        height={px}
        className={`avatar avatar-${size}${onClick ? ' avatar-clickable' : ''}`}
        onClick={onClick}
        style={{ cursor: onClick ? 'pointer' : undefined }}
      />
    );
  }

  return (
    <div
      className={`avatar avatar-${size} avatar-initials${onClick ? ' avatar-clickable' : ''}`}
      title={label}
      onClick={onClick}
      style={{ width: px, height: px, cursor: onClick ? 'pointer' : undefined }}
      aria-label={label}
    >
      {initials(label)}
    </div>
  );
}
