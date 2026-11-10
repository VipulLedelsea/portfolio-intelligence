// Stage B: exhaustive pair / triple / quad search over the 67 indicator conditions. Pick on TRAIN only, judge on the holdout.
import { readFileSync } from "node:fs";
import { data, exitSim, f2 } from "./lib14.mjs";
const SPLIT = "2024-11-05", J = JSON.parse(readFileSync("rows14.json", "utf8")), names = J.conds, rows = J.rows.slice().sort((a, b) => a.date < b.date ? -1 : 1);
const N = rows.length, C = names.length, W = Math.ceil(N / 32);
const OUTS = { "A: current exit (line only)": { st: true }, "B: stop -15%, target +5%": { stop: 15, target: 5, maxHold: 120 }, "C: stop -12%, target +10%": { stop: 12, target: 10, maxHold: 120 } };
const condBits = Array.from({ length: C }, () => new Uint32Array(W)), isTrain = new Uint32Array(W);
rows.forEach((r, i) => { const w = i >> 5, b = 1 << (i & 31); if (r.date < SPLIT) isTrain[w] |= b; for (let c = 0; c < C; c++) if (r.bits[c] === "1") condBits[c][w] |= b; });
const pop = x => { x = x - ((x >>> 1) & 0x55555555); x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24; };
const cnt = (a) => { let s = 0; for (let w = 0; w < W; w++) s += pop(a[w]); return s; };
const flipBits = new Uint32Array(W); rows.forEach((r, i) => { if (r.flip) flipBits[i >> 5] |= 1 << (i & 31); });
for (const [oname, V] of Object.entries(OUTS)) {
  const win = new Uint32Array(W), ret = new Float64Array(N);
  rows.forEach((r, i) => { const x = V.st && Object.keys(V).length === 1 ? { ret: r.ret } : exitSim(data.get(r.sym), r.t, V); ret[i] = x ? x.ret : 0; if (x && x.ret > 0) win[i >> 5] |= 1 << (i & 31); });
  const testMask = new Uint32Array(W); for (let w = 0; w < W; w++) testMask[w] = ~isTrain[w];
  const tail = N & 31; if (tail) testMask[W - 1] &= (1 << tail) - 1;
  const trW = new Uint32Array(W), teW = new Uint32Array(W), trA = new Uint32Array(W), teA = new Uint32Array(W);
  for (let w = 0; w < W; w++) { trA[w] = isTrain[w]; teA[w] = testMask[w]; trW[w] = win[w] & isTrain[w]; teW[w] = win[w] & testMask[w]; }
  const baseTr = cnt(trW) / cnt(trA) * 100, baseTe = cnt(teW) / cnt(teA) * 100;
  const evalMask = (m) => { let nTr = 0, wTr = 0, nTe = 0, wTe = 0; for (let w = 0; w < W; w++) { const x = m[w]; nTr += pop(x & trA[w]); wTr += pop(x & trW[w]); nTe += pop(x & teA[w]); wTe += pop(x & teW[w]); } return { nTr, wTr, nTe, wTe }; };
  const meanRet = (m) => { let s = 0, n = 0; for (let w = 0; w < W; w++) { let x = m[w] & teA[w]; while (x) { const b = x & -x, i = (w << 5) + (31 - Math.clz32(b)); s += ret[i]; n++; x ^= b; } } return n ? s / n : NaN; };
  const out = []; let tried = 0; const tmp2 = new Uint32Array(W), tmp3 = new Uint32Array(W), tmp4 = new Uint32Array(W);
  const consider = (idx, m) => { tried++; const e = evalMask(m); if (e.nTr >= 600 && e.nTe >= 300) out.push({ idx: idx.slice(), ...e, trWin: e.wTr / e.nTr * 100, teWin: e.wTe / e.nTe * 100 }); };
  for (let a = 0; a < C; a++) for (let b = a + 1; b < C; b++) { for (let w = 0; w < W; w++) tmp2[w] = condBits[a][w] & condBits[b][w]; consider([a, b], tmp2);
    for (let c = b + 1; c < C; c++) { for (let w = 0; w < W; w++) tmp3[w] = tmp2[w] & condBits[c][w]; consider([a, b, c], tmp3);
      if (cnt(tmp3) < 700) continue; for (let d = c + 1; d < C; d++) { for (let w = 0; w < W; w++) tmp4[w] = tmp3[w] & condBits[d][w]; consider([a, b, c, d], tmp4); } } }
  out.sort((x, y) => y.trWin - x.trWin);
  const top = out.slice(0, 200);
  const m = top.map(x => ({ lTr: x.trWin - baseTr, lTe: x.teWin - baseTe })); const avg = f => m.reduce((s, x) => s + f(x), 0) / m.length;
  console.log(`\n################ outcome ${oname}: baseline win train ${f2(baseTr, 1)}% / test ${f2(baseTe, 1)}%; combos tried ${tried}, qualifying ${out.length}`);
  console.log(`top-200 by TRAIN win rate: average train lift ${f2(avg(x => x.lTr), 1)} pts  ->  average TEST lift ${f2(avg(x => x.lTe), 1)} pts; share with test lift > 0: ${f2(m.filter(x => x.lTe > 0).length / m.length * 100, 0)}%`);
  // noise reference: same selection but on a random shuffle of the train/test labels is not run here; the gap above is the selection-bias estimate
  console.log("top 12 combos (picked on train) -> holdout:");
  for (const x of top.slice(0, 12)) { const mm = new Uint32Array(W); mm.fill(0xFFFFFFFF); for (const i of x.idx) for (let w = 0; w < W; w++) mm[w] &= condBits[i][w]; let fl = 0, fw = 0; for (let w = 0; w < W; w++) { fl += pop(mm[w] & flipBits[w]); fw += pop(mm[w] & flipBits[w] & win[w]); }
    console.log(`  ${x.idx.map(i => names[i]).join(" + ")}\n     train ${f2(x.trWin, 1)}% (n ${x.nTr})  TEST ${f2(x.teWin, 1)}% (n ${x.nTe}, avg ${f2(meanRet(mm))}%)  fresh flips: ${fl ? f2(fw / fl * 100, 0) + "% of " + fl : "none"}`); }
}
