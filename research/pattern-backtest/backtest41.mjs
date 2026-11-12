// What came before 5% moves? Reverse-engineering study on 20 years of point-in-time S&P 500 daily bars (research only).
// Outcome for every stock-day: buy the next open, sell at +5%, stop at -3%, or sell at the close of day 10. 0.1% cost per side.
// Rules are found on 2006-2016 only and then checked on 2017-2026.   node --max-old-space-size=8192 backtest41.mjs
import { data, memberAt, SPY, CONDS, mean, f2, COST } from "./lib41.mjs";
const TP = +(process.argv[2] || 5), SL = +(process.argv[3] || 3), HOLD = +(process.argv[4] || 10), SPLIT = "2017-01-01", WARM = 260;
const pct = (a, i, k) => a[i] / a[i - k] - 1;
const F = CONDS.filter(c => c.name !== "ST age <=2d" && c.name !== "ST age <=10d" && c.name !== "ST age >20d").map(c => [c.name, c.fn]);
const add = (n, fn) => F.push([n, fn]);
const spy = (S, t) => SPY.dateIdx.get(S.d[t]);
const minL = (S, a, b) => { let m = Infinity; for (let k = a; k <= b; k++) m = Math.min(m, S.l[k]); return m; }, maxH = (S, a, b) => { let m = -Infinity; for (let k = a; k <= b; k++) m = Math.max(m, S.h[k]); return m; };
// Supertrend
add("Supertrend up", (S, t) => S.st[t] === 1); add("Supertrend down", (S, t) => S.st[t] === -1);
add("Supertrend flipped up <=3d ago", (S, t) => S.st[t] === 1 && S.stAge[t] <= 2); add("Supertrend flipped down <=3d ago", (S, t) => S.st[t] === -1 && S.stAge[t] <= 2);
add("Supertrend up >20d", (S, t) => S.st[t] === 1 && S.stAge[t] > 20); add("Supertrend down >20d", (S, t) => S.st[t] === -1 && S.stAge[t] > 20);
add("touched Supertrend line from above (within 1 ATR)", (S, t) => S.st[t] === 1 && (S.l[t] - S.stLine[t]) / S.atr14[t] <= 1);
// chart patterns
add("bull flag (15% run, then <=8% pullback over 3-10d)", (S, t) => { for (let L = 3; L <= 10; L++) { const a = t - L; if (pct(S.c, a, 20) >= 0.15 && S.c[t] >= 0.92 * maxH(S, a - 2, a) && maxH(S, a + 1, t) <= maxH(S, a - 2, a)) return true; } return false; });
add("tight 10d range (<=6%)", (S, t) => maxH(S, t - 9, t) / minL(S, t - 9, t) - 1 <= 0.06);
add("tight 10d range (<=4%)", (S, t) => maxH(S, t - 9, t) / minL(S, t - 9, t) - 1 <= 0.04);
add("NR7 (narrowest day of 7)", (S, t) => { const r = S.h[t] - S.l[t]; for (let k = t - 6; k < t; k++) if (S.h[k] - S.l[k] <= r) return false; return true; });
add("close over 50d high", (S, t) => S.c[t] > maxH(S, t - 50, t - 1)); add("close over 252d high", (S, t) => S.c[t] > S.hi252[t]);
add("close under 20d low", (S, t) => S.c[t] < minL(S, t - 20, t - 1)); add("close under 50d low", (S, t) => S.c[t] < minL(S, t - 50, t - 1));
add("pullback to 20d EMA in uptrend", (S, t) => S.l[t] <= S.ema20[t] && S.c[t] > S.ema20[t] && S.sma50[t] > S.sma50[t - 20]);
add("pullback to 50d avg in uptrend", (S, t) => S.l[t] <= S.sma50[t] * 1.01 && S.c[t] > S.sma50[t] && S.sma50[t] > S.sma50[t - 20]);
add("double bottom (two lows within 3%, 10-40d apart, close off the low)", (S, t) => { const l2 = minL(S, t - 5, t), l1 = minL(S, t - 40, t - 10); return Math.abs(l2 / l1 - 1) <= 0.03 && maxH(S, t - 40, t) / l1 - 1 >= 0.08 && S.c[t] > l2 * 1.02 && minL(S, t - 9, t - 6) > Math.min(l1, l2); });
add("higher lows (three 5d lows rising)", (S, t) => minL(S, t - 4, t) > minL(S, t - 9, t - 5) && minL(S, t - 9, t - 5) > minL(S, t - 14, t - 10));
add("lower highs (three 5d highs falling)", (S, t) => maxH(S, t - 4, t) < maxH(S, t - 9, t - 5) && maxH(S, t - 9, t - 5) < maxH(S, t - 14, t - 10));
add("hammer (long lower wick, close near high)", (S, t) => { const r = S.h[t] - S.l[t]; return r > 0 && (Math.min(S.o[t], S.c[t]) - S.l[t]) / r >= 0.6 && (S.h[t] - S.c[t]) / r <= 0.2; });
add("bullish engulfing", (S, t) => S.c[t - 1] < S.o[t - 1] && S.c[t] > S.o[t] && S.c[t] > S.o[t - 1] && S.o[t] < S.c[t - 1]);
add("thrust day (up >=4% on 1.5x volume)", (S, t) => pct(S.c, t, 1) >= 0.04 && S.v[t] >= 1.5 * S.vol50[t]);
add("gap down >=2%", (S, t) => S.o[t] <= 0.98 * S.c[t - 1]); add("down day >=4%", (S, t) => pct(S.c, t, 1) <= -0.04);
// swing / dip
add("3 down closes in a row", (S, t) => S.c[t] < S.c[t - 1] && S.c[t - 1] < S.c[t - 2] && S.c[t - 2] < S.c[t - 3]);
add("RSI2<10", (S, t) => S.rsi2[t] < 10); add("RSI14<30", (S, t) => S.rsi14[t] < 30); add("RSI14<40", (S, t) => S.rsi14[t] < 40);
add("down >=10% in 5d", (S, t) => pct(S.c, t, 5) <= -0.10); add("down >=20% in 20d", (S, t) => pct(S.c, t, 20) <= -0.20); add("up >=10% in 5d", (S, t) => pct(S.c, t, 5) >= 0.10);
add(">=20% under 52w high", (S, t) => S.c[t] <= 0.80 * S.hi252[t]); add(">=40% under 52w high", (S, t) => S.c[t] <= 0.60 * S.hi252[t]);
add("c<sma200", (S, t) => S.c[t] < S.sma200[t]); add("c<sma50", (S, t) => S.c[t] < S.sma50[t]); add(">=3 ATR under 20d avg", (S, t) => (S.sma20[t] - S.c[t]) / S.atr14[t] >= 3);
add("ATR% >=3", (S, t) => S.atr14[t] / S.c[t] >= 0.03); add("ATR% >=5", (S, t) => S.atr14[t] / S.c[t] >= 0.05); add("ATR14>ATR50 (heating up)", (S, t) => S.atr14[t] > 1.2 * S.atr50[t]);
// market
add("SPY<sma200", (S, t) => { const j = spy(S, t); return SPY.c[j] < SPY.sma200[j]; }); add("SPY down >=5% in 10d", (S, t) => { const j = spy(S, t); return pct(SPY.c, j, 10) <= -0.05; });
add("SPY wild (ATR% >=2)", (S, t) => { const j = spy(S, t); return SPY.atr14[j] / SPY.c[j] >= 0.02; }); add("SPY up day >=1.5%", (S, t) => { const j = spy(S, t); return pct(SPY.c, j, 1) >= 0.015; });
add("SPY RSI14<35", (S, t) => { const j = spy(S, t); return SPY.rsi14[j] < 35; });

