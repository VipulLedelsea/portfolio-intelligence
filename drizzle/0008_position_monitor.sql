CREATE TABLE `holding_level_events` (
	`id` text PRIMARY KEY NOT NULL,
	`holding_id` text NOT NULL,
	`user_id` text NOT NULL,
	`symbol` text NOT NULL,
	`at` text NOT NULL,
	`kind` text NOT NULL,
	`reason` text NOT NULL,
	`price` real,
	`stop_level` real,
	`target_1` real,
	`target_2` real
);
--> statement-breakpoint
CREATE INDEX `holding_level_events_holding_idx` ON `holding_level_events` (`holding_id`,`at`);--> statement-breakpoint
CREATE INDEX `holding_level_events_user_idx` ON `holding_level_events` (`user_id`,`at`);--> statement-breakpoint
ALTER TABLE `holdings` ADD `monitor_atr` real;--> statement-breakpoint
ALTER TABLE `holdings` ADD `stop_level` real;--> statement-breakpoint
ALTER TABLE `holdings` ADD `target_1` real;--> statement-breakpoint
ALTER TABLE `holdings` ADD `target_2` real;--> statement-breakpoint
ALTER TABLE `holdings` ADD `peak_high` real;--> statement-breakpoint
ALTER TABLE `holdings` ADD `monitor_at` text;