import { useState, useRef } from 'react';
import { type UserProfile } from '../api.js';
import { api } from '../api.js';
import { Avatar } from './Avatar.js';

interface UserProfileCardProps {
  profile: UserProfile;
  isOwnProfile: boolean;
  token: string;
  onClose: () => void;
  onProfileUpdate: (updated: UserProfile) => void;
}

export function UserProfileCard({ profile, isOwnProfile, token, onClose, onProfileUpdate }: UserProfileCardProps) {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(profile.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await api.updateUserProfile(token, profile.id, displayName.trim() || null);
      onProfileUpdate(updated);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await api.uploadAvatar(token, profile.id, file);
      onProfileUpdate({ ...profile, avatarUrl: result.avatarUrl });
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteAvatar = async () => {
    setUploading(true);
    try {
      await api.deleteAvatar(token, profile.id);
      onProfileUpdate({ ...profile, avatarUrl: null });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="profile-card-overlay" onClick={onClose}>
      <div className="profile-card" onClick={e => e.stopPropagation()}>
        <button className="profile-card-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="profile-card-avatar-section">
          <Avatar
            username={profile.username}
            displayName={profile.displayName}
            avatarUrl={profile.avatarUrl}
            size="lg"
            onClick={isOwnProfile ? () => fileInputRef.current?.click() : undefined}
          />
          {isOwnProfile && (
            <div className="profile-avatar-actions">
              <button
                className="profile-avatar-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Upload avatar"
              >
                {uploading ? '…' : 'change photo'}
              </button>
              {profile.avatarUrl && (
                <button
                  className="profile-avatar-btn profile-avatar-remove"
                  onClick={handleDeleteAvatar}
                  disabled={uploading}
                  title="Remove avatar"
                >
                  remove
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleAvatarChange}
              />
            </div>
          )}
        </div>

        <div className="profile-card-info">
          <div className="profile-card-username">@{profile.username}</div>

          {isOwnProfile && editing ? (
            <div className="profile-card-edit">
              <input
                className="profile-card-input"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Display name (optional)"
                maxLength={64}
                autoFocus
              />
              <div className="profile-card-edit-actions">
                <button className="profile-card-save" onClick={handleSave} disabled={saving}>
                  {saving ? '…' : 'save'}
                </button>
                <button className="profile-card-cancel" onClick={() => { setEditing(false); setDisplayName(profile.displayName ?? ''); }}>
                  cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="profile-card-display-name">
              {profile.displayName || <span className="muted">{profile.username}</span>}
              {isOwnProfile && (
                <button className="profile-card-edit-btn" onClick={() => setEditing(true)} title="Edit display name">
                  ✎
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
