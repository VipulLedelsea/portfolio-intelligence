// Candlestick patterns with context (research only). Same data, point-in-time membership and 0.1% per side cost as backtest6-8.
// Run: node backtest9.mjs
// Patterns are read at the close of day t, entry is the next open. Long: bullish engulfing, hammer, morning star, three white soldiers.
// Short: bearish engulfing, shooting star, evening star, three black crows. Each is tested in three settings:
//   ALONE: the pattern anywhere (no filter).
//   BRK:   breakout / breakdown context. Long: close over the prior 20-day high, volume 1.4x the 50-day average, close over the 200-day average.
//          Short: the mirror image.
//   PB:    pullback / bounce context. Long: close over the 200-day average and down 4% or more in 5 days (a bounce candle after a dip).
//          Short: the mirror image.
// Controls: the same setting with NO pattern requirement (CONTEXT-ONLY), and any stock-day (BASELINE). A pattern only counts if it beats the
// context-only control, because that control is what killed the bull flag in round 2.
import { readFileSync } from "node:fs";
const current = JSON.parse(readFileSync("bars.json", "utf8"));
const former = JSON.parse(readFileSync("bars_former.json", "utf8"));
const raw = { ...former, ...current };
const intervals = new Map();
for (const l of readFileSync("members.csv", "utf8").trim().split("\n").slice(1)) { const [t, a, b] = l.split(","); (intervals.get(t) || intervals.set(t, []).get(t)).push([a, b || "9999-12-31"]); }
const memberAt = (sym, date) => (intervals.get(sym) || []).some(([a, b]) => date >= a && date <= b);
const COST = 0.001, SPLIT = "2024-11-05", WARM = 260;
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const f2 = (x, p = 2) => Number.isFinite(x) ? x.toFixed(p) : "n/a";

function prep(rows) {
  const n = rows.length, d = [], o = [], h = [], l = [], c = [], v = [];
  for (const r of rows) { d.push(r[0]); o.push(r[1]); h.push(r[2]); l.push(r[3]); c.push(r[4]); v.push(r[5]); }
  const tr = h.map((x, i) => i ? Math.max(x - l[i], Math.abs(x - c[i - 1]), Math.abs(l[i] - c[i - 1])) : x - l[i]);
  const atr14 = tr.map((_, i) => i >= 13 ? mean(tr.slice(i - 13, i + 1)) : NaN);
  const csum = [0]; for (const x of c) csum.push(csum[csum.length - 1] + x);
  const vsum = [0]; for (const x of v) vsum.push(vsum[vsum.length - 1] + x);
  const sma = (i, p) => i + 1 >= p ? (csum[i + 1] - csum[i + 1 - p]) / p : NaN;
  const vavg = (i, p) => i >= p ? (vsum[i] - vsum[i - p]) / p : NaN; // prior p days, excluding day i
  const bad = c.map((x, i) => i && Math.abs(x / c[i - 1] - 1) > 0.35 ? 1 : 0);
  const badSum = [0]; for (const x of bad) badSum.push(badSum[badSum.length - 1] + x);
  const hasBad = (a, b) => badSum[Math.min(n, b + 1)] - badSum[Math.max(0, a)] > 0;
  const dateIdx = new Map(d.map((x, i) => [x, i]));
  return { n, d, o, h, l, c, v, atr14, sma, vavg, hasBad, dateIdx };
}

// ---- candle helpers ----
const body = (S, i) => Math.abs(S.c[i] - S.o[i]);
const green = (S, i) => S.c[i] > S.o[i], red = (S, i) => S.c[i] < S.o[i];
const upper = (S, i) => S.h[i] - Math.max(S.o[i], S.c[i]), lower = (S, i) => Math.min(S.o[i], S.c[i]) - S.l[i];

