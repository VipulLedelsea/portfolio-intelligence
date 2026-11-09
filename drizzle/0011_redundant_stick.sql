CREATE TABLE `learning_rules` (
	`rule_key` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'PROPOSED' NOT NULL,
	`penalty` real DEFAULT 10 NOT NULL,
	`proposed_at` text NOT NULL,
	`decided_at` text,
	`decided_by` text,
	`evidence` text
);
--> statement-breakpoint
ALTER TABLE `recommendations` ADD `features` text;