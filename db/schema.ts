import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const recommendations = sqliteTable("recommendations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  symbol: text("symbol").notNull(),
  action: text("action").notNull(),
  direction: text("direction").notNull(),
  generatedAt: text("generated_at").notNull(),
  signalConfirmedAt: text("signal_confirmed_at").notNull(),
  entryPrice: real("entry_price").notNull(),
  currentPrice: real("current_price").notNull(),
  stopPrice: real("stop_price").notNull(),
  target1: real("target_1").notNull(),
  target2: real("target_2").notNull(),
  confidence: real("confidence").notNull(),
  entryStatus: text("entry_status").notNull(),
  dailyAdx: real("daily_adx").notNull(),
  horizonTradingDays: integer("horizon_trading_days").notNull().default(5),
  status: text("status").notNull().default("PENDING"),
  settledAt: text("settled_at"),
  exitPrice: real("exit_price"),
  rawReturnPct: real("raw_return_pct"),
  strategyReturnPct: real("strategy_return_pct"),
  maxFavorablePct: real("max_favorable_pct"),
  maxAdversePct: real("max_adverse_pct"),
  grade: text("grade"),
  targetHit: integer("target_hit", { mode: "boolean" }),
  stopHit: integer("stop_hit", { mode: "boolean" }),
}, table => [
  uniqueIndex("recommendations_user_signal_unique").on(table.userId, table.symbol, table.signalConfirmedAt, table.action),
  index("recommendations_user_status_idx").on(table.userId, table.status, table.generatedAt),
]);

export const mobilePairings = sqliteTable("mobile_pairings", {
  codeHash: text("code_hash").primaryKey(),
  secretHash: text("secret_hash").notNull(),
  deviceName: text("device_name").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  userId: text("user_id"),
  approvedAt: text("approved_at"),
  claimedAt: text("claimed_at"),
}, table => [
  index("mobile_pairings_expires_idx").on(table.expiresAt),
]);

export const mobileSessions = sqliteTable("mobile_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  deviceName: text("device_name").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
}, table => [
  index("mobile_sessions_user_expiry_idx").on(table.userId, table.expiresAt),
]);