const LONG = {
  "Bullish engulfing": (S, t, A) => red(S, t - 1) && green(S, t) && S.o[t] <= S.c[t - 1] && S.c[t] >= S.o[t - 1] && body(S, t) > body(S, t - 1) && body(S, t) >= 0.5 * A,
  "Hammer": (S, t, A) => S.h[t] - S.l[t] >= 0.8 * A && lower(S, t) >= 2 * body(S, t) && upper(S, t) <= 0.3 * Math.max(body(S, t), 1e-9) + 0.05 * (S.h[t] - S.l[t]) && body(S, t) > 0,
  "Morning star": (S, t, A) => red(S, t - 2) && body(S, t - 2) >= 0.6 * A && body(S, t - 1) <= 0.3 * body(S, t - 2) && Math.max(S.o[t - 1], S.c[t - 1]) < S.c[t - 2] && green(S, t) && S.c[t] > (S.o[t - 2] + S.c[t - 2]) / 2,
  "Three white soldiers": (S, t, A) => [t - 2, t - 1, t].every(i => green(S, i) && body(S, i) >= 0.5 * A && upper(S, i) <= 0.3 * body(S, i)) && S.c[t - 1] > S.c[t - 2] && S.c[t] > S.c[t - 1] && S.o[t - 1] > S.o[t - 2] && S.o[t - 1] < S.c[t - 2] && S.o[t] > S.o[t - 1] && S.o[t] < S.c[t - 1],
};
const SHORT = {
  "Bearish engulfing": (S, t, A) => green(S, t - 1) && red(S, t) && S.o[t] >= S.c[t - 1] && S.c[t] <= S.o[t - 1] && body(S, t) > body(S, t - 1) && body(S, t) >= 0.5 * A,
  "Shooting star": (S, t, A) => S.h[t] - S.l[t] >= 0.8 * A && upper(S, t) >= 2 * body(S, t) && lower(S, t) <= 0.3 * Math.max(body(S, t), 1e-9) + 0.05 * (S.h[t] - S.l[t]) && body(S, t) > 0,
  "Evening star": (S, t, A) => green(S, t - 2) && body(S, t - 2) >= 0.6 * A && body(S, t - 1) <= 0.3 * body(S, t - 2) && Math.min(S.o[t - 1], S.c[t - 1]) > S.c[t - 2] && red(S, t) && S.c[t] < (S.o[t - 2] + S.c[t - 2]) / 2,
  "Three black crows": (S, t, A) => [t - 2, t - 1, t].every(i => red(S, i) && body(S, i) >= 0.5 * A && lower(S, i) <= 0.3 * body(S, i)) && S.c[t - 1] < S.c[t - 2] && S.c[t] < S.c[t - 1] && S.o[t - 1] < S.o[t - 2] && S.o[t - 1] > S.c[t - 2] && S.o[t] < S.o[t - 1] && S.o[t] > S.c[t - 1],
};

function context(S, t, dir) {
  const hi20 = Math.max(...S.h.slice(t - 20, t)), lo20 = Math.min(...S.l.slice(t - 20, t));
  const volOk = S.v[t] > 1.4 * S.vavg(t, 50);
  const s200 = S.sma(t, 200), r5 = S.c[t] / S.c[t - 5] - 1;
  if (dir === "long") return { BRK: S.c[t] > hi20 && volOk && S.c[t] > s200, PB: S.c[t] > s200 && r5 <= -0.04 };
  return { BRK: S.c[t] < lo20 && volOk && S.c[t] < s200, PB: S.c[t] < s200 && r5 >= 0.04 };
}

// ---- exits: stop first when a bar touches both; gaps fill at the open ----
const EXITS = {
  "5d hold, no stop/target (raw signal)": { H: 5, T: Infinity, Sx: Infinity },
  "5d, stop 2 ATR, target 1 ATR (dip levels)": { H: 5, T: 1, Sx: 2 },
  "10d, stop 2 ATR, target 2 ATR": { H: 10, T: 2, Sx: 2 },
};
function trade(S, t, dir, X) {
  const e = t + 1, last = e + X.H - 1; if (last >= S.n) return null;
  if (S.hasBad(t - 252, last)) return null;
  const entry = S.o[e], atr = S.atr14[t]; if (!(entry > 0) || !(atr > 0)) return null;
  const sgn = dir === "long" ? 1 : -1;
  const stop = entry - sgn * X.Sx * atr, tp = entry + sgn * X.T * atr;
  const hitStop = (px) => sgn * (px - stop) <= 0, hitTp = (px) => sgn * (px - tp) >= 0;
  let exit = S.c[last];
  for (let k = e; k <= last; k++) {
    if (X.Sx !== Infinity) {
      if (k > e && hitStop(S.o[k])) { exit = S.o[k]; break; }
      if (hitStop(sgn > 0 ? S.l[k] : S.h[k])) { exit = stop; break; }
    }
    if (X.T !== Infinity) {
      if (k > e && hitTp(S.o[k])) { exit = S.o[k]; break; }
      if (hitTp(sgn > 0 ? S.h[k] : S.l[k])) { exit = tp; break; }
    }
  }
  return { ret: (sgn * (exit / entry - 1) - 2 * COST) * 100, date: S.d[e] };
}

const data = new Map();
for (const sym of Object.keys(raw).filter(s => s !== "SPY")) { const rows = raw[sym]; if (rows.length < 300 || rows.some(r => !(r[4] > 0))) continue; data.set(sym, prep(rows)); }

