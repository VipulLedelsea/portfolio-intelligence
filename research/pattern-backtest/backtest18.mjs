// Tight-stop search: which entry conditions give a HIGH win rate with a SMALL stop (2 ATR or less, about 4-6%) and still profit?
// All member stock-days (every 4th day), 10-day max hold, stop S ATR / target T ATR, entry next open, 0.1% per side. Pick on train, judge on holdout.
import { data, CONDS, SPY, memberAt, stats, f2, COST, WARM } from "./lib14.mjs";
const SPLIT = "2024-11-05";
const add = (name, group, fn) => CONDS.push({ name, group, fn });
add("RSI2<10", "dip", (S, t) => S.rsi2[t] < 10); add("RSI2<5", "dip", (S, t) => S.rsi2[t] < 5); add("down>=5% in 3d", "dip", (S, t) => S.c[t] / S.c[t - 3] - 1 <= -0.05);
add("down>=3% in 3d", "dip", (S, t) => S.c[t] / S.c[t - 3] - 1 <= -0.03); add("c<sma5", "dip", (S, t) => S.c[t] < S.l[t] + 0 || S.c[t] < (S.c[t] + S.c[t - 1] + S.c[t - 2] + S.c[t - 3] + S.c[t - 4]) / 5);
add("IBS<0.25", "dip", (S, t) => (S.c[t] - S.l[t]) / ((S.h[t] - S.l[t]) || 1) < 0.25); add("1+ ATR under sma20", "dip", (S, t) => (S.sma20[t] - S.c[t]) / S.atr14[t] >= 1);
add("ST up", "trend", (S, t) => S.st[t] === 1); add("ST down", "trend", (S, t) => S.st[t] === -1); add("2 down closes", "dip", (S, t) => S.c[t] < S.c[t - 1] && S.c[t - 1] < S.c[t - 2]);
add("SPY 5d <= -1.5%", "market", (S, t) => { const j = SPY.dateIdx.get(S.d[t]); return j !== undefined && SPY.c[j] / SPY.c[j - 5] - 1 <= -0.015; });
add("52w low within 15%", "location", (S, t) => { let m = Infinity; for (let i = t - 252; i < t; i++) m = Math.min(m, S.l[i]); return S.c[t] <= 1.15 * m; });
const names = CONDS.map(c => c.name), C = CONDS.length;
const OUT = { "stop 2 ATR / target 0.5 ATR": [2, 0.5], "stop 2 ATR / target 1 ATR": [2, 1], "stop 1.5 ATR / target 0.75 ATR": [1.5, 0.75], "stop 1 ATR / target 0.5 ATR": [1, 0.5] };
const H = 10, rows = [];
for (const [sym, S] of data) { if (sym === "SPY") continue; let k = 0;
  for (let t = WARM; t < S.n - H - 2; t++) { if ((k++ % 4) || !memberAt(sym, S.d[t]) || !(S.atr14[t] > 0) || S.hasBad(t - 252, t + H + 1)) continue;
    const e = t + 1, entry = S.o[e]; if (!(entry > 0)) continue; const atr = S.atr14[t]; const rets = [];
    for (const [S_, T_] of Object.values(OUT)) { const stop = entry - S_ * atr, tp = entry + T_ * atr; let exit = S.c[e + H - 1];
      for (let j = e; j < e + H; j++) { if (j > e && S.o[j] <= stop) { exit = S.o[j]; break; } if (S.l[j] <= stop) { exit = stop; break; } if (j > e && S.o[j] >= tp) { exit = S.o[j]; break; } if (S.h[j] >= tp) { exit = tp; break; } }
      rets.push((exit / entry - 1 - 2 * COST) * 100); }
    let bits = ""; for (const c of CONDS) { let b = 0; try { b = c.fn(S, t, sym) ? 1 : 0; } catch { b = 0; } bits += b; }
    rows.push({ date: S.d[e], bits, rets, stopPct: 100 * atr / entry }); } }
