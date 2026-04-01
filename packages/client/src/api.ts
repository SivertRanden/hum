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

export const api = {
  register: (username: string, password: string) =>
    post<AuthResponse>('/auth/register', { username, password }),

  login: (username: string, password: string) =>
    post<AuthResponse>('/auth/login', { username, password }),

  listSpaces: (token: string) => get<Space[]>('/spaces', token),

  createSpace: (token: string, name: string, description?: string) =>
    post<Space>('/spaces', { name, description }, token),
};