// results[exit][key] = trades; key = "dir|name|setting"
const results = {}; for (const x of Object.keys(EXITS)) results[x] = {};
const add = (x, key, r) => (results[x][key] || (results[x][key] = [])).push(r);
for (const [sym, S] of data) {
  const free = {}; // per key, the day index until which a trade for this stock is still open
  for (let t = WARM; t < S.n - 11; t++) {
    if (!memberAt(sym, S.d[t])) continue;
    const A = S.atr14[t]; if (!(A > 0)) continue;
    const fire = []; // keys that fire today
    if (t % 3 === 0) { fire.push("long|BASELINE|ALONE", "short|BASELINE|ALONE"); }
    for (const [dir, PATS] of [["long", LONG], ["short", SHORT]]) {
      const ctx = context(S, t, dir);
      const hits = Object.entries(PATS).filter(([, f]) => f(S, t, A)).map(([name]) => name);
      for (const setting of ["BRK", "PB"]) if (ctx[setting]) fire.push(`${dir}|CONTEXT-ONLY|${setting}`);
      for (const name of hits) {
        fire.push(`${dir}|${name}|ALONE`, `${dir}|ANY ${dir === "long" ? "bullish" : "bearish"} pattern|ALONE`);
        for (const setting of ["BRK", "PB"]) if (ctx[setting]) fire.push(`${dir}|${name}|${setting}`, `${dir}|ANY ${dir === "long" ? "bullish" : "bearish"} pattern|${setting}`);
      }
    }
    for (const key of new Set(fire)) {
      if (!key.includes("BASELINE") && t <= (free[key] ?? -1)) continue;
      const dir = key.split("|")[0]; let any = false;
      for (const [x, X] of Object.entries(EXITS)) { const r = trade(S, t, dir, X); if (r) { add(x, key, r); any = true; } }
      if (any && !key.includes("BASELINE")) free[key] = t + 10;
    }
  }
}

// Paired comparison by calendar week: mean over weeks of (pattern weekly mean - control weekly mean), t on the weeks they share.
const week = d => Math.floor(Date.parse(d) / 6048e5);
function weekly(tr) { const m = new Map(); for (const r of tr) { const w = week(r.date); (m.get(w) || m.set(w, []).get(w)).push(r.ret); } return new Map([...m].map(([w, a]) => [w, mean(a)])); }
function paired(tr, ctl) {
  const a = weekly(tr), b = weekly(ctl), diffs = [];
  for (const [w, x] of a) if (b.has(w)) diffs.push(x - b.get(w));
  return { t: diffs.length > 3 ? mean(diffs) / (sd(diffs) / Math.sqrt(diffs.length)) : NaN, weeks: diffs.length, edge: mean(diffs) };
}
for (const [x] of Object.entries(EXITS)) {
  console.log(`\n################ ${x} ################`);
  console.log("setting / pattern".padEnd(46) + "n".padStart(7) + "mean%".padStart(8) + "win%".padStart(7) + "1stH".padStart(8) + "2ndH".padStart(8) + "  vs context-only: edge% (paired weekly t)");
  for (const dir of ["long", "short"]) {
    const base = results[x][`${dir}|BASELINE|ALONE`] || [];
    console.log(`\n-- ${dir.toUpperCase()}   baseline (any stock-day): ${f2(mean(base.map(r => r.ret)))}% per trade, n=${base.length}`);
    for (const setting of ["ALONE", "BRK", "PB"]) {
      const ctl = setting === "ALONE" ? base : (results[x][`${dir}|CONTEXT-ONLY|${setting}`] || []);
      const keys = Object.keys(results[x]).filter(k => k.startsWith(dir + "|") && k.endsWith("|" + setting) && !k.includes("BASELINE")).sort((a, b) => (a.includes("CONTEXT") ? -1 : b.includes("CONTEXT") ? 1 : a.localeCompare(b)));
      for (const k of keys) {
        const tr = results[x][k], rets = tr.map(r => r.ret), name = k.split("|")[1];
        const h1 = tr.filter(r => r.date < SPLIT).map(r => r.ret), h2 = tr.filter(r => r.date >= SPLIT).map(r => r.ret);
        const p = name === "CONTEXT-ONLY" ? null : paired(tr, ctl);
        console.log(`${setting.padEnd(6)}${name.padEnd(40)}${String(tr.length).padStart(7)}${f2(mean(rets)).padStart(8)}${f2(rets.filter(r => r > 0).length / rets.length * 100, 0).padStart(7)}${f2(mean(h1)).padStart(8)}${f2(mean(h2)).padStart(8)}` + (p ? `   ${p.edge >= 0 ? "+" : ""}${f2(p.edge)}% (t ${f2(p.t, 1)}, ${p.weeks} wks)` : "   (control)"));
      }
    }
  }
}
