-- Adds password-reset columns and makes email unique.
-- Written to be safe on every database that exists today: one made by 0000 only, one where the reset columns were already
-- added by hand, and one that already has the unique index. Each change checks information_schema first. MySQL has no
-- "ADD COLUMN IF NOT EXISTS", hence the prepared statements. The index swap is ONE alter, so if it fails (duplicate emails)
-- the old index stays in place; scripts/migrate.mjs also checks for duplicates before running this file.
SET @borga_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `borga_users` ADD `reset_token` varchar(255)', 'SELECT 1') FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'borga_users' AND column_name = 'reset_token');--> statement-breakpoint
PREPARE borga_stmt FROM @borga_sql;--> statement-breakpoint
EXECUTE borga_stmt;--> statement-breakpoint
DEALLOCATE PREPARE borga_stmt;--> statement-breakpoint
SET @borga_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `borga_users` ADD `reset_token_expires` datetime', 'SELECT 1') FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'borga_users' AND column_name = 'reset_token_expires');--> statement-breakpoint
PREPARE borga_stmt FROM @borga_sql;--> statement-breakpoint
EXECUTE borga_stmt;--> statement-breakpoint
DEALLOCATE PREPARE borga_stmt;--> statement-breakpoint
SET @borga_sql = (SELECT CASE WHEN COALESCE(SUM(non_unique = 0), 0) > 0 THEN 'SELECT 1' WHEN COUNT(*) > 0 THEN 'ALTER TABLE `borga_users` DROP INDEX `idx_users_email`, ADD CONSTRAINT `idx_users_email` UNIQUE(`email`)' ELSE 'ALTER TABLE `borga_users` ADD CONSTRAINT `idx_users_email` UNIQUE(`email`)' END FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'borga_users' AND index_name = 'idx_users_email');--> statement-breakpoint
PREPARE borga_stmt FROM @borga_sql;--> statement-breakpoint
EXECUTE borga_stmt;--> statement-breakpoint
DEALLOCATE PREPARE borga_stmt;
