// Checks that India and forex ideas are logged under their own strategy and market, with the levels the app shows, and that the US-only jobs
// (post-mortems against the S&P 500, the learning loop) and the US track-record list never see them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const source = readFileSync(fileURLToPath(new URL("../worker/runtime.js", import.meta.url)), "utf8").replace(/^export default \{/m, "const __default = {");
const rt = await import("data:text/javascript;base64," + Buffer.from(`${source}\nexport { recordScannerPicks, publicTrackRecord, pickLevels };`).toString("base64"));

const captured = [];
const env = { DB: { prepare: sql => ({ bind: (...args) => ({ sql, args }) }), batch: async list => { captured.push(...list); } } };
const candidate = (symbol, direction, entry, atr, extra = {}) => ({ symbol, direction, signal_entry_price: entry, signal_atr: atr, daily_atr: atr * 2.4, signal_confirmed_at: "2026-11-10T09:15:00.000Z", price: entry * 1.001, score: 71, entry_status: "ENTRY_WINDOW", daily_adx: 27, daily_supertrend_value: entry * 0.94, ...extra });

// India: a long
let n = await rt.recordScannerPicks(env, { market: "IN", generated_at: "2026-11-10T10:00:00Z", candidates: [candidate("RELIANCE", "LONG", 1400, 12), candidate("BAD", "LONG", 0, 5)] });
assert.equal(n, 1, "an invalid candidate is skipped");
const row = captured.at(-1), a = row.args;
assert.match(row.sql, /INSERT OR IGNORE INTO recommendations/); assert.match(row.sql, /\(id, user_id, symbol, market,/);
assert.equal(a[2], "RELIANCE"); assert.equal(a[3], "IN"); assert.equal(a.at(-2), "SUPERTREND_IN"); assert.match(row.sql, /, 10, 'PENDING', \?, \?\)/, "a 10-day pick");
const [stop, t1, t2] = [a[9], a[10], a[11]];
assert.ok(stop < 1400 && t1 > 1400 && t2 > t1, "long levels are on the right sides");
const shown = rt.pickLevels("LONG", 1400, 12, "IN", 12 * 2.4, 1400 * 0.94);
assert.equal(stop, Math.round(shown.stop * 1e6) / 1e6, "the logged stop is the one the idea shows");

// Forex: a short, with the forex levels
captured.length = 0;
n = await rt.recordScannerPicks(env, { market: "FX", generated_at: "2026-11-10T10:00:00Z", candidates: [candidate("EURUSD", "SHORT", 1.1620, 0.0018)] });
assert.equal(n, 1); const f = captured[0].args;
assert.equal(f[3], "FX"); assert.equal(f.at(-2), "SUPERTREND_FX"); assert.ok(f[9] > 1.162 && f[10] < 1.162, "short levels flip");

// US keeps its own path, other markets log nothing
captured.length = 0;
assert.equal(await rt.recordScannerPicks(env, { market: "XX", generated_at: "t", candidates: [candidate("A", "LONG", 10, 0.2)] }), 0);
assert.equal(await rt.recordScannerPicks({ DB: null }, { market: "IN", candidates: [candidate("A", "LONG", 10, 0.2)] }), 0);

// US-only jobs and the strategies list
assert.match(source, /status = 'SETTLED' AND market = 'US' AND post_mortem IS NULL/, "post-mortems read US picks only");
assert.match(source, /status = 'SETTLED' AND market = 'US' AND features IS NOT NULL/, "the learning loop reads US picks only");
const settled = [{ direction: "LONG", status: "SETTLED", strategy_return_pct: 1.5, stop_hit: 0, target_hit: 1, generated_at: "2026-11-01", strategy: "SUPERTREND_IN" },
  { direction: "LONG", status: "SETTLED", strategy_return_pct: -2, stop_hit: 1, target_hit: 0, generated_at: "2026-11-02", strategy: "SUPERTREND" }];
const db = { prepare: sql => ({ bind: () => ({ all: async () => ({ results: /status = 'SETTLED'/.test(sql) ? settled : [] }), first: async () => ({ n: /status = 'PENDING' AND strategy/.test(sql) ? 2 : 0 }) }) }) };
const record = await rt.publicTrackRecord(db);
assert.ok(record.strategies.every(s => !/_IN$|_FX$/.test(s.id)), "the strategies list the app reads has no India or forex entry");
assert.equal(record.strategies.find(s => s.id === "SUPERTREND").summary.settled_picks, 1, "the US figure ignores the India pick");
const india = record.other_markets.find(m => m.id === "SUPERTREND_IN");
assert.ok(india && india.market === "IN" && india.summary.settled_picks === 1, "India is listed apart");
console.log("India and forex logging checks passed");
