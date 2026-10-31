CREATE TABLE `recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`symbol` text NOT NULL,
	`action` text NOT NULL,
	`direction` text NOT NULL,
	`generated_at` text NOT NULL,
	`signal_confirmed_at` text NOT NULL,
	`entry_price` real NOT NULL,
	`current_price` real NOT NULL,
	`stop_price` real NOT NULL,
	`target_1` real NOT NULL,
	`target_2` real NOT NULL,
	`confidence` real NOT NULL,
	`entry_status` text NOT NULL,
	`daily_adx` real NOT NULL,
	`horizon_trading_days` integer DEFAULT 5 NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`settled_at` text,
	`exit_price` real,
	`raw_return_pct` real,
	`strategy_return_pct` real,
	`max_favorable_pct` real,
	`max_adverse_pct` real,
	`grade` text,
	`target_hit` integer,
	`stop_hit` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recommendations_user_signal_unique` ON `recommendations` (`user_id`,`symbol`,`signal_confirmed_at`,`action`);--> statement-breakpoint
CREATE INDEX `recommendations_user_status_idx` ON `recommendations` (`user_id`,`status`,`generated_at`);