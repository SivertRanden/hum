CREATE TABLE `message_attachments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `message_id` integer REFERENCES `messages`(`id`) ON DELETE CASCADE,
  `filename` text NOT NULL,
  `storage_key` text NOT NULL,
  `mime_type` text NOT NULL,
  `size` integer NOT NULL,
  `created_at` integer NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_message` ON `message_attachments` (`message_id`);
