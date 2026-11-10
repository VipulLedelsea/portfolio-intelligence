// Why do some flips (and stocks) lose and others win? Compare winning and losing Supertrend flips on what was known at entry, check each difference on both halves,
// look at the anatomy of the losses, and test stock-level "choppiness" measures that were computable before each trade.
import { data, memberAt, exitSim, stats, mean, f2, WARM, secOf, SPY } from "./lib14.mjs";
const SPLIT = "2024-11-05", rows = [];
const er = (S, t, k) => { let path = 0; for (let i = t - k + 1; i <= t; i++) path += Math.abs(S.c[i] - S.c[i - 1]); return path > 0 ? Math.abs(S.c[t] - S.c[t - k]) / path : NaN; };
for (const [sym, S] of data) { if (sym === "SPY") continue; let lastFlip = -1; const flipIdx = [];
  for (let t = 11; t < S.n; t++) if (S.st[t] === 1 && S.st[t - 1] === -1) flipIdx.push(t);
  for (const t of flipIdx) { if (t < WARM || t >= S.n - 130 || !memberAt(sym, S.d[t]) || !(S.atr14[t] > 0)) continue; const r = exitSim(S, t, { st: true }); if (!r || S.hasBad(t - 252, t + 1 + r.days + 1)) continue;
    const e = t + 1, entry = S.o[e]; let mfe = -Infinity, mae = Infinity; for (let k = e; k < e + r.days; k++) { mfe = Math.max(mfe, S.h[k] / entry - 1); mae = Math.min(mae, S.l[k] / entry - 1); }
    const prior = flipIdx.filter(i => i < t && i >= t - 250), j = SPY.dateIdx.get(S.d[t]); if (j === undefined || j < 252) continue;
    rows.push({ sym, sector: secOf(sym) || "former", date: S.d[e], ret: r.ret, days: r.days, mfe: mfe * 100, mae: mae * 100, gate: S.adx[t] >= 20 && S.adx[t] > S.adx[t - 5],
      f: { "ATR % of price": S.atr14[t] / S.c[t] * 100, "ADX": S.adx[t], "flips in the last 250 days (choppiness)": prior.length, "days since the previous flip": t - (flipIdx.filter(i => i < t).at(-1) ?? t - 300),
        "efficiency ratio 40d (trendiness)": er(S, t, 40), "efficiency ratio 100d": er(S, t, 100), "stop distance % (close vs Supertrend line)": (S.c[t] - S.stLine[t]) / S.c[t] * 100,
        "close vs 50d avg %": (S.c[t] / S.sma50[t] - 1) * 100, "close vs 200d avg %": (S.c[t] / S.sma200[t] - 1) * 100, "60d return %": (S.c[t] / S.c[t - 60] - 1) * 100,
        "RS 63d vs SPY %": ((S.c[t] / S.c[t - 63]) - (SPY.c[j] / SPY.c[j - 63])) * 100, "pct below 252d high": (1 - S.c[t] / S.hi252[t]) * 100, "relative volume (flip day)": S.v[t] / S.vol50[t],
        "gap on flip day %": (S.o[t] / S.c[t - 1] - 1) * 100, "dollar volume 20d ($M)": S.dvol20[t] / 1e6, "SPY % below its 252d high": (1 - SPY.c[j] / SPY.hi252[j]) * 100,
        "SPY above 200d (1/0)": SPY.c[j] > SPY.sma200[j] ? 1 : 0, "stock closed above 200d (1/0)": S.c[t] > S.sma200[t] ? 1 : 0 } }); } }
