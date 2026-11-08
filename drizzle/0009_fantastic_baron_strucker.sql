CREATE TABLE `holding_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`holding_id` text NOT NULL,
	`symbol` text NOT NULL,
	`at` text NOT NULL,
	`kind` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`seen_at` text
);
--> statement-breakpoint
CREATE INDEX `holding_alerts_user_idx` ON `holding_alerts` (`user_id`,`at`);--> statement-breakpoint
CREATE UNIQUE INDEX `holding_alerts_dedupe_idx` ON `holding_alerts` (`dedupe_key`);