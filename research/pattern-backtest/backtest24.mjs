// Earnings proximity on Supertrend ideas. Known at entry: how many trading days until the next report. Coverage: only entries on/after a stock's first listed report (about the last 5 quarters).
import { readFileSync } from "node:fs";
import { data, stats, mean, f2 } from "./lib14.mjs";
const earn = JSON.parse(readFileSync("earnings.json", "utf8")), rows = JSON.parse(readFileSync("rows14.json", "utf8")).rows;
const nextSession = (S, date) => { const i = S.dateIdx.get(date); return i === undefined ? date : (S.d[i + 1] || date); };
const out = [];
for (const r of rows) { const S = data.get(r.sym), ev = earn[r.sym]; if (!ev || !ev.length) continue; const e = r.t + 1, entryDate = S.d[e]; if (entryDate < ev[0][0]) continue;
  const react = ev.map(([d, w]) => w === "pm" ? nextSession(S, d) : d).filter(d => d >= entryDate).sort()[0]; if (!react) continue;
  const ri = S.dateIdx.get(react); let dte; if (ri !== undefined) dte = ri - e; else { // future date beyond the bars: estimate trading days as 5/7 of calendar days
    dte = Math.round((new Date(react) - new Date(entryDate)) / 864e5 * 5 / 7); }
  const exitIdx = e + r.days - 1; out.push({ ret: r.ret, days: r.days, date: entryDate, flip: r.flip, dte, inside: dte <= r.days - 1, sym: r.sym }); }
const show = (name, tr) => { const s = stats(tr); const w = tr.map(x => x.ret).sort((a, b) => a - b); return `${name.padEnd(34)} n=${String(s.n).padStart(5)} win ${f2(s.win, 1).padStart(5)}% avg ${f2(s.avg).padStart(5)}% avg win ${f2(s.avgWin, 1).padStart(5)} loss ${f2(s.avgLoss, 1).padStart(5)} worst5% ${f2(w[Math.floor(w.length * .05)], 1)}%`; };
for (const [label, set] of [["FRESH FLIPS (the app's entry)", out.filter(x => x.flip)], ["ALL Supertrend-up days (bigger sample)", out]]) {
  console.log(`\n== ${label}: covered trades ${set.length}, entries ${set.map(x => x.date).sort()[0]} to ${set.map(x => x.date).sort().at(-1)} ==`);
  console.log(show("all covered", set));
  console.log(show("report inside the hold", set.filter(x => x.inside))); console.log(show("no report inside the hold", set.filter(x => !x.inside)));
  console.log("by trading days from entry to the next report:");
  for (const [l, f] of [["0-5 days", x => x.dte <= 5], ["6-10 days", x => x.dte > 5 && x.dte <= 10], ["11-20 days", x => x.dte > 10 && x.dte <= 20], ["21-40 days", x => x.dte > 20 && x.dte <= 40], ["41+ days", x => x.dte > 40]]) console.log("  " + show(l, set.filter(f)));
  console.log("rule: skip entries with a report within N days:");
  for (const N of [5, 10, 15, 20]) { const keep = set.filter(x => x.dte > N), drop = set.filter(x => x.dte <= N); console.log(`  N=${N}: kept ${keep.length} win ${f2(stats(keep).win, 1)}% avg ${f2(stats(keep).avg)}%  | skipped ${drop.length} win ${f2(stats(drop).win, 1)}% avg ${f2(stats(drop).avg)}%`); }
}
