import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateSqlite } from 'drizzle-orm/better-sqlite3/migrator';
import { eq, and, isNull, asc, desc, sql, inArray, ne } from 'drizzle-orm';
import * as sqliteSchema from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Driver detection ──────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const IS_POSTGRES = DATABASE_URL.startsWith('postgres://') || DATABASE_URL.startsWith('postgresql://');

// ── Typed interfaces (shared between drivers) ─────────────────────────────────

export interface User {
  id: number;
  username: string;
  email: string | null;
  password_hash: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: number;
  last_seen_at: number | null;
}

export interface PasswordResetToken {
  id: number;
  user_id: number;
  token: string;
  expires_at: number;
  used_at: number | null;
  created_at: number;
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
  topic: string | null;
  created_by: number;
  created_at: number;
}

export interface Attachment {
  id: number;
  message_id: number | null;
  filename: string;
  storage_key: string;
  mime_type: string;
  size: number;
  created_at: number;
}

export interface Message {
  id: number;
  space_id: number;
  user_id: number;
  channel: string;
  content: string;
  link_previews: string | null;
  reply_count: number;
  created_at: number;
  updated_at: number | null;
  deleted_at: number | null;
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  attachments?: Attachment[];
}

export interface ThreadReply {
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
  display_name?: string | null;
  avatar_url?: string | null;
}

export type SpaceRole = 'owner' | 'admin' | 'moderator' | 'member';

