// Does a weakening alert help the decision "continue the trade or exit at the current profit"? For each Supertrend flip, find the first day a warning rule fires
// (while the trade is in profit by at least P), then simulate what each choice would have earned: hold to the Supertrend line (current), exit all now, exit half now,
// or keep the trade with a protective stop locked at half the open gain / just above the entry. Every comparison is repeated on a RANDOM day of the same trades
// with the same profit condition, to see whether the alert's timing is worth anything beyond just choosing some day to sell.
import { readFileSync } from "node:fs";
import { data, exitSim, mean, f2, COST } from "./lib14.mjs";
const SPLIT = "2024-11-05", obs = JSON.parse(readFileSync("obs33.json", "utf8"));
const byTrade = new Map(); for (const o of obs) (byTrade.get(o.trade) || byTrade.set(o.trade, []).get(o.trade)).push(o);
const RULES = { "gap down 1%+": o => o.f[9], "gave back half the gain": o => o.f[6], "high-volume down day": o => o.f[19], "within 0.5 ATR of the Supertrend line": o => o.f[3],
  "any of: gap down / giveback / high-volume down day": o => o.f[9] || o.f[6] || o.f[19], "2+ of: gap down, giveback, vol-down day, near line, RSI<50 cross": o => [o.f[9], o.f[6], o.f[19], o.f[3], o.f[13]].filter(Boolean).length >= 2 };
function cont(S, e, d, stop) { // continue from the close of day d to the Supertrend exit; optional protective stop; returns return % vs entry open (before costs)
  const entry = S.o[e], last = Math.min(S.n - 1, e + 119);
  for (let k = d + 1; k <= last; k++) { if (stop && S.l[k] <= stop) { const px = S.o[k] <= stop ? S.o[k] : stop; return (px / entry - 1) * 100; } if (S.st[k] === -1) { const nx = Math.min(k + 1, S.n - 1); return ((nx > k ? S.o[nx] : S.c[k]) / entry - 1) * 100; } }
  return (S.c[last] / entry - 1) * 100; }
const net = r => r - 2 * COST * 100;
const POL = { "exit ALL now": (S, e, d, now) => now, "exit HALF now, rest to the line": (S, e, d, now) => 0.5 * now + 0.5 * cont(S, e, d, 0),
  "keep it, stop locked at HALF the open gain": (S, e, d, now) => cont(S, e, d, now > 0 ? S.o[e] * (1 + now / 200) : 0), "keep it, stop at breakeven": (S, e, d, now) => cont(S, e, d, now > 0 ? S.o[e] * 1.003 : 0) };
let seed = 2024; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const stat = a => ({ n: a.length, win: a.filter(x => x > 0).length / a.length * 100, avg: mean(a) });
console.log(`trades: ${byTrade.size}. Policy results are the average return per trade, net of 0.1% costs per side, for the trades where the alert fired in profit.\n`);
const base = new Map(); for (const [key] of byTrade) { const [sym, e] = key.split("|"), S = data.get(sym); base.set(key, exitSim(S, +e - 1, { st: true }).ret); }
for (const P of [0, 5, 10]) {
  console.log(`################ alert counts only if the trade is up ${P}% or more at that close`);
  for (const [rn, rule] of Object.entries(RULES)) {
    const picks = [], ctl = []; for (const [key, arr] of byTrade) { const ok = arr.filter(o => o.pnl >= P), hit = ok.find(rule); if (!hit) continue; picks.push({ key, o: hit }); const pool = ok.filter(o => o !== hit); if (pool.length) ctl.push({ key, o: pool[Math.floor(rnd() * pool.length)] }); }
    if (picks.length < 100) { console.log(`  ${rn}: only ${picks.length} alerts`); continue; }
    const hold = picks.map(p => base.get(p.key)), hs = stat(hold);
    console.log(`  ${rn}: ${picks.length} trades alerted (${f2(picks.length / byTrade.size * 100, 0)}% of all); HOLD to the line: win ${f2(hs.win, 0)}%, avg ${f2(hs.avg)}%`);
    for (const [pn, fn] of Object.entries(POL)) {
      const run = list => list.map(p => { const [sym, e] = p.key.split("|"), S = data.get(sym); return { r: net(fn(S, +e, p.o.d, p.o.pnl)), date: p.o.date, hold: base.get(p.key) }; });
      const A = run(picks), C = run(ctl.filter(c => picks.some(p => p.key === c.key))), a = stat(A.map(x => x.r)), c = stat(C.map(x => x.r)), diff = mean(A.map(x => x.r - x.hold)), diffC = mean(C.map(x => x.r - x.hold));
      const e1 = A.filter(x => x.date < SPLIT), e2 = A.filter(x => x.date >= SPLIT), dEarly = mean(e1.map(x => x.r - x.hold)), dLate = mean(e2.map(x => x.r - x.hold));
      console.log(`     ${pn.padEnd(44)} win ${f2(a.win, 0).padStart(3)}%  avg ${f2(a.avg).padStart(6)}%  vs hold ${f2(diff).padStart(6)}% (early ${f2(dEarly)} / late ${f2(dLate)})  | same policy on a RANDOM day ${f2(diffC).padStart(6)}%  -> alert timing worth ${f2(diff - diffC).padStart(5)}%`);
    }
    const bet = picks.map(p => { const [sym, e] = p.key.split("|"), S = data.get(sym); return { hold: base.get(p.key), now: net(p.o.pnl) }; });
    console.log(`     continuing beats exiting at that close in ${f2(bet.filter(b => b.hold > b.now).length / bet.length * 100, 0)}% of alerts (avg regret if you exit: ${f2(mean(bet.map(b => b.hold - b.now)))}%; median ${f2(bet.map(b => b.hold - b.now).sort((x, y) => x - y)[Math.floor(bet.length / 2)])}%)`);
  }
}
