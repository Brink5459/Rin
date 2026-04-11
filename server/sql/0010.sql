ALTER TABLE `comments` ADD COLUMN `guest_name` text;
--> statement-breakpoint
ALTER TABLE `comments` ADD COLUMN `guest_avatar` text;
--> statement-breakpoint
UPDATE `info` SET `value` = '10' WHERE `key` = 'migration_version';
