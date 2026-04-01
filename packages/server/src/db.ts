import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateSqlite } from 'drizzle-orm/better-sqlite3/migrator';
import { eq, and, isNull, asc, sql } from 'drizzle-orm';
import * as sqliteSchema from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Driver detection ──────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const IS_POSTGRES = DATABASE_URL.startsWith('postgres://') || DATABASE_URL.startsWith('postgresql://');

// ── Typed interfaces (shared between drivers) ─────────────────────────────────

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

// ── Unified async Queries interface ───────────────────────────────────────────

export interface Queries {
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserById(id: number): Promise<User | undefined>;
  createUser(username: string, password_hash: string): Promise<{ id: number }>;

  listSpaces(): Promise<Space[]>;
  getSpaceById(id: number): Promise<Space | undefined>;
  createSpace(name: string, description: string | null, created_by: number): Promise<{ id: number }>;
  deleteSpace(id: number, created_by: number): Promise<void>;

  listChannels(space_id: number): Promise<Channel[]>;
  getChannelById(id: number): Promise<Channel | undefined>;
  createChannel(space_id: number, name: string, type: string, created_by: number): Promise<{ id: number }>;
  deleteChannel(id: number, space_id: number): Promise<void>;

  getMessages(space_id: number, channel: string, limit: number): Promise<Message[]>;
  insertMessage(space_id: number, user_id: number, channel: string, content: string): Promise<{ id: number }>;
  getMessageById(id: number): Promise<Message | undefined>;
  updateMessage(content: string, id: number, user_id: number): Promise<boolean>;
  softDeleteMessage(id: number, user_id: number): Promise<boolean>;

  listSpaceMembers(space_id: number): Promise<(SpaceMember & { username: string; last_seen_at: number | null })[]>;
  addSpaceMember(space_id: number, user_id: number, role: string): Promise<void>;
  getSpaceMember(space_id: number, user_id: number): Promise<SpaceMember | undefined>;

  updateLastSeen(user_id: number): Promise<void>;

  createInviteToken(token: string, space_id: number, created_by: number, expires_at: number | null): Promise<void>;
  getInviteToken(token: string): Promise<InviteToken | undefined>;
  incrementInviteUses(token: string): Promise<void>;
}

// ── SQLite driver ─────────────────────────────────────────────────────────────

