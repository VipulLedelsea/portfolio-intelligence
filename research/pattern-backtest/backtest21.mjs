// Entry idea: pullback to rising support in an up-trend, with a STRUCTURAL stop just under the pullback low (risk capped at 5%).
// Then the owner's filtering idea: pick filters on train, judge on the holdout. Targets in R multiples or fixed percent, 15-day cap.
import { data, CONDS, SPY, memberAt, f2, COST, WARM } from "./lib14.mjs";
const SPLIT = "2024-11-05", H = 15;
CONDS.push({ name: "SPY 5d <= -1.5%", group: "market", fn: (S, t) => { const j = SPY.dateIdx.get(S.d[t]); return j !== undefined && SPY.c[j] / SPY.c[j - 5] - 1 <= -0.015; } });
CONDS.push({ name: "pullback 2+ down closes", group: "dip", fn: (S, t) => S.c[t - 1] < S.c[t - 2] && S.c[t - 2] < S.c[t - 3] });
CONDS.push({ name: "RSI2<30", group: "dip", fn: (S, t) => S.rsi2[t] < 30 });
CONDS.push({ name: "touched sma20 (low<=sma20)", group: "dip", fn: (S, t) => S.l[t] <= S.sma20[t] });
const names = CONDS.map(c => c.name), C = CONDS.length;
const OUT = [["target 1R", { r: 1 }], ["target 1.5R", { r: 1.5 }], ["target 2R", { r: 2 }], ["target +3%", { pct: 3 }], ["target +5%", { pct: 5 }]];
const rows = [];
for (const [sym, S] of data) { if (sym === "SPY") continue; let skip = 0;
  for (let t = WARM; t < S.n - H - 2; t++) { if (skip > 0) { skip--; continue; }
    // trigger: up-trend, rising 20-day EMA, price dipped to it and closed back above it
    if (!(S.c[t] > S.sma50[t] && S.sma50[t] > S.sma200[t] && S.ema20[t] > S.ema20[t - 5] && S.l[t] <= S.ema20[t] * 1.005 && S.c[t] > S.ema20[t] && S.atr14[t] > 0)) continue;
    if (!memberAt(sym, S.d[t]) || S.hasBad(t - 252, t + H + 1)) continue;
    const e = t + 1, entry = S.o[e]; if (!(entry > 0)) continue; let lo = Infinity; for (let i = t - 4; i <= t; i++) lo = Math.min(lo, S.l[i]);
    const stop = lo - 0.1 * S.atr14[t], risk = entry - stop; if (!(risk > 0) || risk / entry > 0.05 || risk / entry < 0.008) continue;
    const rets = OUT.map(([, o]) => { const tp = o.r ? entry + o.r * risk : entry * (1 + o.pct / 100); let exit = S.c[e + H - 1];
      for (let j = e; j < e + H; j++) { if (j > e && S.o[j] <= stop) { exit = S.o[j]; break; } if (S.l[j] <= stop) { exit = stop; break; } if (j > e && S.o[j] >= tp) { exit = S.o[j]; break; } if (S.h[j] >= tp) { exit = tp; break; } }
      return (exit / entry - 1 - 2 * COST) * 100; });
    let bits = ""; for (const c of CONDS) { let b = 0; try { b = c.fn(S, t, sym) ? 1 : 0; } catch { b = 0; } bits += b; }
    rows.push({ date: S.d[e], bits, rets, riskPct: 100 * risk / entry }); skip = 4; } }
