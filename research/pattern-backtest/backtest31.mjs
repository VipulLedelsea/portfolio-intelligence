// Which indicators showed that a flip was going to be a loser? At entry (k=0) and after 3, 5 and 10 sessions in the trade, among trades still open: does a warning flag
// predict the final loss, and would selling at that close (instead of holding to the Supertrend line) have helped? Train / test halves, 36 flags x 4 checkpoints.
import { data, memberAt, exitSim, stats, mean, f2, WARM, SPY, COST } from "./lib14.mjs";
const SPLIT = "2024-11-05", KS = [0, 3, 5, 10];
const sma = (a, i, p) => { let s = 0; for (let k = i - p + 1; k <= i; k++) s += a[k]; return s / p; };
function indicators(S, d, e, entry, t) { // d = index of the checkpoint close, t = signal index, e = entry index
  const c = S.c, h = S.h, l = S.l, v = S.v, atr = S.atr14[t];
  const hh14 = Math.max(...h.slice(d - 13, d + 1)), ll14 = Math.min(...l.slice(d - 13, d + 1)), stochK = (c[d] - ll14) / ((hh14 - ll14) || 1) * 100;
  const tp = i => (h[i] + l[i] + c[i]) / 3; let tps = [], mf = 0, pmf = 0, nmf = 0; for (let i = d - 19; i <= d; i++) tps.push(tp(i)); const m = mean(tps), md = mean(tps.map(x => Math.abs(x - m))), cci = (tps.at(-1) - m) / (0.015 * (md || 1));
  for (let i = d - 13; i <= d; i++) { const f = tp(i) * v[i]; if (tp(i) > tp(i - 1)) pmf += f; else nmf += f; } const mfi = nmf === 0 ? 100 : 100 - 100 / (1 + pmf / nmf);
  let clv = 0, vs = 0; for (let i = d - 19; i <= d; i++) { clv += ((c[i] - l[i]) - (h[i] - c[i])) / ((h[i] - l[i]) || 1) * v[i]; vs += v[i]; } const cmf = clv / (vs || 1);
  let up25 = 0; { let m2 = -Infinity, mi = d; for (let i = d - 25; i <= d; i++) if (h[i] >= m2) { m2 = h[i]; mi = i; } up25 = (25 - (d - mi)) / 25 * 100; }
  const sd20 = Math.sqrt(mean(c.slice(d - 19, d + 1).map(x => (x - sma(c, d, 20)) ** 2))), pb = (c[d] - (sma(c, d, 20) - 2 * sd20)) / (4 * sd20 || 1);
  const down3 = [d, d - 1, d - 2].filter(i => c[i] < c[i - 1]).length, down5 = [d, d - 1, d - 2, d - 3, d - 4].filter(i => c[i] < c[i - 1]).length;
  let dnVol = 0, upVol = 0; for (let i = Math.max(e, d - 9); i <= d; i++) { if (c[i] < c[i - 1]) dnVol += v[i]; else upVol += v[i]; }
  const j = SPY.dateIdx.get(S.d[d]), j0 = SPY.dateIdx.get(S.d[e]);
  return {
    "RSI14 < 50": S.rsi14[d] < 50, "RSI14 < 40": S.rsi14[d] < 40, "RSI14 falling 3d": S.rsi14[d] < S.rsi14[d - 3], "RSI2 < 20": S.rsi2[d] < 20,
    "MACD hist < 0": S.hist[d] < 0, "MACD hist falling 3d": S.hist[d] < S.hist[d - 3], "MACD line < 0": S.macd[d] < 0,
    "Stochastic %K < 30": stochK < 30, "Stochastic %K > 80": stochK > 80, "CCI < -50": cci < -50, "MFI < 40": mfi < 40, "CMF < 0": cmf < 0, "OBV below its 20d avg": S.obv[d] < S.obvMa[d],
    "Aroon-up < 50": up25 < 50, "Bollinger %B < 0.5": pb < 0.5, "Bollinger %B > 0.95": pb > 0.95,
    "ADX falling vs 5d ago": S.adx[d] < S.adx[d - 5], "ADX < 20": S.adx[d] < 20, "-DI above +DI": S.mdi[d] > S.pdi[d],
    "close < 5d avg": c[d] < sma(c, d, 5), "close < 10d avg": c[d] < sma(c, d, 10), "close < 20d EMA": c[d] < S.ema20[d], "close < entry open": c[d] < entry,
    "close < flip-day low": c[d] < l[t], "close within 1 ATR of Supertrend line": (c[d] - S.stLine[d]) / atr < 1, "close within 2 ATR of Supertrend line": (c[d] - S.stLine[d]) / atr < 2,
    "2+ down closes of last 3": down3 >= 2, "4+ down closes of last 5": down5 >= 4, "down-day volume > up-day volume (since entry)": dnVol > upVol,
    "gain since entry < 0": c[d] < entry, "gain since entry < -3%": c[d] < entry * 0.97, "lagging SPY since entry": j !== undefined && j0 !== undefined && (c[d] / entry) < (SPY.c[j] / SPY.o[j0]),
    "volume today > 1.5x avg on a down close": v[d] > 1.5 * S.vol50[d] && c[d] < c[d - 1], "wide-range down day (> 2 ATR)": (c[d - 1] - c[d]) > 2 * atr, "close < previous low": c[d] < l[d - 1],
    "ATR% > 4": atr / c[t] > 0.04 };
}
const trades = [];
for (const [sym, S] of data) { if (sym === "SPY") continue;
  for (let t = WARM; t < S.n - 130; t++) { if (!(S.st[t] === 1 && S.st[t - 1] === -1) || !memberAt(sym, S.d[t]) || !(S.atr14[t] > 0)) continue; const r = exitSim(S, t, { st: true }); if (!r || S.hasBad(t - 252, t + 1 + r.days + 1)) continue;
    const e = t + 1, entry = S.o[e]; if (!(entry > 0)) continue; const o = { r, date: S.d[e], ck: {} };
    for (const k of KS) { const d = k === 0 ? t : e + k - 1; if (k > 0 && r.days <= k) continue; try { const f = indicators(S, d, e, entry, t); o.ck[k] = { f, now: k === 0 ? null : (S.c[d] / entry - 1 - 2 * COST) * 100 }; } catch { } }
    trades.push(o); } }
