// Does an earnings report inside the holding window hurt? Same data and 0.1% per side cost as backtest6-10. Research only.
// Earnings dates come from Robinhood (fetch_earnings.mjs), which only holds about the last five quarters and starts at a different date for each stock
// (median 2025-04-30). A stock is only tested from its own first listed report onward, so no earlier report is missing from its record.
// Entry at the next open after the signal close, exit at the close of day H. A trade is "flagged" when the market reaction to a report falls inside the
// hold: the report day for before-open ("am") reports, the next session for after-close ("pm") ones.
// Run: node backtest11.mjs
import { readFileSync } from "node:fs";
const raw = { ...JSON.parse(readFileSync("bars_former.json", "utf8")), ...JSON.parse(readFileSync("bars.json", "utf8")) };
const earn = JSON.parse(readFileSync("earnings.json", "utf8"));
const COST = 0.001, FROM = "2025-03-12";
const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1), sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const pct = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(p * (b.length - 1))]; };
function prep(rows) {
  const d = rows.map(r => r[0]), o = rows.map(r => r[1]), c = rows.map(r => r[4]), n = rows.length;
  const rsi2 = new Array(n).fill(NaN); let ag = 0, al = 0;
  for (let i = 1; i < n; i++) { const ch = c[i] - c[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= 2) { ag += g / 2; al += l / 2; } else { ag = (ag + g) / 2; al = (al + l) / 2; }
    if (i >= 2) rsi2[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
  const cs = [0]; for (const x of c) cs.push(cs.at(-1) + x);
  const sma = (i, p) => i + 1 >= p ? (cs[i + 1] - cs[i + 1 - p]) / p : NaN;
  return { n, d, o, c, rsi2, sma, idx: new Map(d.map((x, i) => [x, i])) };
}
const SPY = prep(raw.SPY);
const spy5 = date => { const i = SPY.idx.get(date); return i >= 5 ? SPY.c[i] / SPY.c[i - 5] - 1 : NaN; };
const rules = {
  "Dip (RSI2<10, above 200d)": (S, t) => S.c[t] > S.sma(t, 200) && S.rsi2[t] < 10,
  "Sharp dip (RSI2<5, -5% in 3d)": (S, t) => S.c[t] > S.sma(t, 200) && S.rsi2[t] < 5 && S.c[t] < S.sma(t, 5) && S.c[t] / S.c[t - 3] - 1 < -0.05,
  "Any stock-day (control)": (S, t) => t % 3 === 0,
};
function bootDiff(rows, iters = 3000) { // date-clustered bootstrap of (flagged mean - clear mean)
  const byDate = new Map(); for (const r of rows) (byDate.get(r.date) || byDate.set(r.date, []).get(r.date)).push(r);
  const dates = [...byDate.keys()], diffs = []; let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let k = 0; k < iters; k++) { const f = [], u = []; for (let j = 0; j < dates.length; j++) for (const r of byDate.get(dates[Math.floor(rnd() * dates.length)])) (r.flag ? f : u).push(r.ret); if (f.length && u.length) diffs.push(mean(f) - mean(u)); }
  diffs.sort((a, b) => a - b); return [diffs[Math.floor(0.025 * diffs.length)], diffs[Math.floor(0.975 * diffs.length)]];
}
const show = (label, a) => `${label.padEnd(9)} n=${String(a.length).padStart(6)}  mean ${(mean(a) * 100).toFixed(2).padStart(6)}%  win ${(a.filter(x => x > 0).length / (a.length || 1) * 100).toFixed(0)}%  sd ${(sd(a) * 100).toFixed(2)}%  worst5% ${(pct(a, 0.05) * 100).toFixed(1)}%`;
for (const H of [5, 10]) {
  console.log(`\n=== Hold ${H} days ===`);
  for (const [name, rule] of Object.entries(rules)) for (const gate of [false, true]) {
    if (name.startsWith("Any") && gate) continue;
    const rows = [];
    for (const [sym, bars] of Object.entries(raw)) {
      if (sym === "SPY" || !earn[sym]) continue;
      const S = prep(bars), react = new Set();
      for (const [e, timing] of earn[sym]) { let i = S.idx.get(e); if (i === undefined) { i = S.d.findIndex(x => x >= e); if (i < 0) continue; } react.add(timing === "pm" ? i + 1 : i); }
      let nextFree = 0; const firstReport = earn[sym][0][0];
      for (let t = 260; t + H + 1 < S.n; t++) {
        if (S.d[t] < FROM || S.d[t] < firstReport || t < nextFree || !rule(S, t)) continue;
        if (gate && !(spy5(S.d[t]) <= -0.015)) continue;
        const ret = S.c[t + 1 + H - 1] / S.o[t + 1] - 1 - 2 * COST; nextFree = t + H + 1;
        let flag = false; for (let k = t + 1; k <= t + H; k++) if (react.has(k)) flag = true;
        rows.push({ date: S.d[t], ret, flag });
      }
    }
    const f = rows.filter(r => r.flag).map(r => r.ret), u = rows.filter(r => !r.flag).map(r => r.ret);
    if (f.length < 20) { console.log(`${name}${gate ? " + SPY gate" : ""}: only ${f.length} flagged trades`); continue; }
    const [lo, hi] = bootDiff(rows);
    console.log(`\n${name}${gate ? " + SPY down 1.5% gate" : ""}`);
    console.log("  " + show("clear", u)); console.log("  " + show("earnings", f));
    console.log(`  flagged minus clear: ${((mean(f) - mean(u)) * 100).toFixed(2)}%  (date-clustered 95% interval ${(lo * 100).toFixed(2)}% to ${(hi * 100).toFixed(2)}%)`);
  }
}
