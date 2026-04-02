const BASE = '/api';

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: token ? authHeaders(token) : { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json() as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Request failed');
  return data;
}

async function get<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders(token) });
  const data = await res.json() as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Request failed');
  return data;
}

async function patch<T>(path: string, body: unknown, token: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  const data = await res.json() as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Request failed');
  return data;
}

async function del(path: string, token: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE', headers: authHeaders(token) });
  if (!res.ok && res.status !== 204) {
    const data = await res.json() as { error?: string };
    throw new Error(data.error ?? 'Request failed');
  }
}

export interface AuthResponse {
  token: string;
  user: { id: number; username: string };
}

export interface Space {
  id: number;
  name: string;
  description: string | null;
  created_by: number;
  created_at: number;
}

export interface Channel {
  id: number;
  space_id: number;
  name: string;
  type: 'text' | 'voice' | 'dm';
  topic: string | null;
  created_by: number;
  created_at: number;
}

export interface DmChannel {
  id: number;
  name: string;
  space_id: number;
  other_user_id: number;
  other_username: string;
  other_display_name: string | null;
  other_avatar_url: string | null;
  is_online?: boolean;
}

export interface UserProfile {
  id: number;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export type SpaceRole = 'owner' | 'admin' | 'moderator' | 'member';

export interface SpaceMember {
  id: number;
  space_id: number;
  user_id: number;
  role: SpaceRole;
  joined_at: number;
  username: string;
  is_online?: boolean;
  last_seen_at?: number | null;
}

export interface SearchResult {
  id: number;
  space_id: number;
  channel: string;
  user_id: number;
  username: string;
  content: string;
  created_at: number;
}

export interface ThreadReplyData {
  id: number;
  parent_message_id: number;
  space_id: number;
  user_id: number;
  channel: string;
  content: string;
  created_at: number;
  updated_at: number | null;
  deleted_at: number | null;
  username?: string;
  reply_count: number;
}

export interface AuditLogEntry {
  id: number;
  space_id: number;
  user_id: number;
  username: string;
  action: string;
  target_type: string | null;
  target_id: number | null;
  meta: string | null;
  created_at: number;
}

export interface ThreadData {
  parent: {
    id: number;
    space_id: number;
    user_id: number;
    channel: string;
    content: string;
    reply_count: number;
    created_at: number;
    updated_at: number | null;
    deleted_at: number | null;
    username?: string;
  };
  replies: ThreadReplyData[];
}

export const api = {
  register: (username: string, password: string, email?: string) =>
    post<AuthResponse>('/auth/register', { username, password, email }),

  login: (username: string, password: string) =>
    post<AuthResponse>('/auth/login', { username, password }),

  forgotPassword: (email: string) =>
    post<{ message: string }>('/auth/forgot-password', { email }),

  resetPassword: (token: string, password: string) =>
    post<{ message: string }>('/auth/reset-password', { token, password }),

  listSpaces: (token: string) => get<Space[]>('/spaces', token),

  createSpace: (token: string, name: string, description?: string) =>
    post<Space>('/spaces', { name, description }, token),

  deleteSpace: (token: string, spaceId: number) =>
    del(`/spaces/${spaceId}`, token),

  listChannels: (token: string, spaceId: number) =>
    get<Channel[]>(`/spaces/${spaceId}/channels`, token),

  createChannel: (token: string, spaceId: number, name: string, type: 'text' | 'voice') =>
    post<Channel>(`/spaces/${spaceId}/channels`, { name, type }, token),

  deleteChannel: (token: string, spaceId: number, channelId: number) =>
    del(`/spaces/${spaceId}/channels/${channelId}`, token),

  editMessage: (token: string, spaceId: number, messageId: number, content: string) =>
    patch<{ id: number; content: string; editedAt: number }>(
      `/spaces/${spaceId}/messages/${messageId}`,
      { content },
      token,
    ),

  deleteMessage: (token: string, spaceId: number, messageId: number) =>
    del(`/spaces/${spaceId}/messages/${messageId}`, token),

  listMembers: (token: string, spaceId: number) =>
    get<SpaceMember[]>(`/spaces/${spaceId}/members`, token),

  createInvite: (token: string, spaceId: number) =>
    post<{ token: string; expiresAt: number }>(`/spaces/${spaceId}/invites`, {}, token),

  joinByInvite: (token: string, inviteToken: string) =>
    post<{ space: Space }>(`/invite/${inviteToken}/join`, {}, token),

  getUnreadCounts: (token: string, spaceId: number) =>
    get<Record<string, number>>(`/spaces/${spaceId}/unread`, token),

  updateUserProfile: (token: string, userId: number, displayName: string | null) =>
    patch<UserProfile>(`/users/${userId}/profile`, { displayName }, token),

  uploadAvatar: async (token: string, userId: number, file: File): Promise<{ avatarUrl: string }> => {
    const form = new FormData();
    form.append('avatar', file);
    const res = await fetch(`${BASE}/users/${userId}/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = await res.json() as { avatarUrl: string; error?: string };
    if (!res.ok) throw new Error(data.error ?? 'Upload failed');
    return data;
  },

  deleteAvatar: (token: string, userId: number) =>
    del(`/users/${userId}/avatar`, token),

  markChannelRead: async (token: string, spaceId: number, channel: string, lastReadMessageId: number): Promise<void> => {
    await fetch(`${BASE}/spaces/${spaceId}/channels/${encodeURIComponent(channel)}/read`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ lastReadMessageId }),
    });
  },

  listDms: (token: string, spaceId: number) =>
    get<DmChannel[]>(`/spaces/${spaceId}/dms`, token),

  openDm: (token: string, spaceId: number, targetUserId: number) =>
    post<{ channelId: number }>(`/spaces/${spaceId}/dms`, { targetUserId }, token),

  searchMessages: (token: string, spaceId: number, q: string, channel?: string) =>
    get<SearchResult[]>(
      `/spaces/${spaceId}/search?q=${encodeURIComponent(q)}${channel ? `&channel=${encodeURIComponent(channel)}` : ''}`,
      token,
    ),

  updateChannelTopic: (token: string, spaceId: number, channelId: number, topic: string | null) =>
    patch<{ id: number; topic: string | null }>(
      `/spaces/${spaceId}/channels/${channelId}/topic`,
      { topic },
      token,
    ),

  getThread: (token: string, spaceId: number, messageId: number) =>
    get<ThreadData>(`/spaces/${spaceId}/messages/${messageId}/thread`, token),

  postThreadReply: (token: string, spaceId: number, messageId: number, content: string) =>
    post<ThreadReplyData>(`/spaces/${spaceId}/messages/${messageId}/thread/replies`, { content }, token),

  uploadFile: async (token: string, file: File): Promise<{ id: number; url: string; filename: string; mimeType: string; size: number }> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = await res.json() as { id: number; url: string; filename: string; mimeType: string; size: number; error?: string };
    if (!res.ok) throw new Error(data.error ?? 'Upload failed');
    return data;
  },

  updateMemberRole: (token: string, spaceId: number, userId: number, role: SpaceRole) =>
    patch<{ userId: number; role: SpaceRole }>(`/spaces/${spaceId}/members/${userId}`, { role }, token),

  kickMember: (token: string, spaceId: number, userId: number) =>
    del(`/spaces/${spaceId}/members/${userId}`, token),

  getAuditLogs: (token: string, spaceId: number, limit = 100) =>
    get<AuditLogEntry[]>(`/spaces/${spaceId}/audit-log?limit=${limit}`, token),
};
