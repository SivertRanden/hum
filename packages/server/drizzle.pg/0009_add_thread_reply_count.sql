ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "reply_count" integer NOT NULL DEFAULT 0;
