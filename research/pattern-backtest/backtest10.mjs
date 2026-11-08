// Swing setups from the web write-ups (research only). Same data, point-in-time membership and 0.1% per side cost as backtest6-9.
// Run: node backtest10.mjs
// Long side only. Signal at the close of day t, entry at the next open, one open trade per stock per rule.
//   PB20:     uptrend (20 EMA over 50 EMA, close over 50 EMA and 200-day average), 1-3 down closes, then a green bar that tested the 20 EMA and closed over it,
//             within 10% of the 20-day high.
//   CONTRACT: within 10% of the 52-week high, over the 200-day average, 6-month return beats SPY's, a tight 5-bar consolidation (range <= 2.5 ATR, at least
//             one bar under 70% of average volume), and today closes over the consolidation high.
//   EMAX:     10 EMA crosses over 20 EMA, close over a rising 50 EMA.
//   FIB382:   a 15%+ rally off a 60-day low to a high within the last 15 days, then a bar that dipped to the 38.2% retracement and closed back over it,
//             green, above the 50 EMA.
//   SPRING:   today's low breaks the prior 10-day low but it closes back over it, green, over the 200-day average (false breakdown then recovery).
// Controls: CTL = the same trend/location context without the trigger, UPTREND = 20 over 50 EMA with close over 50 EMA and 200-day average, ANY = any stock-day.
// Exits: A 5d / 2 ATR stop / 1 ATR target; B 10d / 2 ATR / 2 ATR; C structural stop (low of the setup, 1 to 4 ATR away, else skipped) with a 3R target, 20d limit;
//        D no target, 3 ATR initial stop and a 3 ATR trail under the highest close, 60d limit.
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
const ema = (arr, p) => { const k = 2 / (p + 1), out = new Array(arr.length).fill(NaN); let prev = NaN; for (let i = 0; i < arr.length; i++) { if (i === p - 1) prev = mean(arr.slice(0, p)); else if (i >= p) prev = arr[i] * k + prev * (1 - k); out[i] = i >= p - 1 ? prev : NaN; } return out; };

function prep(rows) {
  const n = rows.length, d = [], o = [], h = [], l = [], c = [], v = [];
  for (const r of rows) { d.push(r[0]); o.push(r[1]); h.push(r[2]); l.push(r[3]); c.push(r[4]); v.push(r[5]); }
  const tr = h.map((x, i) => i ? Math.max(x - l[i], Math.abs(x - c[i - 1]), Math.abs(l[i] - c[i - 1])) : x - l[i]);
  const atr14 = tr.map((_, i) => i >= 13 ? mean(tr.slice(i - 13, i + 1)) : NaN);
  const csum = [0]; for (const x of c) csum.push(csum[csum.length - 1] + x);
  const vsum = [0]; for (const x of v) vsum.push(vsum[vsum.length - 1] + x);
  const sma = (i, p) => i + 1 >= p ? (csum[i + 1] - csum[i + 1 - p]) / p : NaN;
  const vavg = (i, p) => i >= p ? (vsum[i] - vsum[i - p]) / p : NaN;
  const bad = c.map((x, i) => i && Math.abs(x / c[i - 1] - 1) > 0.35 ? 1 : 0);
  const badSum = [0]; for (const x of bad) badSum.push(badSum[badSum.length - 1] + x);
  const hasBad = (a, b) => badSum[Math.min(n, b + 1)] - badSum[Math.max(0, a)] > 0;
  return { n, d, o, h, l, c, v, atr14, sma, vavg, hasBad, e10: ema(c, 10), e20: ema(c, 20), e50: ema(c, 50), dateIdx: new Map(d.map((x, i) => [x, i])) };
}
const maxOf = (a, from, to) => { let m = -Infinity; for (let i = from; i <= to; i++) if (a[i] > m) m = a[i]; return m; };
const minOf = (a, from, to) => { let m = Infinity; for (let i = from; i <= to; i++) if (a[i] < m) m = a[i]; return m; };
const SPYS = prep(raw.SPY);

