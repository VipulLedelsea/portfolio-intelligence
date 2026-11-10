// Checks the information-only chart labels: each pattern detector fires on a hand-built series and stays quiet on a flat or falling one, the market label
// follows SPY's distance from its 252-session high, the labels reach US long Supertrend items and the logged features, and nothing reaches the ranking agent.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const source = readFileSync(fileURLToPath(new URL("../worker/runtime.js", import.meta.url)), "utf8").replace(/^export default \{/m, "const __default = {");
const code = `${source}\nexport { chartLabelInputs, marketRegimeLabel, buildRanking, pickFeatures, rankModelInput };`;
const rt = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));

// ---- series builders: 200 flat-ish sessions, then a shape, then a breakout close ----
const bar = (c, wiggle = 0.01, v = 1000) => ({ open: c, high: c * (1 + wiggle), low: c * (1 - wiggle), close: c, volume: v });
const series = (shape) => { const out = []; for (let i = 0; i < 160; i++) out.push(bar(100 + Math.sin(i / 7) * 1.5)); for (const x of shape) out.push(typeof x === "number" ? bar(x) : x); return out; };

// bull flag: pole 100 -> 130 over 15 sessions, flag 6 sessions drifting 128-126 (tight), then a close above the flag high
const pole = Array.from({ length: 15 }, (_, i) => 100 + (i + 1) * 2), flag = [129, 128.5, 128, 127.5, 127, 127.2], flagBars = flag.map(x => bar(x, 0.003));
const flagSeries = series([...pole, ...flagBars, bar(131, 0.004)]);
const f1 = rt.chartLabelInputs(flagSeries);
assert.equal(f1.pattern, "Bull flag", "bull flag breakout is found");
assert.equal(f1.days_ago, 0);
assert.equal(f1.prior_run_up, true, "a 30% pole counts as a prior run-up");
// the same series two sessions later still counts (look-back of 3), five sessions later it does not
const later = (k) => [...flagSeries, ...Array.from({ length: k }, (_, i) => bar(131.2 + i * 0.1, 0.003))];
assert.equal(rt.chartLabelInputs(later(2)).pattern, "Bull flag");
assert.equal(rt.chartLabelInputs(later(2)).days_ago, 2);
assert.equal(rt.chartLabelInputs(later(5)).pattern, null, "an old breakout is not labelled");

// flat base: 30 tight sessions, then a close above the base on 2x volume
const base = Array.from({ length: 30 }, (_, i) => bar(100 + Math.sin(i) * 1, 0.004, 1000));
assert.equal(rt.chartLabelInputs([...series([]), ...base, bar(103.5, 0.004, 2500)]).pattern, "Flat base");
assert.notEqual(rt.chartLabelInputs([...series([]), ...base, bar(103.5, 0.004, 900)]).pattern, "Flat base", "no volume, no flat base");

// a double bottom is deliberately not labelled (it matched a quarter of all flips and never beat its control)
const dbl = [];
for (let i = 0; i < 30; i++) dbl.push(bar(120 - i * 1.3, 0.004)); for (let i = 0; i < 16; i++) dbl.push(bar(82 + (i + 1) * 1.2, 0.004));
for (let i = 0; i < 16; i++) dbl.push(bar(100 - i * 1.2, 0.004)); for (let i = 0; i < 26; i++) dbl.push(bar(82 + (i + 1) * 0.8, 0.004));
for (let k = 0; k < 26; k++) assert.notEqual(rt.chartLabelInputs(series(dbl).slice(0, series(dbl).length - k))?.pattern, "Double bottom");

// quiet series: no pattern, no run-up
const quiet = rt.chartLabelInputs(series(Array.from({ length: 40 }, (_, i) => bar(100 + Math.sin(i / 5)))));
assert.equal(quiet.pattern, null); assert.equal(quiet.prior_run_up, false);
assert.equal(rt.chartLabelInputs(series([]).slice(0, 100)), null, "too little history gives no label");

// ---- market label ----
const spy = (close, high) => ({ recent_daily: [{ d: "2026-01-02", h: close, l: close, c: close }], high_252: high });
assert.deepEqual(rt.marketRegimeLabel(spy(94, 100)), { regime: "CORRECTION", spy_below_high_pct: 6 });
assert.equal(rt.marketRegimeLabel(spy(96, 100)).regime, "NEAR_HIGHS");
assert.equal(rt.marketRegimeLabel(spy(95, 100)).regime, "CORRECTION", "exactly 5% below counts");
assert.equal(rt.marketRegimeLabel(null), null); assert.equal(rt.marketRegimeLabel({ recent_daily: [], high_252: 100 }), null);

// ---- the labels reach the ranking item, the logged features, and not the agent ----
const snapshots = new Map([["AAA", { symbol: "AAA", chart_label: { pattern: "Bull flag", days_ago: 1, prior_run_up: true }, chart_daily: [] }]]);
const candidate = { symbol: "AAA", company: "Aaa Corp", sector: "Tech", direction: "LONG", price: 100, signal_entry_price: 100, signal_atr: 2, daily_atr: 3, daily_supertrend_value: 94, daily_supertrend_direction: "up", daily_adx: 30, daily_adx_rising: true, daily_aligned: true, score: 75, label: "Fresh long entry", signal_confirmed_at: new Date().toISOString(), currency_symbol: "$", price_decimals: 2 };
const ranking = rt.buildRanking({ candidates: [candidate], dipScan: null, patternScan: null, snapshots, trend: { state: "DOWN" }, marketId: "US", spy: spy(90, 100) });
const item = ranking.items.concat(ranking.rejected.map(r => r.item || r))[0] || ranking.items[0];
assert.ok(ranking.items.length === 1, "the long Supertrend idea is listed");
const it = ranking.items[0];
assert.equal(it.chart_pattern, "Bull flag"); assert.equal(it.chart_pattern_days_ago, 1); assert.equal(it.prior_run_up, true);
assert.equal(it.market_regime, "CORRECTION"); assert.equal(it.spy_below_high_pct, 10);
const features = rt.pickFeatures(it, "DOWN");
assert.equal(features.chart_pattern, "Bull flag"); assert.equal(features.market_regime, "CORRECTION"); assert.equal(features.prior_run_up, true);
const modelInput = JSON.stringify(rt.rankModelInput(ranking, "US"));
for (const word of ["chart_pattern", "market_regime", "prior_run_up", "Bull flag", "CORRECTION"]) assert.ok(!modelInput.includes(word), `${word} must not reach the ranking agent`);
// India and forex ideas, and shorts, carry no labels
const inRanking = rt.buildRanking({ candidates: [{ ...candidate, price: 2400 }], dipScan: null, patternScan: null, snapshots, trend: { state: "UP" }, marketId: "IN", spy: spy(90, 100) });
for (const x of inRanking.items) { assert.equal(x.chart_pattern, undefined); assert.equal(x.market_regime, undefined); }
console.log("chart label checks passed");
