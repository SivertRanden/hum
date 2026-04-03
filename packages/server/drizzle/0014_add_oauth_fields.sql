ALTER TABLE users ADD COLUMN oauth_provider TEXT;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN oauth_id TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_unique ON users(oauth_provider, oauth_id) WHERE oauth_provider IS NOT NULL;
