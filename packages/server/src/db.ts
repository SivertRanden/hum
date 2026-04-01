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

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_messages_space_id ON messages(space_id, created_at);
`);

export default db;

// Typed query helpers
export interface User {
  id: number;
  username: string;
  password_hash: string;
  created_at: number;
}

export interface Space {
  id: number;
  name: string;
  description: string | null;
  created_by: number;
  created_at: number;
}

export interface Message {
  id: number;
  space_id: number;
  user_id: number;
  content: string;
  created_at: number;
  username?: string;
}

export const queries = {
  getUserByUsername: db.prepare<[string], User>('SELECT * FROM users WHERE username = ?'),
  getUserById: db.prepare<[number], User>('SELECT * FROM users WHERE id = ?'),
  createUser: db.prepare<[string, string], { lastInsertRowid: number }>('INSERT INTO users (username, password_hash) VALUES (?, ?)'),

  listSpaces: db.prepare<[], Space>('SELECT * FROM spaces ORDER BY name ASC'),
  getSpaceById: db.prepare<[number], Space>('SELECT * FROM spaces WHERE id = ?'),
  createSpace: db.prepare<[string, string | null, number]>('INSERT INTO spaces (name, description, created_by) VALUES (?, ?, ?)'),

  getMessages: db.prepare<[number, number], Message>(`
    SELECT m.*, u.username
    FROM messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.space_id = ?
    ORDER BY m.created_at ASC
    LIMIT ?
  `),
  insertMessage: db.prepare<[number, number, string]>(
    'INSERT INTO messages (space_id, user_id, content) VALUES (?, ?, ?)'
  ),
};
