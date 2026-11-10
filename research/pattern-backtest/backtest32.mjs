// What if ALL exits were converted to 5%-10% profit points? Compare the current exits with +5%, +7.5%, +10% and scale-out (half at +5%, rest at +10%) profit points,
// for (A) Supertrend flips (app-gated and all) and (B) the stress-dip scan (RSI2 setups with the SPY-stress gate). Point-in-time S&P 500, next-open entry, 0.1% per side.
import { data, SPY, memberAt, mean, f2, COST, WARM } from "./lib14.mjs";
const SPLIT = "2024-11-05";
// ---- generic exit simulator: stop (price or line), optional two profit points with a share sold at each, hold cap ----
function sim(S, e, o) { // o: { stopPx, line: bool, p1, f1, p2, cap }
  const entry = S.o[e]; if (!(entry > 0) || e + o.cap - 1 >= S.n) return null; const last = e + o.cap - 1;
  const t1 = o.p1 ? entry * (1 + o.p1 / 100) : Infinity, t2 = o.p2 ? entry * (1 + o.p2 / 100) : Infinity; let rem = 1, pnl = 0, wDays = 0, lastDay = 0, hit1 = false;
  const take = (frac, px, day) => { pnl += frac * (px / entry - 1); wDays += frac * day; rem -= frac; lastDay = day; };
  for (let k = e; k <= last && rem > 1e-9; k++) { const day = k - e + 1, stop = o.stopPx ?? -Infinity;
    if (S.l[k] <= stop || (k > e && S.o[k] <= stop)) { const px = (k > e && S.o[k] <= stop) ? S.o[k] : stop; take(rem, px, day); break; }
    if (!hit1 && S.h[k] >= t1) { hit1 = true; const px = (k > e && S.o[k] >= t1) ? S.o[k] : t1; take(o.f1 ?? 1, px, day); if (rem <= 1e-9) break; if (o.beAfter1) o.stopPx = Math.max(o.stopPx ?? -Infinity, entry * 1.001); }
    if (rem > 1e-9 && S.h[k] >= t2) { const px = (k > e && S.o[k] >= t2) ? S.o[k] : t2; take(rem, px, day); break; }
    if (o.line && S.st[k] === -1) { const nx = Math.min(k + 1, S.n - 1), px = nx > k ? S.o[nx] : S.c[k]; take(rem, px, nx - e + 1); break; } }
  if (rem > 1e-9) take(rem, S.c[last], last - e + 1);
  return { ret: (pnl - 2 * COST) * 100, days: wDays };
}
const fresh = o => ({ ...o });
const stat = a => { const r = a.map(x => x.ret), w = r.filter(x => x > 0), L = r.filter(x => x <= 0), d = mean(a.map(x => x.days)); return { n: a.length, win: w.length / r.length * 100, avg: mean(r), aw: mean(w), al: mean(L), days: d, perDay: mean(r) / d, pf: w.reduce((x, y) => x + y, 0) / -(L.reduce((x, y) => x + y, 0) || -1e-9) }; };
const row = (name, a) => { const s = stat(a), tr = stat(a.filter(x => x.date < SPLIT)), te = stat(a.filter(x => x.date >= SPLIT)); return `${name.padEnd(46)} win ${f2(s.win, 1).padStart(5)}%  avg ${f2(s.avg).padStart(5)}% (win ${f2(s.aw, 1).padStart(5)} / loss ${f2(s.al, 1).padStart(5)})  days ${f2(s.days, 0).padStart(3)}  %/day ${f2(s.perDay, 3).padStart(6)}  PF ${f2(s.pf)}  | early ${f2(tr.win, 0)}%/${f2(tr.avg)} late ${f2(te.win, 0)}%/${f2(te.avg)}`; };
// ---------------- A. Supertrend flips ----------------
const VARS = [
  ["CURRENT: Supertrend line only", S => ({ line: true, cap: 120 })],
  ["line + sell all at +5%", S => ({ line: true, p1: 5, f1: 1, cap: 120 })],
  ["line + sell all at +7.5%", S => ({ line: true, p1: 7.5, f1: 1, cap: 120 })],
  ["line + sell all at +10%", S => ({ line: true, p1: 10, f1: 1, cap: 120 })],
  ["line + half at +5%, rest at +10%", S => ({ line: true, p1: 5, f1: 0.5, p2: 10, cap: 120 })],
  ["line + half at +5%, rest on the line", S => ({ line: true, p1: 5, f1: 0.5, cap: 120 })],
  ["line + half at +5%, rest on the line, stop to breakeven", S => ({ line: true, p1: 5, f1: 0.5, beAfter1: true, cap: 120 })],
  ["line + half at +10%, rest on the line", S => ({ line: true, p1: 10, f1: 0.5, cap: 120 })],
];
const flips = [];
for (const [sym, S] of data) { if (sym === "SPY") continue; for (let t = WARM; t < S.n - 130; t++) { if (!(S.st[t] === 1 && S.st[t - 1] === -1) || !memberAt(sym, S.d[t]) || !(S.atr14[t] > 0)) continue; const cur = sim(S, t + 1, { line: true, cap: 120 }); if (!cur || S.hasBad(t - 252, t + 1 + Math.ceil(cur.days) + 1)) continue; flips.push({ S, e: t + 1, gate: S.adx[t] >= 20 && S.adx[t] > S.adx[t - 5], date: S.d[t + 1] }); } }
for (const [label, set] of [["APP-GATED flips (ADX >= 20 and rising)", flips.filter(f => f.gate)], ["ALL daily flips", flips]]) {
  console.log(`\n################ A. SUPERTREND — ${label}: ${set.length} trades`); for (const [name, mk] of VARS) console.log(row(name, set.map(f => ({ ...sim(f.S, f.e, mk(f.S)), date: f.date })))); }
