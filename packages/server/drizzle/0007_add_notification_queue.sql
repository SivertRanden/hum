CREATE TABLE `notification_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
	`message_id` integer NOT NULL REFERENCES `messages`(`id`) ON DELETE CASCADE,
	`space_id` integer NOT NULL,
	`channel` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`sent_at` integer
);