rows.sort((a, b) => a.date < b.date ? -1 : 1);
const N = rows.length, W = Math.ceil(N / 32); console.log(`rows ${N}, conditions ${C}, average ATR ${f2(rows.reduce((s, r) => s + r.stopPct, 0) / N, 2)}% of price (so a 2 ATR stop is about ${f2(2 * rows.reduce((s, r) => s + r.stopPct, 0) / N, 1)}%)`);
const cb = Array.from({ length: C }, () => new Uint32Array(W)), trA = new Uint32Array(W), teA = new Uint32Array(W);
rows.forEach((r, i) => { const w = i >> 5, b = 1 << (i & 31); (r.date < SPLIT ? trA : teA)[w] |= b; for (let c = 0; c < C; c++) if (r.bits[c] === "1") cb[c][w] |= b; });
const pop = x => { x = x - ((x >>> 1) & 0x55555555); x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24; };
const idxOf = (m, which) => { const out = []; for (let w = 0; w < W; w++) { let x = m[w] & which[w]; while (x) { const b = x & -x; out.push((w << 5) + (31 - Math.clz32(b))); x ^= b; } } return out; };
Object.entries(OUT).forEach(([oname], oi) => {
  const win = new Uint32Array(W); rows.forEach((r, i) => { if (r.rets[oi] > 0) win[i >> 5] |= 1 << (i & 31); });
  const trW = new Uint32Array(W), teW = new Uint32Array(W); for (let w = 0; w < W; w++) { trW[w] = win[w] & trA[w]; teW[w] = win[w] & teA[w]; }
  const cnt = a => { let s = 0; for (let w = 0; w < W; w++) s += pop(a[w]); return s; };
  const bTr = cnt(trW) / cnt(trA) * 100, bTe = cnt(teW) / cnt(teA) * 100, all = new Uint32Array(W).fill(0xFFFFFFFF);
  const ev = m => { let nTr = 0, wTr = 0, nTe = 0, wTe = 0; for (let w = 0; w < W; w++) { const x = m[w]; nTr += pop(x & trA[w]); wTr += pop(x & trW[w]); nTe += pop(x & teA[w]); wTe += pop(x & teW[w]); } return { nTr, wTr, nTe, wTe }; };
  const out = []; let tried = 0, m2 = new Uint32Array(W), m3 = new Uint32Array(W);
  const consider = (idx, m) => { tried++; const e = ev(m); if (e.nTr >= 1500 && e.nTe >= 700) out.push({ idx: idx.slice(), ...e, trW: e.wTr / e.nTr * 100, teW: e.wTe / e.nTe * 100 }); };
  for (let a = 0; a < C; a++) { consider([a], cb[a]); for (let b = a + 1; b < C; b++) { for (let w = 0; w < W; w++) m2[w] = cb[a][w] & cb[b][w]; consider([a, b], m2);
    for (let c = b + 1; c < C; c++) { for (let w = 0; w < W; w++) m3[w] = m2[w] & cb[c][w]; consider([a, b, c], m3); } } }
  const avgOf = (m, which) => { const ix = idxOf(m, which); return ix.reduce((s, i) => s + rows[i].rets[oi], 0) / (ix.length || 1); };
  const mask = idx => { const m = all.slice(); for (const i of idx) for (let w = 0; w < W; w++) m[w] &= cb[i][w]; return m; };
  out.sort((x, y) => y.trW - x.trW); const cand = out.slice(0, 400).map(x => { const m = mask(x.idx); return { ...x, avgTr: avgOf(m, trA), avgTe: avgOf(m, teA) }; });
  const ok = cand.filter(x => x.avgTr > 0.05);
  const baseAvgTr = avgOf(all, trA), baseAvgTe = avgOf(all, teA);
  console.log(`\n######## ${oname}: baseline win train ${f2(bTr, 1)}% test ${f2(bTe, 1)}%, avg train ${f2(baseAvgTr)}% test ${f2(baseAvgTe)}%; combos tried ${tried}`);
  console.log(`top-400 by train win: avg train win ${f2(cand.reduce((s, x) => s + x.trW, 0) / cand.length, 1)}% -> avg TEST win ${f2(cand.reduce((s, x) => s + x.teW, 0) / cand.length, 1)}%;  profitable-in-train subset ${ok.length}: train ${f2(ok.reduce((s, x) => s + x.trW, 0) / (ok.length || 1), 1)}% -> TEST ${f2(ok.reduce((s, x) => s + x.teW, 0) / (ok.length || 1), 1)}%, test avg ${f2(ok.reduce((s, x) => s + x.avgTe, 0) / (ok.length || 1))}%`);
  console.log("best 8 profitable-in-train combos -> holdout:");
  for (const x of ok.slice(0, 8)) console.log(`  ${x.idx.map(i => names[i]).join(" + ")}\n     train ${f2(x.trW, 1)}% avg ${f2(x.avgTr)}% (n ${x.nTr}) | TEST ${f2(x.teW, 1)}% avg ${f2(x.avgTe)}% (n ${x.nTe})`);
});