// ---- build the table of stock-days ----
function outcome(S, t) { const e = t + 1, entry = S.o[e], tgt = entry * (1 + TP / 100), stop = entry * (1 - SL / 100);
  for (let k = e; k < e + HOLD; k++) { if (k > e && S.o[k] <= stop) return [S.o[k] / entry - 1, 0]; if (S.l[k] <= stop) return [-SL / 100, 0]; if (k > e && S.o[k] >= tgt) return [S.o[k] / entry - 1, 1]; if (S.h[k] >= tgt) return [TP / 100, 1]; }
  return [S.c[e + HOLD - 1] / entry - 1, 0]; }
let N = 0; for (const [sym, S] of data) if (sym !== "SPY" && sym !== "QQQ") N += Math.max(0, S.n - WARM - HOLD - 1);
const ret = new Float32Array(N), win = new Uint8Array(N), test = new Uint8Array(N), year = new Uint16Array(N), sid = new Uint16Array(N), tix = new Uint16Array(N), feat = F.map(() => new Uint8Array(N));
const syms = [...data.keys()]; let n = 0;
for (let si = 0; si < syms.length; si++) { const sym = syms[si], S = data.get(sym); if (sym === "SPY" || sym === "QQQ") continue;
  for (let t = WARM; t < S.n - HOLD - 1; t++) { const d = S.d[t]; if (!memberAt(sym, d) || spy(S, t) === undefined || S.hasBad(t - 255, t + HOLD + 1)) continue;
    const [r, w] = outcome(S, t); ret[n] = (r - 2 * COST) * 100; win[n] = w; test[n] = d >= SPLIT ? 1 : 0; year[n] = +d.slice(0, 4); sid[n] = si; tix[n] = t;
    for (let f = 0; f < F.length; f++) feat[f][n] = F[f][1](S, t, sym) ? 1 : 0; n++; } }
