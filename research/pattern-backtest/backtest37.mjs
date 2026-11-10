// Does rising SELLER volume signal the start of a downtrend? On every open-trade day (obs33.json, from the backtest33 set): measures of selling volume (volume on down closes,
// volume attributed to sellers by where the bar closed, net up/down volume balance) and whether they predict a 6%+ fall within 10 sessions or the Supertrend exit within 5.
import { readFileSync } from "node:fs";
import { data, mean, f2 } from "./lib14.mjs";
const SPLIT = "2024-11-05", obs = JSON.parse(readFileSync("obs33.json", "utf8"));
const sellV = (S, i) => { const r = S.h[i] - S.l[i]; return r > 0 ? S.v[i] * (S.h[i] - S.c[i]) / r : S.v[i] / 2; };
const sum = (S, a, b, f) => { let s = 0; for (let i = a; i <= b; i++) s += f(i); return s; };
function feats(S, d) {
  const dnAvg = (a, b) => { let s = 0, n = 0; for (let i = a; i <= b; i++) if (S.c[i] < S.c[i - 1]) { s += S.v[i]; n++; } return n ? [s / n, n] : [0, 0]; };
  const [d5, n5] = dnAvg(d - 4, d), [d20] = dnAvg(d - 24, d - 5); const va = S.vol50[d];
  const s5 = sum(S, d - 4, d, i => sellV(S, i)), s5p = sum(S, d - 14, d - 10, i => sellV(S, i)), s20 = sum(S, d - 19, d, i => sellV(S, i)) / 20, tot5 = sum(S, d - 4, d, i => S.v[i]);
  const up = (a, b) => sum(S, a, b, i => S.c[i] >= S.c[i - 1] ? S.v[i] : 0), dn = (a, b) => sum(S, a, b, i => S.c[i] < S.c[i - 1] ? S.v[i] : 0);
  const bal5 = (up(d - 4, d) - dn(d - 4, d)) / (tot5 || 1), tot10 = sum(S, d - 14, d - 5, i => S.v[i]), bal10p = (up(d - 14, d - 5) - dn(d - 14, d - 5)) / (tot10 || 1);
  const three = S.c[d] < S.c[d - 1] && S.c[d - 1] < S.c[d - 2] && S.c[d - 2] < S.c[d - 3] && S.v[d] > S.v[d - 1] && S.v[d - 1] > S.v[d - 2];
  return { // continuous measures (higher = more selling) and boolean flags
    ratioDown: d20 > 0 && n5 >= 2 ? d5 / d20 : NaN, sellShare5: s5 / (tot5 || 1), sellGrowth: s5p > 0 ? s5 / s5p : NaN, sell5vsAvg: s5 / 5 / (va || 1), balance5: -bal5, balanceChange: -(bal5 - bal10p), sell20: s20 / (va || 1),
    flags: { "down-day volume 30%+ higher than on earlier down days": d20 > 0 && n5 >= 2 && d5 >= 1.3 * d20, "sellers' volume (by close location) up 30%+ vs 10 days earlier": s5p > 0 && s5 >= 1.3 * s5p, "sellers' volume above 60% of the 5-day total": s5 / (tot5 || 1) > 0.6,
      "3 down closes in a row, each on more volume": three, "net volume balance negative over 5 days and worse than before": bal5 < 0 && bal5 < bal10p, "net volume balance below -30% over 5 days": bal5 < -0.3,
      "5-day sellers' volume 20%+ above the 50-day average volume": s5 / 5 > 1.2 * va, "up-volume faded: up days below 80% of average while sellers rose": up(d - 4, d) / 5 < 0.8 * va && s5 >= 1.3 * s5p, "any heavy selling day (1.5x volume on a down close)": [d, d - 1, d - 2, d - 3, d - 4].some(i => S.c[i] < S.c[i - 1] && S.v[i] >= 1.5 * va) } };
}
const rows = []; for (const o of obs) { const S = data.get(o.sym); try { rows.push({ ...feats(S, o.d), drop: o.drop, xs: o.xs, early: o.early, near: o.f[3], under10: o.f[0] || (o.x[11] < 0), downClose: S.c[o.d] < S.c[o.d - 1], trade: o.trade, lead: o.lead, exitPx: o.exitPx, c: o.c }); } catch { } }
const base = a => a.filter(x => x.drop).length / a.length * 100, bx = a => a.filter(x => x.xs).length / a.length * 100;
console.log(`open-trade days: ${rows.length}; base: 6%+ drop within 10 sessions ${f2(base(rows), 1)}% (train ${f2(base(rows.filter(r => r.early)), 1)} / test ${f2(base(rows.filter(r => !r.early)), 1)}); Supertrend exit within 5 sessions ${f2(bx(rows), 1)}%\n`);
console.log("== selling-volume flags ==\n" + "flag".padEnd(70) + "fires".padStart(8) + "P(drop)".padStart(9) + "not".padStart(7) + "lift".padStart(6) + "  train/test".padStart(13) + "  P(exit<=5d)  vs not");
for (const nm of Object.keys(rows[0].flags)) { const F = rows.filter(r => r.flags[nm]), N = rows.filter(r => !r.flags[nm]); if (F.length < 200) continue; console.log(nm.padEnd(70) + `${F.length}`.padStart(8) + (f2(base(F), 1) + "%").padStart(9) + (f2(base(N), 1) + "%").padStart(7) + f2(base(F) / base(N), 2).padStart(6) + `  ${f2(base(F.filter(r => r.early)), 0)}%/${f2(base(F.filter(r => !r.early)), 0)}%`.padStart(13) + `  ${f2(bx(F), 0)}% vs ${f2(bx(N), 0)}%`); }
const auc = (pos, neg) => { const all = [...pos.map(s => [s, 1]), ...neg.map(s => [s, 0])].sort((a, b) => a[0] - b[0]); let i = 0, sp = 0; while (i < all.length) { let j = i; while (j < all.length && all[j][0] === all[i][0]) j++; const av = (i + j + 1) / 2; for (let k = i; k < j; k++) if (all[k][1]) sp += av; i = j; } return (sp - pos.length * (pos.length + 1) / 2) / (pos.length * neg.length); };
console.log("\n== continuous measures: AUC for predicting a 6%+ drop (train / test) and the Supertrend exit within 5d; 0.50 = no information ==");
for (const k of ["ratioDown", "sellShare5", "sellGrowth", "sell5vsAvg", "balance5", "balanceChange", "sell20"]) { const ok = rows.filter(r => Number.isFinite(r[k])), a = (set, y) => auc(set.filter(y).map(r => r[k]), set.filter(r => !y(r)).map(r => r[k])), tr = ok.filter(r => r.early), te = ok.filter(r => !r.early);
  console.log(`  ${k.padEnd(14)} drop: ${f2(a(tr, r => r.drop), 3)} / ${f2(a(te, r => r.drop), 3)}   exit<=5d: ${f2(a(tr, r => r.xs), 3)} / ${f2(a(te, r => r.xs), 3)}`); }