const auc = (pos, neg) => { const all = [...pos.map(s => [s, 1]), ...neg.map(s => [s, 0])].sort((a, b) => a[0] - b[0]); let i = 0, sp = 0; while (i < all.length) { let j = i; while (j < all.length && all[j][0] === all[i][0]) j++; const avg = (i + j + 1) / 2; for (let k = i; k < j; k++) if (all[k][1]) sp += avg; i = j; } return (sp - pos.length * (pos.length + 1) / 2) / (pos.length * neg.length); };
const sdv = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
for (const [label, set] of [["ALL daily flips", rows], ["APP-GATED flips", rows.filter(r => r.gate)]]) {
  const W = set.filter(r => r.ret > 0), L = set.filter(r => r.ret <= 0), tr = set.filter(r => r.date < SPLIT), te = set.filter(r => r.date >= SPLIT);
  console.log(`\n################ ${label}: ${set.length} flips, ${W.length} winners (avg ${f2(mean(W.map(r => r.ret)), 1)}%), ${L.length} losers (avg ${f2(mean(L.map(r => r.ret)), 1)}%)`);
  console.log("feature".padEnd(46) + "winners".padStart(9) + "losers".padStart(9) + "AUC all".padStart(9) + "AUC early".padStart(10) + "AUC late".padStart(9) + "  stable?");
  const out = Object.keys(set[0].f).map(k => { const g = (a, w) => a.filter(r => (r.ret > 0) === w).map(r => r.f[k]).filter(Number.isFinite), a = auc(g(set, true), g(set, false)), a1 = auc(g(tr, true), g(tr, false)), a2 = auc(g(te, true), g(te, false)); return { k, w: mean(g(set, true)), l: mean(g(set, false)), a, a1, a2, stable: (a1 - 0.5) * (a2 - 0.5) > 0 && Math.abs(a1 - 0.5) > 0.02 && Math.abs(a2 - 0.5) > 0.02 }; }).sort((x, y) => Math.abs(y.a - 0.5) - Math.abs(x.a - 0.5));
  out.forEach(o => console.log(o.k.padEnd(46) + f2(o.w, 1).padStart(9) + f2(o.l, 1).padStart(9) + f2(o.a, 3).padStart(9) + f2(o.a1, 3).padStart(10) + f2(o.a2, 3).padStart(9) + (o.stable ? "  YES" : "")));
  // tercile tables for the top stable features
  for (const o of out.filter(o => o.stable).slice(0, 4)) { const v = set.map(r => r.f[o.k]).filter(Number.isFinite).sort((a, b) => a - b), c1 = v[Math.floor(v.length / 3)], c2 = v[Math.floor(2 * v.length / 3)];
    console.log(`  ${o.k}: ` + [["low", r => r.f[o.k] <= c1], ["mid", r => r.f[o.k] > c1 && r.f[o.k] <= c2], ["high", r => r.f[o.k] > c2]].map(([n, f]) => { const a = set.filter(f), a1 = a.filter(r => r.date < SPLIT), a2 = a.filter(r => r.date >= SPLIT), s = x => stats(x.map(r => ({ ret: r.ret, days: 1 }))); return `${n} win ${f2(s(a).win, 0)}% avg ${f2(s(a).avg)}% (early ${f2(s(a1).win, 0)}/${f2(s(a2).win, 0)} late)`; }).join(" | ")); }
}
const L = rows.filter(r => r.ret <= 0), W = rows.filter(r => r.ret > 0);
console.log(`\n== anatomy of the ${L.length} losing flips (all flips) ==`);
console.log(`losers: held ${f2(mean(L.map(r => r.days)), 0)} days vs winners ${f2(mean(W.map(r => r.days)), 0)}; average worst dip ${f2(mean(L.map(r => r.mae)), 1)}%`);
const pc = (a, f) => f2(a.filter(f).length / a.length * 100, 0) + "%";
console.log(`losers that NEVER rose 2% above entry: ${pc(L, r => r.mfe < 2)}; reached +5% first: ${pc(L, r => r.mfe >= 5)}; reached +10% first: ${pc(L, r => r.mfe >= 10)}; ended within 3 days: ${pc(L, r => r.days <= 3)}; stopped inside 10 days: ${pc(L, r => r.days <= 10)}`);
console.log(`winners that dipped more than 5% below entry first: ${pc(W, r => r.mae <= -5)}; winners average best run ${f2(mean(W.map(r => r.mfe)), 1)}%`);
// stock level: stocks with no wins vs the rest
const byS = new Map(); for (const r of rows) (byS.get(r.sym) || byS.set(r.sym, []).get(r.sym)).push(r);
const stock = [...byS].filter(([, a]) => a.length >= 3).map(([sym, a]) => ({ sym, zero: a.every(r => r.ret <= 0), winPct: a.filter(r => r.ret > 0).length / a.length * 100, atr: mean(a.map(r => r.f["ATR % of price"])), chop: mean(a.map(r => r.f["flips in the last 250 days (choppiness)"])), er: mean(a.map(r => r.f["efficiency ratio 100d"])), adx: mean(a.map(r => r.f["ADX"])), sector: a[0].sector }));
const Z = stock.filter(s => s.zero), O = stock.filter(s => !s.zero);
console.log(`\n== stocks with 3+ flips and NO wins (${Z.length}) vs the other ${O.length} ==`);
for (const [k, n] of [["atr", "ATR % of price at entry"], ["chop", "flips in the last 250 days"], ["er", "efficiency ratio 100d"], ["adx", "ADX at entry"]]) console.log(`  ${n.padEnd(30)} no-win stocks ${f2(mean(Z.map(s => s[k])), 2)}  other stocks ${f2(mean(O.map(s => s[k])), 2)}`);
console.log("  sectors of the no-win stocks:", JSON.stringify(Z.reduce((m, s) => (m[s.sector] = (m[s.sector] || 0) + 1, m), {})));
const sc = [...stock].sort((a, b) => a.winPct - b.winPct); console.log("  correlation of per-stock win % with ATR %:", f2(corr(stock.map(s => s.atr), stock.map(s => s.winPct)), 2), "| with flips/250d:", f2(corr(stock.map(s => s.chop), stock.map(s => s.winPct)), 2), "| with efficiency ratio:", f2(corr(stock.map(s => s.er), stock.map(s => s.winPct)), 2));
function corr(a, b) { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / Math.sqrt(da * db); }
