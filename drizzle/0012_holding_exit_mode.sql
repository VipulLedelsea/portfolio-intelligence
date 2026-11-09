ALTER TABLE `holdings` ADD `exit_mode` text;--> statement-breakpoint
UPDATE `holdings` SET `exit_mode` = 'LEVELS' WHERE `closed_at` IS NULL AND `market` = 'US' AND EXISTS (
	SELECT 1 FROM `recommendations` r WHERE r.`symbol` = `holdings`.`symbol` AND r.`strategy` IN ('DIP', 'PATTERN') AND r.`action` = 'IDEA'
	AND substr(r.`generated_at`, 1, 10) <= `holdings`.`bought_at`
	AND julianday(`holdings`.`bought_at`) - julianday(substr(r.`generated_at`, 1, 10)) <= 10
);
