// Regime-aware gating of the main book: does restricting Supertrend flips to weak-market regimes lift win rate and profit, and how much of it is just a few episodes?
import { data, SPY, memberAt, exitSim, stats, mean, f2, WARM } from "./lib14.mjs";
const SPLIT = "2024-11-05";
const spyAt = (S, t) => SPY.dateIdx.get(S.d[t]);
const REG = {
  "SPY below 200d avg": j => SPY.c[j] < SPY.sma200[j],
  "SPY below 50d avg": j => SPY.c[j] < SPY.sma50[j],
  "SPY >= 5% below 252d high": j => SPY.c[j] <= 0.95 * SPY.hi252[j],
  "SPY >= 8% below 252d high": j => SPY.c[j] <= 0.92 * SPY.hi252[j],
  "SPY >= 10% below 252d high": j => SPY.c[j] <= 0.90 * SPY.hi252[j],
  "SPY 20d return <= -3%": j => SPY.c[j] / SPY.c[j - 20] - 1 <= -0.03,
  "SPY 5d return <= -1.5%": j => SPY.c[j] / SPY.c[j - 5] - 1 <= -0.015,
  "SPY below 200d OR >= 8% off high": j => SPY.c[j] < SPY.sma200[j] || SPY.c[j] <= 0.92 * SPY.hi252[j],
  "SPY above 50d but below 200d (recovery)": j => SPY.c[j] > SPY.sma50[j] && SPY.c[j] < SPY.sma200[j],
};
const build = gated => { const out = [];
  for (const [sym, S] of data) { if (sym === "SPY") continue;
    for (let t = WARM; t < S.n - 130; t++) { if (!(S.st[t] === 1 && S.st[t - 1] === -1) || !memberAt(sym, S.d[t]) || !(S.atr14[t] > 0)) continue; if (gated && !(S.adx[t] >= 20 && S.adx[t] > S.adx[t - 5])) continue;
      const j = spyAt(S, t); if (j === undefined || j < 252) continue; const r = exitSim(S, t, { st: true }), r8 = exitSim(S, t, { st: true, target: 8 }); if (!r || !r8 || S.hasBad(t - 252, t + 1 + r.days + 1)) continue;
      const flags = {}; for (const [k, f] of Object.entries(REG)) flags[k] = f(j);
      out.push({ date: S.d[t + 1], ret: r.ret, ret8: r8.ret, days: r.days, flags, month: S.d[t + 1].slice(0, 7) }); } } return out; };
const sh = a => { if (!a.length) return "n=0"; const s = stats(a.map(x => ({ ret: x.ret, days: x.days }))); return `n=${String(s.n).padStart(4)} win ${f2(s.win, 0).padStart(3)}% avg ${f2(s.avg).padStart(5)}%`; };
let seed = 99; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
function bootCI(inR, outR, key = "ret") { // month-clustered bootstrap of (avg in - avg out) and win diff
  const mo = new Map(); for (const x of [...inR.map(x => ({ x, g: 1 })), ...outR.map(x => ({ x, g: 0 }))]) { const m = x.x.month; (mo.get(m) || mo.set(m, []).get(m)).push(x); }
  const months = [...mo.keys()], dA = [], dW = [];
  for (let k = 0; k < 1500; k++) { const a = [], b = []; for (let i = 0; i < months.length; i++) for (const y of mo.get(months[Math.floor(rnd() * months.length)])) (y.g ? a : b).push(y.x[key]); if (a.length && b.length) { dA.push(mean(a) - mean(b)); dW.push(a.filter(v => v > 0).length / a.length * 100 - b.filter(v => v > 0).length / b.length * 100); } }
  dA.sort((p, q) => p - q); dW.sort((p, q) => p - q); const g = (arr, q) => arr[Math.floor(q * arr.length)]; return `avg diff 95% CI [${f2(g(dA, .025))}, ${f2(g(dA, .975))}], win diff [${f2(g(dW, .025), 0)}, ${f2(g(dW, .975), 0)}] pts`; }
for (const [label, gated] of [["APP-GATED flips (ADX >= 20 and rising)", true], ["ALL daily flips (bigger sample)", false]]) {
  const rows = build(gated); console.log(`\n################ ${label}: ${rows.length} flips. baseline ${sh(rows)} | train ${sh(rows.filter(r => r.date < SPLIT))} | test ${sh(rows.filter(r => r.date >= SPLIT))}`);
  console.log("regime".padEnd(42) + "IN regime".padEnd(30) + "train / test".padEnd(40) + "OUTSIDE regime");
  for (const k of Object.keys(REG)) { const I = rows.filter(r => r.flags[k]), O = rows.filter(r => !r.flags[k]); const a = I.filter(r => r.date < SPLIT), b = I.filter(r => r.date >= SPLIT);
    console.log(k.padEnd(42) + sh(I).padEnd(30) + `${sh(a).replace("n=", "").slice(0, 26)} | ${sh(b).replace("n=", "").slice(0, 26)}`.padEnd(40) + sh(O)); }
  const key = "SPY below 200d avg"; const I = rows.filter(r => r.flags[key]), O = rows.filter(r => !r.flags[key]);
  console.log(`\n"${key}": month-clustered bootstrap, IN minus OUT: ${bootCI(I, O)}; flips in ${new Set(I.map(r => r.month)).size} distinct months`);
  console.log("  months with the most flips in regime:", [...I.reduce((m, r) => m.set(r.month, (m.get(r.month) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([m, c]) => `${m}:${c}`).join(", "));
  console.log(`  drop the best 2 months: ${sh(I.filter(r => { const top = [...I.reduce((m, y) => m.set(y.month, (m.get(y.month) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]); return !top.includes(r.month); }))}`);
  console.log(`  in regime with +8% target: ${sh(I.map(r => ({ ...r, ret: r.ret8 })))}   outside: ${sh(O.map(r => ({ ...r, ret: r.ret8 })))}`);
}