const uptrend = (S, t) => S.e20[t] > S.e50[t] && S.c[t] > S.e50[t] && S.c[t] > S.sma(t, 200);
const near52 = (S, t) => S.c[t] >= 0.9 * maxOf(S.h, t - 251, t);
const beatsSpy = (S, t) => { const j = SPYS.dateIdx.get(S.d[t]); return j !== undefined && j >= 126 && S.c[t] / S.c[t - 126] > SPYS.c[j] / SPYS.c[j - 126]; };
const pbTrig = (S, t) => {
  let down = 0; for (let k = 1; k <= 3 && S.c[t - k] < S.c[t - k - 1]; k++) down++;
  return down >= 1 && S.c[t] > S.o[t] && S.l[t] <= S.e20[t] && S.c[t] > S.e20[t] && S.c[t] >= 0.9 * maxOf(S.h, t - 19, t);
};
const consol = (S, t) => { const hi = maxOf(S.h, t - 5, t - 1), lo = minOf(S.l, t - 5, t - 1); const A = S.atr14[t - 1];
  if (!(hi - lo <= 2.5 * A)) return null; let quiet = false; for (let i = t - 5; i < t; i++) if (S.v[i] < 0.7 * S.vavg(i, 50)) quiet = true; return quiet ? { hi, lo } : null; };
const fib = (S, t) => {
  const ih0 = t - 15; let ih = -1, hv = -Infinity; for (let i = ih0; i < t; i++) if (S.h[i] > hv) { hv = S.h[i]; ih = i; }
  const lv = minOf(S.l, ih - 60, ih); if (!(hv / lv >= 1.15)) return null;
  const level = hv - 0.382 * (hv - lv); return { level, hv, lv };
};
// each setup: sig (trigger), ctl (context only), stop (structural stop level)
const stop3 = (S, t) => minOf(S.l, t - 2, t) - 0.25 * S.atr14[t];
const SETUPS = {
  "PB20: pullback to the 20 EMA": { ctl: "UPTREND", sig: (S, t) => uptrend(S, t) && pbTrig(S, t), stop: stop3 },
  "CONTRACT: tight base near 52w high": { ctl: "NEAR52", sig: (S, t) => near52(S, t) && S.c[t] > S.sma(t, 200) && beatsSpy(S, t) && (() => { const k = consol(S, t); return k && S.c[t] > k.hi; })(), stop: (S, t) => consol(S, t).lo - 0.25 * S.atr14[t] },
  "EMAX: 10/20 EMA cross over rising 50": { ctl: "UPTREND", sig: (S, t) => S.e10[t] > S.e20[t] && S.e10[t - 1] <= S.e20[t - 1] && S.c[t] > S.e50[t] && S.e50[t] > S.e50[t - 10], stop: (S, t) => minOf(S.l, t - 4, t) - 0.25 * S.atr14[t] },
  "FIB382: 38.2% retracement bounce": { ctl: "UPTREND", sig: (S, t) => { const f = fib(S, t); return f && S.l[t] <= f.level && S.c[t] > f.level && S.c[t] > S.o[t] && S.c[t] > S.e50[t]; }, stop: stop3 },
  "SPRING: false breakdown, recovery": { ctl: "ABOVE200", sig: (S, t) => { const lo = minOf(S.l, t - 10, t - 1); return S.c[t] > S.sma(t, 200) && S.l[t] < lo && S.c[t] > lo && S.c[t] > S.o[t]; }, stop: (S, t) => S.l[t] - 0.25 * S.atr14[t] },
};
const CONTROLS = {
  UPTREND: uptrend,
  NEAR52: (S, t) => near52(S, t) && S.c[t] > S.sma(t, 200) && beatsSpy(S, t),
  ABOVE200: (S, t) => S.c[t] > S.sma(t, 200),
  ANY: () => true,
};
const EXITS = {
  "A: 5d, stop 2 ATR, target 1 ATR": { H: 5, T: 1, Sx: 2 },
  "B: 10d, stop 2 ATR, target 2 ATR": { H: 10, T: 2, Sx: 2 },
  "C: structural stop (1-4 ATR), 3R target, 20d": { H: 20, struct: true, R: 3 },
  "D: 3 ATR stop + 3 ATR trail, no target, 60d": { H: 60, T: Infinity, Sx: 3, trail: 3 },
};
function trade(S, t, X, stopLevel) {
  const e = t + 1, last = e + X.H - 1; if (last >= S.n) return null;
  if (S.hasBad(t - 252, last)) return null;
  const entry = S.o[e], atr = S.atr14[t]; if (!(entry > 0) || !(atr > 0)) return null;
  let stop, tp;
  if (X.struct) { const dist = entry - stopLevel; if (!(dist >= atr) || dist > 4 * atr) return null; stop = stopLevel; tp = entry + X.R * dist; }
  else { stop = entry - X.Sx * atr; tp = entry + X.T * atr; }
  let exit = S.c[last], hi = entry;
  for (let k = e; k <= last; k++) {
    if (k > e && S.o[k] <= stop) { exit = S.o[k]; break; }
    if (S.l[k] <= stop) { exit = stop; break; }
    if (tp !== Infinity && !(tp < 0)) { if (k > e && S.o[k] >= tp) { exit = S.o[k]; break; } if (S.h[k] >= tp) { exit = tp; break; } }
    if (X.trail) { hi = Math.max(hi, S.c[k]); stop = Math.max(stop, hi - X.trail * atr); }
  }
  return { ret: (exit / entry - 1 - 2 * COST) * 100, date: S.d[e] };
}

