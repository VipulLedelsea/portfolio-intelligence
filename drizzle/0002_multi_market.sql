CREATE TABLE `scan_cache` (
	`market` text PRIMARY KEY NOT NULL,
	`payload` text,
	`generated_at` text NOT NULL,
	`refreshing_until` text
);
--> statement-breakpoint
ALTER TABLE `recommendations` ADD `market` text DEFAULT 'US' NOT NULL;