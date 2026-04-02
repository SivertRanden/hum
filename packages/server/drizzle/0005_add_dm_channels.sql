CREATE TABLE `dm_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` integer NOT NULL REFERENCES `channels`(`id`) ON DELETE cascade,
	`user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dm_members_channel_user_unique` ON `dm_members` (`channel_id`,`user_id`);
