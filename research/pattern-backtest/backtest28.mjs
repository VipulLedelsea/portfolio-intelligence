// Which STOCKS do not produce wins? Per-stock results of the daily Supertrend flip (current exit), and whether a stock's past record predicts its future one.
import { data, memberAt, exitSim, stats, mean, f2, WARM, secOf } from "./lib14.mjs";
const SPLIT = "2024-11-05", by = new Map();
for (const [sym, S] of data) { if (sym === "SPY") continue;
  for (let t = WARM; t < S.n - 130; t++) { if (!(S.st[t] === 1 && S.st[t - 1] === -1) || !memberAt(sym, S.d[t]) || !(S.atr14[t] > 0)) continue; const r = exitSim(S, t, { st: true }); if (!r || S.hasBad(t - 252, t + 1 + r.days + 1)) continue;
    (by.get(sym) || by.set(sym, []).get(sym)).push({ ret: r.ret, date: S.d[t + 1], days: r.days, atrPct: S.atr14[t] / S.c[t] * 100 }); } }
const all = [...by.values()].flat(); console.log(`stocks with flips: ${by.size}, flips ${all.length}, avg per stock ${f2(all.length / by.size, 1)}; baseline win ${f2(stats(all).win, 1)}% avg ${f2(stats(all).avg)}%`);
// per-stock table (>= 8 flips)
const rows = [...by].map(([sym, a]) => ({ sym, sector: secOf(sym) || "?", n: a.length, win: stats(a).win, avg: stats(a).avg })).filter(r => r.n >= 8);
rows.sort((x, y) => x.avg - y.avg);
console.log(`\n== the 15 weakest stocks with >= 8 flips (${rows.length} stocks qualify) ==`); rows.slice(0, 15).forEach(r => console.log(`  ${r.sym.padEnd(6)} ${r.sector.padEnd(24)} n=${r.n} win ${f2(r.win, 0)}% avg ${f2(r.avg)}%`));
console.log("== the 10 strongest =="); rows.slice(-10).reverse().forEach(r => console.log(`  ${r.sym.padEnd(6)} ${r.sector.padEnd(24)} n=${r.n} win ${f2(r.win, 0)}% avg ${f2(r.avg)}%`));
// persistence: does a stock's record before the split predict its record after?
const pairs = []; for (const [sym, a] of by) { const tr = a.filter(x => x.date < SPLIT), te = a.filter(x => x.date >= SPLIT); if (tr.length >= 4 && te.length >= 2) pairs.push({ sym, trWin: stats(tr).win, trAvg: stats(tr).avg, te }); }
const q = (arr, f) => { const s = [...arr].sort((a, b) => f(a) - f(b)), k = Math.floor(s.length / 3); return [s.slice(0, k), s.slice(k, 2 * k), s.slice(2 * k)]; };
console.log(`\n== persistence: ${pairs.length} stocks with >=4 flips before ${SPLIT} and >=2 after; split by their EARLIER win rate ==`);
for (const [label, grp] of [["weakest third", 0], ["middle third", 1], ["strongest third", 2]].map(([l, i]) => [l, q(pairs, p => p.trWin + p.trAvg / 100)[i]])) { const te = grp.flatMap(p => p.te); console.log(`  ${label.padEnd(16)} stocks ${grp.length}: earlier win ${f2(mean(grp.map(p => p.trWin)), 0)}% -> LATER win ${f2(stats(te).win, 1)}% avg ${f2(stats(te).avg)}% (n ${te.length})`); }
// sectors, volatility
const sect = new Map(); for (const [sym, a] of by) for (const x of a) (sect.get(secOf(sym) || "?") || sect.set(secOf(sym) || "?", []).get(secOf(sym) || "?")).push(x);
console.log("\n== by sector =="); [...sect].map(([s, a]) => ({ s, n: a.length, w: stats(a), tr: stats(a.filter(x => x.date < SPLIT)), te: stats(a.filter(x => x.date >= SPLIT)) })).sort((x, y) => x.w.avg - y.w.avg).forEach(o => console.log(`  ${o.s.padEnd(24)} n=${String(o.n).padStart(4)} win ${f2(o.w.win, 0)}% avg ${f2(o.w.avg).padStart(5)}%  (train ${f2(o.tr.win, 0)}%/${f2(o.tr.avg)} test ${f2(o.te.win, 0)}%/${f2(o.te.avg)})`));
const vs = [...all].sort((a, b) => a.atrPct - b.atrPct), k = Math.floor(vs.length / 3);
console.log("\n== by volatility (daily ATR % of price) =="); [["calmest third", vs.slice(0, k)], ["middle", vs.slice(k, 2 * k)], ["most volatile third", vs.slice(2 * k)]].forEach(([l, a]) => console.log(`  ${l.padEnd(20)} ATR ${f2(mean(a.map(x => x.atrPct)), 1)}%: win ${f2(stats(a).win, 0)}% avg ${f2(stats(a).avg)}% (train ${f2(stats(a.filter(x => x.date < SPLIT)).win, 0)}%/${f2(stats(a.filter(x => x.date < SPLIT)).avg)} test ${f2(stats(a.filter(x => x.date >= SPLIT)).win, 0)}%/${f2(stats(a.filter(x => x.date >= SPLIT)).avg)})`));
