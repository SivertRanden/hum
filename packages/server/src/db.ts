import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '../../hum.db');

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS spaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(space_id, name, type)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    channel TEXT NOT NULL DEFAULT 'general',
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER,
    deleted_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_messages_space_id ON messages(space_id, channel, created_at);

  CREATE TABLE IF NOT EXISTS space_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(space_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS invite_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    created_by INTEGER NOT NULL REFERENCES users(id),
    expires_at INTEGER,
    uses INTEGER NOT NULL DEFAULT 0,
    max_uses INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

// Migration: add channel column if it doesn't exist yet (for existing DBs)
try {
  db.exec("ALTER TABLE messages ADD COLUMN channel TEXT NOT NULL DEFAULT 'general'");
} catch {
  // Column already exists — safe to ignore
}

// Migration: add updated_at column for message edits
try {
  db.exec('ALTER TABLE messages ADD COLUMN updated_at INTEGER');
} catch {
  // Column already exists — safe to ignore
}

// Migration: add deleted_at column for soft deletes
try {
  db.exec('ALTER TABLE messages ADD COLUMN deleted_at INTEGER');
} catch {
  // Column already exists — safe to ignore
}

// Migration: add last_seen_at column to users for presence tracking
try {
  db.exec('ALTER TABLE users ADD COLUMN last_seen_at INTEGER');
} catch {
  // Column already exists — safe to ignore
}

// Migration: seed default channels for existing spaces that have none
db.exec(`
  INSERT OR IGNORE INTO channels (space_id, name, type, created_by)
  SELECT s.id, 'general', 'text', s.created_by FROM spaces s
  WHERE NOT EXISTS (SELECT 1 FROM channels WHERE space_id = s.id);
`);

// Migration: seed space creators as owners in space_members for existing spaces
db.exec(`
  INSERT OR IGNORE INTO space_members (space_id, user_id, role)
  SELECT id, created_by, 'owner' FROM spaces;
`);

export default db;

// Typed query helpers
export interface User {
  id: number;
  username: string;
  password_hash: string;
  created_at: number;
  last_seen_at: number | null;
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
  type: 'text' | 'voice';
  created_by: number;
  created_at: number;
}

export interface Message {
  id: number;
  space_id: number;
  user_id: number;
  channel: string;
  content: string;
  created_at: number;
  updated_at: number | null;
  deleted_at: number | null;
  username?: string;
}

export interface SpaceMember {
  id: number;
  space_id: number;
  user_id: number;
  role: 'owner' | 'member';
  joined_at: number;
  username?: string;
}

export interface InviteToken {
  id: number;
  token: string;
  space_id: number;
  created_by: number;
  expires_at: number | null;
  uses: number;
  max_uses: number | null;
  created_at: number;
}

export const queries = {
  getUserByUsername: db.prepare<[string], User>('SELECT * FROM users WHERE username = ?'),
  getUserById: db.prepare<[number], User>('SELECT * FROM users WHERE id = ?'),
  createUser: db.prepare<[string, string], { lastInsertRowid: number }>('INSERT INTO users (username, password_hash) VALUES (?, ?)'),

  listSpaces: db.prepare<[], Space>('SELECT * FROM spaces ORDER BY name ASC'),
  getSpaceById: db.prepare<[number], Space>('SELECT * FROM spaces WHERE id = ?'),
  createSpace: db.prepare<[string, string | null, number]>('INSERT INTO spaces (name, description, created_by) VALUES (?, ?, ?)'),

  listChannels: db.prepare<[number], Channel>('SELECT * FROM channels WHERE space_id = ? ORDER BY type ASC, name ASC'),
  getChannelById: db.prepare<[number], Channel>('SELECT * FROM channels WHERE id = ?'),
  createChannel: db.prepare<[number, string, string, number]>('INSERT INTO channels (space_id, name, type, created_by) VALUES (?, ?, ?, ?)'),
  deleteChannel: db.prepare<[number, number]>('DELETE FROM channels WHERE id = ? AND space_id = ?'),

  getMessages: db.prepare<[number, string, number], Message>(`
    SELECT m.*, u.username
    FROM messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.space_id = ? AND m.channel = ? AND m.deleted_at IS NULL
    ORDER BY m.created_at ASC
    LIMIT ?
  `),
  insertMessage: db.prepare<[number, number, string, string]>(
    'INSERT INTO messages (space_id, user_id, channel, content) VALUES (?, ?, ?, ?)'
  ),

  getMessageById: db.prepare<[number], Message>(`
    SELECT m.*, u.username
    FROM messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.id = ? AND m.deleted_at IS NULL
  `),
  updateMessage: db.prepare<[string, number, number]>(
    'UPDATE messages SET content = ?, updated_at = unixepoch() WHERE id = ? AND user_id = ? AND deleted_at IS NULL'
  ),
  softDeleteMessage: db.prepare<[number, number]>(
    'UPDATE messages SET deleted_at = unixepoch() WHERE id = ? AND user_id = ? AND deleted_at IS NULL'
  ),

  listSpaceMembers: db.prepare<[number], SpaceMember & { username: string; last_seen_at: number | null }>(`
    SELECT sm.*, u.username, u.last_seen_at
    FROM space_members sm
    JOIN users u ON u.id = sm.user_id
    WHERE sm.space_id = ?
    ORDER BY sm.joined_at ASC
  `),
  addSpaceMember: db.prepare<[number, number, string], { changes: number }>(
    'INSERT OR IGNORE INTO space_members (space_id, user_id, role) VALUES (?, ?, ?)'
  ),
  getSpaceMember: db.prepare<[number, number], SpaceMember>(
    'SELECT * FROM space_members WHERE space_id = ? AND user_id = ?'
  ),

  updateLastSeen: db.prepare<[number]>(
    'UPDATE users SET last_seen_at = unixepoch() WHERE id = ?'
  ),

  createInviteToken: db.prepare<[string, number, number, number | null]>(
    'INSERT INTO invite_tokens (token, space_id, created_by, expires_at) VALUES (?, ?, ?, ?)'
  ),
  getInviteToken: db.prepare<[string], InviteToken>(
    'SELECT * FROM invite_tokens WHERE token = ?'
  ),
  incrementInviteUses: db.prepare<[string]>(
    'UPDATE invite_tokens SET uses = uses + 1 WHERE token = ?'
  ),
};
