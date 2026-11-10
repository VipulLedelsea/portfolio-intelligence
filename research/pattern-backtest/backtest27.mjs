// Supertrend + chart patterns as the main strategy (owner's direction). Pattern breakouts that happen while the daily Supertrend is UP (ADX gate optional),
// with the pattern's own stop (under the flag / base / handle / pivot lows) and measured-move target, or a Supertrend-line exit. Each trade is compared with
// matched random controls: random Supertrend-up days in the same month with the same stop and target distance in ATR units.
import { data, memberAt, stats, mean, f2, COST, WARM } from "./lib14.mjs";
const SPLIT = "2024-11-05", CAPD = 30;
const piv = S => { const pl = [], ph = []; for (let i = 3; i < S.n - 3; i++) { let lo = true, hi = true; for (let k = 1; k <= 3; k++) { if (!(S.l[i] < S.l[i - k] && S.l[i] < S.l[i + k])) lo = false; if (!(S.h[i] > S.h[i - k] && S.h[i] > S.h[i + k])) hi = false; } if (lo) pl.push(i); if (hi) ph.push(i); } return { pl, ph }; };
const mx = (a, i, j) => { let m = -Infinity; for (let k = i; k <= j; k++) m = Math.max(m, a[k]); return m; }, mn = (a, i, j) => { let m = Infinity; for (let k = i; k <= j; k++) m = Math.min(m, a[k]); return m; };
const DET = {
  "Bull flag": (S, t) => { for (let fl = 3; fl <= 10; fl++) { const fh = mx(S.h, t - fl, t - 1), fL = mn(S.l, t - fl, t - 1); const ps = t - fl - 15, pe = t - fl; const pl = mn(S.l, ps, pe), ph = mx(S.h, ps, pe); const pole = ph - pl; if (!(pole / pl >= 0.20)) continue; if (!((fh - fL) <= 0.5 * pole) || fL < ph - 0.5 * pole) continue; if (S.c[t] > fh && S.c[t - 1] <= fh) return { stop: fL, target: S.c[t] + pole }; } return null; },
  "Flat base breakout": (S, t) => { const hi = mx(S.h, t - 25, t - 1), lo = mn(S.l, t - 25, t - 1); if (!((hi - lo) / hi <= 0.12 && S.c[t] > hi && S.c[t - 1] <= hi && S.v[t] >= 1.3 * S.vol50[t])) return null; return { stop: lo, target: S.c[t] + (hi - lo) }; },
  "Cup and handle": (S, t) => { const left = mx(S.h, t - 100, t - 30); let li = -1; for (let k = t - 100; k <= t - 30; k++) if (S.h[k] === left) { li = k; break; } const bot = mn(S.l, li, t - 8), dd = 1 - bot / left; if (!(dd >= 0.15 && dd <= 0.35)) return null; const hh = mx(S.h, t - 12, t - 1), hl = mn(S.l, t - 12, t - 1); if (!(hh >= 0.95 * left && (hh - hl) / hh <= 0.12 && S.c[t] > hh && S.c[t - 1] <= hh)) return null; return { stop: hl, target: S.c[t] + (left - bot) }; },
  "Ascending triangle": (S, t, P) => { const hs = P.ph.filter(i => i + 3 <= t && i >= t - 40), ls = P.pl.filter(i => i + 3 <= t && i >= t - 40); if (hs.length < 2 || ls.length < 2) return null; const top = Math.max(...hs.map(i => S.h[i])); if (!hs.every(i => Math.abs(S.h[i] / top - 1) <= 0.015)) return null; if (!(S.l[ls.at(-1)] > S.l[ls[0]] * 1.01)) return null; if (!(S.c[t] > top && S.c[t - 1] <= top)) return null; return { stop: S.l[ls.at(-1)], target: S.c[t] + (top - S.l[ls[0]]) }; },
  "Double bottom": (S, t, P) => { const ls = P.pl.filter(i => i + 3 <= t && i >= t - 60); for (let a = 0; a < ls.length; a++) for (let b = a + 1; b < ls.length; b++) { const i = ls[a], j = ls[b]; if (j - i < 10 || j - i > 40 || Math.abs(S.l[i] / S.l[j] - 1) > 0.03) continue; const mid = mx(S.h, i, j); if (S.c[t] > mid && S.c[t - 1] <= mid) { const low = Math.min(S.l[i], S.l[j]); return { stop: low, target: S.c[t] + (mid - low) }; } } return null; },
};
function run(S, e, stop, target, mode) { // mode "target": stop+measured target+30d; mode "line": stop + Supertrend line exit (120d cap)
  const entry = S.o[e]; const cap = mode === "line" ? 120 : CAPD, last = Math.min(S.n - 1, e + cap - 1); if (e + cap - 1 >= S.n || !(entry > 0)) return null; let exit = S.c[last];
  for (let k = e; k <= last; k++) { if (k > e && S.o[k] <= stop) { exit = S.o[k]; break; } if (S.l[k] <= stop) { exit = stop; break; }
    if (mode === "target") { if (k > e && S.o[k] >= target) { exit = S.o[k]; break; } if (S.h[k] >= target) { exit = target; break; } }
    else if (S.st[k] === -1) { const nx = Math.min(k + 1, S.n - 1); exit = nx > k ? S.o[nx] : S.c[k]; break; } }
  return (exit / entry - 1 - 2 * COST) * 100; }