console.log("\n== does it add anything beyond price weakness? Same flag, among days that ALREADY closed down / sit under the 10-day EMA ==");
for (const [ctx, f] of [["closed down today", r => r.downClose], ["closed under the 10-day EMA", r => r.under10], ["within 0.5 ATR of the Supertrend line", r => r.near]]) { const C = rows.filter(f); console.log(`  ${ctx}: base P(drop) ${f2(base(C), 1)}% (n ${C.length})`);
  for (const nm of ["down-day volume 30%+ higher than on earlier down days", "sellers' volume (by close location) up 30%+ vs 10 days earlier", "net volume balance negative over 5 days and worse than before"]) { const F = C.filter(r => r.flags[nm]), N = C.filter(r => !r.flags[nm]); console.log(`     ${nm.slice(0, 62).padEnd(62)} with: ${f2(base(F), 1)}% (n ${F.length}, test ${f2(base(F.filter(r => !r.early)), 0)}%)  without: ${f2(base(N), 1)}%`); } }
// first alert per trade for the two best-defined flags
const byTrade = new Map(); for (const r of rows) (byTrade.get(r.trade) || byTrade.set(r.trade, []).get(r.trade)).push(r);
console.log("\n== first time each flag fires in a trade ==");
for (const nm of ["down-day volume 30%+ higher than on earlier down days", "sellers' volume (by close location) up 30%+ vs 10 days earlier", "net volume balance negative over 5 days and worse than before", "3 down closes in a row, each on more volume"]) { const first = []; for (const [, a] of byTrade) { const h = a.find(r => r.flags[nm]); if (h) first.push(h); }
  const leads = first.filter(r => r.lead > 0).map(r => r.lead).sort((a, b) => a - b); console.log(`  ${nm}\n     fires in ${f2(first.length / byTrade.size * 100, 0)}% of trades; after it: 6%+ drop in 10d ${f2(base(first), 1)}% (base ${f2(base(rows), 1)}%); Supertrend exit within 5d ${f2(bx(first), 0)}%; median sessions to the exit ${leads[Math.floor(leads.length / 2)]}; eventual exit price vs that close: avg ${f2(mean(first.map(r => (r.exitPx / r.c - 1) * 100)))}%`); }
