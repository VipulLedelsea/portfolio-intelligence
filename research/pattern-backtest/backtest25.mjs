// Volume x chart patterns x Supertrend (owner's focus). Base set: every daily Supertrend flip up (no ADX gate, so there are enough trades), entry next open.
// Part 1: each volume and pattern feature alone, with train/test halves. Part 2: all pairs and triples, picked on train, judged on test, with a permutation null
// (shuffle the outcomes among the same trades, repeat the same search) so we can see how good the best combination looks by pure chance.
import { data, memberAt, exitSim, stats, mean, f2, SPY, WARM } from "./lib14.mjs";
const SPLIT = "2024-11-05", NPERM = 30;
const pivots = S => { const pl = [], ph = []; for (let i = 3; i < S.n - 3; i++) { let lo = true, hi = true; for (let k = 1; k <= 3; k++) { if (!(S.l[i] < S.l[i - k] && S.l[i] < S.l[i + k])) lo = false; if (!(S.h[i] > S.h[i - k] && S.h[i] > S.h[i + k])) hi = false; } if (lo) pl.push(i); if (hi) ph.push(i); } return { pl, ph }; };
const sumV = (S, a, b, f) => { let s = 0; for (let i = a; i <= b; i++) if (f(i)) s += S.v[i]; return s; };
const spyI = (S, t) => SPY.dateIdx.get(S.d[t]);
const F = [
  ["vol: flip-day rel vol >= 1.5", (S, t) => S.v[t] >= 1.5 * S.vol50[t]], ["vol: flip-day rel vol >= 2", (S, t) => S.v[t] >= 2 * S.vol50[t]],
  ["vol: max rel vol of last 3d >= 2", (S, t) => Math.max(S.v[t], S.v[t - 1], S.v[t - 2]) >= 2 * S.vol50[t]],
  ["vol: 20d avg >= 1.1 x 50d avg", (S, t) => S.vol20[t] >= 1.1 * S.vol50[t]],
  ["vol: dry-up before (10d avg < 0.8 x 50d)", (S, t) => { let s = 0; for (let i = t - 10; i < t; i++) s += S.v[i]; return s / 10 < 0.8 * S.vol50[t]; }],
  ["vol: up/down volume ratio 20d >= 1.3", (S, t) => { const u = sumV(S, t - 19, t, i => S.c[i] > S.c[i - 1]), d = sumV(S, t - 19, t, i => S.c[i] < S.c[i - 1]); return d > 0 && u / d >= 1.3; }],
  ["vol: OBV above its 20d avg", (S, t) => S.obv[t] > S.obvMa[t]], ["vol: OBV rising 20d", (S, t) => S.obv[t] > S.obv[t - 20]],
  ["vol: dollar volume >= $100M", (S, t) => S.dvol20[t] >= 1e8],
  ["vol: flip-day volume is the 20d high", (S, t) => { let m = 0; for (let i = t - 20; i < t; i++) m = Math.max(m, S.v[i]); return S.v[t] > m; }],
  ["vol: power bar (+2% on rel vol >= 1.5)", (S, t) => S.c[t] / S.c[t - 1] - 1 >= 0.02 && S.v[t] >= 1.5 * S.vol50[t]],
  ["vol: accumulation (down-day vol < up-day vol, 10d)", (S, t) => sumV(S, t - 9, t, i => S.c[i] < S.c[i - 1]) < sumV(S, t - 9, t, i => S.c[i] > S.c[i - 1])],
  ["pat: tight 20d base (range <= 12%)", (S, t) => { let hi = -Infinity, lo = Infinity; for (let i = t - 20; i < t; i++) { hi = Math.max(hi, S.h[i]); lo = Math.min(lo, S.l[i]); } return (hi - lo) / S.c[t] <= 0.12; }],
  ["pat: breaks 20d high", (S, t) => S.c[t] > S.hi20[t]],
  ["pat: breaks 50d high", (S, t) => { let m = -Infinity; for (let i = t - 50; i < t; i++) m = Math.max(m, S.h[i]); return S.c[t] > m; }],
  ["pat: bull flag (+15% run, tight 5d)", (S, t) => { let lo = Infinity, hi = -Infinity; for (let i = t - 30; i < t - 5; i++) { lo = Math.min(lo, S.l[i]); hi = Math.max(hi, S.h[i]); } let l5 = Infinity, h5 = -Infinity; for (let i = t - 5; i <= t; i++) { l5 = Math.min(l5, S.l[i]); h5 = Math.max(h5, S.h[i]); } return hi / lo - 1 >= 0.15 && (h5 - l5) / S.c[t] <= 0.06; }],
  ["pat: bullish engulfing (last 2d)", (S, t) => [t, t - 1].some(i => S.c[i] > S.o[i] && S.c[i - 1] < S.o[i - 1] && S.c[i] >= S.o[i - 1] && S.o[i] <= S.c[i - 1])],
  ["pat: hammer (last 2d)", (S, t) => [t, t - 1].some(i => { const body = Math.abs(S.c[i] - S.o[i]), low = Math.min(S.c[i], S.o[i]) - S.l[i], rng = S.h[i] - S.l[i]; return rng > 0 && low >= 2 * body && (S.c[i] - S.l[i]) / rng >= 0.66; })],
  ["pat: inside day (last 3d)", (S, t) => [t, t - 1, t - 2].some(i => S.h[i] < S.h[i - 1] && S.l[i] > S.l[i - 1])],
  ["pat: NR7 (last 3d)", (S, t) => [t, t - 1, t - 2].some(i => { let m = Infinity; for (let k = i - 6; k < i; k++) m = Math.min(m, S.h[k] - S.l[k]); return S.h[i] - S.l[i] < m; })],
  ["pat: cup-like (15-35% dip, back within 8%)", (S, t) => { let hi = -Infinity; for (let i = t - 60; i < t - 30; i++) hi = Math.max(hi, S.h[i]); let lo = Infinity; for (let i = t - 45; i < t - 10; i++) lo = Math.min(lo, S.l[i]); const dd = 1 - lo / hi; return dd >= 0.15 && dd <= 0.35 && S.c[t] >= 0.92 * hi; }],
  ["pat: within 5% of 52w high", (S, t) => S.c[t] >= 0.95 * S.hi252[t]], ["pat: gap up >= 1% on flip day", (S, t) => S.o[t] >= 1.01 * S.c[t - 1]],
  ["st: ADX >= 20 and rising", (S, t) => S.adx[t] >= 20 && S.adx[t] > S.adx[t - 5]], ["st: ADX >= 25", (S, t) => S.adx[t] >= 25],
  ["st: close > 200d avg", (S, t) => S.c[t] > S.sma200[t]], ["st: SPY above 200d", (S, t) => { const j = spyI(S, t); return j !== undefined && SPY.c[j] > SPY.sma200[j]; }],
  ["st: RS 63d vs SPY > 0", (S, t) => { const j = spyI(S, t); return j >= 63 && S.c[t] / S.c[t - 63] > SPY.c[j] / SPY.c[j - 63]; }],
];
// pivot-based double bottom (added separately, needs pivots)
const rows = [];
for (const [sym, S] of data) { if (sym === "SPY") continue; const { pl, ph } = pivots(S);
  for (let t = WARM; t < S.n - 130; t++) { if (!(S.st[t] === 1 && S.st[t - 1] === -1) || !memberAt(sym, S.d[t]) || !(S.atr14[t] > 0)) continue;
    const r = exitSim(S, t, { st: true }), r8 = exitSim(S, t, { st: true, target: 8 }); if (!r || !r8 || S.hasBad(t - 252, t + 1 + r.days + 1)) continue;
    const lows = pl.filter(i => i + 3 <= t && i >= t - 60), highs = ph.filter(i => i + 3 <= t && i >= t - 60); let db = false;
    for (let a = 0; a < lows.length && !db; a++) for (let b = a + 1; b < lows.length; b++) { const i = lows[a], j = lows[b]; if (j - i >= 10 && j - i <= 40 && Math.abs(S.l[i] / S.l[j] - 1) <= 0.03) { const mid = Math.max(...S.h.slice(i, j + 1)); if (S.c[t] > mid * 0.98) { db = true; break; } } }
    const hl = lows.length >= 2 && S.l[lows.at(-1)] > S.l[lows.at(-2)];
    const bits = F.map(([, fn]) => { try { return fn(S, t) ? 1 : 0; } catch { return 0; } }); bits.push(db ? 1 : 0, hl ? 1 : 0);
    rows.push({ date: S.d[t + 1], ret: r.ret, ret8: r8.ret, bits }); } }