const data = new Map();
for (const sym of Object.keys(raw).filter(s => s !== "SPY")) { const rows = raw[sym]; if (rows.length < 300 || rows.some(r => !(r[4] > 0))) continue; data.set(sym, prep(rows)); }
const results = {}; for (const x of Object.keys(EXITS)) results[x] = {};
const add = (x, key, r) => (results[x][key] || (results[x][key] = [])).push(r);
for (const [sym, S] of data) {
  const free = {};
  for (let t = WARM; t < S.n - 62; t++) {
    if (!memberAt(sym, S.d[t])) continue;
    if (!(S.atr14[t] > 0)) continue;
    const fire = []; // [key, stopLevel]
    for (const [cn, f] of Object.entries(CONTROLS)) if (t % 3 === 0 && f(S, t)) fire.push(["CTL:" + cn, stop3(S, t)]);
    for (const [name, st] of Object.entries(SETUPS)) {
      if (CONTROLS[st.ctl](S, t) && t % 3 === 1) fire.push(["CTLOF:" + name, stop3(S, t)]);
      if (st.sig(S, t)) fire.push([name, st.stop(S, t)]);
    }
    for (const [key, sl] of fire) {
      const isCtl = key.startsWith("CTL");
      if (!isCtl && t <= (free[key] ?? -1)) continue;
      let any = false;
      for (const [x, X] of Object.entries(EXITS)) { const r = trade(S, t, X, sl); if (r) { add(x, key, r); any = true; } }
      if (any && !isCtl) free[key] = t + 10;
    }
  }
}
const week = d => Math.floor(Date.parse(d) / 6048e5);
function weekly(tr) { const m = new Map(); for (const r of tr) { const w = week(r.date); (m.get(w) || m.set(w, []).get(w)).push(r.ret); } return new Map([...m].map(([w, a]) => [w, mean(a)])); }
function paired(tr, ctl) { const a = weekly(tr), b = weekly(ctl), diffs = []; for (const [w, x] of a) if (b.has(w)) diffs.push(x - b.get(w)); return { t: diffs.length > 3 ? mean(diffs) / (sd(diffs) / Math.sqrt(diffs.length)) : NaN, weeks: diffs.length, edge: mean(diffs) }; }
const fmtRow = (name, tr, ctl, ctlName) => {
  const rets = tr.map(r => r.ret), h1 = tr.filter(r => r.date < SPLIT).map(r => r.ret), h2 = tr.filter(r => r.date >= SPLIT).map(r => r.ret);
  const p = ctl ? paired(tr, ctl) : null;
  return `${name.padEnd(42)}${String(tr.length).padStart(7)}${f2(mean(rets)).padStart(8)}${f2(rets.filter(r => r > 0).length / rets.length * 100, 0).padStart(7)}${f2(mean(h1)).padStart(8)}${f2(mean(h2)).padStart(8)}` + (p ? `   ${p.edge >= 0 ? "+" : ""}${f2(p.edge)}% vs ${ctlName} (t ${f2(p.t, 1)}, ${p.weeks} wks)` : "");
};
for (const x of Object.keys(EXITS)) {
  console.log(`\n################ ${x} ################`);
  console.log("setup".padEnd(42) + "n".padStart(7) + "mean%".padStart(8) + "win%".padStart(7) + "1stH".padStart(8) + "2ndH".padStart(8));
  const R = results[x];
  for (const [cn] of Object.entries(CONTROLS)) if (R["CTL:" + cn]) console.log(fmtRow("control " + cn, R["CTL:" + cn]));
  for (const [name, st] of Object.entries(SETUPS)) {
    const tr = R[name]; if (!tr || !tr.length) { console.log(name.padEnd(42) + "  no trades"); continue; }
    console.log(fmtRow(name, tr, R["CTL:" + st.ctl], st.ctl));
    if (R["CTLOF:" + name]) console.log(fmtRow("   (own context, no trigger)", R["CTLOF:" + name]));
  }
}
