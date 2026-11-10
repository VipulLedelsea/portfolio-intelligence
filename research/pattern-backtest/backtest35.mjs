// Decision test at the TRADE level (all Supertrend flips, so win rates are comparable): once a trade is up P%, what happens if the stop is moved to breakeven (or locked at half
// the gain), either immediately (no alert) or only when a weakness alert fires? Also exit-half and exit-all at the alert. Causal throughout: only what was known at that close.
import { readFileSync } from "node:fs";
import { data, exitSim, mean, f2, COST } from "./lib14.mjs";
const SPLIT = "2024-11-05", obs = JSON.parse(readFileSync("obs33.json", "utf8")), byTrade = new Map();
for (const o of obs) (byTrade.get(o.trade) || byTrade.set(o.trade, []).get(o.trade)).push(o);
const ALERT = { "any of gap down / giveback / high-volume down day": o => o.f[9] || o.f[6] || o.f[19], "near the Supertrend line (0.5 ATR)": o => o.f[3], "2+ of 5 warnings": o => [o.f[9], o.f[6], o.f[19], o.f[3], o.f[13]].filter(Boolean).length >= 2 };
function cont(S, e, d, stop) { const entry = S.o[e], last = Math.min(S.n - 1, e + 119); for (let k = d + 1; k <= last; k++) { if (stop && S.l[k] <= stop) return ((S.o[k] <= stop ? S.o[k] : stop) / entry - 1) * 100; if (S.st[k] === -1) { const nx = Math.min(k + 1, S.n - 1); return ((nx > k ? S.o[nx] : S.c[k]) / entry - 1) * 100; } } return (S.c[last] / entry - 1) * 100; }
const net = r => r - 2 * COST * 100, trades = [];
for (const [key, arr] of byTrade) { const [sym, e] = key.split("|"), S = data.get(sym), t = +e - 1; trades.push({ key, S, e: +e, arr, hold: exitSim(S, t, { st: true }).ret, date: S.d[+e] }); }
const summarize = (name, rs, rows) => { const w = rs.filter(x => x > 0), l = rs.filter(x => x <= 0), e1 = rs.filter((_, i) => rows[i].date < SPLIT), e2 = rs.filter((_, i) => rows[i].date >= SPLIT);
  return `${name.padEnd(64)} win ${f2(w.length / rs.length * 100, 1).padStart(5)}%  avg ${f2(mean(rs)).padStart(5)}% (win ${f2(mean(w), 1)} / loss ${f2(mean(l), 1)})  PF ${f2(w.reduce((a, b) => a + b, 0) / -l.reduce((a, b) => a + b, 0))}  early ${f2(mean(e1))} / late ${f2(mean(e2))}`; };
console.log(`all trades: ${trades.length}\n`);
console.log(summarize("HOLD to the Supertrend line (current)", trades.map(t => t.hold), trades));
for (const P of [3, 5, 8, 10]) {
  console.log(`\n---- once the trade is up ${P}% ----`);
  const up = trades.filter(t => t.arr.some(o => o.pnl >= P)); console.log(`  ${up.length} trades (${f2(up.length / trades.length * 100, 0)}%) ever reach +${P}% at a close; ${f2(up.filter(t => t.hold <= 0).length / up.length * 100, 1)}% of those still end as losses under HOLD`);
  const policies = { [`stop to breakeven at first close up ${P}% (no alert)`]: (t) => { const o = t.arr.find(x => x.pnl >= P); return o ? net(cont(t.S, t.e, o.d, t.S.o[t.e] * 1.003)) : null; },
    [`stop locked at half the gain at first close up ${P}% (no alert)`]: (t) => { const o = t.arr.find(x => x.pnl >= P); return o ? net(cont(t.S, t.e, o.d, t.S.o[t.e] * (1 + o.pnl / 200))) : null; } };
  for (const [an, rule] of Object.entries(ALERT)) { policies[`ALERT (${an}) while up ${P}%: stop to breakeven`] = t => { const o = t.arr.find(x => x.pnl >= P && rule(x)); return o ? net(cont(t.S, t.e, o.d, t.S.o[t.e] * 1.003)) : null; };
    policies[`ALERT (${an}) while up ${P}%: exit half now, rest to the line`] = t => { const o = t.arr.find(x => x.pnl >= P && rule(x)); return o ? net(0.5 * o.pnl + 0.5 * cont(t.S, t.e, o.d, 0)) : null; };
    policies[`ALERT (${an}) while up ${P}%: exit ALL now`] = t => { const o = t.arr.find(x => x.pnl >= P && rule(x)); return o ? net(o.pnl) : null; }; }
  for (const [pn, fn] of Object.entries(policies)) { const rs = trades.map(t => { const r = fn(t); return r === null ? t.hold : r; }); console.log(summarize("  " + pn, rs, trades)); }
}