const names = [...F.map(f => f[0]), "pat: double bottom (10-40 bars, breaks middle peak)", "pat: higher pivot low"], C = names.length;
rows.sort((a, b) => a.date < b.date ? -1 : 1); const N = rows.length;
const tr = rows.filter(r => r.date < SPLIT), te = rows.filter(r => r.date >= SPLIT);
const sh = (n, a, k = "ret") => { const s = stats(a.map(x => ({ ret: x[k], days: 1 }))); return `n=${String(s.n).padStart(4)} win ${f2(s.win, 0).padStart(3)}% avg ${f2(s.avg).padStart(5)}%`; };
console.log(`all daily Supertrend flips: ${N} (train ${tr.length}, test ${te.length}). Current exit.  ALL: ${sh("", rows)} | train ${sh("", tr)} | test ${sh("", te)}\n  with +8% target: ALL ${sh("", rows, "ret8")}\n`);
console.log("== Part 1: each feature alone (TRUE vs FALSE) ==");
console.log("feature".padEnd(54) + "TRUE all".padEnd(30) + "train / test win%, avg%".padEnd(34) + "FALSE all");
const single = names.map((nm, i) => { const T = rows.filter(r => r.bits[i]), Fa = rows.filter(r => !r.bits[i]), a = T.filter(r => r.date < SPLIT), b = T.filter(r => r.date >= SPLIT); return { nm, i, T, Fa, a, b }; });
for (const s of single) { if (s.T.length < 25) { console.log(s.nm.padEnd(54) + `n=${s.T.length} (too few)`); continue; } const w = x => stats(x.map(y => ({ ret: y.ret, days: 1 })));
  console.log(s.nm.padEnd(54) + sh("", s.T).padEnd(30) + `${f2(w(s.a).win, 0)}/${f2(w(s.b).win, 0)}%  ${f2(w(s.a).avg)}/${f2(w(s.b).avg)}%`.padEnd(34) + sh("", s.Fa)); }
