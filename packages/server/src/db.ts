import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq, and, isNull, asc, sql } from 'drizzle-orm';
import * as schema from './schema.js';

const { users, spaces, channels, messages, space_members, invite_tokens } = schema;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '../../hum.db');
// In src/ during dev (tsx) and dist/ after build, '../drizzle' resolves to packages/server/drizzle/
const MIGRATIONS_FOLDER = path.join(__dirname, '../drizzle');

const rawDb = new Database(DB_PATH);
rawDb.pragma('journal_mode = WAL');
rawDb.pragma('foreign_keys = ON');

const db = drizzle(rawDb, { schema });

// Run migrations (creates tables on first run; idempotent on subsequent runs)
migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

// Backward-compat: add columns that predate the Drizzle migration for existing databases
try { rawDb.exec("ALTER TABLE messages ADD COLUMN channel TEXT NOT NULL DEFAULT 'general'"); } catch { /* already exists */ }
try { rawDb.exec('ALTER TABLE messages ADD COLUMN updated_at INTEGER'); } catch { /* already exists */ }
try { rawDb.exec('ALTER TABLE messages ADD COLUMN deleted_at INTEGER'); } catch { /* already exists */ }
try { rawDb.exec('ALTER TABLE users ADD COLUMN last_seen_at INTEGER'); } catch { /* already exists */ }

// Data migrations: seed defaults for existing rows
rawDb.exec(`
  INSERT OR IGNORE INTO channels (space_id, name, type, created_by)
  SELECT s.id, 'general', 'text', s.created_by FROM spaces s
  WHERE NOT EXISTS (SELECT 1 FROM channels WHERE space_id = s.id);
`);
rawDb.exec(`
  INSERT OR IGNORE INTO space_members (space_id, user_id, role)
  SELECT id, created_by, 'owner' FROM spaces;
`);

export default rawDb;

// ── Typed interfaces (kept for route compatibility) ───────────────────────────

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

// ── Typed query helpers (Drizzle-backed, same call signature as before) ───────

