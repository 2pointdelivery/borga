CREATE TABLE `borga_users` (
	`id` varchar(36) NOT NULL,
	`email` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `borga_users_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `borga_state` (
	`key` varchar(255) NOT NULL,
	`value` json NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `borga_state_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE INDEX `idx_users_email` ON `borga_users` (`email`);