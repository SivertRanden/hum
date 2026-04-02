CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"space_id" integer NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
	"user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" integer,
	"meta" text,
	"created_at" integer NOT NULL DEFAULT extract(epoch from now())::int
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_space" ON "audit_logs" ("space_id","created_at");