export interface SpaceMember {
  id: number;
  space_id: number;
  user_id: number;
  role: SpaceRole;
  joined_at: number;
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  is_online?: boolean;
  last_seen_at?: number | null;
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

export interface MessageReaction {
  id: number;
  message_id: number;
  user_id: number;
  emoji: string;
  created_at: number;
  username?: string;
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

export interface PendingNotification {
  id: number;
  user_id: number;
  email: string;
  username: string;
  message_id: number;
  message_content: string;
  sender_username: string;
  space_id: number;
  space_name: string;
  channel: string;
}

export interface SpaceEmoji {
  id: number;
  space_id: number;
  name: string;
  image_url: string;
  created_by: number;
  created_at: number;
}

// ── Unified async Queries interface ───────────────────────────────────────────

export interface Queries {
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserById(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(username: string, password_hash: string, email?: string): Promise<{ id: number }>;
  updateUserPassword(userId: number, password_hash: string): Promise<void>;

  createPasswordResetToken(userId: number, token: string, expiresAt: number): Promise<void>;
  getPasswordResetToken(token: string): Promise<PasswordResetToken | undefined>;
  markPasswordResetTokenUsed(token: string): Promise<void>;

  listSpaces(): Promise<Space[]>;
  getSpaceById(id: number): Promise<Space | undefined>;
  createSpace(name: string, description: string | null, created_by: number): Promise<{ id: number }>;
  deleteSpace(id: number, created_by: number): Promise<void>;

  listChannels(space_id: number): Promise<Channel[]>;
  getChannelById(id: number): Promise<Channel | undefined>;
  createChannel(space_id: number, name: string, type: string, created_by: number): Promise<{ id: number }>;
  deleteChannel(id: number, space_id: number): Promise<void>;
  updateChannelTopic(id: number, space_id: number, topic: string | null, user_id: number): Promise<boolean>;

  getMessages(space_id: number, channel: string, limit: number): Promise<Message[]>;
  insertMessage(space_id: number, user_id: number, channel: string, content: string): Promise<{ id: number }>;
  getMessageById(id: number): Promise<Message | undefined>;
  updateMessage(content: string, id: number, user_id: number): Promise<boolean>;
  softDeleteMessage(id: number, user_id: number): Promise<boolean>;
  storeLinkPreviews(message_id: number, previews_json: string): Promise<void>;

  listSpaceMembers(space_id: number): Promise<(SpaceMember & { username: string; last_seen_at: number | null })[]>;
  addSpaceMember(space_id: number, user_id: number, role: string): Promise<void>;
  getSpaceMember(space_id: number, user_id: number): Promise<SpaceMember | undefined>;
  updateMemberRole(space_id: number, user_id: number, role: SpaceRole): Promise<void>;
  removeMember(space_id: number, user_id: number): Promise<void>;

  updateLastSeen(user_id: number): Promise<void>;

  createInviteToken(token: string, space_id: number, created_by: number, expires_at: number | null): Promise<void>;
  getInviteToken(token: string): Promise<InviteToken | undefined>;
  incrementInviteUses(token: string): Promise<void>;

  markChannelRead(user_id: number, space_id: number, channel: string, last_read_message_id: number): Promise<void>;
  getUnreadCounts(user_id: number, space_id: number): Promise<{ channel: string; count: number }[]>;

  addReaction(message_id: number, user_id: number, emoji: string): Promise<void>;
  removeReaction(message_id: number, user_id: number, emoji: string): Promise<void>;
  getReactionsForMessages(message_ids: number[]): Promise<Record<number, MessageReaction[]>>;

  updateUserProfile(user_id: number, display_name: string | null, avatar_url?: string | null): Promise<void>;

  createDmChannel(space_id: number, user1_id: number, user2_id: number, created_by: number): Promise<{ id: number }>;
  findDmChannel(space_id: number, user1_id: number, user2_id: number): Promise<{ id: number } | undefined>;
  listDmChannels(space_id: number, user_id: number): Promise<DmChannel[]>;
  isUserDmMember(channel_id: number, user_id: number): Promise<boolean>;

  searchMessages(space_id: number, query: string, channel: string | null, limit: number): Promise<SearchResult[]>;

  getThread(space_id: number, message_id: number): Promise<{ parent: Message; replies: ThreadReply[] } | undefined>;
  insertThreadReply(parent_message_id: number, space_id: number, user_id: number, channel: string, content: string): Promise<{ id: number; reply_count: number }>;

  enqueueNotification(user_id: number, message_id: number, space_id: number, channel: string): Promise<void>;
  getPendingNotifications(): Promise<PendingNotification[]>;
  markNotificationsSent(ids: number[]): Promise<void>;

  logAudit(space_id: number, user_id: number, action: string, target_type?: string | null, target_id?: number | null, meta?: string | null): Promise<void>;
  getAuditLogs(space_id: number, limit: number): Promise<AuditLogEntry[]>;

  insertAttachment(filename: string, storage_key: string, mime_type: string, size: number): Promise<{ id: number }>;
  linkAttachmentToMessage(attachment_id: number, message_id: number): Promise<void>;
  getAttachmentsForMessages(message_ids: number[]): Promise<Record<number, Attachment[]>>;
  addSpaceEmoji(space_id: number, name: string, image_url: string, created_by: number): Promise<SpaceEmoji>;
  listSpaceEmoji(space_id: number): Promise<SpaceEmoji[]>;
  deleteSpaceEmoji(space_id: number, name: string): Promise<void>;
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

// ── SQLite driver ─────────────────────────────────────────────────────────────

/**
 * Idempotent SQLite migration runner.
 *
 * Drizzle's built-in migrator runs every migration whose folderMillis timestamp
 * is newer than the most-recently-recorded one, but it does not tolerate duplicate
 * DDL statements (e.g. ALTER TABLE ADD COLUMN on a column that already exists).
 * This replacement runner executes each pending statement inside a transaction and
 * silently skips any statement that fails with "duplicate column name" or "already
 * exists", making migrations safe to re-run against a partially-initialised DB.
 */
function runSqliteMigrationsIdempotent(rawDb: Database.Database, migrationsFolder: string): void {
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      hash  TEXT    NOT NULL,
      created_at NUMERIC
    )
  `);

  const lastRow = rawDb
    .prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1')
    .get() as { created_at: number } | undefined;
  const lastMillis = lastRow ? Number(lastRow.created_at) : -1;

  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8')) as {
    entries: Array<{ tag: string; when: number }>;
  };

  for (const entry of journal.entries) {
    if (entry.when <= lastMillis) continue;

    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`Migration file not found: ${sqlPath}`);
    }

    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');
    const statements = sqlContent
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    const hash = crypto.createHash('sha256').update(sqlContent).digest('hex');

    rawDb.transaction(() => {
      for (const stmt of statements) {
        try {
          rawDb.exec(stmt);
        } catch (err: any) {
          const msg: string = err?.message ?? '';
          if (msg.includes('duplicate column name') || msg.includes('already exists')) {
            continue; // idempotent — skip already-applied DDL
          }
          throw err;
        }
      }
      rawDb
        .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
        .run(hash, entry.when);
    })();
  }
}

function buildSqliteQueries(): Queries {
  const { users, spaces, channels, messages, space_members, invite_tokens, password_reset_tokens, thread_replies, message_attachments } = sqliteSchema;

  const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '../../hum.db');
  const MIGRATIONS_FOLDER = path.join(__dirname, '../drizzle');

  const rawDb = new Database(DB_PATH);
  rawDb.pragma('journal_mode = WAL');
  rawDb.pragma('foreign_keys = ON');

  runSqliteMigrationsIdempotent(rawDb, MIGRATIONS_FOLDER);
  const db = drizzleSqlite(rawDb, { schema: sqliteSchema });

  // Backward-compat: add columns that predate the Drizzle migration for existing databases
  try { rawDb.exec("ALTER TABLE messages ADD COLUMN channel TEXT NOT NULL DEFAULT 'general'"); } catch { /* already exists */ }
  try { rawDb.exec('ALTER TABLE messages ADD COLUMN reply_count INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }
  try { rawDb.exec('ALTER TABLE messages ADD COLUMN updated_at INTEGER'); } catch { /* already exists */ }
  try { rawDb.exec('ALTER TABLE messages ADD COLUMN deleted_at INTEGER'); } catch { /* already exists */ }
  try { rawDb.exec('ALTER TABLE messages ADD COLUMN link_previews TEXT'); } catch { /* already exists */ }
  try { rawDb.exec('ALTER TABLE users ADD COLUMN last_seen_at INTEGER'); } catch { /* already exists */ }
  try { rawDb.exec('ALTER TABLE channels ADD COLUMN topic TEXT'); } catch { /* already exists */ }
  try { rawDb.exec('ALTER TABLE users ADD COLUMN display_name TEXT'); } catch { /* already exists */ }
  try { rawDb.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT'); } catch { /* already exists */ }

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

  // FTS5 full-text search (idempotent setup)
  rawDb.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, content='messages', content_rowid='id')`);
  try { rawDb.exec(`INSERT INTO messages_fts(messages_fts) VALUES('rebuild')`); } catch { /* ok */ }
  rawDb.exec(`CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
  END`);
  rawDb.exec(`CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
  END`);
  rawDb.exec(`CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
  END`);

  const nowEpoch = sql`(unixepoch())`;

