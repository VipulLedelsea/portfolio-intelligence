CREATE TABLE `holdings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`symbol` text NOT NULL,
	`market` text DEFAULT 'US' NOT NULL,
	`shares` real NOT NULL,
	`buy_price` real NOT NULL,
	`bought_at` text NOT NULL,
	`created_at` text NOT NULL,
	`closed_at` text,
	`sell_price` real,
	`last_action` text,
	`last_action_at` text
);
--> statement-breakpoint
CREATE INDEX `holdings_user_idx` ON `holdings` (`user_id`,`closed_at`);