N = n;
const agg = (idx, wantTest) => { let c = 0, s = 0, w = 0; for (const i of idx) if (test[i] === wantTest) { c++; s += ret[i]; w += win[i]; } return { n: c, avg: s / c, win: w / c * 100 }; };
const all = Array.from({ length: N }, (_, i) => i);
const bTr = agg(all, 0), bTe = agg(all, 1);
console.log(`target +${TP}%, stop -${SL}%, ${HOLD}-day limit. ${N} stock-days, ${F.length} traits.`);
console.log(`ALL DAYS  2006-2016: n ${bTr.n}, reached +${TP}% first ${f2(bTr.win, 1)}%, avg ${f2(bTr.avg)}%   2017-2026: n ${bTe.n}, ${f2(bTe.win, 1)}%, avg ${f2(bTe.avg)}%`);

// ---- 1. each trait alone: how common before winners vs on all days, and what a trade taken on it earned ----
console.log(`\n=== 1. Each trait alone (2006-2016 / 2017-2026). "before winners" = share of the days that went on to +${TP}% that had the trait ===`);
const rows = F.map(([name], f) => { let c0 = 0, s0 = 0, w0 = 0, c1 = 0, s1 = 0, w1 = 0; const a = feat[f]; for (let i = 0; i < N; i++) if (a[i]) { if (test[i]) { c1++; s1 += ret[i]; w1 += win[i]; } else { c0++; s0 += ret[i]; w0 += win[i]; } }
  return { name, f, n0: c0, avg0: s0 / c0, win0: w0 / c0 * 100, n1: c1, avg1: s1 / c1, win1: w1 / c1 * 100, prevAll: c0 / bTr.n * 100, prevWin: w0 / (bTr.win / 100 * bTr.n) * 100 }; });
rows.sort((a, b) => b.avg0 - a.avg0);
for (const r of rows) console.log(`${r.name.padEnd(62)} all days ${f2(r.prevAll, 1).padStart(5)}%  before winners ${f2(r.prevWin, 1).padStart(5)}%  | win ${f2(r.win0, 1)}% avg ${f2(r.avg0).padStart(6)}% | later: win ${f2(r.win1, 1)}% avg ${f2(r.avg1).padStart(6)}%  n ${r.n1}`);

// ---- 2. greedy combinations found on 2006-2016, then checked on 2017-2026 ----
function greedy(start, minN, depth, score) { let idx = all.filter(i => feat[start][i]), used = [start];
  for (let d = 1; d < depth; d++) { let best = null; const cur = agg(idx, 0);
    for (let f = 0; f < F.length; f++) { if (used.includes(f)) continue; let c = 0, s = 0, w = 0; const a = feat[f]; for (const i of idx) if (a[i] && !test[i]) { c++; s += ret[i]; w += win[i]; }
      if (c < minN) continue; const v = score === "win" ? w / c : s / c; if (!best || v > best.v) best = { f, v }; }
    if (!best || best.v <= (score === "win" ? cur.win / 100 : cur.avg) * 1.02 + 1e-9) break; used.push(best.f); idx = idx.filter(i => feat[best.f][i]); }
  return { used, idx }; }
for (const score of ["avg", "win"]) { console.log(`\n=== 2. Best combinations by ${score === "avg" ? "average profit" : "win rate"} on 2006-2016 (at least 2,000 stock-days), with their 2017-2026 result ===`);
  const seen = new Set(), res = [];
  for (let f = 0; f < F.length; f++) { const g = greedy(f, 2000, 4, score); const key = [...g.used].sort((a, b) => a - b).join(","); if (seen.has(key)) continue; seen.add(key); const a = agg(g.idx, 0), b = agg(g.idx, 1); if (a.n >= 2000) res.push({ g, a, b }); }
  res.sort((x, y) => score === "avg" ? y.a.avg - x.a.avg : y.a.win - x.a.win);
  for (const { g, a, b } of res.slice(0, 15)) { const by = {}; for (const i of g.idx) { (by[year[i]] ||= [0, 0]); by[year[i]][0] += ret[i]; by[year[i]][1]++; } const ys = Object.keys(by).filter(y => +y >= 2017); const pos = ys.filter(y => by[y][0] > 0).length;
    console.log(`${g.used.map(f => F[f][0]).join("  +  ")}\n     2006-2016: n ${a.n} win ${f2(a.win, 1)}% avg ${f2(a.avg)}%   2017-2026: n ${b.n} win ${f2(b.win, 1)}% avg ${f2(b.avg)}%  (${pos} of ${ys.length} years positive)`); } }