function buildSqliteQueries(): Queries {
  const { users, spaces, channels, messages, space_members, invite_tokens } = sqliteSchema;

  const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '../../hum.db');
  const MIGRATIONS_FOLDER = path.join(__dirname, '../drizzle');

  const rawDb = new Database(DB_PATH);
  rawDb.pragma('journal_mode = WAL');
  rawDb.pragma('foreign_keys = ON');

  const db = drizzleSqlite(rawDb, { schema: sqliteSchema });
  migrateSqlite(db, { migrationsFolder: MIGRATIONS_FOLDER });

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

  const nowEpoch = sql`(unixepoch())`;

  return {
    getUserByUsername: async (username) =>
      db.select().from(users).where(eq(users.username, username)).get() as User | undefined,

    getUserById: async (id) =>
      db.select().from(users).where(eq(users.id, id)).get() as User | undefined,

    createUser: async (username, password_hash) => {
      const row = db.insert(users).values({ username, password_hash }).returning({ id: users.id }).get()!;
      return { id: row.id };
    },

    listSpaces: async () =>
      db.select().from(spaces).orderBy(asc(spaces.name)).all() as Space[],

    getSpaceById: async (id) =>
      db.select().from(spaces).where(eq(spaces.id, id)).get() as Space | undefined,

    createSpace: async (name, description, created_by) => {
      const row = db.insert(spaces).values({ name, description, created_by }).returning({ id: spaces.id }).get()!;
      return { id: row.id };
    },

    deleteSpace: async (id, created_by) => {
      db.delete(spaces).where(and(eq(spaces.id, id), eq(spaces.created_by, created_by))).run();
    },

    listChannels: async (space_id) =>
      db.select().from(channels)
        .where(eq(channels.space_id, space_id))
        .orderBy(asc(channels.type), asc(channels.name))
        .all() as Channel[],

    getChannelById: async (id) =>
      db.select().from(channels).where(eq(channels.id, id)).get() as Channel | undefined,

    createChannel: async (space_id, name, type, created_by) => {
      const row = db.insert(channels).values({ space_id, name, type, created_by }).returning({ id: channels.id }).get()!;
      return { id: row.id };
    },

    deleteChannel: async (id, space_id) => {
      db.delete(channels).where(and(eq(channels.id, id), eq(channels.space_id, space_id))).run();
    },

    getMessages: async (space_id, channel, limit) =>
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

    insertMessage: async (space_id, user_id, channel, content) => {
      const row = db.insert(messages).values({ space_id, user_id, channel, content }).returning({ id: messages.id }).get()!;
      return { id: row.id };
    },

    getMessageById: async (id) =>
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

    updateMessage: async (content, id, user_id) => {
      const result = db.update(messages)
        .set({ content, updated_at: nowEpoch })
        .where(and(eq(messages.id, id), eq(messages.user_id, user_id), isNull(messages.deleted_at)))
        .run();
      return result.changes > 0;
    },

    softDeleteMessage: async (id, user_id) => {
      const result = db.update(messages)
        .set({ deleted_at: nowEpoch })
        .where(and(eq(messages.id, id), eq(messages.user_id, user_id), isNull(messages.deleted_at)))
        .run();
      return result.changes > 0;
    },

    listSpaceMembers: async (space_id) =>
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

    addSpaceMember: async (space_id, user_id, role) => {
      db.insert(space_members).values({ space_id, user_id, role }).onConflictDoNothing().run();
    },

    getSpaceMember: async (space_id, user_id) =>
      db.select().from(space_members)
        .where(and(eq(space_members.space_id, space_id), eq(space_members.user_id, user_id)))
        .get() as SpaceMember | undefined,

    updateLastSeen: async (user_id) => {
      db.update(users).set({ last_seen_at: nowEpoch }).where(eq(users.id, user_id)).run();
    },

    createInviteToken: async (token, space_id, created_by, expires_at) => {
      db.insert(invite_tokens).values({ token, space_id, created_by, expires_at }).run();
    },

    getInviteToken: async (token) =>
      db.select().from(invite_tokens).where(eq(invite_tokens.token, token)).get() as InviteToken | undefined,

    incrementInviteUses: async (token) => {
      db.update(invite_tokens)
        .set({ uses: sql`${invite_tokens.uses} + 1` })
        .where(eq(invite_tokens.token, token))
        .run();
    },
  };
}

// ── PostgreSQL driver ─────────────────────────────────────────────────────────