const trades = [], pool = new Map(); // pool: month -> list of {sym, t} Supertrend-up days for controls
for (const [sym, S] of data) { if (sym === "SPY") continue; const P = piv(S);
  for (let t = WARM; t < S.n - 130; t++) { if (!(S.st[t] === 1 && S.atr14[t] > 0) || !memberAt(sym, S.d[t])) continue; const m = S.d[t].slice(0, 7); if (t % 4 === 0) (pool.get(m) || pool.set(m, []).get(m)).push({ sym, t });
    if (S.hasBad(t - 252, t + 130)) continue; const e = t + 1, entry = S.o[e]; if (!(entry > 0)) continue;
    for (const [pn, det] of Object.entries(DET)) { let d = null; try { d = det(S, t, P); } catch {} if (!d) continue; const risk = entry - d.stop, gain = d.target - entry; if (!(risk > 0) || risk / entry > 0.08 || risk / entry < 0.01 || !(gain > 0)) continue;
      trades.push({ pn, sym, t, e, date: S.d[e], month: S.d[t].slice(0, 7), stop: d.stop, target: d.target, riskA: risk / S.atr14[t], gainA: gain / S.atr14[t], riskPct: 100 * risk / entry, gainPct: 100 * gain / entry, fresh: S.stAge[t] <= 10, gate: S.adx[t] >= 20 && S.adx[t] > S.adx[t - 5] }); } } }
let seed = 4242; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const sh = a => { if (a.length < 5) return `n=${a.length}`; const s = stats(a.map(x => ({ ret: x, days: 1 }))); return `n=${String(s.n).padStart(4)} win ${f2(s.win, 0).padStart(3)}% avg ${f2(s.avg).padStart(5)}% (win ${f2(s.avgWin, 1)}, loss ${f2(s.avgLoss, 1)})`; };
for (const mode of ["target", "line"]) {
  console.log(`\n################ exit: ${mode === "target" ? "pattern stop + measured-move target, 30-day cap" : "pattern stop + Supertrend-line exit (no target)"}`);
  for (const [filtName, filt] of [["Supertrend up", () => true], ["Supertrend up + ADX gate", t => t.gate], ["fresh Supertrend (<=10d)", t => t.fresh]]) {
    console.log(`-- ${filtName}`); console.log("pattern".padEnd(22) + "PATTERN trades".padEnd(54) + "train / test win%, avg%".padEnd(28) + "MATCHED CONTROL".padEnd(44) + "edge win / avg");
    for (const pn of Object.keys(DET)) { const T = trades.filter(t => t.pn === pn && filt(t)); const res = [], ctl = [];
      for (const tr of T) { const S = data.get(tr.sym), r = run(S, tr.e, tr.stop, tr.target, mode); if (r === null) continue; res.push({ r, date: tr.date });
        const cands = pool.get(tr.month) || []; for (let k = 0; k < 8 && cands.length; k++) { const c = cands[Math.floor(rnd() * cands.length)], S2 = data.get(c.sym), e2 = c.t + 1, en = S2.o[e2]; if (!(en > 0)) continue; const atr = S2.atr14[c.t]; const rr = run(S2, e2, en - tr.riskA * atr, en + tr.gainA * atr, mode); if (rr !== null) ctl.push(rr); } }
      if (res.length < 15) { console.log(pn.padEnd(22) + `n=${res.length} (too few)`); continue; }
      const a = res.filter(x => x.date < SPLIT).map(x => x.r), b = res.filter(x => x.date >= SPLIT).map(x => x.r), all = res.map(x => x.r), cw = ctl.filter(x => x > 0).length / ctl.length * 100, pw = all.filter(x => x > 0).length / all.length * 100;
      console.log(pn.padEnd(22) + sh(all).padEnd(54) + `${f2(stats(a.map(x => ({ ret: x, days: 1 }))).win, 0)}/${f2(stats(b.map(x => ({ ret: x, days: 1 }))).win, 0)}%  ${f2(mean(a))}/${f2(mean(b))}%`.padEnd(28) + `win ${f2(cw, 0)}% avg ${f2(mean(ctl))}%`.padEnd(44) + `${f2(pw - cw, 1)} pts / ${f2(mean(all) - mean(ctl))}%`); } }
}
const byP = {}; for (const t of trades) byP[t.pn] = (byP[t.pn] || 0) + 1; console.log("\nraw pattern signals in Supertrend-up (risk 1-8%):", JSON.stringify(byP), "| avg risk", f2(mean(trades.map(t => t.riskPct)), 1), "% avg measured-move gain", f2(mean(trades.map(t => t.gainPct)), 1), "%");
