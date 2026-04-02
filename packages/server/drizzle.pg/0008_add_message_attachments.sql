CREATE TABLE IF NOT EXISTS "message_attachments" (
  "id" serial PRIMARY KEY NOT NULL,
  "message_id" integer REFERENCES "messages"("id") ON DELETE CASCADE,
  "filename" text NOT NULL,
  "storage_key" text NOT NULL,
  "mime_type" text NOT NULL,
  "size" integer NOT NULL,
  "created_at" integer NOT NULL DEFAULT extract(epoch from now())::int
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attachments_message" ON "message_attachments" ("message_id");
