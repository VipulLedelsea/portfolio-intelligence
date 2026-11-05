import { readFileSync, writeFileSync } from "node:fs";
const raw = JSON.parse(readFileSync("bars.json", "utf8"));
const H = Number(process.argv[2] || 20), COST = 0.001; // 10 bps per side
const STOP_ATR = 2;
const SPLIT = "2024-11-05"; // rules are fixed a priori; the split only shows stability across time
const WARM = 260;

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

function prep(rows) {
  const n = rows.length, d = [], o = [], h = [], l = [], c = [], v = [];
  for (const r of rows) { d.push(r[0]); o.push(r[1]); h.push(r[2]); l.push(r[3]); c.push(r[4]); v.push(r[5]); }
  const tr = h.map((x, i) => i ? Math.max(x - l[i], Math.abs(x - c[i - 1]), Math.abs(l[i] - c[i - 1])) : x - l[i]);
  const atr14 = tr.map((_, i) => i >= 13 ? mean(tr.slice(i - 13, i + 1)) : NaN);
  const csum = [0]; for (const x of c) csum.push(csum[csum.length - 1] + x);
  const sma = (i, p) => i + 1 >= p ? (csum[i + 1] - csum[i + 1 - p]) / p : NaN;
  const vsum = [0]; for (const x of v) vsum.push(vsum[vsum.length - 1] + x);
  const avgVol = i => i >= 50 ? (vsum[i] - vsum[i - 50]) / 50 : NaN; // prior 50 days, excludes day i
  const bad = c.map((x, i) => i && Math.abs(x / c[i - 1] - 1) > 0.35 ? 1 : 0);
  const badSum = [0]; for (const x of bad) badSum.push(badSum[badSum.length - 1] + x);
  const hasBad = (a, b) => badSum[Math.min(n, b + 1)] - badSum[Math.max(0, a)] > 0;
  // Supertrend(10,3) and ADX(14), Wilder smoothing
  const st = (() => {
    const atr = []; let prev = NaN;
    for (let i = 0; i < n; i++) { prev = i < 10 ? NaN : i === 10 ? mean(tr.slice(1, 11)) : (prev * 9 + tr[i]) / 10; atr.push(prev); }
    const dir = new Array(n).fill(0); let fu = NaN, fl = NaN;
    for (let i = 10; i < n; i++) {
      const mid = (h[i] + l[i]) / 2, bu = mid + 3 * atr[i], bl = mid - 3 * atr[i];
      if (i === 10) { fu = bu; fl = bl; dir[i] = c[i] >= mid ? 1 : -1; continue; }
      fu = (bu < fu || c[i - 1] > fu) ? bu : fu;
      fl = (bl > fl || c[i - 1] < fl) ? bl : fl;
      dir[i] = dir[i - 1] === -1 ? (c[i] > fu ? 1 : -1) : (c[i] < fl ? -1 : 1);
    }
    return dir;
  })();
  const adx = (() => {
    const out = new Array(n).fill(NaN); let tr14 = 0, p14 = 0, m14 = 0; const dx = [];
    for (let i = 1; i < n; i++) {
      const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
      const pdm = up > dn && up > 0 ? up : 0, mdm = dn > up && dn > 0 ? dn : 0;
      if (i <= 14) { tr14 += tr[i]; p14 += pdm; m14 += mdm; } else { tr14 = tr14 - tr14 / 14 + tr[i]; p14 = p14 - p14 / 14 + pdm; m14 = m14 - m14 / 14 + mdm; }
      if (i >= 14) { const pdi = 100 * p14 / tr14, mdi = 100 * m14 / tr14; dx.push(100 * Math.abs(pdi - mdi) / (pdi + mdi || 1)); const k = dx.length; out[i] = k === 14 ? mean(dx) : k > 14 ? (out[i - 1] * 13 + dx[k - 1]) / 14 : NaN; }
    }
    return out;
  })();
  return { n, d, o, h, l, c, v, atr14, sma, avgVol, hasBad, st, adx };
}

