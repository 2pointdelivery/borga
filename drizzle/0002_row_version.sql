-- Adds a per-row version to borga_state for optimistic concurrency (a stale save is refused instead of overwriting).
-- Existing rows start at version 1. Idempotent: skipped when the column already exists.
SET @borga_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `borga_state` ADD `version` bigint unsigned DEFAULT 1 NOT NULL', 'SELECT 1') FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'borga_state' AND column_name = 'version');--> statement-breakpoint
PREPARE borga_stmt FROM @borga_sql;--> statement-breakpoint
EXECUTE borga_stmt;--> statement-breakpoint
DEALLOCATE PREPARE borga_stmt;
