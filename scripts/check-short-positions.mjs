// Checks that a short position mirrors the long rules: stop above price and only moving down, targets below, profit when price falls, the profit lock mirrored,
// cover when the daily close is over the Supertrend line, and that a long is unchanged.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const source = readFileSync(fileURLToPath(new URL("../worker/runtime.js", import.meta.url)), "utf8").replace(/^export default \{/m, "const __default = {");
const rt = await import("data:text/javascript;base64," + Buffer.from(`${source}\nexport { profitLockState, monitorLevels, evaluateHolding, tradePnl, tradePct };`).toString("base64"));
const bar = (d, l, h, c) => ({ d, l, h, c });

// profit lock, mirrored: armed by a close 3% under, lock 1% under, hit by a later high or the live price
const lock = (over = {}) => rt.profitLockState({ buy: 100, boughtDate: "2026-01-02", price: 96, bars: [], direction: "SHORT", ...over });
let s = lock();
assert.equal(s.armed, false); assert.equal(s.level, 99); assert.equal(s.arm_price, 97);
s = lock({ bars: [bar("2026-01-03", 95, 100, 97)] }); assert.equal(s.armed, true); assert.equal(s.armed_close, 97);
s = lock({ bars: [bar("2026-01-03", 95, 100, 97.1)] }); assert.equal(s.armed, false, "a 2.9% close does not arm");
s = lock({ bars: [bar("2026-01-03", 95, 98, 96.5), bar("2026-01-04", 95, 99.2, 97)] }); assert.equal(s.hit, true); assert.equal(s.touched_on, "2026-01-04");
s = lock({ bars: [bar("2026-01-03", 95, 98.9, 96.5)], price: 99 }); assert.equal(s.hit, true, "the live price at the lock hits it");
assert.equal(lock({ stop: 98.9 }).superseded, true); assert.equal(lock({ stop: 99.5 }).superseded, false);

// a fresh short: stop above, targets below
const snapshot = (over = {}) => ({ price: 95, atr_14: 2, sma_20: 100, daily_adx: { value: 30 }, daily_supertrend: { direction: "SHORT", value: 99 }, supertrend: { direction: "SHORT", value: 98 }, recent_daily: [], data_complete: true, ...over });
const row = (over = {}) => ({ market: "US", symbol: "XYZ", shares: 10, buy_price: 100, bought_at: "2026-01-02", direction: "SHORT", exit_mode: "TREND", ...over });
let levels = rt.monitorLevels(row(), snapshot());
assert.equal(levels.stop, 99, "the daily Supertrend line over the price is the stop");
assert.ok(levels.target1 < 100 && levels.target2 < levels.target1, "targets sit under the short price");
let ev = rt.evaluateHolding(row(), snapshot(), levels);
assert.equal(ev.direction, "SHORT"); assert.equal(ev.pnl_value, 50); assert.equal(ev.pnl_pct, 5);
assert.equal(ev.action, "TAKE_PROFIT", "5% under the short price suggests considering a cover");
assert.ok(ev.stop_level > ev.current_price);
// the stop only moves down: a stored lower stop is kept when the line is higher
levels = rt.monitorLevels(row({ stop_level: 97, monitor_atr: 2 }), snapshot({ daily_supertrend: { direction: "SHORT", value: 99 } }));
assert.equal(levels.stop, 97);
// the line moving down by a step lowers it
levels = rt.monitorLevels(row({ stop_level: 99, monitor_atr: 2 }), snapshot({ daily_supertrend: { direction: "SHORT", value: 96 } }));
assert.equal(levels.stop, 96); assert.ok(levels.events.some(event => event.kind === "LINE_RAISED"));
// the lowest price since entry is tracked, not the highest
levels = rt.monitorLevels(row({ stop_level: 99, monitor_atr: 2, peak_high: 94 }), snapshot({ price: 97, recent_daily: [bar("2026-01-05", 93, 98, 96)] }));
assert.equal(levels.peak, 93);
// daily trend turning up is the cover signal
ev = rt.evaluateHolding(row(), snapshot({ price: 101, daily_supertrend: { direction: "LONG", value: 98 } }), rt.monitorLevels(row(), snapshot({ price: 101, daily_supertrend: { direction: "LONG", value: 98 } })));
assert.equal(ev.action, "EXIT"); assert.ok(ev.pnl_value < 0);
// a LEVELS short covers when a bar's high goes over the stop, and takes profit at target 1
const lv = row({ exit_mode: "LEVELS", stop_level: 104, target_1: 96, target_2: 92, monitor_atr: 2 });
ev = rt.evaluateHolding(lv, snapshot({ price: 101, recent_daily: [bar("2026-01-05", 99, 104.5, 101)] }), rt.monitorLevels(lv, snapshot({ price: 101 })));
assert.equal(ev.action, "EXIT");
ev = rt.evaluateHolding(lv, snapshot({ price: 95.5, recent_daily: [bar("2026-01-05", 95.5, 100.5, 96)] }), rt.monitorLevels(lv, snapshot({ price: 95.5 })));
assert.equal(ev.action, "TAKE_PROFIT");

// realised profit and loss
assert.equal(rt.tradePnl({ direction: "SHORT", buy_price: 100 }, 90, 10), 100); assert.ok(Math.abs(rt.tradePct({ direction: "SHORT", buy_price: 100 }, 90) - 10) < 1e-9);
assert.equal(rt.tradePnl({ direction: "LONG", buy_price: 100 }, 90, 10), -100); assert.equal(rt.tradePnl({ buy_price: 100 }, 110, 10), 100);

// a long is unchanged
const long = row({ direction: "LONG" });
ev = rt.evaluateHolding(long, snapshot({ price: 105, daily_supertrend: { direction: "LONG", value: 98 }, supertrend: { direction: "LONG", value: 99 } }), rt.monitorLevels(long, snapshot({ price: 105, daily_supertrend: { direction: "LONG", value: 98 } })));
assert.equal(ev.direction, "LONG"); assert.equal(ev.pnl_value, 50); assert.equal(ev.action, "TAKE_PROFIT");
console.log("short position checks passed");
