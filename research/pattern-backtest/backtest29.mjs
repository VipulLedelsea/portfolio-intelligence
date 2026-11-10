// Run the current strategy (daily Supertrend flip, ADX >= 20 and rising, exit on the daily Supertrend line) and list the stocks with no winning trade.
// Two views: the app's gated flips, and every daily flip (more trades per stock). Writes stocks_no_wins.csv.
import { writeFileSync } from "node:fs";
import { data, memberAt, exitSim, stats, f2, WARM, secOf } from "./lib14.mjs";
const by = { gated: new Map(), all: new Map() };
for (const [sym, S] of data) { if (sym === "SPY") continue;
  for (let t = WARM; t < S.n - 130; t++) { if (!(S.st[t] === 1 && S.st[t - 1] === -1) || !memberAt(sym, S.d[t]) || !(S.atr14[t] > 0)) continue; const r = exitSim(S, t, { st: true }); if (!r || S.hasBad(t - 252, t + 1 + r.days + 1)) continue;
    const gate = S.adx[t] >= 20 && S.adx[t] > S.adx[t - 5], rec = { date: S.d[t + 1], ret: r.ret, days: r.days };
    (by.all.get(sym) || by.all.set(sym, []).get(sym)).push(rec); if (gate) (by.gated.get(sym) || by.gated.set(sym, []).get(sym)).push(rec); } }
const table = m => [...m].map(([sym, a]) => { const s = stats(a.map(x => ({ ret: x.ret, days: x.days }))); return { sym, sector: secOf(sym) || "(former member)", n: a.length, wins: a.filter(x => x.ret > 0).length, win: s.win, avg: s.avg, worst: Math.min(...a.map(x => x.ret)), best: Math.max(...a.map(x => x.ret)), last: a.at(-1).date }; });
const G = table(by.gated), A = table(by.all);
const gz = G.filter(r => r.wins === 0), az = A.filter(r => r.wins === 0);
console.log(`APP-GATED flips: ${G.length} stocks traded, ${G.reduce((s, r) => s + r.n, 0)} trades; stocks with ZERO wins: ${gz.length} (${f2(gz.length / G.length * 100, 0)}%); of those with 2+ gated trades: ${gz.filter(r => r.n >= 2).length}`);
console.log(`ALL daily flips: ${A.length} stocks, ${A.reduce((s, r) => s + r.n, 0)} trades; stocks with ZERO wins: ${az.length}; with 3+ flips: ${az.filter(r => r.n >= 3).length}; with 5+ flips: ${az.filter(r => r.n >= 5).length}`);
const fmt = r => `  ${r.sym.padEnd(6)} ${r.sector.padEnd(24)} trades ${String(r.n).padStart(2)}  wins 0  avg ${f2(r.avg).padStart(6)}%  worst ${f2(r.worst, 1).padStart(6)}%  last flip ${r.last}`;
console.log("\n== zero wins on ALL flips, 5+ flips (never produced a win), worst average first =="); az.filter(r => r.n >= 5).sort((a, b) => a.avg - b.avg).forEach(r => console.log(fmt(r)));
console.log("\n== zero wins on ALL flips, 3 to 4 flips =="); az.filter(r => r.n >= 3 && r.n <= 4).sort((a, b) => a.avg - b.avg).forEach(r => console.log(fmt(r)));
console.log("\n== zero wins on APP-GATED flips with 2+ gated trades =="); gz.filter(r => r.n >= 2).sort((a, b) => a.avg - b.avg).forEach(r => console.log(fmt(r)));
const rows = ["symbol,sector,view,trades,wins,win_pct,avg_return_pct,worst_pct,best_pct,last_flip"];
for (const [view, T] of [["all_flips", A], ["app_gated", G]]) for (const r of T.sort((a, b) => a.win - b.win || a.avg - b.avg)) rows.push([r.sym, `"${r.sector}"`, view, r.n, r.wins, f2(r.win, 0), f2(r.avg), f2(r.worst, 1), f2(r.best, 1), r.last].join(","));
writeFileSync("stocks_no_wins.csv", rows.join("\n") + "\n"); console.log(`\nwrote stocks_no_wins.csv (${rows.length - 1} rows, both views, sorted weakest first)`);
