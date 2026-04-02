CREATE TABLE IF NOT EXISTS "thread_replies" (
  "id" serial PRIMARY KEY NOT NULL,
  "parent_message_id" integer NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
  "space_id" integer NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "channel" text NOT NULL DEFAULT 'general',
  "content" text NOT NULL,
  "created_at" integer NOT NULL DEFAULT extract(epoch from now())::int,
  "updated_at" integer,
  "deleted_at" integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_thread_replies_parent" ON "thread_replies" ("parent_message_id","created_at");
