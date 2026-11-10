// Supertrend + support/resistance (the owner's idea). Supertrend up gives direction. Entry when price sits on a support: a clustered pivot-low level
// or the Supertrend line itself. Stop just under the support (risk capped at 5%). Target: the next resistance (a pivot-high above) or a fixed R multiple.
// Pivots are fractals (3 bars each side) and are only known 3 bars after they form, so there is no lookahead. 15-day cap, 0.1% per side.
import { data, memberAt, stats, mean, f2, COST, WARM } from "./lib14.mjs";
const SPLIT = "2024-11-05", H = 15, LB = 120;
function pivots(S) { const pl = [], ph = []; for (let i = 3; i < S.n - 3; i++) { let lo = true, hi = true; for (let k = 1; k <= 3; k++) { if (!(S.l[i] < S.l[i - k] && S.l[i] < S.l[i + k])) lo = false; if (!(S.h[i] > S.h[i - k] && S.h[i] > S.h[i + k])) hi = false; } if (lo) pl.push(i); if (hi) ph.push(i); } return { pl, ph }; }
const rows = [];
for (const [sym, S] of data) { if (sym === "SPY") continue; const { pl, ph } = pivots(S); let free = -1, a0 = 0, b0 = 0;
  for (let t = WARM; t < S.n - H - 2; t++) { if (t <= free || S.st[t] !== 1 || !(S.atr14[t] > 0) || !memberAt(sym, S.d[t])) continue;
    const atr = S.atr14[t], c = S.c[t];
    // usable pivots: formed at i, known at i+3 <= t, within the last LB bars
    const lows = pl.filter(i => i + 3 <= t && i >= t - LB).map(i => S.l[i]), highs = ph.filter(i => i + 3 <= t && i >= t - 252).map(i => S.h[i]);
    // candidate support levels
    const cands = [];
    const below = lows.filter(p => p < c + 0.2 * atr && c - p <= 3 * atr).sort((x, y) => y - x);
    if (below.length) { const p = below[0]; cands.push({ type: "pivot", px: p, touches: lows.filter(q => Math.abs(q - p) <= 0.4 * atr).length }); }
    if (S.stLine[t] < c) cands.push({ type: "stline", px: S.stLine[t], touches: 1 });
    const res = highs.filter(p => p > c + 0.5 * atr).sort((x, y) => x - y)[0] ?? null;
    for (const sp of cands) { const dist = (c - sp.px) / atr; if (dist > 1.0) continue;
      const e = t + 1, entry = S.o[e]; if (!(entry > 0) || S.hasBad(t - 252, t + H + 1)) continue;
      const bounce = S.c[t] > S.o[t] && S.l[t] <= sp.px + 0.3 * atr;
      const stop = sp.px - 0.25 * atr, risk = entry - stop; if (!(risk > 0) || risk / entry > 0.05 || risk / entry < 0.006) continue;
      const tg = { "resistance": res && res > entry ? res : null, "0.25R": entry + 0.25 * risk, "0.5R": entry + 0.5 * risk, "0.75R": entry + 0.75 * risk, "1R": entry + risk, "1.5R": entry + 1.5 * risk, "2R": entry + 2 * risk };
      const r = {}; for (const [tn, tp] of Object.entries(tg)) { if (!tp) { r[tn] = null; continue; } let exit = S.c[e + H - 1]; for (let j = e; j < e + H; j++) { if (j > e && S.o[j] <= stop) { exit = S.o[j]; break; } if (S.l[j] <= stop) { exit = stop; break; } if (j > e && S.o[j] >= tp) { exit = S.o[j]; break; } if (S.h[j] >= tp) { exit = tp; break; } } r[tn] = (exit / entry - 1 - 2 * COST) * 100; }
      rows.push({ sym, date: S.d[e], type: sp.type, touches: sp.touches, dist, bounce, age: S.stAge[t], riskPct: 100 * risk / entry, resR: res ? (res - entry) / risk : null, r }); } } }
console.log(`candidate setups: ${rows.length} (pivot support ${rows.filter(r => r.type === "pivot").length}, Supertrend-line support ${rows.filter(r => r.type === "stline").length})`);
const out = [];
for (const type of ["pivot", "stline"]) for (const dmax of [0.5, 1.0]) for (const bounce of [false, true]) for (const minT of type === "pivot" ? [1, 2, 3] : [1]) for (const fresh of [false, true]) for (const tn of ["resistance", "0.25R", "0.5R", "0.75R", "1R", "1.5R", "2R"]) for (const minRes of tn === "resistance" ? [0, 1, 1.5] : [0]) {
  const sel = rows.filter(r => r.type === type && r.dist <= dmax && (!bounce || r.bounce) && r.touches >= minT && (!fresh || r.age <= 10) && r.r[tn] !== null && (minRes === 0 || (r.resR !== null && r.resR >= minRes)));
  // one trade per stock per 5 days to limit overlap
  const seen = new Map(), tr = []; for (const r of sel.sort((a, b) => a.date < b.date ? -1 : 1)) { const k = r.sym, last = seen.get(k); if (last && r.date <= last) continue; seen.set(k, nextDate(r.date)); tr.push({ ret: r.r[tn], date: r.date, days: H, riskPct: r.riskPct }); }
  if (tr.length < 200) continue; const s = stats(tr), a = stats(tr.filter(x => x.date < SPLIT)), b = stats(tr.filter(x => x.date >= SPLIT));
  out.push({ label: `${type} <=${dmax}ATR${bounce ? " bounce" : ""} touches>=${minT}${fresh ? " ST<=10d" : ""} target ${tn}${minRes ? " (res>=" + minRes + "R)" : ""}`, n: s.n, win: s.win, avg: s.avg, aw: s.avgWin, al: s.avgLoss, tw: a.win, ta: a.avg, ew: b.win, ea: b.avg, risk: mean(tr.map(x => x.riskPct)) });
}
function nextDate(d) { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + 7); return t.toISOString().slice(0, 10); }
const line = o => `${o.label.padEnd(66)} n=${String(o.n).padStart(5)} win ${f2(o.win, 1).padStart(5)}% avg ${f2(o.avg).padStart(5)}% (win ${f2(o.aw, 1)}, loss ${f2(o.al, 1)}) risk ${f2(o.risk, 1)}% | train ${f2(o.tw, 0)}/${f2(o.ta)} test ${f2(o.ew, 0)}/${f2(o.ea)}`;
console.log(`\nconfigurations tried (n>=200): ${out.length}`);
console.log("\n== highest win rate with avg > 0 on BOTH halves ==");
out.filter(o => o.ta > 0 && o.ea > 0).sort((x, y) => y.win - x.win).slice(0, 15).forEach(o => console.log(line(o)));
console.log("\n== win rate >= 70% (any profit) ==");
out.filter(o => o.win >= 70).sort((x, y) => y.avg - x.avg).slice(0, 10).forEach(o => console.log(line(o)));
console.log("\n== highest win rate regardless of profit ==");
out.sort((x, y) => y.win - x.win).slice(0, 8).forEach(o => console.log(line(o)));
console.log("\n== best average return with test-half win >= 60% ==");
out.filter(o => o.ew >= 60).sort((x, y) => y.avg - x.avg).slice(0, 8).forEach(o => console.log(line(o)));
