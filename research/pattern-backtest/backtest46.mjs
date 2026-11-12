// TradingView article "Swing Trading: The Perfect Strategy for Busy Traders" (BNBUSD) - research only.
// The article has no exact rules or code, so its four codeable daily strategies are rebuilt with the usual textbook settings:
//  A pullback: uptrend (close>200MA, 50MA>200MA), low touches within 1% of the 50MA, bullish candle (close>open, close>prior close)
//  B golden cross: 50MA crosses over 200MA, exit on the death cross
//  C breakout: close over the 20-day high on volume >=1.5x the 20-day average, in an uptrend
// Exits for A and C: stop 2.5 ATR below entry, target 2R (the article's 1:2 minimum), 40-day limit. Entry at next open, 0.1% cost per side.
// Each trade is compared with random uptrend stocks bought the same day with the same stop/target distances (5 per trade).
// Point-in-time S&P 500 membership, 20 years.  node --max-old-space-size=8000 backtest46.mjs
import { raw, prep, memberAt, mean } from "./lib41.mjs";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
const COST = 0.001, H = 40, f2 = (x, p = 2) => Number.isFinite(x) ? x.toFixed(p) : "n/a";
const sdv = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = a => a.length > 2 ? mean(a) / (sdv(a) / Math.sqrt(a.length)) : NaN;
let seed = 4242; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
function sma(a, p) { const out = new Array(a.length).fill(NaN); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= p) s -= a[i - p]; if (i >= p - 1) out[i] = s / p; } return out; }
function ready(rows, sym) { const S = prep(rows); S.sym = sym; S.hi20 = new Array(S.n).fill(NaN); for (let i = 20; i < S.n; i++) { let m = -Infinity; for (let k = i - 20; k < i; k++) m = Math.max(m, S.h[k]); S.hi20[i] = m; } return S; }
// stop/target trade: returns % return
function runST(S, t, stopAtr, R) { const f = t + 1, en = S.o[f], a = S.atr14[t]; if (!(a > 0) || f >= S.n) return null; const risk = stopAtr * a, stop = en - risk, tgt = en + R * risk; if (stop <= 0) return null;
  for (let k = f; k < Math.min(S.n, f + H); k++) { if (k > f && S.o[k] <= stop) return (S.o[k] / en - 1) * 100 - 2 * COST * 100; if (S.l[k] <= stop) return (stop / en - 1) * 100 - 2 * COST * 100; if (S.h[k] >= tgt) return (R * risk / en) * 100 - 2 * COST * 100; }
  return (S.c[Math.min(S.n - 1, f + H - 1)] / en - 1) * 100 - 2 * COST * 100; }
function runCross(S, t) { const f = t + 1, en = S.o[f]; for (let k = f + 1; k < Math.min(S.n, f + 750); k++) if (S.s50[k] < S.s200[k]) return { r: (S.o[Math.min(S.n - 1, k + 1)] / en - 1) * 100 - 2 * COST * 100, days: k - f }; return null; }

const list = []; for (const [sym, rows] of Object.entries(raw)) { if (sym === "SPY" || sym === "QQQ" || rows.length < 400) continue; const S = ready(rows, sym); S.s50 = sma(S.c, 50); S.s200 = sma(S.c, 200); list.push(S); }
const pool = new Map(); for (const S of list) for (let t = 210; t < S.n - H - 2; t++) if (S.c[t] > S.s200[t] && memberAt(S.sym, S.d[t])) (pool.get(S.d[t]) || pool.set(S.d[t], []).get(S.d[t])).push([S, t]);
const sigs = { A: [], B: [], C: [] };
for (const S of list) for (let t = 210; t < S.n - H - 2; t++) { if (!memberAt(S.sym, S.d[t])) continue; const up = S.c[t] > S.s200[t] && S.s50[t] > S.s200[t];
  if (up && S.l[t] <= S.s50[t] * 1.01 && S.c[t] > S.s50[t] && S.c[t] > S.o[t] && S.c[t] > S.c[t - 1]) sigs.A.push([S, t]);
  if (S.s50[t] > S.s200[t] && S.s50[t - 1] <= S.s200[t - 1]) sigs.B.push([S, t]);
  const v20 = S.vol20 ? S.vol20[t] : NaN; let vm = 0; for (let k = t - 20; k < t; k++) vm += S.v[k]; vm /= 20; if (up && S.c[t] > S.hi20[t] && S.v[t] >= 1.5 * vm) sigs.C.push([S, t]); }
function perDay(per) { const m = new Map(); for (const [d, v] of per) { let p = m.get(d); if (!p) m.set(d, p = [0, 0]); p[0] += v; p[1]++; } return [...m.values()].map(p => p[0] / p[1]); }
function report(name, list, fn) { const r = [], per = [], half = [[], []]; for (const [S, t] of list) { const v = fn(S, t); if (v == null) continue; r.push(v); const p = pool.get(S.d[t]) || [], cs = [];
    for (let q = 0; q < 5 && p.length; q++) { const [S2, t2] = p[Math.floor(rnd() * p.length)]; const x = fn(S2, t2); if (x != null) cs.push(x); }
    if (cs.length) { per.push([S.d[t], v - mean(cs)]); half[S.d[t] < "2016-01-01" ? 0 : 1].push([S.d[t], v - mean(cs)]); } }
  const dd = perDay(per), h0 = perDay(half[0]), h1 = perDay(half[1]);
  console.log(`  ${name}: ${r.length} trades, win ${f2(r.filter(x => x > 0).length / r.length * 100, 1)}%, avg ${f2(mean(r), 3)}% | vs random uptrend stocks ${f2(mean(dd), 3)}% (t ${f2(tstat(dd), 1)}) | 2005-15 ${f2(mean(h0), 3)}%, 2016-26 ${f2(mean(h1), 3)}%`); }
