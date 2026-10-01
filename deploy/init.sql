-- Idempotent schema for a fresh install (mirrors db/schemas + drizzle migrations).
-- Runs once, on first start of the empty MySQL volume.
CREATE TABLE IF NOT EXISTS `borga_users` (
  `id` varchar(36) NOT NULL,
  `email` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `reset_token` varchar(255) NULL,
  `reset_token_expires` datetime NULL,
  `created_at` datetime NOT NULL,
  CONSTRAINT `borga_users_id` PRIMARY KEY (`id`),
  CONSTRAINT `idx_users_email` UNIQUE (`email`)
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS `borga_state` (
  `key` varchar(255) NOT NULL,
  `value` json NOT NULL,
  `updated_at` datetime NOT NULL,
  CONSTRAINT `borga_state_key` PRIMARY KEY (`key`)
) CHARACTER SET utf8mb4;
