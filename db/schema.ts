import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const recommendations = sqliteTable("recommendations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  symbol: text("symbol").notNull(),
  market: text("market").notNull().default("US"),
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
  // SUPERTREND (4-hour Supertrend scan), DIP (dip scan, market gate open) or DIP_WAIT (dip scan while the gate was closed; logged to test the gate, never shown as an idea).
  strategy: text("strategy").notNull().default("SUPERTREND"),
  // The bull-versus-bear debate's lean (bull, bear or even) when it was logged within two days of the pick, so results can be compared by lean.
  debateLeaning: text("debate_leaning"),
  debateAt: text("debate_at"),
  // JSON from the post-mortem step: tags such as STOPPED_OUT or EARNINGS_IN_HOLD worked out by code once the pick settles.
  postMortem: text("post_mortem"),
  // JSON snapshot of what was known when the pick was logged (score, distance from entry, stop size, alignment, earnings, market state), used to test rules on results.
  features: text("features"),
  // JSON: what the ranking advisor (the AI model plus the code guardrails) decided about this idea the first time it saw it: KEPT or REJECTED, who rejected it,
  // its rank, score, confidence and stated win probability, the price at that moment, the model and the prompt version. Used to measure the advisor on results.
  advisorVerdict: text("advisor_verdict"),
  advisorAt: text("advisor_at"),
  // The price that proves a dip or pattern idea wrong (added by migration 0013; the Worker reads and writes it).
  failureLevel: real("failure_level"),
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

export const scanCache = sqliteTable("scan_cache", {
  market: text("market").primaryKey(),
  payload: text("payload"),
  generatedAt: text("generated_at").notNull(),
  refreshingUntil: text("refreshing_until"),
});

export const webSessions = sqliteTable("web_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  email: text("email").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, table => [
  index("web_sessions_expires_idx").on(table.expiresAt),
]);

export const holdings = sqliteTable("holdings", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  symbol: text("symbol").notNull(),
  market: text("market").notNull().default("US"),
  shares: real("shares").notNull(),
  buyPrice: real("buy_price").notNull(),
  boughtAt: text("bought_at").notNull(),
  createdAt: text("created_at").notNull(),
  closedAt: text("closed_at"),
  sellPrice: real("sell_price"),
  lastAction: text("last_action"),
  lastActionAt: text("last_action_at"),
  // Position monitor (US): the ATR the levels are anchored to, the protective level and targets as last ratcheted (the stop only
  // ever moves up, targets only out), and the highest price seen since entry. Levels are recomputed from these on every pass.
  monitorAtr: real("monitor_atr"),
  stopLevel: real("stop_level"),
  target1: real("target_1"),
  target2: real("target_2"),
  peakHigh: real("peak_high"),
  monitorAt: text("monitor_at"),
  // How the position is exited. null/TREND: leave when a daily close is under the daily Supertrend line (Supertrend entries).
  // LEVELS: a dip, pattern or counter-trend buy, where the daily trend is down by design, so it uses a fixed protective level and target.
  exitMode: text("exit_mode"),
  // The idea the position came from (DIP or PATTERN) and, for a pattern, the breakout level it fails under (a daily close back below it).
  ideaStrategy: text("idea_strategy"),
  failureLevel: real("failure_level"),
  // Profit lock (advisory): the day a daily close first reached the arming gain over the buy price, and the day price first came back to the lock. See profitLockState.
  lockArmedAt: text("lock_armed_at"),
  lockHitAt: text("lock_hit_at"),
}, table => [
  index("holdings_user_idx").on(table.userId, table.closedAt),
]);

// Every change the monitor made to a position's levels, with the reason in plain words.
export const holdingLevelEvents = sqliteTable("holding_level_events", {
  id: text("id").primaryKey(),
  holdingId: text("holding_id").notNull(),
  userId: text("user_id").notNull(),
  symbol: text("symbol").notNull(),
  at: text("at").notNull(),
  kind: text("kind").notNull(), // INITIAL, BREAKEVEN, TARGETS_RAISED, MARKET_TIGHTEN
  reason: text("reason").notNull(),
  price: real("price"),
  stopLevel: real("stop_level"),
  target1: real("target_1"),
  target2: real("target_2"),
}, table => [
  index("holding_level_events_holding_idx").on(table.holdingId, table.at),
  index("holding_level_events_user_idx").on(table.userId, table.at),
]);

// Things that happened to a held position while the user was away. dedupe_key keeps each event to one row; seen_at is set when the user opens the list.
export const holdingAlerts = sqliteTable("holding_alerts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  holdingId: text("holding_id").notNull(),
  symbol: text("symbol").notNull(),
  at: text("at").notNull(),
  kind: text("kind").notNull(), // EXIT, TAKE_PROFIT, WATCH, STOP_RAISED, EARNINGS_SOON, FILING_RED_FLAG
  severity: text("severity").notNull(), // high or info
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  seenAt: text("seen_at"),
}, table => [
  index("holding_alerts_user_idx").on(table.userId, table.at),
  uniqueIndex("holding_alerts_dedupe_idx").on(table.dedupeKey),
]);

// Rules the learning loop found in graded results. PROPOSED rules do nothing until an admin approves them; ACTIVE rules take points off matching ideas.
export const learningRules = sqliteTable("learning_rules", {
  ruleKey: text("rule_key").primaryKey(), // for example WIDE_STOP|DIP
  status: text("status").notNull().default("PROPOSED"), // PROPOSED, ACTIVE, REJECTED, RETIRED
  penalty: real("penalty").notNull().default(10),
  proposedAt: text("proposed_at").notNull(),
  decidedAt: text("decided_at"),
  decidedBy: text("decided_by"),
  evidence: text("evidence"),
});

export const holdingTrades = sqliteTable("holding_trades", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  holdingId: text("holding_id").notNull(),
  chainId: text("chain_id"),
  symbol: text("symbol").notNull(),
  market: text("market").notNull().default("US"),
  side: text("side").notNull(),
  shares: real("shares").notNull(),
  price: real("price").notNull(),
  at: text("at").notNull(),
  realizedPnl: real("realized_pnl"),
  voidedAt: text("voided_at"),
}, table => [
  index("holding_trades_user_idx").on(table.userId, table.at),
  index("holding_trades_holding_idx").on(table.holdingId),
]);
