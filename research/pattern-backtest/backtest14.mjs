// Stage A: dataset, baseline, single-indicator lift, and the exit frontier (win rate vs profit). See WINRATE_PLAN.md.
import { writeFileSync } from "node:fs";
import { data, CONDS, memberAt, exitSim, stats, f2, WARM } from "./lib14.mjs";
const SPLIT = "2024-11-05", outPath = process.argv[2] || "rows14.json";
const rows = [];
for (const [sym, S] of data) { if (sym === "SPY") continue; let k = 0;
  for (let t = WARM; t < S.n - 2; t++) {
    if (!(S.st[t] === 1 && S.adx[t] >= 20 && S.adx[t] > S.adx[t - 5] && S.atr14[t] > 0)) continue;
    const flip = S.st[t - 1] === -1; if (!flip && (k++ % 3)) continue;
    if (!memberAt(sym, S.d[t])) continue;
    const r = exitSim(S, t); if (!r || S.hasBad(t - 252, t + 1 + r.days + 1)) continue;
    let bits = ""; for (const c of CONDS) { let b = 0; try { b = c.fn(S, t, sym) ? 1 : 0; } catch { b = 0; } bits += b; }
    rows.push({ sym, t, date: S.d[t + 1], ret: r.ret, days: r.days, flip: flip ? 1 : 0, bits }); } }
writeFileSync(outPath, JSON.stringify({ conds: CONDS.map(c => c.name), groups: CONDS.map(c => c.group), rows }));
const all = rows, flips = rows.filter(r => r.flip);
const show = (name, tr) => { const s = stats(tr); console.log(`${name.padEnd(34)} n=${String(s.n).padStart(6)}  win ${f2(s.win, 1)}%  avg ${f2(s.avg)}%  avg win ${f2(s.avgWin, 1)}  avg loss ${f2(s.avgLoss, 1)}  days ${f2(s.days, 0)}  PF ${f2(s.pf)}`); };
console.log(`rows ${rows.length}, conditions ${CONDS.length}`);
show("ALL up-trend rows (every 3rd day)", all); show("FLIPS (fresh, the app's entry)", flips);
const tr = all.filter(r => r.date < SPLIT), te = all.filter(r => r.date >= SPLIT);
show("rows train (< 2024-11-05)", tr); show("rows test (>= 2024-11-05)", te);
show("flips train", flips.filter(r => r.date < SPLIT)); show("flips test", flips.filter(r => r.date >= SPLIT));
// single-condition lift
console.log("\n== single condition: win% when TRUE (train | test) vs all-rows baseline; flips shown too ==");
const base = { tr: stats(tr).win, te: stats(te).win };
const lines = CONDS.map((c, i) => { const pick = a => a.filter(r => r.bits[i] === "1"), a = stats(pick(tr)), b = stats(pick(te)), f = stats(pick(flips));
  return { name: c.name, group: c.group, nTr: a.n, nTe: b.n, wTr: a.win, wTe: b.win, aTr: a.avg, aTe: b.avg, fN: f.n, fW: f.win, fA: f.avg, liftTr: a.win - base.tr, liftTe: b.win - base.te }; });
lines.sort((x, y) => Math.min(y.liftTr, y.liftTe) - Math.min(x.liftTr, x.liftTe));
console.log(`baseline win: train ${f2(base.tr, 1)}%  test ${f2(base.te, 1)}%`);
console.log("condition".padEnd(30) + "grp".padEnd(11) + "nTrain nTest  winTr winTe  liftTr liftTe  avgTr avgTe | flips n win avg");
for (const l of lines) console.log(l.name.padEnd(30) + l.group.padEnd(11) + `${String(l.nTr).padStart(6)} ${String(l.nTe).padStart(5)}  ${f2(l.wTr, 1).padStart(5)} ${f2(l.wTe, 1).padStart(5)}  ${f2(l.liftTr, 1).padStart(6)} ${f2(l.liftTe, 1).padStart(6)}  ${f2(l.aTr).padStart(5)} ${f2(l.aTe).padStart(5)} | ${String(l.fN).padStart(3)} ${f2(l.fW, 0).padStart(3)} ${f2(l.fA).padStart(5)}`);
// exit frontier on flips (re-simulated)
console.log("\n== exit frontier on the fresh flips: win rate vs profit ==");
const flipRows = flips.map(r => ({ S: data.get(r.sym), t: r.t }));
const V = [["Supertrend line only (CURRENT)", { st: true }]];
for (const T of [3, 5, 8, 10, 15, 20]) V.push([`line + target +${T}%`, { st: true, target: T }]);
for (const s of [5, 8, 12]) for (const T of [5, 10]) V.push([`hard stop -${s}% + target +${T}% (no line)`, { stop: s, target: T }]);
for (const [a, b] of [[3, 0.1], [5, 0.1], [8, 0.1], [10, 2], [10, 5]]) V.push([`line + break-even lock at +${a}% -> stop +${b}%`, { st: true, be: [a, b] }]);
for (const m of [2, 3, 4]) V.push([`line + ${m} ATR trail (from high close)`, { st: true, trail: m }]);
for (const N of [10, 15, 20, 30]) V.push([`line + time stop ${N}d`, { st: true, timeN: N }]);
for (const s of [6, 8, 10]) V.push([`line + hard stop -${s}%`, { st: true, stop: s }]);
for (const [name, v] of V) show(name, flipRows.map(x => exitSim(x.S, x.t, v)).filter(Boolean));
