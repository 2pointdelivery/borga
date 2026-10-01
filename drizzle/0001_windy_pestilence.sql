DROP INDEX `idx_users_email` ON `borga_users`;--> statement-breakpoint
ALTER TABLE `borga_users` ADD `reset_token` varchar(255);--> statement-breakpoint
ALTER TABLE `borga_users` ADD `reset_token_expires` datetime;--> statement-breakpoint
ALTER TABLE `borga_users` ADD CONSTRAINT `idx_users_email` UNIQUE(`email`);