// Stage C: scale-out exits. Sell a fraction at +T%, let the rest run on the Supertrend line (optionally with a break-even or hard stop). Win = blended trade P&L > 0.
import { readFileSync } from "node:fs";
import { data, stats, f2, COST } from "./lib14.mjs";
const SPLIT = "2024-11-05", J = JSON.parse(readFileSync("rows14.json", "utf8")), rows = J.rows;
const mk = a => a.map(r => ({ S: data.get(r.sym), t: r.t, date: r.date }));
const FL = mk(rows.filter(r => r.flip)), AL = mk(rows);
function sim(S, t, P) { // P: { frac, T, hard (initial % stop, 0 = line only), after: 'line' | 'be' | 'hard' }
  const e = t + 1, cap = 120, last = Math.min(S.n - 1, e + cap - 1); if (e + cap - 1 >= S.n) return null; const entry = S.o[e]; if (!(entry > 0)) return null;
  const tgt = entry * (1 + P.T / 100); let stop = P.hard ? entry * (1 - P.hard / 100) : -Infinity, part = false, r1 = 0, rest = 1 - P.frac, exit = NaN, days = 0;
  for (let k = e; k <= last; k++) {
    if (S.o[k] <= stop && k > e) { exit = S.o[k]; days = k - e + 1; break; } if (S.l[k] <= stop) { exit = stop; days = k - e + 1; break; }
    if (!part && S.h[k] >= tgt) { part = true; const px = (k > e && S.o[k] >= tgt) ? S.o[k] : tgt; r1 = P.frac * (px / entry - 1);
      if (P.after === "be") stop = Math.max(stop, entry * 1.001); else if (P.after === "line") stop = -Infinity; }
    if (S.st[k] === -1 && (P.after !== "hard" || !part ? true : true)) { if (!(part && P.after === "be") || true) { const nx = Math.min(k + 1, S.n - 1); exit = nx > k ? S.o[nx] : S.c[k]; days = nx - e + 1; break; } }
  }
  if (!Number.isFinite(exit)) { exit = S.c[last]; days = last - e + 1; }
  const blended = part ? r1 + rest * (exit / entry - 1) : (exit / entry - 1);
  return { ret: (blended - 2 * COST) * 100, days, part };
}
const res = [];
for (const frac of [0.5, 0.75]) for (const T of [3, 4, 5, 6, 8, 10]) for (const hard of [0, 8, 12, 15]) for (const after of ["line", "be"]) {
  const P = { frac, T, hard, after }; const run = L => L.map(x => { const r = sim(x.S, x.t, P); return r && { ...r, date: x.date }; }).filter(Boolean);
  const f = run(FL), a = run(AL); res.push({ P, f: stats(f), a: stats(a), ft: stats(f.filter(x => x.date < SPLIT)), fe: stats(f.filter(x => x.date >= SPLIT)), at: stats(a.filter(x => x.date < SPLIT)), ae: stats(a.filter(x => x.date >= SPLIT)) });
}
const line = r => `sell ${r.P.frac * 100}% at +${r.P.T}%, ${r.P.hard ? "stop -" + r.P.hard + "%" : "no hard stop"}, rest: ${r.P.after.padEnd(4)} | flips win ${f2(r.f.win, 1).padStart(5)} avg ${f2(r.f.avg).padStart(5)} (tr ${f2(r.ft.win, 0)}/${f2(r.ft.avg)} te ${f2(r.fe.win, 0)}/${f2(r.fe.avg)}) | ALL win ${f2(r.a.win, 1).padStart(5)} avg ${f2(r.a.avg).padStart(5)} (tr ${f2(r.at.win, 0)}/${f2(r.at.avg)} te ${f2(r.ae.win, 0)}/${f2(r.ae.avg)}) days ${f2(r.a.days, 0)}`;
console.log("Reference, current exit: flips 44.6% win / +2.14%; ALL rows 36.4% / +0.59%\n");
console.log("== top 15 by win rate on ALL rows with avg >= +1.0% on both halves of ALL rows ==");
res.filter(r => r.at.avg >= 1 && r.ae.avg >= 1).sort((x, y) => y.a.win - x.a.win).slice(0, 15).forEach(r => console.log(line(r)));
console.log("\n== top 10 by avg on ALL rows with win >= 60% ==");
res.filter(r => r.a.win >= 60).sort((x, y) => y.a.avg - x.a.avg).slice(0, 10).forEach(r => console.log(line(r)));
console.log("\n== top 10 by win rate overall ==");
res.sort((x, y) => y.a.win - x.a.win).slice(0, 10).forEach(r => console.log(line(r)));
