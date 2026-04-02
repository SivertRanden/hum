import { pgTable, serial, text, integer, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  created_at: integer('created_at').notNull().default(sql`extract(epoch from now())::int`),
  last_seen_at: integer('last_seen_at'),
});

export const spaces = pgTable('spaces', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  created_by: integer('created_by').notNull().references(() => users.id),
  created_at: integer('created_at').notNull().default(sql`extract(epoch from now())::int`),
});

export const channels = pgTable('channels', {
  id: serial('id').primaryKey(),
  space_id: integer('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull().default('text'),
  created_by: integer('created_by').notNull().references(() => users.id),
  created_at: integer('created_at').notNull().default(sql`extract(epoch from now())::int`),
}, (table) => [
  uniqueIndex('channels_space_name_type_unique').on(table.space_id, table.name, table.type),
]);

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  space_id: integer('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  user_id: integer('user_id').notNull().references(() => users.id),
  channel: text('channel').notNull().default('general'),
  content: text('content').notNull(),
  created_at: integer('created_at').notNull().default(sql`extract(epoch from now())::int`),
  updated_at: integer('updated_at'),
  deleted_at: integer('deleted_at'),
}, (table) => [
  index('idx_messages_space_id').on(table.space_id, table.channel, table.created_at),
]);

export const space_members = pgTable('space_members', {
  id: serial('id').primaryKey(),
  space_id: integer('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'),
  joined_at: integer('joined_at').notNull().default(sql`extract(epoch from now())::int`),
}, (table) => [
  uniqueIndex('space_members_space_user_unique').on(table.space_id, table.user_id),
]);

export const invite_tokens = pgTable('invite_tokens', {
  id: serial('id').primaryKey(),
  token: text('token').notNull().unique(),
  space_id: integer('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  created_by: integer('created_by').notNull().references(() => users.id),
  expires_at: integer('expires_at'),
  uses: integer('uses').notNull().default(0),
  max_uses: integer('max_uses'),
  created_at: integer('created_at').notNull().default(sql`extract(epoch from now())::int`),
});

export const last_read = pgTable('last_read', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  space_id: integer('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(),
  last_read_message_id: integer('last_read_message_id').notNull().default(0),
  updated_at: integer('updated_at').notNull().default(sql`extract(epoch from now())::int`),
}, (table) => [
  uniqueIndex('last_read_user_space_channel_unique').on(table.user_id, table.space_id, table.channel),
]);
