// IBD-style sell rules (from background knowledge: the investors.com page could not be opened): cut losses at 7-8%, take profits at 20-25%,
// and the 8-week rule (a +20% gain within 3 weeks of the buy point means hold at least 8 weeks). Tested on the fresh flips and on all up-trend rows.
import { readFileSync } from "node:fs";
import { data, stats, f2, COST } from "./lib14.mjs";
const SPLIT = "2024-11-05", J = JSON.parse(readFileSync("rows14.json", "utf8")), rows = J.rows;
const mk = a => a.map(r => ({ S: data.get(r.sym), t: r.t, date: r.date }));
const FL = mk(rows.filter(r => r.flip)), AL = mk(rows);
function sim(S, t, P) { // P: { stop %, target % (0 = none), eight: bool, line: bool (exit on Supertrend line once past any hold window) }
  const e = t + 1, cap = 120, last = Math.min(S.n - 1, e + cap - 1); if (e + cap - 1 >= S.n) return null; const entry = S.o[e]; if (!(entry > 0)) return null;
  const stop = entry * (1 - P.stop / 100), tgt = P.target ? entry * (1 + P.target / 100) : Infinity; let hold = false, exit = NaN, days = 0;
  for (let k = e; k <= last; k++) {
    const d = k - e + 1;
    if (S.o[k] <= stop && k > e) { exit = S.o[k]; days = d; break; } if (S.l[k] <= stop) { exit = stop; days = d; break; }
    if (P.eight && !hold && d <= 15 && S.h[k] >= entry * 1.20) hold = true;
    const holdActive = hold && d <= 40;
    if (!holdActive && S.h[k] >= tgt) { exit = (k > e && S.o[k] >= tgt) ? S.o[k] : tgt; days = d; break; }
    if (!holdActive && P.line && S.st[k] === -1) { const nx = Math.min(k + 1, S.n - 1); exit = nx > k ? S.o[nx] : S.c[k]; days = nx - e + 1; break; }
  }
  if (!Number.isFinite(exit)) { exit = S.c[last]; days = last - e + 1; }
  return { ret: (exit / entry - 1 - 2 * COST) * 100, days };
}
const V = [];
for (const stop of [7, 8]) for (const target of [20, 25]) for (const eight of [false, true]) V.push({ stop, target, eight, line: false });
for (const stop of [7, 8]) V.push({ stop, target: 0, eight: false, line: true }), V.push({ stop, target: 25, eight: true, line: true });
console.log("Reference: current exit (line only): flips 44.6% / +2.14%, ALL rows 36.4% / +0.59%\n");
for (const P of V) { const run = L => L.map(x => { const r = sim(x.S, x.t, P); return r && { ...r, date: x.date }; }).filter(Boolean);
  const f = run(FL), a = run(AL), ft = stats(f.filter(x => x.date < SPLIT)), fe = stats(f.filter(x => x.date >= SPLIT)), fs = stats(f), as = stats(a);
  console.log(`stop -${P.stop}%, ${P.target ? "target +" + P.target + "%" : "no target"}${P.eight ? ", 8-week rule" : ""}${P.line ? ", then Supertrend line" : ""}`.padEnd(66) + `| flips win ${f2(fs.win, 1).padStart(5)} avg ${f2(fs.avg).padStart(5)} (avg win ${f2(fs.avgWin, 1)}, loss ${f2(fs.avgLoss, 1)}, tr ${f2(ft.win, 0)}/${f2(ft.avg)} te ${f2(fe.win, 0)}/${f2(fe.avg)}) d ${f2(fs.days, 0)} | ALL win ${f2(as.win, 1)} avg ${f2(as.avg)}`); }