console.log("== S&P 500 point-in-time, daily ==");
for (const [k, nm] of [["A", "A pullback to the 50MA"], ["C", "C volume breakout"]]) for (const [sa, R] of [[2.5, 2], [2.5, 3]]) report(`${nm}, stop ${sa} ATR, target ${R}R`, sigs[k], (S, t) => runST(S, t, sa, R));
{ const r = [], days = []; for (const [S, t] of sigs.B) { const x = runCross(S, t); if (x) { r.push(x.r); days.push(x.days); } } console.log(`  B golden cross to death cross: ${r.length} trades, win ${f2(r.filter(x => x > 0).length / r.length * 100, 1)}%, avg ${f2(mean(r), 2)}% per trade over ${f2(mean(days), 0)} days (about ${f2(mean(r) / mean(days) * 252, 1)}% a year while held)`); }
// SPY buy and hold for reference
{ const S = prep(raw.SPY), n = S.n; console.log(`  reference SPY buy and hold ${S.d[0]} to ${S.d[n - 1]}: ${f2(((S.c[n - 1] / S.c[0]) ** (252 / n) - 1) * 100, 1)}% a year`); }

// ---- BNB-USD itself (the article's chart), daily from Yahoo ----
const bf = "bnb.json"; if (!existsSync(bf)) { const j = await (await fetch("https://query1.finance.yahoo.com/v8/finance/chart/BNB-USD?period1=1500000000&period2=1794000000&interval=1d", { headers: { "User-Agent": "Mozilla/5.0" } })).json(); const q = j.chart.result[0], ts = q.timestamp, x = q.indicators.quote[0];
  writeFileSync(bf, JSON.stringify(ts.map((t, i) => [new Date(t * 1000).toISOString().slice(0, 10), x.open[i], x.high[i], x.low[i], x.close[i], x.volume[i]]).filter(r => r[4] != null && r[1] != null))); }
const B = ready(JSON.parse(readFileSync(bf, "utf8")), "BNB"); B.s50 = sma(B.c, 50); B.s200 = sma(B.c, 200);
console.log(`\n== BNB-USD daily, ${B.d[0]} to ${B.d[B.n - 1]} (${B.n} bars), cost 0.1% per side ==`);
const bs = { A: [], C: [] }, bx = []; for (let t = 210; t < B.n - H - 2; t++) { const up = B.c[t] > B.s200[t] && B.s50[t] > B.s200[t]; let vm = 0; for (let k = t - 20; k < t; k++) vm += B.v[k]; vm /= 20;
  if (up && B.l[t] <= B.s50[t] * 1.01 && B.c[t] > B.s50[t] && B.c[t] > B.o[t] && B.c[t] > B.c[t - 1]) bs.A.push(t); if (up && B.c[t] > B.hi20[t] && B.v[t] >= 1.5 * vm) bs.C.push(t); if (B.s50[t] > B.s200[t] && B.s50[t - 1] <= B.s200[t - 1]) bx.push(t); }
const allUp = []; for (let t = 210; t < B.n - H - 2; t++) if (B.c[t] > B.s200[t]) allUp.push(t);
for (const [k, nm] of [["A", "A pullback"], ["C", "C breakout"]]) for (const [sa, R] of [[2.5, 2], [2.5, 3]]) { const r = bs[k].map(t => runST(B, t, sa, R)).filter(x => x != null), c = allUp.map(t => runST(B, t, sa, R)).filter(x => x != null);
  console.log(`  ${nm}, stop ${sa} ATR, target ${R}R: ${r.length} trades, win ${f2(r.filter(x => x > 0).length / r.length * 100, 1)}%, avg ${f2(mean(r), 2)}% | any day above the 200MA: avg ${f2(mean(c), 2)}% (${c.length} days)`); }
for (const t of bx) { const x = runCross(B, t); console.log(`  B golden cross ${B.d[t]}: ${x ? f2(x.r, 1) + "% over " + x.days + " days" : "still open"}`); }
{ let open = null; const xs = []; for (let t = 210; t < B.n - 1; t++) { if (open === null && B.s50[t] > B.s200[t] && B.s50[t - 1] <= B.s200[t - 1]) open = B.o[t + 1]; if (open !== null && B.s50[t] < B.s200[t]) { xs.push(B.o[t + 1] / open - 1); open = null; } } console.log(`  (BNB buy and hold since ${B.d[0]}: ${f2((B.c[B.n - 1] / B.c[0] - 1) * 100, 0)}%)`); }