async function buildPgQueries(): Promise<Queries> {
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const { migrate } = await import('drizzle-orm/postgres-js/migrator');
  const postgresModule = await import('postgres');
  const postgres = postgresModule.default;
  const pgSchema = await import('./schema.pg.js');

  const { users, spaces, channels, messages, space_members, invite_tokens } = pgSchema;

  const MIGRATIONS_FOLDER = path.join(__dirname, '../drizzle.pg');

  const migrationClient = postgres(DATABASE_URL, { max: 1 });
  const migrationDb = drizzle(migrationClient, { schema: pgSchema });
  await migrate(migrationDb, { migrationsFolder: MIGRATIONS_FOLDER });
  await migrationClient.end();

  const appClient = postgres(DATABASE_URL);
  const db = drizzle(appClient, { schema: pgSchema });

  const nowEpoch = sql`extract(epoch from now())::int`;

  return {
    getUserByUsername: async (username) => {
      const rows = await db.select().from(users).where(eq(users.username, username)).limit(1);
      return rows[0] as User | undefined;
    },

    getUserById: async (id) => {
      const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return rows[0] as User | undefined;
    },

    createUser: async (username, password_hash) => {
      const rows = await db.insert(users).values({ username, password_hash }).returning({ id: users.id });
      return { id: rows[0].id };
    },

    listSpaces: async () => {
      return db.select().from(spaces).orderBy(asc(spaces.name)) as Promise<Space[]>;
    },

    getSpaceById: async (id) => {
      const rows = await db.select().from(spaces).where(eq(spaces.id, id)).limit(1);
      return rows[0] as Space | undefined;
    },

    createSpace: async (name, description, created_by) => {
      const rows = await db.insert(spaces).values({ name, description, created_by }).returning({ id: spaces.id });
      return { id: rows[0].id };
    },

    deleteSpace: async (id, created_by) => {
      await db.delete(spaces).where(and(eq(spaces.id, id), eq(spaces.created_by, created_by)));
    },

    listChannels: async (space_id) => {
      return db.select().from(channels)
        .where(eq(channels.space_id, space_id))
        .orderBy(asc(channels.type), asc(channels.name)) as Promise<Channel[]>;
    },

    getChannelById: async (id) => {
      const rows = await db.select().from(channels).where(eq(channels.id, id)).limit(1);
      return rows[0] as Channel | undefined;
    },

    createChannel: async (space_id, name, type, created_by) => {
      const rows = await db.insert(channels).values({ space_id, name, type, created_by }).returning({ id: channels.id });
      return { id: rows[0].id };
    },

    deleteChannel: async (id, space_id) => {
      await db.delete(channels).where(and(eq(channels.id, id), eq(channels.space_id, space_id)));
    },

    getMessages: async (space_id, channel, limit) => {
      return db.select({
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
        .limit(limit) as Promise<Message[]>;
    },

    insertMessage: async (space_id, user_id, channel, content) => {
      const rows = await db.insert(messages).values({ space_id, user_id, channel, content }).returning({ id: messages.id });
      return { id: rows[0].id };
    },

    getMessageById: async (id) => {
      const rows = await db.select({
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
        .limit(1);
      return rows[0] as Message | undefined;
    },

    updateMessage: async (content, id, user_id) => {
      const rows = await db.update(messages)
        .set({ content, updated_at: nowEpoch })
        .where(and(eq(messages.id, id), eq(messages.user_id, user_id), isNull(messages.deleted_at)))
        .returning({ id: messages.id });
      return rows.length > 0;
    },

    softDeleteMessage: async (id, user_id) => {
      const rows = await db.update(messages)
        .set({ deleted_at: nowEpoch })
        .where(and(eq(messages.id, id), eq(messages.user_id, user_id), isNull(messages.deleted_at)))
        .returning({ id: messages.id });
      return rows.length > 0;
    },

    listSpaceMembers: async (space_id) => {
      return db.select({
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
        .orderBy(asc(space_members.joined_at)) as Promise<(SpaceMember & { username: string; last_seen_at: number | null })[]>;
    },

    addSpaceMember: async (space_id, user_id, role) => {
      await db.insert(space_members).values({ space_id, user_id, role }).onConflictDoNothing();
    },

    getSpaceMember: async (space_id, user_id) => {
      const rows = await db.select().from(space_members)
        .where(and(eq(space_members.space_id, space_id), eq(space_members.user_id, user_id)))
        .limit(1);
      return rows[0] as SpaceMember | undefined;
    },

    updateLastSeen: async (user_id) => {
      await db.update(users).set({ last_seen_at: nowEpoch }).where(eq(users.id, user_id));
    },

    createInviteToken: async (token, space_id, created_by, expires_at) => {
      await db.insert(invite_tokens).values({ token, space_id, created_by, expires_at });
    },

    getInviteToken: async (token) => {
      const rows = await db.select().from(invite_tokens).where(eq(invite_tokens.token, token)).limit(1);
      return rows[0] as InviteToken | undefined;
    },

    incrementInviteUses: async (token) => {
      await db.update(invite_tokens)
        .set({ uses: sql`${invite_tokens.uses} + 1` })
        .where(eq(invite_tokens.token, token));
    },
  };
}

// ── Initialize and export ─────────────────────────────────────────────────────

let _queries: Queries;

export async function initDb(): Promise<void> {
  if (IS_POSTGRES) {
    console.log('[db] Using PostgreSQL driver');
    _queries = await buildPgQueries();
  } else {
    console.log('[db] Using SQLite driver');
    _queries = buildSqliteQueries();
  }
}

export const queries: Queries = new Proxy({} as Queries, {
  get(_target, prop) {
    if (!_queries) throw new Error('Database not initialized — call initDb() first');
    return (_queries as never)[prop];
  },
});
