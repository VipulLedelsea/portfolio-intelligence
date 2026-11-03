CREATE TABLE `holding_trades` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`holding_id` text NOT NULL,
	`symbol` text NOT NULL,
	`market` text DEFAULT 'US' NOT NULL,
	`side` text NOT NULL,
	`shares` real NOT NULL,
	`price` real NOT NULL,
	`at` text NOT NULL,
	`realized_pnl` real
);
--> statement-breakpoint
CREATE INDEX `holding_trades_user_idx` ON `holding_trades` (`user_id`,`at`);--> statement-breakpoint
CREATE INDEX `holding_trades_holding_idx` ON `holding_trades` (`holding_id`);
--> statement-breakpoint
INSERT INTO `holding_trades` (`id`, `user_id`, `holding_id`, `symbol`, `market`, `side`, `shares`, `price`, `at`, `realized_pnl`)
SELECT lower(hex(randomblob(9))), `user_id`, `id`, `symbol`, `market`, 'BUY', `shares`, `buy_price`, `bought_at` || 'T00:00:00.000Z', NULL FROM `holdings`;
--> statement-breakpoint
INSERT INTO `holding_trades` (`id`, `user_id`, `holding_id`, `symbol`, `market`, `side`, `shares`, `price`, `at`, `realized_pnl`)
SELECT lower(hex(randomblob(9))), `user_id`, `id`, `symbol`, `market`, 'SELL', `shares`, `sell_price`, `closed_at`, (`sell_price` - `buy_price`) * `shares` FROM `holdings` WHERE `closed_at` IS NOT NULL AND `sell_price` IS NOT NULL;