// Part 2: combos
const baseWin = k => rows.filter(r => r[k] > 0).length / N;
function search(rowsLocal, label) { // returns top combos by train win, with holdout stats
  const res = []; const trR = rowsLocal.filter(r => r.date < SPLIT), teR = rowsLocal.filter(r => r.date >= SPLIT);
  const test = idx => { let nT = 0, wT = 0, nE = 0, wE = 0; for (const r of trR) { let ok = true; for (const i of idx) if (!r.bits[i]) { ok = false; break; } if (ok) { nT++; if (r.ret > 0) wT++; } } if (nT < 40) return null; for (const r of teR) { let ok = true; for (const i of idx) if (!r.bits[i]) { ok = false; break; } if (ok) { nE++; if (r.ret > 0) wE++; } } if (nE < 20) return null; return { idx, nT, nE, tw: wT / nT * 100, ew: wE / nE * 100 }; };
  for (let a = 0; a < C; a++) { let x = test([a]); if (x) res.push(x); for (let b = a + 1; b < C; b++) { x = test([a, b]); if (x) res.push(x); for (let c = b + 1; c < C; c++) { x = test([a, b, c]); if (x) res.push(x); } } }
  res.sort((x, y) => y.tw - x.tw); return { res, trWin: trR.filter(r => r.ret > 0).length / trR.length * 100, teWin: teR.filter(r => r.ret > 0).length / teR.length * 100 };
}
const real = search(rows), top = real.res.slice(0, 25);
const topN = real.res.slice(0, 50), avgTr = mean(topN.map(x => x.tw)), avgTe = mean(topN.map(x => x.ew));
console.log(`\n== Part 2: every single, pair and triple of the ${C} features (${real.res.length} qualifying combos; picked on train, judged on test) ==`);
console.log(`baseline win: train ${f2(real.trWin, 1)}%  test ${f2(real.teWin, 1)}%`);
console.log(`top 50 by train win rate: train avg ${f2(avgTr, 1)}% -> test avg ${f2(avgTe, 1)}%`);
// permutation null: shuffle the (ret) labels among rows, repeat the search, record the best-50 train avg
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32; const nullTr = [];
for (let p = 0; p < NPERM; p++) { const rets = rows.map(r => r.ret); for (let i = rets.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rets[i], rets[j]] = [rets[j], rets[i]]; }
  const sh2 = rows.map((r, i) => ({ date: r.date, ret: rets[i], bits: r.bits })); const s = search(sh2); nullTr.push(mean(s.res.slice(0, 50).map(x => x.tw))); }
