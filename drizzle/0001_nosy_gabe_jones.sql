CREATE TABLE `mobile_pairings` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`secret_hash` text NOT NULL,
	`device_name` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`user_id` text,
	`approved_at` text,
	`claimed_at` text
);
--> statement-breakpoint
CREATE INDEX `mobile_pairings_expires_idx` ON `mobile_pairings` (`expires_at`);--> statement-breakpoint
CREATE TABLE `mobile_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_name` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE INDEX `mobile_sessions_user_expiry_idx` ON `mobile_sessions` (`user_id`,`expires_at`);