// ---- signals (evaluated at the close of day t; entry is the next open) ----
const volOk = (S, t, mult) => S.v[t] >= mult * S.avgVol(t);
function sig52w(S, t, needVol) {
  if (t < 252) return false;
  let mx = -Infinity; for (let i = t - 252; i < t; i++) mx = Math.max(mx, S.h[i]);
  return S.c[t] > mx && (!needVol || volOk(S, t, 1.5));
}
function sigFlag(S, t, minPole) {
  if (t < 40) return false;
  let p = t - 16; for (let i = t - 16; i <= t - 1; i++) if (S.h[i] > S.h[p]) p = i;
  if (p > t - 4 || p < t - 16) return false;
  let lowPole = Infinity, lpi = p; for (let i = p - 15; i <= p; i++) if (S.l[i] < lowPole) { lowPole = S.l[i]; lpi = i; }
  if (S.h[p] / lowPole - 1 < minPole) return false;
  let flagLow = Infinity, flagHigh = -Infinity, fr = 0, fc = 0;
  for (let i = p + 1; i <= t - 1; i++) { flagLow = Math.min(flagLow, S.l[i]); flagHigh = Math.max(flagHigh, S.h[i]); fr += S.h[i] - S.l[i]; fc++; }
  let pr = 0, pc = 0; for (let i = lpi; i <= p; i++) { pr += S.h[i] - S.l[i]; pc++; }
  if ((S.h[p] - flagLow) / (S.h[p] - lowPole) > 0.5) return false;
  if (fr / fc > 0.8 * (pr / pc)) return false;
  return S.c[t] > flagHigh && volOk(S, t, 1.2);
}
function sigCup(S, t) {
  if (t < 140) return false;
  let near = -Infinity; for (let i = t - 130; i < t; i++) near = Math.max(near, S.h[i]);
  if (S.c[t] < 0.97 * near || !volOk(S, t, 1.3) || !(S.c[t] > S.sma(t, 200))) return false;
  for (const W of [35, 50, 70, 100, 130]) for (const hh of [5, 8, 12, 15]) {
    const c0 = t - hh, a = c0 - W; if (a < 5) continue;
    let rimL = -Infinity; for (let i = a - 3; i <= a + 3; i++) rimL = Math.max(rimL, S.h[i]);
    let bottom = Infinity, b = a; for (let i = a + 3; i <= c0 - 3; i++) if (S.l[i] < bottom) { bottom = S.l[i]; b = i; }
    const depth = (rimL - bottom) / rimL; if (depth < 0.12 || depth > 0.35) continue;
    if (b < a + 0.25 * W || b > a + 0.75 * W) continue;
    let rimR = -Infinity; for (let i = c0 - 4; i <= c0; i++) rimR = Math.max(rimR, S.h[i]);
    if (rimR < 0.92 * rimL || rimR > 1.05 * rimL) continue;
    let hLow = Infinity, hHigh = -Infinity; for (let i = c0 + 1; i <= t - 1; i++) { hLow = Math.min(hLow, S.l[i]); hHigh = Math.max(hHigh, S.h[i]); }
    if (hHigh > rimR * 1.01) continue;
    if ((rimR - hLow) / rimR > 0.12 || (rimR - hLow) > 0.5 * (rimR - bottom)) continue;
    if (S.c[t] > rimR) return true;
  }
  return false;
}
const sigST = (S, t) => t >= 60 && S.st[t] === 1 && S.st[t - 1] === -1 && S.adx[t] >= 20 && S.adx[t] > S.adx[t - 5];
const sigTrend = (S, t) => t >= 252 && S.c[t] > S.sma(t, 200);
const sigAll = (S, t) => t >= 252;

const STRATS = {
  "52w high + volume": (S, t) => sig52w(S, t, true),
  "52w high (no vol)": (S, t) => sig52w(S, t, false),
  "Bull flag (pole>=20%)": (S, t) => sigFlag(S, t, 0.20),
  "Bull flag (pole>=12%)": (S, t) => sigFlag(S, t, 0.12),
  "Cup and handle": sigCup,
  "Daily Supertrend flip + ADX": sigST,
};
const sigSurge = (S, t) => t >= 252 && S.c[t] > S.sma(t, 200) && S.c[t] / S.c[t - 20] - 1 >= 0.20;
const BASES = { "Baseline: any stock-day": sigAll, "Baseline: above 200-day": sigTrend, "Control: up 20%+ in 20 days": sigSurge };

function trade(S, t, useStop) {
  const e = t + 1, last = e + H - 1; if (last >= S.n) return null;
  if (S.hasBad(t - 252, last)) return null;
  const entry = S.o[e]; if (!(entry > 0)) return null;
  const stop = entry - STOP_ATR * S.atr14[t];
  let exit = S.c[last], hit = false;
  if (useStop) for (let k = e; k <= last; k++) {
    if (k > e && S.o[k] <= stop) { exit = S.o[k]; hit = true; break; }
    if (S.l[k] <= stop) { exit = stop; hit = true; break; }
  }
  return { ret: (exit / entry - 1 - 2 * COST) * 100, hit, entryDate: S.d[e] };
}