export const queries = {
  // ── Users ──────────────────────────────────────────────────────────────────
  getUserByUsername: {
    get: (username: string): User | undefined =>
      db.select().from(users).where(eq(users.username, username)).get() as User | undefined,
  },
  getUserById: {
    get: (id: number): User | undefined =>
      db.select().from(users).where(eq(users.id, id)).get() as User | undefined,
  },
  createUser: {
    run: (username: string, password_hash: string) =>
      db.insert(users).values({ username, password_hash }).run(),
  },

  // ── Spaces ─────────────────────────────────────────────────────────────────
  listSpaces: {
    all: (): Space[] =>
      db.select().from(spaces).orderBy(asc(spaces.name)).all() as Space[],
  },
  getSpaceById: {
    get: (id: number): Space | undefined =>
      db.select().from(spaces).where(eq(spaces.id, id)).get() as Space | undefined,
  },
  createSpace: {
    run: (name: string, description: string | null, created_by: number) =>
      db.insert(spaces).values({ name, description, created_by }).run(),
  },
  deleteSpace: {
    run: (id: number, created_by: number) =>
      db.delete(spaces).where(and(eq(spaces.id, id), eq(spaces.created_by, created_by))).run(),
  },

  // ── Channels ───────────────────────────────────────────────────────────────
  listChannels: {
    all: (space_id: number): Channel[] =>
      db.select().from(channels)
        .where(eq(channels.space_id, space_id))
        .orderBy(asc(channels.type), asc(channels.name))
        .all() as Channel[],
  },
  getChannelById: {
    get: (id: number): Channel | undefined =>
      db.select().from(channels).where(eq(channels.id, id)).get() as Channel | undefined,
  },
  createChannel: {
    run: (space_id: number, name: string, type: string, created_by: number) =>
      db.insert(channels).values({ space_id, name, type, created_by }).run(),
  },
  deleteChannel: {
    run: (id: number, space_id: number) =>
      db.delete(channels).where(and(eq(channels.id, id), eq(channels.space_id, space_id))).run(),
  },

  // ── Messages ───────────────────────────────────────────────────────────────
  getMessages: {
    all: (space_id: number, channel: string, limit: number): Message[] =>
      db.select({
        id: messages.id,
        space_id: messages.space_id,
        user_id: messages.user_id,
        channel: messages.channel,
        content: messages.content,
        created_at: messages.created_at,
        updated_at: messages.updated_at,
        deleted_at: messages.deleted_at,
        username: users.username,
      })
        .from(messages)
        .innerJoin(users, eq(messages.user_id, users.id))
        .where(and(
          eq(messages.space_id, space_id),
          eq(messages.channel, channel),
          isNull(messages.deleted_at),
        ))
        .orderBy(asc(messages.created_at))
        .limit(limit)
        .all() as Message[],
  },
  insertMessage: {
    run: (space_id: number, user_id: number, channel: string, content: string) =>
      db.insert(messages).values({ space_id, user_id, channel, content }).run(),
  },
  getMessageById: {
    get: (id: number): Message | undefined =>
      db.select({
        id: messages.id,
        space_id: messages.space_id,
        user_id: messages.user_id,
        channel: messages.channel,
        content: messages.content,
        created_at: messages.created_at,
        updated_at: messages.updated_at,
        deleted_at: messages.deleted_at,
        username: users.username,
      })
        .from(messages)
        .innerJoin(users, eq(messages.user_id, users.id))
        .where(and(eq(messages.id, id), isNull(messages.deleted_at)))
        .get() as Message | undefined,
  },
  updateMessage: {
    run: (content: string, id: number, user_id: number) =>
      db.update(messages)
        .set({ content, updated_at: sql`(unixepoch())` })
        .where(and(eq(messages.id, id), eq(messages.user_id, user_id), isNull(messages.deleted_at)))
        .run(),
  },
  softDeleteMessage: {
    run: (id: number, user_id: number) =>
      db.update(messages)
        .set({ deleted_at: sql`(unixepoch())` })
        .where(and(eq(messages.id, id), eq(messages.user_id, user_id), isNull(messages.deleted_at)))
        .run(),
  },

  // ── Space members ──────────────────────────────────────────────────────────
  listSpaceMembers: {
    all: (space_id: number): (SpaceMember & { username: string; last_seen_at: number | null })[] =>
      db.select({
        id: space_members.id,
        space_id: space_members.space_id,
        user_id: space_members.user_id,
        role: space_members.role,
        joined_at: space_members.joined_at,
        username: users.username,
        last_seen_at: users.last_seen_at,
      })
        .from(space_members)
        .innerJoin(users, eq(space_members.user_id, users.id))
        .where(eq(space_members.space_id, space_id))
        .orderBy(asc(space_members.joined_at))
        .all() as (SpaceMember & { username: string; last_seen_at: number | null })[],
  },
  addSpaceMember: {
    run: (space_id: number, user_id: number, role: string) =>
      db.insert(space_members).values({ space_id, user_id, role }).onConflictDoNothing().run(),
  },
  getSpaceMember: {
    get: (space_id: number, user_id: number): SpaceMember | undefined =>
      db.select().from(space_members)
        .where(and(eq(space_members.space_id, space_id), eq(space_members.user_id, user_id)))
        .get() as SpaceMember | undefined,
  },

  // ── Presence ───────────────────────────────────────────────────────────────
  updateLastSeen: {
    run: (user_id: number) =>
      db.update(users)
        .set({ last_seen_at: sql`(unixepoch())` })
        .where(eq(users.id, user_id))
        .run(),
  },

  // ── Invite tokens ──────────────────────────────────────────────────────────
  createInviteToken: {
    run: (token: string, space_id: number, created_by: number, expires_at: number | null) =>
      db.insert(invite_tokens).values({ token, space_id, created_by, expires_at }).run(),
  },
  getInviteToken: {
    get: (token: string): InviteToken | undefined =>
      db.select().from(invite_tokens).where(eq(invite_tokens.token, token)).get() as InviteToken | undefined,
  },
  incrementInviteUses: {
    run: (token: string) =>
      db.update(invite_tokens)
        .set({ uses: sql`${invite_tokens.uses} + 1` })
        .where(eq(invite_tokens.token, token))
        .run(),
  },
};
