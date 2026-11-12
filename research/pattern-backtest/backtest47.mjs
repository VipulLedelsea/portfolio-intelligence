// Does the Lorentzian Classification reading predict anything on our data? Runs the shipped port (worker/lorentzian.js, the
// indicator's own logic and default settings) for every point-in-time S&P 500 member since 2006, on every 20th trading day, on the
// previous 250 daily bars only (what the worker has: one year), then compares its prediction (-8 to +8) with what the stock did
// over the next 4 and 10 days (close to close, no costs).
// Run: node --max-old-space-size=6000 backtest47.mjs > backtest47.out
import { readFileSync } from "node:fs";

const lorentzianClassification = new Function(readFileSync(new URL("../../worker/lorentzian.js", import.meta.url), "utf8") + "\nreturn lorentzianClassification;")();
const raw = { ...JSON.parse(readFileSync("bars_former.json", "utf8")), ...JSON.parse(readFileSync("bars_long.json", "utf8")) };
const intervals = new Map();
for (const line of readFileSync("members.csv", "utf8").trim().split("\n").slice(1)) {
  const [sym, a, b] = line.split(",");
  if (!intervals.has(sym)) intervals.set(sym, []);
  intervals.get(sym).push([a, b || "9999-12-31"]);
}
const memberAt = (sym, date) => (intervals.get(sym) || []).some(([a, b]) => date >= a && date <= b);

const WINDOW = 250, STEP = 20;
const obs = [];
let offset = 0;
for (const [sym, bars] of Object.entries(raw)) {
  if (sym === "SPY" || sym === "QQQ" || !intervals.has(sym) || !Array.isArray(bars) || bars.length < WINDOW + 20) continue;
  const rows = bars.map(b => ({ date: b[0], open: b[1], high: b[2], low: b[3], close: b[4] })).filter(r => r.close > 0 && r.high >= r.low);
  // Stagger the start per stock so every trading day is sampled across the universe.
  for (let t = WINDOW - 1 + (offset++ % STEP); t + 10 < rows.length; t += STEP) {
    const date = rows[t].date;
    if (date < "2006-01-01" || !memberAt(sym, date)) continue;
    const s = lorentzianClassification(rows.slice(t - WINDOW + 1, t + 1));
    if (!s) continue;
    obs.push({ date, p: s.prediction, signal: s.signal, pass: s.filters_pass, r4: rows[t + 4].close / rows[t].close - 1, r10: rows[t + 10].close / rows[t].close - 1 });
  }
}

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2)) * a.length / (a.length - 1)); };
const pct = (x, d = 2) => Number.isFinite(x) ? (x * 100).toFixed(d) + "%" : "n/a";
console.log(`Observations: ${obs.length.toLocaleString()} stock-days (every ${STEP}th trading day per stock, 2006 on, index members at the time)`);
console.log(`All: next 4 days ${pct(mean(obs.map(o => o.r4)))} mean, ${pct(mean(obs.map(o => o.r4 > 0 ? 1 : 0)), 1)} rose; next 10 days ${pct(mean(obs.map(o => o.r10)))} mean\n`);
console.log("Prediction | stock-days | next 4d mean | next 4d rose | next 10d mean");
for (const [name, pick] of [["-8 to -5", o => o.p <= -5], ["-4 to -1", o => o.p < 0 && o.p > -5], ["0", o => o.p === 0], ["+1 to +4", o => o.p > 0 && o.p < 5], ["+5 to +8", o => o.p >= 5]]) {
  const g = obs.filter(pick);
  console.log(`${name.padEnd(9)} | ${g.length.toLocaleString().padStart(9)} | ${pct(mean(g.map(o => o.r4))).padStart(7)} | ${pct(mean(g.map(o => o.r4 > 0 ? 1 : 0)), 1).padStart(6)} | ${pct(mean(g.map(o => o.r10))).padStart(7)}`);
}

// Same-day comparison removes market drift: on each date, the mean of a group less the mean of every stock sampled that day.
const byDate = new Map();
for (const o of obs) { if (!byDate.has(o.date)) byDate.set(o.date, []); byDate.get(o.date).push(o); }
const test = (name, pick, key, from = "0000", to = "9999") => {
  const gaps = [];
  for (const [date, list] of byDate) {
    if (date < from || date >= to) continue;
    const g = list.filter(pick);
    if (g.length >= 2 && list.length >= 10) gaps.push(mean(g.map(o => o[key])) - mean(list.map(o => o[key])));
  }
  const t = mean(gaps) / (sd(gaps) / Math.sqrt(gaps.length));
  console.log(`${name.padEnd(34)} ${key}: ${pct(mean(gaps), 3).padStart(8)} vs same-day average, t ${t.toFixed(2)}, ${gaps.length} dates`);
};
console.log("");
for (const key of ["r4", "r10"]) {
  test("Prediction above 0 (leans long)", o => o.p > 0, key);
  test("Prediction below 0 (leans short)", o => o.p < 0, key);
  test("Prediction +5 or more", o => o.p >= 5, key);
  test("Prediction -5 or less", o => o.p <= -5, key);
  test("Signal long (filters applied)", o => o.signal === 1, key);
  test("Signal short (filters applied)", o => o.signal === -1, key);
  test("Leans long, 2006 to 2015", o => o.p > 0, key, "2006", "2016");
  test("Leans long, 2016 on", o => o.p > 0, key, "2016");
  test("Leans short, 2006 to 2015", o => o.p < 0, key, "2006", "2016");
  test("Leans short, 2016 on", o => o.p < 0, key, "2016");
}