const results = {}; // strat -> useStop -> trades[]
const names = [...Object.keys(STRATS), ...Object.keys(BASES)];
for (const nm of names) results[nm] = { stop: [], nostop: [] };
const syms = Object.keys(raw).filter(s => s !== "SPY");
let skipped = 0;
for (const sym of syms) {
  const rows = raw[sym]; if (rows.length < 400 || rows.some(r => !(r[4] > 0))) { skipped++; continue; }
  const S = prep(rows);
  for (const nm of Object.keys(STRATS)) {
    let free = -1;
    for (let t = WARM; t < S.n - 1; t++) {
      if (t <= free) continue;
      if (!STRATS[nm](S, t)) continue;
      const a = trade(S, t, true), b = trade(S, t, false); if (!a) continue;
      a.sym = sym; b.sym = sym; results[nm].stop.push(a); results[nm].nostop.push(b);
      free = t + H; // one open trade per stock
    }
  }
  for (const nm of Object.keys(BASES)) for (let t = WARM; t < S.n - H - 1; t += 1) {
    if (!BASES[nm](S, t)) continue;
    const a = trade(S, t, true), b = trade(S, t, false); if (!a) continue;
    results[nm].stop.push(a); results[nm].nostop.push(b);
  }
}
console.log("stocks used", syms.length - skipped, "skipped", skipped, "hold days", H);

function stats(tr) {
  const r = tr.map(x => x.ret), w = r.filter(x => x > 0), L = r.filter(x => x <= 0);
  return { n: r.length, win: w.length / (r.length || 1) * 100, mean: mean(r), med: median(r), pf: L.length ? w.reduce((s, x) => s + x, 0) / Math.abs(L.reduce((s, x) => s + x, 0)) : NaN, stopHit: tr.filter(x => x.hit).length / (r.length || 1) * 100 };
}
const fmt = s => `n=${String(s.n).padStart(6)}  win ${s.win.toFixed(0).padStart(3)}%  mean ${s.mean.toFixed(2).padStart(6)}%  median ${s.med.toFixed(2).padStart(6)}%  PF ${isNaN(s.pf) ? "  - " : s.pf.toFixed(2)}  stop ${s.stopHit.toFixed(0)}%`;
const byMonth = tr => { const m = new Map(); for (const x of tr) { const k = x.entryDate.slice(0, 7); (m.get(k) || m.set(k, []).get(k)).push(x.ret); } return m; };

for (const mode of ["stop", "nostop"]) {
  console.log(`\n===== ${mode === "stop" ? `2xATR stop + ${H}-day exit` : `${H}-day hold, no stop`} (costs 0.2% round trip) =====`);
  const baseT = results["Baseline: above 200-day"][mode], baseM = byMonth(baseT);
  for (const nm of names) {
    const all = results[nm][mode], is = all.filter(x => x.entryDate < SPLIT), oos = all.filter(x => x.entryDate >= SPLIT);
    console.log(`${nm}`);
    console.log("   all  ", fmt(stats(all)));
    console.log("   first ", fmt(stats(is)));
    console.log("   last  ", fmt(stats(oos)));
    if (!nm.startsWith("Baseline")) {
      const m = byMonth(all); let better = 0, tot = 0;
      for (const [k, arr] of m) { const b = baseM.get(k); if (arr.length >= 3 && b && b.length >= 30) { tot++; if (mean(arr) > mean(b)) better++; } }
      const s = stats(all), bs = stats(baseT);
      const se = Math.sqrt(sd(all.map(x => x.ret)) ** 2 / all.length + sd(baseT.map(x => x.ret)) ** 2 / baseT.length);
      console.log(`   vs above-200-day baseline: ${(s.mean - bs.mean >= 0 ? "+" : "")}${(s.mean - bs.mean).toFixed(2)}% per trade (naive t ${((s.mean - bs.mean) / se).toFixed(1)}), better in ${better}/${tot} months`);
    }
  }
}
{ const f = results["Bull flag (pole>=20%)"].nostop, by = new Map(); for (const x of f) (by.get(x.sym) || by.set(x.sym, []).get(x.sym)).push(x.ret);
  const top = [...by.entries()].sort((a, b) => b[1].length - a[1].length);
  const rest = f.filter(x => !top.slice(0, 5).some(([k]) => k === x.sym));
  console.log(`\nFlag20 concentration: ${by.size} distinct stocks; top 5 by trade count: ${top.slice(0, 5).map(([k, v]) => k + " x" + v.length).join(", ")}; mean excluding those 5 = ${mean(rest.map(x => x.ret)).toFixed(2)}% over ${rest.length} trades`); }
writeFileSync(`results_${H}.json`, JSON.stringify(Object.fromEntries(names.map(nm => [nm, { stop: stats(results[nm].stop), nostop: stats(results[nm].nostop) }]))));
