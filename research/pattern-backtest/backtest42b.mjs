// Why rule D (panic dip in a bear market) looks good per trade but not as a portfolio: how concentrated are its trades in a few dates?
// All qualifying stock-days (overlap allowed), +5% / -3% / 10 days.   node --max-old-space-size=8192 backtest42b.mjs
import { data, memberAt, SPY, mean, f2, COST } from "./lib41.mjs";
const WARM = 260; data.delete("QQQ");
const rule = (S, t) => { const j = SPY.dateIdx.get(S.d[t]); return j !== undefined && S.rsi2[t] < 10 && S.v[t] < 0.8 * S.vol50[t] && SPY.atr14[j] / SPY.c[j] >= 0.02 && SPY.c[j] < SPY.sma200[j]; };
function sim(S, t, TP, SL, H) { const e = t + 1; if (e + H > S.n) return null; const entry = S.o[e], tgt = entry * (1 + TP / 100), stop = entry * (1 - SL / 100);
  for (let k = e; k < e + H; k++) { if (k > e && S.o[k] <= stop) return S.o[k] / entry - 1; if (S.l[k] <= stop) return -SL / 100; if (k > e && S.o[k] >= tgt) return S.o[k] / entry - 1; if (S.h[k] >= tgt) return TP / 100; }
  return S.c[e + H - 1] / entry - 1; }
const byDay = new Map();
for (const [sym, S] of data) { if (sym === "SPY") continue; for (let t = WARM; t < S.n - 1; t++) { if (!memberAt(sym, S.d[t]) || S.hasBad(t - 255, t) || !rule(S, t)) continue; const r = sim(S, t, 5, 3, 10); if (r === null) continue; (byDay.get(S.d[t]) || byDay.set(S.d[t], []).get(S.d[t])).push((r - 2 * COST) * 100); } }
const days = [...byDay.entries()].map(([d, a]) => ({ d, n: a.length, avg: mean(a), sum: a.reduce((s, x) => s + x, 0) })).sort((a, b) => a.d < b.d ? -1 : 1);
const all = [...byDay.values()].flat(); const total = all.reduce((s, x) => s + x, 0);
console.log(`stock-days ${all.length}, avg ${f2(mean(all))}%, on ${days.length} distinct dates`);
console.log(`average of the daily averages (each date counted once): ${f2(mean(days.map(x => x.avg)))}%, dates with a positive average: ${f2(days.filter(x => x.avg > 0).length / days.length * 100, 0)}%`);
const top = [...days].sort((a, b) => b.sum - a.sum); console.log(`total profit ${f2(total, 0)} points; the best 10 dates supply ${f2(top.slice(0, 10).reduce((s, x) => s + x.sum, 0), 0)}, the best 20 supply ${f2(top.slice(0, 20).reduce((s, x) => s + x.sum, 0), 0)}`);
console.log("best 10 dates: " + top.slice(0, 10).map(x => `${x.d} (${x.n} stocks, ${f2(x.avg, 1)}%)`).join(", "));
for (const [lo, hi] of [[1, 9], [10, 49], [50, 149], [150, 9999]]) { const g = days.filter(x => x.n >= lo && x.n <= hi); const tr = g.reduce((s, x) => s + x.n, 0); console.log(`dates with ${lo}-${hi} qualifying stocks: ${g.length} dates, ${tr} stock-days, avg per stock-day ${f2(g.reduce((s, x) => s + x.sum, 0) / tr)}%, avg per date ${f2(mean(g.map(x => x.avg)))}%, 2006-16 ${f2(mean(g.filter(x => x.d < "2017").map(x => x.avg)))}% / 2017-26 ${f2(mean(g.filter(x => x.d >= "2017").map(x => x.avg)))}%`); }
