// Checks the IBD-style market outlook (marketOutlook): state and invested range on real SPY / QQQ history at known turning points, and on constructed
// follow-through, distribution and failure sequences. Uses the 20-year bars kept for the backtest.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const source = readFileSync(fileURLToPath(new URL("../worker/runtime.js", import.meta.url)), "utf8").replace(/^export default \{/m, "const __default = {");
const rt = await import("data:text/javascript;base64," + Buffer.from(`${source}\nexport { marketOutlook };`).toString("base64"));
const raw = JSON.parse(readFileSync(fileURLToPath(new URL("../research/pattern-backtest/bars_long.json", import.meta.url)), "utf8"));
const bars = rows => rows.map(r => ({ date: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
const at = end => { const cut = rows => bars(rows.filter(r => r[0] <= end).slice(-260)); return rt.marketOutlook(cut(raw.SPY), cut(raw.QQQ)); };

// bands are always 20 points wide, inside 0-100, and the state says which ladder rung
for (const end of ["2008-10-10", "2009-03-09", "2012-06-29", "2017-06-30", "2018-12-24", "2020-03-20", "2020-06-30", "2022-06-16", "2024-12-31", "2026-11-06"]) {
  const o = at(end); assert.ok(o, end);
  assert.equal(o.exposure_max_pct - o.exposure_min_pct, 20); assert.ok(o.exposure_min_pct >= 0 && o.exposure_max_pct <= 100);
  assert.ok(["UP", "PRESS", "CORR"].includes(o.state)); assert.equal(o.state === "CORR", o.exposure_max_pct === 20);
  console.log(end, o.state, `${o.exposure_min_pct}-${o.exposure_max_pct}%`, "dist", o.distribution_days, "FTD", o.follow_through_date, "attempt day", o.rally_attempt_day);
}
// the middle of the 2008 collapse and the 2022 bear low are corrections; a calm 2017 and mid-2020 recovery are not
assert.equal(at("2008-10-10").state, "CORR"); assert.equal(at("2022-06-16").state, "CORR"); assert.equal(at("2020-03-20").state, "CORR");
assert.notEqual(at("2017-06-30").state, "CORR");
// missing or short data gives no outlook instead of a guess
assert.equal(rt.marketOutlook(null, null), null); assert.equal(rt.marketOutlook(bars(raw.SPY.slice(-30)), bars(raw.QQQ.slice(-30))), null);
assert.equal(rt.marketOutlook(bars(raw.SPY.slice(-260)).map(b => ({ ...b, volume: 0 })), bars(raw.QQQ.slice(-260))), null, "no volume, no distribution days, no outlook");

// constructed: a long calm uptrend, with 5 heavy-volume down days in the last 10 sessions, reads under pressure and its band drops
const flat = (n, start) => Array.from({ length: n }, (_, i) => { const c = start * 1.0007 ** i; return { date: new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10), open: c, high: c * 1.003, low: c * 0.997, close: c, volume: 1e6 + (i % 2) * 1e5 }; });
const calm = flat(200, 100), calmQ = flat(200, 200);
const calmOut = rt.marketOutlook(calm, calmQ); assert.equal(calmOut.state, "UP"); assert.equal(calmOut.exposure_max_pct, 100);
const selloff = list => list.map((b, i) => i >= 190 && i % 2 === 0 ? { ...b, close: b.close * 0.99, low: b.low * 0.985, volume: b.volume * 1.5 } : b);
const hit = rt.marketOutlook(selloff(calm), selloff(calmQ));
assert.ok(hit.distribution_days >= 4, "heavy down days are counted"); assert.ok(hit.exposure_max_pct <= 80, "the band drops once selling shows up");
console.log("constructed calm uptrend:", calmOut.state, calmOut.headline, "| after 5 heavy down days:", hit.state, hit.headline, "dist", hit.distribution_days);
console.log("outlook checks passed");
