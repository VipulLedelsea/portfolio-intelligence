// Stage A2: grid of stop / target exits. Win rate vs profit on (a) the fresh flips, (b) all up-trend rows (25.9k), split train / test.
import { readFileSync } from "node:fs";
import { data, exitSim, stats, f2 } from "./lib14.mjs";
const SPLIT = "2024-11-05", J = JSON.parse(readFileSync("rows14.json", "utf8")), rows = J.rows;
const mk = a => a.map(r => ({ S: data.get(r.sym), t: r.t, date: r.date }));
const FL = mk(rows.filter(r => r.flip)), AL = mk(rows);
const STOPS = [4, 6, 8, 10, 12, 15, 20], TGTS = [3, 4, 5, 6, 8, 10, 12, 15, 20], res = [];
for (const useLine of [false, true]) for (const s of STOPS) for (const T of TGTS) {
  const v = { stop: s, target: T, st: useLine, maxHold: 120 };
  const run = L => L.map(x => ({ ...exitSim(x.S, x.t, v), date: x.date })).filter(x => Number.isFinite(x.ret));
  const f = run(FL), a = run(AL), ft = stats(f.filter(x => x.date < SPLIT)), fe = stats(f.filter(x => x.date >= SPLIT)), at = stats(a.filter(x => x.date < SPLIT)), ae = stats(a.filter(x => x.date >= SPLIT));
  res.push({ useLine, s, T, f: stats(f), a: stats(a), ft, fe, at, ae });
}
const line = (r) => `${(r.useLine ? "line+" : "     ")}stop -${String(r.s).padEnd(2)} tgt +${String(r.T).padEnd(2)} | flips win ${f2(r.f.win, 1).padStart(5)} avg ${f2(r.f.avg).padStart(5)} (train ${f2(r.ft.win, 0)}/${f2(r.ft.avg)} test ${f2(r.fe.win, 0)}/${f2(r.fe.avg)}) d ${f2(r.f.days, 0).padStart(2)} | ALL win ${f2(r.a.win, 1).padStart(5)} avg ${f2(r.a.avg).padStart(5)} (train ${f2(r.at.win, 0)}/${f2(r.at.avg)} test ${f2(r.ae.win, 0)}/${f2(r.ae.avg)}) PF ${f2(r.a.pf)}`;
console.log("Current exit (line only), flips: 44.6% win, +2.14% avg; ALL rows: 36.4% win, +0.59% avg\n");
for (const minAvg of [0.5, 1.0, 1.5]) {
  console.log(`== best win rate on ALL rows with avg >= ${minAvg}% on BOTH train and test halves of ALL rows, top 12 ==`);
  res.filter(r => r.at.avg >= minAvg && r.ae.avg >= minAvg).sort((x, y) => y.a.win - x.a.win).slice(0, 12).forEach(r => console.log(line(r)));
}
console.log("\n== highest win rates regardless of profit (top 10) ==");
res.sort((x, y) => y.a.win - x.a.win).slice(0, 10).forEach(r => console.log(line(r)));
console.log("\n== win rate >= 70% and avg > 0 on ALL rows ==");
res.filter(r => r.a.win >= 70 && r.a.avg > 0).sort((x, y) => y.a.avg - x.a.avg).slice(0, 10).forEach(r => console.log(line(r)));
