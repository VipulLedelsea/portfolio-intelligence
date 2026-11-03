ALTER TABLE `holding_trades` ADD `chain_id` text;--> statement-breakpoint
ALTER TABLE `holding_trades` ADD `voided_at` text;
--> statement-breakpoint
UPDATE `holding_trades` SET `chain_id` = `holding_id` WHERE `chain_id` IS NULL;
