CREATE TABLE IF NOT EXISTS message_reactions (
	id serial PRIMARY KEY NOT NULL,
	message_id integer NOT NULL REFERENCES messages(id) ON DELETE cascade,
	user_id integer NOT NULL REFERENCES users(id) ON DELETE cascade,
	emoji text NOT NULL,
	created_at integer NOT NULL DEFAULT extract(epoch from now())::int
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS message_reactions_unique ON message_reactions (message_id, user_id, emoji);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_message_reactions_message_id ON message_reactions (message_id);