rows.sort((a, b) => a.date < b.date ? -1 : 1);
const N = rows.length, W = Math.ceil(N / 32); console.log(`pullback-to-rising-EMA20 triggers: ${N}; average structural stop ${f2(rows.reduce((s, r) => s + r.riskPct, 0) / N, 2)}% below entry`);
const cb = Array.from({ length: C }, () => new Uint32Array(W)), trA = new Uint32Array(W), teA = new Uint32Array(W);
rows.forEach((r, i) => { const w = i >> 5, b = 1 << (i & 31); (r.date < SPLIT ? trA : teA)[w] |= b; for (let c = 0; c < C; c++) if (r.bits[c] === "1") cb[c][w] |= b; });
const pop = x => { x = x - ((x >>> 1) & 0x55555555); x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24; };
const idxOf = (m, which) => { const o = []; for (let w = 0; w < W; w++) { let x = m[w] & which[w]; while (x) { const b = x & -x; o.push((w << 5) + (31 - Math.clz32(b))); x ^= b; } } return o; };
const all = new Uint32Array(W).fill(0xFFFFFFFF);
OUT.forEach(([oname], oi) => {
  const win = new Uint32Array(W); rows.forEach((r, i) => { if (r.rets[oi] > 0) win[i >> 5] |= 1 << (i & 31); });
  const trW = new Uint32Array(W), teW = new Uint32Array(W); for (let w = 0; w < W; w++) { trW[w] = win[w] & trA[w]; teW[w] = win[w] & teA[w]; }
  const avg = (m, which) => { const ix = idxOf(m, which); return { n: ix.length, avg: ix.reduce((s, i) => s + rows[i].rets[oi], 0) / (ix.length || 1), win: ix.filter(i => rows[i].rets[oi] > 0).length / (ix.length || 1) * 100 }; };
  const b = { tr: avg(all, trA), te: avg(all, teA) };
  console.log(`\n######## ${oname}: ALL triggers  train win ${f2(b.tr.win, 1)}% avg ${f2(b.tr.avg)}% (n ${b.tr.n}) | test win ${f2(b.te.win, 1)}% avg ${f2(b.te.avg)}% (n ${b.te.n})`);
  const ev = m => { let nTr = 0, wTr = 0, nTe = 0, wTe = 0; for (let w = 0; w < W; w++) { const x = m[w]; nTr += pop(x & trA[w]); wTr += pop(x & trW[w]); nTe += pop(x & teA[w]); wTe += pop(x & teW[w]); } return { nTr, wTr, nTe, wTe }; };
  const out = []; let tried = 0, m2 = new Uint32Array(W), m3 = new Uint32Array(W);
  const consider = (idx, m) => { tried++; const e = ev(m); if (e.nTr >= 500 && e.nTe >= 250) out.push({ idx: idx.slice(), ...e, trW: e.wTr / e.nTr * 100, teW: e.wTe / e.nTe * 100 }); };
  for (let a = 0; a < C; a++) { consider([a], cb[a]); for (let c2 = a + 1; c2 < C; c2++) { for (let w = 0; w < W; w++) m2[w] = cb[a][w] & cb[c2][w]; consider([a, c2], m2); for (let c3 = c2 + 1; c3 < C; c3++) { for (let w = 0; w < W; w++) m3[w] = m2[w] & cb[c3][w]; consider([a, c2, c3], m3); } } }
  out.sort((x, y) => y.trW - x.trW); const mask = idx => { const m = all.slice(); for (const i of idx) for (let w = 0; w < W; w++) m[w] &= cb[i][w]; return m; };
  const cand = out.slice(0, 300).map(x => { const m = mask(x.idx); return { ...x, tr: avg(m, trA), te: avg(m, teA) }; });
  const prof = cand.filter(x => x.tr.avg > 0);
  console.log(`combos tried ${tried}; top-300 by train win: avg train ${f2(cand.reduce((s, x) => s + x.trW, 0) / cand.length, 1)}% -> avg TEST ${f2(cand.reduce((s, x) => s + x.teW, 0) / cand.length, 1)}% (baseline test ${f2(b.te.win, 1)}%); profitable-in-train ${prof.length}, their TEST avg return ${f2(prof.reduce((s, x) => s + x.te.avg, 0) / (prof.length || 1))}%`);
  for (const x of prof.slice(0, 5)) console.log(`   ${x.idx.map(i => names[i]).join(" + ")}\n      train ${f2(x.trW, 1)}% avg ${f2(x.tr.avg)}% (n ${x.nTr}) | TEST ${f2(x.teW, 1)}% avg ${f2(x.te.avg)}% (n ${x.nTe})`);
});