  const _logAudit = (space_id: number, user_id: number, action: string, target_type?: string | null, target_id?: number | null, meta?: string | null) => {
    const { audit_logs } = sqliteSchema;
    try { db.insert(audit_logs).values({ space_id, user_id, action, target_type: target_type ?? null, target_id: target_id ?? null, meta: meta ?? null }).run(); } catch { /* non-fatal */ }
  };

  return {
    getUserByUsername: async (username) =>
      db.select().from(users).where(eq(users.username, username)).get() as User | undefined,

    getUserById: async (id) =>
      db.select().from(users).where(eq(users.id, id)).get() as User | undefined,

    getUserByEmail: async (email) =>
      db.select().from(users).where(eq(users.email, email)).get() as User | undefined,

    createUser: async (username, password_hash, email?) => {
      const row = db.insert(users).values({ username, password_hash, email: email ?? null }).returning({ id: users.id }).get()!;
      return { id: row.id };
    },

    updateUserPassword: async (userId, password_hash) => {
      db.update(users).set({ password_hash }).where(eq(users.id, userId)).run();
    },

    createPasswordResetToken: async (userId, token, expiresAt) => {
      db.insert(password_reset_tokens).values({ user_id: userId, token, expires_at: expiresAt }).run();
    },

    getPasswordResetToken: async (token) =>
      db.select().from(password_reset_tokens).where(eq(password_reset_tokens.token, token)).get() as PasswordResetToken | undefined,

    markPasswordResetTokenUsed: async (token) => {
      db.update(password_reset_tokens)
        .set({ used_at: nowEpoch })
        .where(eq(password_reset_tokens.token, token))
        .run();
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
      _logAudit(space_id, created_by, 'channel.create', 'channel', row.id, JSON.stringify({ name, type }));
      return { id: row.id };
    },

    deleteChannel: async (id, space_id) => {
      db.delete(channels).where(and(eq(channels.id, id), eq(channels.space_id, space_id))).run();
    },

    updateChannelTopic: async (id, space_id, topic, user_id) => {
      // Only space owner or moderator can update topic
      const member = await db.select()
        .from(space_members)
        .where(and(eq(space_members.space_id, space_id), eq(space_members.user_id, user_id)))
        .get();
      if (!member || (member.role !== 'owner' && member.role !== 'moderator')) return false;
      const result = db.update(channels)
        .set({ topic })
        .where(and(eq(channels.id, id), eq(channels.space_id, space_id)))
        .run();
      if (result.changes > 0) _logAudit(space_id, user_id, 'channel.topic', 'channel', id, JSON.stringify({ topic }));
      return result.changes > 0;
    },

    getMessages: async (space_id, channel, limit) =>
      db.select({
        id: messages.id,
        space_id: messages.space_id,
        user_id: messages.user_id,
        channel: messages.channel,
        content: messages.content,
        link_previews: messages.link_previews,
        reply_count: messages.reply_count,
        created_at: messages.created_at,
        updated_at: messages.updated_at,
        deleted_at: messages.deleted_at,
        username: users.username,
        display_name: users.display_name,
        avatar_url: users.avatar_url,
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
        link_previews: messages.link_previews,
        reply_count: messages.reply_count,
        created_at: messages.created_at,
        updated_at: messages.updated_at,
        deleted_at: messages.deleted_at,
        username: users.username,
        display_name: users.display_name,
        avatar_url: users.avatar_url,
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

    storeLinkPreviews: async (message_id, previews_json) => {
      db.update(messages)
        .set({ link_previews: previews_json })
        .where(eq(messages.id, message_id))
        .run();
    },

    listSpaceMembers: async (space_id) =>
      db.select({
        id: space_members.id,
        space_id: space_members.space_id,
        user_id: space_members.user_id,
        role: space_members.role,
        joined_at: space_members.joined_at,
        username: users.username,
        display_name: users.display_name,
        avatar_url: users.avatar_url,
        last_seen_at: users.last_seen_at,
      })
        .from(space_members)
        .innerJoin(users, eq(space_members.user_id, users.id))
        .where(eq(space_members.space_id, space_id))
        .orderBy(asc(space_members.joined_at))
        .all() as (SpaceMember & { username: string; display_name: string | null; avatar_url: string | null; last_seen_at: number | null })[],

    addSpaceMember: async (space_id, user_id, role) => {
      db.insert(space_members).values({ space_id, user_id, role }).onConflictDoNothing().run();
    },

    getSpaceMember: async (space_id, user_id) =>
      db.select().from(space_members)
        .where(and(eq(space_members.space_id, space_id), eq(space_members.user_id, user_id)))
        .get() as SpaceMember | undefined,

    updateMemberRole: async (space_id, user_id, role) => {
      db.update(space_members)
        .set({ role })
        .where(and(eq(space_members.space_id, space_id), eq(space_members.user_id, user_id)))
        .run();
    },

    removeMember: async (space_id, user_id) => {
      db.delete(space_members)
        .where(and(eq(space_members.space_id, space_id), eq(space_members.user_id, user_id)))
        .run();
    },

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

    markChannelRead: async (user_id, space_id, channel, last_read_message_id) => {
      const { last_read } = sqliteSchema;
      db.insert(last_read).values({ user_id, space_id, channel, last_read_message_id })
        .onConflictDoUpdate({
          target: [last_read.user_id, last_read.space_id, last_read.channel],
          set: { last_read_message_id, updated_at: nowEpoch },
        }).run();
    },

    getUnreadCounts: async (user_id, space_id) => {
      const { last_read } = sqliteSchema;
      return db.select({ channel: messages.channel, count: sql<number>`count(*)`.as('count') })
        .from(messages)
        .leftJoin(last_read, and(eq(last_read.user_id, user_id), eq(last_read.space_id, space_id), eq(last_read.channel, messages.channel)))
        .where(and(eq(messages.space_id, space_id), isNull(messages.deleted_at), sql`${messages.id} > COALESCE(${last_read.last_read_message_id}, 0)`))
        .groupBy(messages.channel).all() as { channel: string; count: number }[];
    },

    addReaction: async (message_id, user_id, emoji) => {
      const { message_reactions } = sqliteSchema;
      db.insert(message_reactions).values({ message_id, user_id, emoji }).onConflictDoNothing().run();
    },

    removeReaction: async (message_id, user_id, emoji) => {
      const { message_reactions } = sqliteSchema;
      db.delete(message_reactions)
        .where(and(eq(message_reactions.message_id, message_id), eq(message_reactions.user_id, user_id), eq(message_reactions.emoji, emoji)))
        .run();
    },

    getReactionsForMessages: async (message_ids) => {
      if (message_ids.length === 0) return {};
      const { message_reactions } = sqliteSchema;
      const rows = db.select({
        id: message_reactions.id,
        message_id: message_reactions.message_id,
        user_id: message_reactions.user_id,
        emoji: message_reactions.emoji,
        created_at: message_reactions.created_at,
        username: users.username,
      })
        .from(message_reactions)
        .innerJoin(users, eq(message_reactions.user_id, users.id))
        .where(inArray(message_reactions.message_id, message_ids))
        .all() as (MessageReaction & { username: string })[];
      const result: Record<number, MessageReaction[]> = {};
      for (const row of rows) {
        if (!result[row.message_id]) result[row.message_id] = [];
        result[row.message_id].push(row);
      }
      return result;
    },

    updateUserProfile: async (user_id, display_name, avatar_url) => {
      const upd: Partial<{ display_name: string | null; avatar_url: string | null }> = { display_name };
      if (avatar_url !== undefined) upd.avatar_url = avatar_url;
      db.update(users).set(upd).where(eq(users.id, user_id)).run();
    },

    createDmChannel: async (space_id, user1_id, user2_id, created_by) => {
      const { dm_members } = sqliteSchema;
      const name = `dm_${Math.min(user1_id, user2_id)}_${Math.max(user1_id, user2_id)}`;
      const row = db.insert(channels).values({ space_id, name, type: 'dm', created_by }).returning({ id: channels.id }).get()!;
      db.insert(dm_members).values({ channel_id: row.id, user_id: user1_id }).run();
      db.insert(dm_members).values({ channel_id: row.id, user_id: user2_id }).run();
      return { id: row.id };
    },

    findDmChannel: async (space_id, user1_id, user2_id) => {
      const name = `dm_${Math.min(user1_id, user2_id)}_${Math.max(user1_id, user2_id)}`;
      const row = db.select({ id: channels.id })
        .from(channels)
        .where(and(eq(channels.space_id, space_id), eq(channels.name, name), eq(channels.type, 'dm')))
        .get();
      return row as { id: number } | undefined;
    },

    listDmChannels: async (space_id, user_id) => {
      const { dm_members } = sqliteSchema;
      const myChannels = db.select({ channel_id: dm_members.channel_id })
        .from(dm_members)
        .innerJoin(channels, eq(dm_members.channel_id, channels.id))
        .where(and(eq(dm_members.user_id, user_id), eq(channels.space_id, space_id), eq(channels.type, 'dm')))
        .all();
      return myChannels.map(({ channel_id }) => {
        const otherMember = db.select({ user_id: dm_members.user_id, username: users.username, display_name: users.display_name, avatar_url: users.avatar_url })
          .from(dm_members)
          .innerJoin(users, eq(dm_members.user_id, users.id))
          .where(and(eq(dm_members.channel_id, channel_id), ne(dm_members.user_id, user_id)))
          .get();
        const chan = db.select({ id: channels.id, name: channels.name, space_id: channels.space_id })
          .from(channels).where(eq(channels.id, channel_id)).get()!;
        return {
          id: chan.id,
          name: chan.name,
          space_id: chan.space_id,
          other_user_id: otherMember?.user_id ?? 0,
          other_username: otherMember?.username ?? '',
          other_display_name: otherMember?.display_name ?? null,
          other_avatar_url: otherMember?.avatar_url ?? null,
        } as DmChannel;
      });
    },

    isUserDmMember: async (channel_id, user_id) => {
      const { dm_members } = sqliteSchema;
      const row = db.select({ id: dm_members.id }).from(dm_members)
        .where(and(eq(dm_members.channel_id, channel_id), eq(dm_members.user_id, user_id)))
        .get();
      return !!row;
    },

    searchMessages: async (space_id, query, channel, limit) => {
      const terms = query.trim().split(/\s+/).filter(t => t.length > 0);
      if (terms.length === 0) return [];
      const ftsQuery = terms.map(t => `"${t.replace(/"/g, ' ')}"`).join(' ');
      try {
        const sql_str = channel
          ? `SELECT m.id, m.space_id, m.channel, m.user_id, m.content, m.created_at, u.username
             FROM messages_fts
             JOIN messages m ON m.id = messages_fts.rowid
             JOIN users u ON u.id = m.user_id
             WHERE messages_fts MATCH ?
               AND m.space_id = ? AND m.channel = ? AND m.deleted_at IS NULL
             ORDER BY rank LIMIT ?`
          : `SELECT m.id, m.space_id, m.channel, m.user_id, m.content, m.created_at, u.username
             FROM messages_fts
             JOIN messages m ON m.id = messages_fts.rowid
             JOIN users u ON u.id = m.user_id
             WHERE messages_fts MATCH ?
               AND m.space_id = ? AND m.deleted_at IS NULL
             ORDER BY rank LIMIT ?`;
        const args = channel ? [ftsQuery, space_id, channel, limit] : [ftsQuery, space_id, limit];
        return rawDb.prepare(sql_str).all(...args) as SearchResult[];
      } catch { return []; }
    },

    enqueueNotification: async (user_id, message_id, space_id, channel) => {
      rawDb.prepare(
        'INSERT INTO notification_queue (user_id, message_id, space_id, channel) VALUES (?, ?, ?, ?)'
      ).run(user_id, message_id, space_id, channel);
    },

    getPendingNotifications: async () => {
      return rawDb.prepare(`
        SELECT nq.id, nq.user_id, u.email, u.username,
               nq.message_id, m.content as message_content,
               su.username as sender_username,
               nq.space_id, s.name as space_name,
               nq.channel, nq.created_at
        FROM notification_queue nq
        JOIN users u ON nq.user_id = u.id
        JOIN messages m ON nq.message_id = m.id
        JOIN users su ON m.user_id = su.id
        JOIN spaces s ON nq.space_id = s.id
        WHERE nq.sent_at IS NULL AND u.email IS NOT NULL
        ORDER BY nq.created_at ASC
      `).all() as PendingNotification[];
    },

    markNotificationsSent: async (ids) => {
      if (ids.length === 0) return;
      const placeholders = ids.map(() => '?').join(',');
      rawDb.prepare(`UPDATE notification_queue SET sent_at = unixepoch() WHERE id IN (${placeholders})`).run(...ids);
    },

    insertAttachment: async (filename, storage_key, mime_type, size) => {
      const row = db.insert(message_attachments).values({ filename, storage_key, mime_type, size }).returning({ id: message_attachments.id }).get()!;
      return { id: row.id };
    },

    linkAttachmentToMessage: async (attachment_id, message_id) => {
      db.update(message_attachments).set({ message_id }).where(eq(message_attachments.id, attachment_id)).run();
    },

    getAttachmentsForMessages: async (message_ids) => {
      if (message_ids.length === 0) return {};
      const rows = db.select().from(message_attachments).where(inArray(message_attachments.message_id, message_ids)).all() as Attachment[];
      const result: Record<number, Attachment[]> = {};
      for (const row of rows) {
        if (row.message_id !== null) {
          if (!result[row.message_id]) result[row.message_id] = [];
          result[row.message_id].push(row);
        }
      }
      return result;
    },

    getThread: async (space_id, message_id) => {
      const parent = db.select({
        id: messages.id,
        space_id: messages.space_id,
        user_id: messages.user_id,
        channel: messages.channel,
        content: messages.content,
        reply_count: messages.reply_count,
        created_at: messages.created_at,
        updated_at: messages.updated_at,
        deleted_at: messages.deleted_at,
        username: users.username,
      })
        .from(messages)
        .innerJoin(users, eq(messages.user_id, users.id))
        .where(and(eq(messages.id, message_id), eq(messages.space_id, space_id), isNull(messages.deleted_at)))
        .get() as Message | undefined;
      if (!parent) return undefined;
      const replies = db.select({
        id: thread_replies.id,
        parent_message_id: thread_replies.parent_message_id,
        space_id: thread_replies.space_id,
        user_id: thread_replies.user_id,
        channel: thread_replies.channel,
        content: thread_replies.content,
        created_at: thread_replies.created_at,
        updated_at: thread_replies.updated_at,
        deleted_at: thread_replies.deleted_at,
        username: users.username,
      })
        .from(thread_replies)
        .innerJoin(users, eq(thread_replies.user_id, users.id))
        .where(and(eq(thread_replies.parent_message_id, message_id), isNull(thread_replies.deleted_at)))
        .orderBy(asc(thread_replies.created_at))
        .all() as ThreadReply[];
      return { parent, replies };
    },

    insertThreadReply: async (parent_message_id, space_id, user_id, channel, content) => {
      const row = db.insert(thread_replies)
        .values({ parent_message_id, space_id, user_id, channel, content })
        .returning({ id: thread_replies.id })
        .get()!;
      db.update(messages)
        .set({ reply_count: sql`${messages.reply_count} + 1` })
        .where(eq(messages.id, parent_message_id))
        .run();
      const parent = db.select({ reply_count: messages.reply_count })
        .from(messages).where(eq(messages.id, parent_message_id)).get() as { reply_count: number } | undefined;
      return { id: row.id, reply_count: parent?.reply_count ?? 0 };
    },

    addSpaceEmoji: async (space_id, name, image_url, created_by) => {
      const { space_emoji } = sqliteSchema;
      const row = db.insert(space_emoji).values({ space_id, name, image_url, created_by }).returning().get()!;
      return row as SpaceEmoji;
    },

    listSpaceEmoji: async (space_id) => {
      const { space_emoji } = sqliteSchema;
      return db.select().from(space_emoji)
        .where(eq(space_emoji.space_id, space_id))
        .orderBy(asc(space_emoji.name))
        .all() as SpaceEmoji[];
    },

    deleteSpaceEmoji: async (space_id, name) => {
      const { space_emoji } = sqliteSchema;
      db.delete(space_emoji)
        .where(and(eq(space_emoji.space_id, space_id), eq(space_emoji.name, name)))
        .run();
    },

    logAudit: async (space_id, user_id, action, target_type = null, target_id = null, meta = null) => {
      const { audit_logs } = sqliteSchema;
      db.insert(audit_logs).values({ space_id, user_id, action, target_type, target_id, meta }).run();
    },

    getAuditLogs: async (space_id, limit) => {
      const { audit_logs } = sqliteSchema;
      return db.select({
        id: audit_logs.id,
        space_id: audit_logs.space_id,
        user_id: audit_logs.user_id,
        username: users.username,
        action: audit_logs.action,
        target_type: audit_logs.target_type,
        target_id: audit_logs.target_id,
        meta: audit_logs.meta,
        created_at: audit_logs.created_at,
      })
        .from(audit_logs)
        .innerJoin(users, eq(audit_logs.user_id, users.id))
        .where(eq(audit_logs.space_id, space_id))
        .orderBy(desc(audit_logs.created_at))
        .limit(limit)
        .all() as AuditLogEntry[];
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

  const { users, spaces, channels, messages, space_members, invite_tokens, password_reset_tokens, thread_replies, message_attachments } = pgSchema;

  const MIGRATIONS_FOLDER = path.join(__dirname, '../drizzle.pg');

  const migrationClient = postgres(DATABASE_URL, { max: 1 });
  const migrationDb = drizzle(migrationClient, { schema: pgSchema });
  await migrate(migrationDb, { migrationsFolder: MIGRATIONS_FOLDER });
  await migrationClient.end();

  const poolSize = parseInt(process.env.DATABASE_POOL_SIZE ?? '10', 10);
  const appClient = postgres(DATABASE_URL, { max: poolSize });
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

    getUserByEmail: async (email) => {
      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
      return rows[0] as User | undefined;
    },

    createUser: async (username, password_hash, email?) => {
      const rows = await db.insert(users).values({ username, password_hash, email: email ?? null }).returning({ id: users.id });
      return { id: rows[0].id };
    },

    updateUserPassword: async (userId, password_hash) => {
      await db.update(users).set({ password_hash }).where(eq(users.id, userId));
    },

    createPasswordResetToken: async (userId, token, expiresAt) => {
      await db.insert(password_reset_tokens).values({ user_id: userId, token, expires_at: expiresAt });
    },

    getPasswordResetToken: async (token) => {
      const rows = await db.select().from(password_reset_tokens).where(eq(password_reset_tokens.token, token)).limit(1);
      return rows[0] as PasswordResetToken | undefined;
    },

    markPasswordResetTokenUsed: async (token) => {
      await db.update(password_reset_tokens)
        .set({ used_at: nowEpoch })
        .where(eq(password_reset_tokens.token, token));
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

    updateChannelTopic: async (id, space_id, topic, user_id) => {
      const members = await db.select()
        .from(space_members)
        .where(and(eq(space_members.space_id, space_id), eq(space_members.user_id, user_id)))
        .limit(1);
      const member = members[0];
      if (!member || (member.role !== 'owner' && member.role !== 'moderator')) return false;
      const rows = await db.update(channels)
        .set({ topic })
        .where(and(eq(channels.id, id), eq(channels.space_id, space_id)))
        .returning({ id: channels.id });
      return rows.length > 0;
    },

    getMessages: async (space_id, channel, limit) => {
      return db.select({
        id: messages.id,
        space_id: messages.space_id,
        user_id: messages.user_id,
        channel: messages.channel,
        content: messages.content,
        link_previews: messages.link_previews,
        reply_count: messages.reply_count,
        created_at: messages.created_at,
        updated_at: messages.updated_at,
        deleted_at: messages.deleted_at,
        username: users.username,
        display_name: users.display_name,
        avatar_url: users.avatar_url,
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
        link_previews: messages.link_previews,
        reply_count: messages.reply_count,
        created_at: messages.created_at,
        updated_at: messages.updated_at,
        deleted_at: messages.deleted_at,
        username: users.username,
        display_name: users.display_name,
        avatar_url: users.avatar_url,
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

    storeLinkPreviews: async (message_id, previews_json) => {
      await db.update(messages)
        .set({ link_previews: previews_json })
        .where(eq(messages.id, message_id));
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

    updateMemberRole: async (space_id, user_id, role) => {
      await db.update(space_members)
        .set({ role })
        .where(and(eq(space_members.space_id, space_id), eq(space_members.user_id, user_id)));
    },

    removeMember: async (space_id, user_id) => {
      await db.delete(space_members)
        .where(and(eq(space_members.space_id, space_id), eq(space_members.user_id, user_id)));
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

    markChannelRead: async (user_id, space_id, channel, last_read_message_id) => {
      const { last_read } = pgSchema;
      await db.insert(last_read).values({ user_id, space_id, channel, last_read_message_id })
        .onConflictDoUpdate({
          target: [last_read.user_id, last_read.space_id, last_read.channel],
          set: { last_read_message_id, updated_at: nowEpoch },
        });
    },

    getUnreadCounts: async (user_id, space_id) => {
      const { last_read } = pgSchema;
      const rows = await db.select({ channel: messages.channel, count: sql<number>`count(*)`.as('count') })
        .from(messages)
        .leftJoin(last_read, and(eq(last_read.user_id, user_id), eq(last_read.space_id, space_id), eq(last_read.channel, messages.channel)))
        .where(and(eq(messages.space_id, space_id), isNull(messages.deleted_at), sql`${messages.id} > COALESCE(${last_read.last_read_message_id}, 0)`))
        .groupBy(messages.channel);
      return rows as { channel: string; count: number }[];
    },

    addReaction: async (message_id, user_id, emoji) => {
      const { message_reactions } = pgSchema;
      await db.insert(message_reactions).values({ message_id, user_id, emoji }).onConflictDoNothing();
    },

    removeReaction: async (message_id, user_id, emoji) => {
      const { message_reactions } = pgSchema;
      await db.delete(message_reactions)
        .where(and(eq(message_reactions.message_id, message_id), eq(message_reactions.user_id, user_id), eq(message_reactions.emoji, emoji)));
    },

    updateUserProfile: async (user_id, display_name, avatar_url) => {
      const upd: Partial<{ display_name: string | null; avatar_url: string | null }> = { display_name };
      if (avatar_url !== undefined) upd.avatar_url = avatar_url;
      await db.update(users).set(upd).where(eq(users.id, user_id));
    },

    getReactionsForMessages: async (message_ids) => {
      if (message_ids.length === 0) return {};
      const { message_reactions } = pgSchema;
      const rows = await db.select({
        id: message_reactions.id,
        message_id: message_reactions.message_id,
        user_id: message_reactions.user_id,
        emoji: message_reactions.emoji,
        created_at: message_reactions.created_at,
        username: users.username,
      })
        .from(message_reactions)
        .innerJoin(users, eq(message_reactions.user_id, users.id))
        .where(inArray(message_reactions.message_id, message_ids)) as (MessageReaction & { username: string })[];
      const result: Record<number, MessageReaction[]> = {};
      for (const row of rows) {
        if (!result[row.message_id]) result[row.message_id] = [];
        result[row.message_id].push(row);
      }
      return result;
    },

    createDmChannel: async (space_id, user1_id, user2_id, created_by) => {
      const { dm_members } = pgSchema;
      const name = `dm_${Math.min(user1_id, user2_id)}_${Math.max(user1_id, user2_id)}`;
      const rows = await db.insert(channels).values({ space_id, name, type: 'dm', created_by }).returning({ id: channels.id });
      const channelId = rows[0].id;
      await db.insert(dm_members).values({ channel_id: channelId, user_id: user1_id });
      await db.insert(dm_members).values({ channel_id: channelId, user_id: user2_id });
      return { id: channelId };
    },

    findDmChannel: async (space_id, user1_id, user2_id) => {
      const name = `dm_${Math.min(user1_id, user2_id)}_${Math.max(user1_id, user2_id)}`;
      const rows = await db.select({ id: channels.id })
        .from(channels)
        .where(and(eq(channels.space_id, space_id), eq(channels.name, name), eq(channels.type, 'dm')))
        .limit(1);
      return rows[0] as { id: number } | undefined;
    },

    listDmChannels: async (space_id, user_id) => {
      const { dm_members } = pgSchema;
      const myChannels = await db.select({ channel_id: dm_members.channel_id })
        .from(dm_members)
        .innerJoin(channels, eq(dm_members.channel_id, channels.id))
        .where(and(eq(dm_members.user_id, user_id), eq(channels.space_id, space_id), eq(channels.type, 'dm')));
      const result: DmChannel[] = [];
      for (const { channel_id } of myChannels) {
        const otherRows = await db.select({ user_id: dm_members.user_id, username: users.username, display_name: users.display_name, avatar_url: users.avatar_url })
          .from(dm_members)
          .innerJoin(users, eq(dm_members.user_id, users.id))
          .where(and(eq(dm_members.channel_id, channel_id), ne(dm_members.user_id, user_id)))
          .limit(1);
        const chanRows = await db.select({ id: channels.id, name: channels.name, space_id: channels.space_id })
          .from(channels).where(eq(channels.id, channel_id)).limit(1);
        if (chanRows[0]) {
          result.push({
            id: chanRows[0].id,
            name: chanRows[0].name,
            space_id: chanRows[0].space_id,
            other_user_id: otherRows[0]?.user_id ?? 0,
            other_username: otherRows[0]?.username ?? '',
            other_display_name: otherRows[0]?.display_name ?? null,
            other_avatar_url: otherRows[0]?.avatar_url ?? null,
          });
        }
      }
      return result;
    },

    isUserDmMember: async (channel_id, user_id) => {
      const { dm_members } = pgSchema;
      const rows = await db.select({ id: dm_members.id }).from(dm_members)
        .where(and(eq(dm_members.channel_id, channel_id), eq(dm_members.user_id, user_id)))
        .limit(1);
      return rows.length > 0;
    },

    searchMessages: async (space_id, query, channel, limit) => {
      const q = query.trim();
      if (!q) return [];
      const rows = await appClient<SearchResult[]>`
        SELECT m.id, m.space_id, m.channel, m.user_id, m.content, m.created_at, u.username
        FROM messages m
        JOIN users u ON u.id = m.user_id
        WHERE m.space_id = ${space_id}
          AND m.deleted_at IS NULL
          AND (${channel}::text IS NULL OR m.channel = ${channel})
          AND to_tsvector('english', m.content) @@ plainto_tsquery('english', ${q})
        ORDER BY ts_rank(to_tsvector('english', m.content), plainto_tsquery('english', ${q})) DESC
        LIMIT ${limit}
      `;
      return rows;
    },

    enqueueNotification: async (user_id, message_id, space_id, channel) => {
      await appClient`
        INSERT INTO notification_queue (user_id, message_id, space_id, channel)
        VALUES (${user_id}, ${message_id}, ${space_id}, ${channel})
      `;
    },

    getPendingNotifications: async () => {
      const rows = await appClient<PendingNotification[]>`
        SELECT nq.id, nq.user_id, u.email, u.username,
               nq.message_id, m.content as message_content,
               su.username as sender_username,
               nq.space_id, s.name as space_name,
               nq.channel, nq.created_at
        FROM notification_queue nq
        JOIN users u ON nq.user_id = u.id
        JOIN messages m ON nq.message_id = m.id
        JOIN users su ON m.user_id = su.id
        JOIN spaces s ON nq.space_id = s.id
        WHERE nq.sent_at IS NULL AND u.email IS NOT NULL
        ORDER BY nq.created_at ASC
      `;
      return rows;
    },

    markNotificationsSent: async (ids) => {
      if (ids.length === 0) return;
      await appClient`
        UPDATE notification_queue SET sent_at = extract(epoch from now())::int
        WHERE id = ANY(${ids})
      `;
    },

    insertAttachment: async (filename, storage_key, mime_type, size) => {
      const rows = await db.insert(message_attachments).values({ filename, storage_key, mime_type, size }).returning({ id: message_attachments.id });
      return { id: rows[0].id };
    },

    linkAttachmentToMessage: async (attachment_id, message_id) => {
      await db.update(message_attachments).set({ message_id }).where(eq(message_attachments.id, attachment_id));
    },

    getAttachmentsForMessages: async (message_ids) => {
      if (message_ids.length === 0) return {};
      const rows = await db.select().from(message_attachments).where(inArray(message_attachments.message_id, message_ids)) as Attachment[];
      const result: Record<number, Attachment[]> = {};
      for (const row of rows) {
        if (row.message_id !== null) {
          if (!result[row.message_id]) result[row.message_id] = [];
          result[row.message_id].push(row);
        }
      }
      return result;
    },

    getThread: async (space_id, message_id) => {
      const parentRows = await db.select({
        id: messages.id,
        space_id: messages.space_id,
        user_id: messages.user_id,
        channel: messages.channel,
        content: messages.content,
        reply_count: messages.reply_count,
        created_at: messages.created_at,
        updated_at: messages.updated_at,
        deleted_at: messages.deleted_at,
        username: users.username,
      })
        .from(messages)
        .innerJoin(users, eq(messages.user_id, users.id))
        .where(and(eq(messages.id, message_id), eq(messages.space_id, space_id), isNull(messages.deleted_at)))
        .limit(1);
      const parent = parentRows[0] as Message | undefined;
      if (!parent) return undefined;
      const replies = await db.select({
        id: thread_replies.id,
        parent_message_id: thread_replies.parent_message_id,
        space_id: thread_replies.space_id,
        user_id: thread_replies.user_id,
        channel: thread_replies.channel,
        content: thread_replies.content,
        created_at: thread_replies.created_at,
        updated_at: thread_replies.updated_at,
        deleted_at: thread_replies.deleted_at,
        username: users.username,
      })
        .from(thread_replies)
        .innerJoin(users, eq(thread_replies.user_id, users.id))
        .where(and(eq(thread_replies.parent_message_id, message_id), isNull(thread_replies.deleted_at)))
        .orderBy(asc(thread_replies.created_at));
      return { parent, replies: replies as ThreadReply[] };
    },

    insertThreadReply: async (parent_message_id, space_id, user_id, channel, content) => {
      const rows = await db.insert(thread_replies)
        .values({ parent_message_id, space_id, user_id, channel, content })
        .returning({ id: thread_replies.id });
      await db.update(messages)
        .set({ reply_count: sql`${messages.reply_count} + 1` })
        .where(eq(messages.id, parent_message_id));
      const parentRows = await db.select({ reply_count: messages.reply_count })
        .from(messages).where(eq(messages.id, parent_message_id)).limit(1);
      return { id: rows[0].id, reply_count: parentRows[0]?.reply_count ?? 0 };
    },

    addSpaceEmoji: async (space_id, name, image_url, created_by) => {
      const { space_emoji } = pgSchema;
      const rows = await db.insert(space_emoji).values({ space_id, name, image_url, created_by }).returning();
      return rows[0] as SpaceEmoji;
    },

    listSpaceEmoji: async (space_id) => {
      const { space_emoji } = pgSchema;
      return db.select().from(space_emoji)
        .where(eq(space_emoji.space_id, space_id))
        .orderBy(asc(space_emoji.name)) as Promise<SpaceEmoji[]>;
    },

    deleteSpaceEmoji: async (space_id, name) => {
      const { space_emoji } = pgSchema;
      await db.delete(space_emoji)
        .where(and(eq(space_emoji.space_id, space_id), eq(space_emoji.name, name)));
    },

    logAudit: async (space_id, user_id, action, target_type = null, target_id = null, meta = null) => {
      const { audit_logs } = pgSchema;
      await db.insert(audit_logs).values({ space_id, user_id, action, target_type, target_id, meta });
    },

    getAuditLogs: async (space_id, limit) => {
      const { audit_logs } = pgSchema;
      const rows = await db.select({
        id: audit_logs.id,
        space_id: audit_logs.space_id,
        user_id: audit_logs.user_id,
        username: users.username,
        action: audit_logs.action,
        target_type: audit_logs.target_type,
        target_id: audit_logs.target_id,
        meta: audit_logs.meta,
        created_at: audit_logs.created_at,
      })
        .from(audit_logs)
        .innerJoin(users, eq(audit_logs.user_id, users.id))
        .where(eq(audit_logs.space_id, space_id))
        .orderBy(desc(audit_logs.created_at))
        .limit(limit);
      return rows as AuditLogEntry[];
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