console.log(`flips: ${trades.length}; final: ${f2(stats(trades.map(x => ({ ret: x.r.ret, days: x.r.days }))).win, 1)}% wins, avg ${f2(mean(trades.map(x => x.r.ret)))}%\n`);
const loss = x => x.r.ret <= 0;
for (const k of KS) {
  const T = trades.filter(x => x.ck[k]), names = Object.keys(T[0].ck[k].f), base = T.filter(loss).length / T.length;
  console.log(`######## checkpoint ${k === 0 ? "ENTRY (signal close)" : "after " + k + " sessions in the trade"}: ${T.length} trades, P(final loss) = ${f2(base * 100, 1)}%`);
  const res = names.map(nm => { const F = T.filter(x => x.ck[k].f[nm]), N = T.filter(x => !x.ck[k].f[nm]); if (F.length < 80 || N.length < 80) return null; const pl = a => a.filter(loss).length / a.length * 100;
    const g = a => k === 0 ? NaN : mean(a.map(x => x.ck[k].now - x.r.ret)), tr = F.filter(x => x.date < SPLIT), te = F.filter(x => x.date >= SPLIT);
    return { nm, n: F.length, share: F.length / T.length * 100, pF: pl(F), pN: pl(N), pTr: pl(tr), pTe: pl(te), gain: g(F), gTr: g(tr), gTe: g(te), avgF: mean(F.map(x => x.r.ret)), avgN: mean(N.map(x => x.r.ret)) }; }).filter(Boolean);
  const key = o => k === 0 ? o.pF - o.pN : o.gain; res.sort((a, b) => key(b) - key(a));
  console.log("flag".padEnd(46) + "flagged".padStart(8) + "P(loss) flagged".padStart(17) + "not".padStart(7) + (k ? "  sell-now gain (train / test)" : "  avg final ret flagged vs not"));
  for (const o of res.slice(0, 8)) console.log(o.nm.padEnd(46) + `${String(o.n).padStart(5)} (${f2(o.share, 0)}%)`.padStart(8) + f2(o.pF, 1).padStart(14) + "%" + f2(o.pN, 1).padStart(6) + "%" + (k ? `   ${f2(o.gain)}% (${f2(o.gTr)} / ${f2(o.gTe)})` : `   ${f2(o.avgF)}% vs ${f2(o.avgN)}%`));
  const best = res.filter(o => k ? (o.gain > 0 && o.gTr > 0 && o.gTe > 0) : (o.pTr > base * 100 + 3 && o.pTe > base * 100 + 3)); console.log(`  flags that point the same way in both halves: ${best.length} of ${res.length}` + (best.length ? ": " + best.slice(0, 5).map(o => o.nm).join("; ") : "") + "\n");
}