nullTr.sort((a, b) => a - b);
console.log(`permutation null (outcomes shuffled, ${NPERM} repeats): top-50 train avg win ${f2(mean(nullTr), 1)}% (range ${f2(nullTr[0], 1)}-${f2(nullTr.at(-1), 1)}%) -> so the real train lift above baseline (${f2(avgTr - real.trWin, 1)} pts) vs by-chance lift (${f2(mean(nullTr) - real.trWin, 1)} pts)`);
console.log("\ntop 15 combos by train win (with holdout):");
for (const x of real.res.slice(0, 15)) console.log(`  ${x.idx.map(i => names[i].replace(/\(.*/, "")).join(" + ")}\n     train ${f2(x.tw, 1)}% (n ${x.nT}) | TEST ${f2(x.ew, 1)}% (n ${x.nE})`);
const surv = real.res.filter(x => x.tw >= real.trWin + 8 && x.ew >= real.teWin + 8);
console.log(`\ncombos that gained >= 8 pts of win rate on BOTH halves: ${surv.length}`); for (const x of surv.slice(0, 10)) console.log(`  ${x.idx.map(i => names[i].replace(/\(.*/, "")).join(" + ")}  train ${f2(x.tw, 1)}% (n ${x.nT}) test ${f2(x.ew, 1)}% (n ${x.nE})`);

// ---- follow-ups: SPY below its 200-day average, and how many "survivors" pure chance produces ----
const iSpy = names.indexOf("st: SPY above 200d"), below = rows.filter(r => !r.bits[iSpy]), above = rows.filter(r => r.bits[iSpy]);
const w3 = (a) => { const t = a.filter(r => r.date < SPLIT), e = a.filter(r => r.date >= SPLIT), f = x => stats(x.map(y => ({ ret: y.ret, days: 1 }))); return `ALL n=${a.length} win ${f2(f(a).win, 0)}% avg ${f2(f(a).avg)}% | train n=${t.length} ${f2(f(t).win, 0)}%/${f2(f(t).avg)}% | test n=${e.length} ${f2(f(e).win, 0)}%/${f2(f(e).avg)}%`; };
console.log("\n== follow-up: flips when SPY is BELOW vs ABOVE its 200-day average =="); console.log("below: " + w3(below)); console.log("above: " + w3(above));
const byYear = new Map(); for (const r of below) { const y = r.date.slice(0, 4); (byYear.get(y) || byYear.set(y, []).get(y)).push(r); } for (const [y, a] of [...byYear].sort()) console.log(`  below, ${y}: n=${a.length} win ${f2(a.filter(r => r.ret > 0).length / a.length * 100, 0)}% avg ${f2(mean(a.map(r => r.ret)))}%`);
let survNull = [];
for (let p = 0; p < NPERM; p++) { const rets = rows.map(r => r.ret); for (let i = rets.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rets[i], rets[j]] = [rets[j], rets[i]]; }
  const sh2 = rows.map((r, i) => ({ date: r.date, ret: rets[i], bits: r.bits })); const s = search(sh2); survNull.push(s.res.filter(x => x.tw >= s.trWin + 8 && x.ew >= s.teWin + 8).length); }
survNull.sort((a, b) => a - b); console.log(`\nsurvivors (>= +8 pts on both halves): real ${surv.length} vs by chance (shuffled outcomes, ${NPERM} repeats): median ${survNull[Math.floor(NPERM / 2)]}, max ${survNull.at(-1)}, range ${survNull[0]}-${survNull.at(-1)}`);
