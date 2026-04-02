CREATE TABLE IF NOT EXISTS `message_reactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` integer NOT NULL REFERENCES `messages`(`id`) ON DELETE cascade,
	`user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
	`emoji` text NOT NULL,
	`created_at` integer NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `message_reactions_unique` ON `message_reactions` (`message_id`,`user_id`,`emoji`);
