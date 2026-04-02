CREATE TABLE IF NOT EXISTS "notification_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"message_id" integer NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
	"space_id" integer NOT NULL,
	"channel" text NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::int NOT NULL,
	"sent_at" integer
);
