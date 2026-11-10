// Profit lock: once a trade is up P%, raise the stop to entry +L% (stop touched intraday, otherwise the Supertrend line exit as usual). All Supertrend flips, causal,
// net of 0.1% per side. Wins are trades finishing more than +0.5% up; scratch is -0.5% to +0.5%.
import { readFileSync } from "node:fs";
import { data, exitSim, mean, f2 } from "./lib14.mjs";
const SPLIT = "2024-11-05", obs = JSON.parse(readFileSync("obs33.json", "utf8")), byTrade = new Map(); for (const o of obs) (byTrade.get(o.trade) || byTrade.set(o.trade, []).get(o.trade)).push(o);
function cont(S, e, d, stop) { const entry = S.o[e], last = Math.min(S.n - 1, e + 119); for (let k = d + 1; k <= last; k++) { if (stop && S.l[k] <= stop) return ((S.o[k] <= stop ? S.o[k] : stop) / entry - 1) * 100; if (S.st[k] === -1) { const nx = Math.min(k + 1, S.n - 1); return ((nx > k ? S.o[nx] : S.c[k]) / entry - 1) * 100; } } return (S.c[last] / entry - 1) * 100; }
const trades = [...byTrade].map(([key, arr]) => { const [sym, e] = key.split("|"), S = data.get(sym); return { S, e: +e, arr, hold: exitSim(S, +e - 1, { st: true }).ret, date: S.d[+e], days: 0 }; });
const line = (name, rs, tr) => { const n = rs.length, w = rs.filter(x => x > 0.5), sc = rs.filter(x => x > -0.5 && x <= 0.5), l = rs.filter(x => x <= -0.5), e1 = rs.filter((_, i) => tr[i].date < SPLIT), e2 = rs.filter((_, i) => tr[i].date >= SPLIT);
  const rel = x => x.filter((_, i) => true); const g = (a, f) => a.length ? a.filter(f).length / a.length * 100 : NaN; return `${name.padEnd(46)} wins ${f2(w.length / n * 100, 1).padStart(5)}%  scratch ${f2(sc.length / n * 100, 1).padStart(4)}%  losses ${f2(l.length / n * 100, 1).padStart(5)}%  avg ${f2(mean(rs)).padStart(5)}% (win ${f2(mean(w), 1)} / loss ${f2(mean(l), 1)})  early ${f2(mean(e1))} (wins ${f2(g(e1, x => x > 0.5), 0)}%) / late ${f2(mean(e2))} (wins ${f2(g(e2, x => x > 0.5), 0)}%)`; };
console.log(`trades ${trades.length}`); console.log(line("HOLD to the line (current)", trades.map(t => t.hold), trades));
for (const P of [3, 4, 5, 7]) for (const L of [0.5, 1, 1.5, 2]) { if (L >= P) continue; const rs = trades.map(t => { const o = t.arr.find(x => x.pnl >= P); return o ? cont(t.S, t.e, o.d, t.S.o[t.e] * (1 + L / 100)) - 0.2 : t.hold; }); console.log(line(`up ${P}% -> stop to entry +${L}%`, rs, trades)); }
// the same after a weakness alert only (any of gap down / giveback / high-volume down day) for comparison
const alertRule = o => o.f[9] || o.f[6] || o.f[19];
for (const [P, L] of [[3, 1], [5, 1]]) { const rs = trades.map(t => { const o = t.arr.find(x => x.pnl >= P && alertRule(x)); return o ? cont(t.S, t.e, o.d, t.S.o[t.e] * (1 + L / 100)) - 0.2 : t.hold; }); console.log(line(`ALERT only, up ${P}% -> stop to entry +${L}%`, rs, trades)); }
