// Owner's target: take profit at +10% to +15% with a 3% to 5% stop. Fresh flips and all up-trend rows, no Supertrend-line exit (pure stop/target), hold cap 60 or 120 days.
import { readFileSync } from "node:fs";
import { data, exitSim, stats, f2 } from "./lib14.mjs";
const SPLIT = "2024-11-05", rows = JSON.parse(readFileSync("rows14.json", "utf8")).rows;
const mk = a => a.map(r => ({ S: data.get(r.sym), t: r.t, date: r.date }));
const FL = mk(rows.filter(r => r.flip)), AL = mk(rows);
console.log("Break-even win rate for stop s, target T (ignoring costs) = s / (s + T). Current exit: flips 44.6% win / +2.14%; ALL rows 36.4% / +0.59%\n");
for (const hold of [120, 40]) for (const s of [3, 4, 5]) for (const T of [10, 12, 15]) {
  const v = { stop: s, target: T, maxHold: hold }, run = L => L.map(x => { const r = exitSim(x.S, x.t, v); return r && { ...r, date: x.date }; }).filter(Boolean);
  const f = run(FL), a = run(AL), fs = stats(f), as = stats(a), ft = stats(f.filter(x => x.date < SPLIT)), fe = stats(f.filter(x => x.date >= SPLIT)), at = stats(a.filter(x => x.date < SPLIT)), ae = stats(a.filter(x => x.date >= SPLIT));
  console.log(`hold<=${String(hold).padEnd(3)} stop -${s}% target +${String(T).padEnd(2)}% (break-even win ${f2(s / (s + T) * 100, 0)}%) | flips win ${f2(fs.win, 1).padStart(5)} avg ${f2(fs.avg).padStart(5)} PF ${f2(fs.pf)} (tr ${f2(ft.win, 0)}/${f2(ft.avg)} te ${f2(fe.win, 0)}/${f2(fe.avg)}) d ${f2(fs.days, 0)} | ALL win ${f2(as.win, 1).padStart(5)} avg ${f2(as.avg).padStart(5)} (tr ${f2(at.win, 0)}/${f2(at.avg)} te ${f2(ae.win, 0)}/${f2(ae.avg)})`);
}
