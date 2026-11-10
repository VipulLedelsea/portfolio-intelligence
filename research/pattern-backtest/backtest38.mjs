// Wait for confirmation before entering? Instead of buying the open after the daily Supertrend flip, enter only after a confirmation: waiting N sessions with the trend still up,
// a close above the flip day's high, a +2% close over the flip close, or several indicators agreeing. Exit unchanged (Supertrend line, no target). Compared on the same flips.
import { data, memberAt, exitSim, stats, mean, f2, WARM } from "./lib14.mjs";
const SPLIT = "2024-11-05", K = 10;
const wait = n => (S, t, k) => k === n;                                           // exactly n sessions after the flip (trend must still be up)
const VARS = {
  "enter immediately (current)": null,
  "wait 1 session": wait(1), "wait 2 sessions": wait(2), "wait 3 sessions": wait(3), "wait 5 sessions": wait(5), "wait 10 sessions": wait(10),
  "close above the flip day's high (within 5 sessions)": (S, t, k) => k <= 5 && S.c[t + k] > S.h[t],
  "close 2%+ over the flip close (within 5 sessions)": (S, t, k) => k <= 5 && S.c[t + k] >= S.c[t] * 1.02,
  "close 4%+ over the flip close (within 10 sessions)": (S, t, k) => S.c[t + k] >= S.c[t] * 1.04,
  "two closes in a row above the flip close (within 5)": (S, t, k) => k <= 5 && k >= 2 && S.c[t + k] > S.c[t] && S.c[t + k - 1] > S.c[t],
  "ADX 20+ and rising, within 10 sessions": (S, t, k) => S.adx[t + k] >= 20 && S.adx[t + k] > S.adx[t + k - 3],
  "ALL agree: close>50d avg, MACD>0, RSI14>50, OBV>its avg, ADX 20+ rising (within 10)": (S, t, k) => { const d = t + k; return S.c[d] > S.sma50[d] && S.macd[d] > 0 && S.rsi14[d] > 50 && S.obv[d] > S.obvMa[d] && S.adx[d] >= 20 && S.adx[d] > S.adx[d - 3]; },
  "MOST agree: any 4 of those 5 (within 10)": (S, t, k) => { const d = t + k; return [S.c[d] > S.sma50[d], S.macd[d] > 0, S.rsi14[d] > 50, S.obv[d] > S.obvMa[d], S.adx[d] >= 20 && S.adx[d] > S.adx[d - 3]].filter(Boolean).length >= 4; },
};
const flips = [];
for (const [sym, S] of data) { if (sym === "SPY") continue; for (let t = WARM; t < S.n - 150; t++) { if (!(S.st[t] === 1 && S.st[t - 1] === -1) || !memberAt(sym, S.d[t]) || !(S.atr14[t] > 0)) continue; const imm = exitSim(S, t, { st: true }); if (!imm || S.hasBad(t - 252, t + 20 + imm.days)) continue; flips.push({ S, t, imm, gate: S.adx[t] >= 20 && S.adx[t] > S.adx[t - 5], date: S.d[t + 1] }); } }
const find = (S, t, cond) => { for (let k = 1; k <= K; k++) { if (S.st[t + k] !== 1) return null; if (cond(S, t, k)) return t + k; } return null; };
const row = (name, trades, nFlips, base) => { const s = stats(trades.map(x => ({ ret: x.ret, days: x.days }))), tr = stats(trades.filter(x => x.date < SPLIT).map(x => ({ ret: x.ret, days: x.days }))), te = stats(trades.filter(x => x.date >= SPLIT).map(x => ({ ret: x.ret, days: x.days })));
  const slip = mean(trades.map(x => x.slip)), same = mean(trades.map(x => x.imm));
  return `${name.padEnd(80)} trades ${String(trades.length).padStart(5)} (${f2(trades.length / nFlips * 100, 0).padStart(3)}% of flips)  win ${f2(s.win, 1).padStart(5)}%  avg ${f2(s.avg).padStart(5)}%  same flips bought at once ${f2(same).padStart(5)}%  entry ${f2(slip)}% higher  early ${f2(tr.avg)} / late ${f2(te.avg)}  per flip incl. no-trades ${f2(s.avg * trades.length / nFlips)}%`; };
for (const [label, set] of [["APP-GATED flips (ADX >= 20 and rising)", flips.filter(f => f.gate)], ["ALL daily flips", flips]]) {
  console.log(`\n################ ${label}: ${set.length} flips`);
  for (const [name, cond] of Object.entries(VARS)) { const trades = [];
    for (const f of set) { let tc = f.t; if (cond) { tc = find(f.S, f.t, cond); if (tc === null) continue; } const r = exitSim(f.S, tc, { st: true }); if (!r) continue; trades.push({ ret: r.ret, days: r.days, date: f.date, imm: f.imm.ret, slip: (f.S.o[tc + 1] / f.S.o[f.t + 1] - 1) * 100 }); }
    console.log(row(name, trades, set.length)); } }