// ---------------- B. stress-dip scan ----------------
const spy5 = (S, t) => { const j = SPY.dateIdx.get(S.d[t]); return j >= 5 ? SPY.c[j] / SPY.c[j - 5] - 1 : NaN; };
const dips = [];
for (const [sym, S] of data) { if (sym === "SPY") continue; let free = -1;
  for (let t = WARM; t < S.n - 40; t++) { if (t <= free || !memberAt(sym, S.d[t]) || !(S.atr14[t] > 0) || S.hasBad(t - 252, t + 30)) continue; if (!(S.c[t] > S.sma200[t] && S.rsi2[t] < 10 && spy5(S, t) <= -0.015)) continue;
    dips.push({ S, t, e: t + 1, date: S.d[t + 1], atr: S.atr14[t], sharp: S.rsi2[t] < 5 && S.c[t] / S.c[t - 3] - 1 < -0.05 }); free = t + 10; } }
const DV = (cap) => [
  [`CURRENT: stop 2 ATR, target 1 ATR, ${cap}d`, d => ({ stopPx: d.S.o[d.e] - 2 * d.atr, p1: 100 * d.atr / d.S.o[d.e], f1: 1, cap })],
  [`stop 2 ATR, sell all at +5%, ${cap}d`, d => ({ stopPx: d.S.o[d.e] - 2 * d.atr, p1: 5, f1: 1, cap })],
  [`stop 2 ATR, sell all at +10%, ${cap}d`, d => ({ stopPx: d.S.o[d.e] - 2 * d.atr, p1: 10, f1: 1, cap })],
  [`stop 2 ATR, half at +5%, rest at +10%, ${cap}d`, d => ({ stopPx: d.S.o[d.e] - 2 * d.atr, p1: 5, f1: 0.5, p2: 10, cap })],
  [`stop 5%, sell all at +5%, ${cap}d`, d => ({ stopPx: d.S.o[d.e] * 0.95, p1: 5, f1: 1, cap })],
];
for (const [label, set] of [["ALL stress dips (RSI2 < 10 above 200d, SPY 5d <= -1.5%)", dips], ["SHARP stress dips (RSI2 < 5, -5% in 3d)", dips.filter(d => d.sharp)]]) for (const cap of [10, 20]) {
  console.log(`\n################ B. STRESS-DIP — ${label}, cap ${cap} days: ${set.length} trades`); for (const [name, mk] of DV(cap)) { const rs = set.map(d => { const o = mk(d), r = sim(d.S, d.e, o); return r && { ...r, date: d.date }; }).filter(Boolean); console.log(row(name, rs)); } }
