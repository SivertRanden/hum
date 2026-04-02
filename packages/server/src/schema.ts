import { sqliteTable, integer, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  email: text('email').unique(),
  password_hash: text('password_hash').notNull(),
  display_name: text('display_name'),
  avatar_url: text('avatar_url'),
  created_at: integer('created_at').notNull().default(sql`(unixepoch())`),
  last_seen_at: integer('last_seen_at'),
});

export const spaces = sqliteTable('spaces', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  description: text('description'),
  created_by: integer('created_by').notNull().references(() => users.id),
  created_at: integer('created_at').notNull().default(sql`(unixepoch())`),
});

export const channels = sqliteTable('channels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  space_id: integer('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull().default('text'),
  created_by: integer('created_by').notNull().references(() => users.id),
  created_at: integer('created_at').notNull().default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex('channels_space_name_type_unique').on(table.space_id, table.name, table.type),
]);

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  space_id: integer('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  user_id: integer('user_id').notNull().references(() => users.id),
  channel: text('channel').notNull().default('general'),
  content: text('content').notNull(),
  created_at: integer('created_at').notNull().default(sql`(unixepoch())`),
  updated_at: integer('updated_at'),
  deleted_at: integer('deleted_at'),
}, (table) => [
  index('idx_messages_space_id').on(table.space_id, table.channel, table.created_at),
]);

export const space_members = sqliteTable('space_members', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  space_id: integer('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'),
  joined_at: integer('joined_at').notNull().default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex('space_members_space_user_unique').on(table.space_id, table.user_id),
]);

export const invite_tokens = sqliteTable('invite_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  token: text('token').notNull().unique(),
  space_id: integer('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  created_by: integer('created_by').notNull().references(() => users.id),
  expires_at: integer('expires_at'),
  uses: integer('uses').notNull().default(0),
  max_uses: integer('max_uses'),
  created_at: integer('created_at').notNull().default(sql`(unixepoch())`),
});

export const password_reset_tokens = sqliteTable('password_reset_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expires_at: integer('expires_at').notNull(),
  used_at: integer('used_at'),
  created_at: integer('created_at').notNull().default(sql`(unixepoch())`),
});

export const last_read = sqliteTable('last_read', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  space_id: integer('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(),
  last_read_message_id: integer('last_read_message_id').notNull().default(0),
  updated_at: integer('updated_at').notNull().default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex('last_read_user_space_channel_unique').on(table.user_id, table.space_id, table.channel),
]);

export const dm_members = sqliteTable('dm_members', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  channel_id: integer('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('dm_members_channel_user_unique').on(table.channel_id, table.user_id),
]);

export const message_reactions = sqliteTable('message_reactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  message_id: integer('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  emoji: text('emoji').notNull(),
  created_at: integer('created_at').notNull().default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex('message_reactions_unique').on(table.message_id, table.user_id, table.emoji),
]);
