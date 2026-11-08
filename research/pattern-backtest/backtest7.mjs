// Robustness checks on the buy-the-dip entry (research only). Same data, costs and point-in-time rules as backtest6.mjs.
import { readFileSync } from "node:fs";
const current = JSON.parse(readFileSync("bars.json", "utf8"));
const former = JSON.parse(readFileSync("bars_former.json", "utf8"));
const raw = { ...former, ...current };
const intervals = new Map();
for (const l of readFileSync("members.csv", "utf8").trim().split("\n").slice(1)) { const [t, a, b] = l.split(","); (intervals.get(t) || intervals.set(t, []).get(t)).push([a, b || "9999-12-31"]); }
const memberAt = (sym, date) => (intervals.get(sym) || []).some(([a, b]) => date >= a && date <= b);
const COST = 0.001, SPLIT = "2024-11-05", WARM = 260;
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const variance = a => { const m = mean(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1); };

function prep(rows) {
  const n = rows.length, d = [], o = [], h = [], l = [], c = [], v = [];
  for (const r of rows) { d.push(r[0]); o.push(r[1]); h.push(r[2]); l.push(r[3]); c.push(r[4]); v.push(r[5]); }
  const tr = h.map((x, i) => i ? Math.max(x - l[i], Math.abs(x - c[i - 1]), Math.abs(l[i] - c[i - 1])) : x - l[i]);
  const atr14 = tr.map((_, i) => i >= 13 ? mean(tr.slice(i - 13, i + 1)) : NaN);
  const csum = [0]; for (const x of c) csum.push(csum[csum.length - 1] + x);
  const sma = (i, p) => i + 1 >= p ? (csum[i + 1] - csum[i + 1 - p]) / p : NaN;
  const bad = c.map((x, i) => i && Math.abs(x / c[i - 1] - 1) > 0.35 ? 1 : 0);
  const badSum = [0]; for (const x of bad) badSum.push(badSum[badSum.length - 1] + x);
  const hasBad = (a, b) => badSum[Math.min(n, b + 1)] - badSum[Math.max(0, a)] > 0;
  // RSI(2), Wilder smoothing
  const rsi2 = new Array(n).fill(NaN); { let ag = 0, al = 0;
    for (let i = 1; i < n; i++) { const ch = c[i] - c[i - 1], g = Math.max(ch, 0), ls = Math.max(-ch, 0);
      if (i <= 2) { ag += g / 2; al += ls / 2; } else { ag = (ag + g) / 2; al = (al + ls) / 2; }
      if (i >= 2) rsi2[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } }
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
  const dateIdx = new Map(d.map((x, i) => [x, i]));
  return { n, d, o, h, l, c, v, atr14, sma, hasBad, st, adx, rsi2, dateIdx };
}

// ---- market filter: SPY above its 200-day average at the signal close ----
const SPYS = prep(raw.SPY);
const mktUp = date => { const i = SPYS.dateIdx.get(date); return i !== undefined && i >= 200 && SPYS.c[i] > SPYS.sma(i, 200); };

// ---- entries (evaluated at the close of day t) ----
const sigST = (S, t) => t >= 60 && S.st[t] === 1 && S.st[t - 1] === -1 && S.adx[t] >= 20 && S.adx[t] > S.adx[t - 5];
const sigPullback = (S, t) => S.c[t] > S.sma(t, 200) && S.rsi2[t] < 10;                       // oversold dip inside an uptrend
const sigDeepPullback = (S, t) => S.c[t] > S.sma(t, 200) && S.rsi2[t] < 5 && S.c[t] < S.sma(t, 5) && S.c[t] / S.c[t - 3] - 1 < -0.05; // sharper dip
const sig52w = (S, t) => { if (t < 252) return false; let mx = -Infinity; for (let i = t - 252; i < t; i++) mx = Math.max(mx, S.h[i]); return S.c[t] > mx; };
const sigAll = (S, t) => true;
// Cross-sectional momentum: filled in below (top decile of 12-1 month return among members, every 21 trading days).
const momPick = new Map(); // key sym|date -> true
const ENTRIES = {
  "Current: daily Supertrend flip + ADX": sigST,
  "Pullback: RSI2<10 in uptrend": sigPullback,
  "Deep pullback: RSI2<5, -5% in 3d": sigDeepPullback,
  "52-week high": sig52w,
  "Momentum: top decile 12-1m, monthly": (S, t, sym) => momPick.has(sym + "|" + S.d[t]),
};
// ---- exits (fixed up front) ----
// stopATR: stop that many daily ATRs below entry. trailATR: exit when price falls that many ATRs below the highest close since entry.
// smaExit: exit at the close once the close is above its 5-day average. maxHold: time exit at that day's close.
const EXITS = {
  "5d, stop 1.5 ATR": { maxHold: 5, stopATR: 1.5 },
  "5d, no stop": { maxHold: 5 },
  "10d, stop 3 ATR": { maxHold: 10, stopATR: 3 },
  "21d, stop 3 ATR": { maxHold: 21, stopATR: 3 },
  "Trail 3 ATR, max 60d": { maxHold: 60, trailATR: 3 },
  "Close>5d avg, max 10d, stop 3 ATR": { maxHold: 10, stopATR: 3, smaExit: true },
};
function trade(S, t, X) {
  const e = t + 1, last = Math.min(S.n - 1, e + X.maxHold - 1);
  if (e + X.maxHold - 1 >= S.n) return null;
  if (S.hasBad(t - 252, last)) return null;
  const entry = S.o[e]; if (!(entry > 0)) return null;
  const atr = S.atr14[t]; if (!(atr > 0)) return null;
  const stop = X.stopATR ? entry - X.stopATR * atr : -Infinity;
  let exit = S.c[last], kind = "time", day = last - e + 1, hi = entry, trail = X.trailATR ? entry - X.trailATR * atr : -Infinity;
  for (let k = e; k <= last; k++) {
    const lvl = Math.max(stop, trail);
    if (k > e && S.o[k] <= lvl) { exit = S.o[k]; kind = "stop"; day = k - e + 1; break; }
    if (S.l[k] <= lvl) { exit = lvl; kind = "stop"; day = k - e + 1; break; }
    if (X.trailATR) { hi = Math.max(hi, S.c[k]); trail = Math.max(trail, hi - X.trailATR * atr); }
    if (X.smaExit && k > e && S.c[k] > S.sma(k, 5)) { exit = S.c[k]; kind = "signal"; day = k - e + 1; break; }
  }
  return { ret: (exit / entry - 1 - 2 * COST) * 100, kind, day, date: S.d[e] };
}


const syms = Object.keys(raw).filter(s => s !== "SPY");
const data = new Map();
for (const sym of syms) { const rows = raw[sym]; if (rows.length < 300 || rows.some(r => !(r[4] > 0))) continue; data.set(sym, prep(rows)); }
const f2 = (x, p = 2) => Number.isFinite(x) ? x.toFixed(p) : "n/a";
const wk = d => { const t = Date.parse(d) / 864e5; return Math.floor((t + 3) / 7); };
const dip = (rsiMax, drop, below5 = true) => (S, t) => S.c[t] > S.sma(t, 200) && S.rsi2[t] < rsiMax && (!below5 || S.c[t] < S.sma(t, 5)) && (drop === 0 || S.c[t] / S.c[t - 3] - 1 < drop);
const X5 = { maxHold: 5 }, X10 = { maxHold: 10, stopATR: 3 };

function collect(sig, X, base = false) {
  const out = [];
  for (const [sym, S] of data) {
    let free = -1;
    for (let t = WARM; t < S.n - 1; t++) {
      if (!memberAt(sym, S.d[t])) continue;
      if (!base) { if (t <= free || !sig(S, t)) continue; }
      const r = trade(S, t, X); if (!r) continue;
      if (!base) free = t + r.day;
      out.push({ ...r, sym, exitDate: S.d[Math.min(S.n - 1, t + r.day)], rsi: S.rsi2[t] });
    }
  }
  return out;
}
const adj = (tr, c) => tr.map(x => x.ret + 0.2 - 2 * c * 100);

const MAIN = dip(5, -0.05), base5 = collect(null, X5, true), main5 = collect(MAIN, X5);
const m = a => mean(a.map(x => x.ret));
console.log(`Main test: RSI2<5, close<5d avg, -5% in 3d, above 200d; 5-day hold, no stop. n=${main5.length}, mean ${f2(m(main5))}%, baseline ${f2(m(base5))}%\n`);

console.log("1) By calendar year of entry (edge vs any stock-day in the same year)");
for (const y of ["2022", "2023", "2024", "2025", "2026"]) {
  const a = main5.filter(x => x.date.startsWith(y)), b = base5.filter(x => x.date.startsWith(y));
  if (a.length) console.log(`  ${y}  n ${String(a.length).padStart(5)}  mean ${f2(m(a)).padStart(6)}%  base ${f2(m(b)).padStart(6)}%  edge ${f2(m(a) - m(b)).padStart(6)}%  win ${f2(a.filter(x => x.ret > 0).length / a.length * 100, 0)}%`);
}

console.log("\n2) Weekly buckets (removes overlap): mean over weeks of (dip trades' average minus that week's baseline average)");
{ const bw = new Map(), aw = new Map();
  for (const x of base5) (bw.get(wk(x.date)) || bw.set(wk(x.date), []).get(wk(x.date))).push(x.ret);
  for (const x of main5) (aw.get(wk(x.date)) || aw.set(wk(x.date), []).get(wk(x.date))).push(x.ret);
  const d = []; for (const [k, v] of aw) if (bw.has(k)) d.push(mean(v) - mean(bw.get(k)));
  const t = mean(d) / Math.sqrt(variance(d) / d.length), pos = d.filter(x => x > 0).length;
  console.log(`  weeks with dip trades: ${d.length}, mean weekly edge ${f2(mean(d))}%, t ${f2(t, 1)}, positive in ${f2(pos / d.length * 100, 0)}% of weeks`); }

console.log("\n3) Cost sensitivity (per side): ");
for (const c of [0.001, 0.002, 0.003, 0.005]) console.log(`  ${(c * 100).toFixed(1)}%  mean ${f2(mean(adj(main5, c)))}%  baseline ${f2(mean(adj(base5, c)))}%`);

console.log("\n4) Outlier and loss checks");
{ const r = main5.map(x => x.ret).sort((a, b) => a - b), k = Math.floor(r.length * 0.01);
  console.log(`  trimmed mean (drop best and worst 1%): ${f2(mean(r.slice(k, r.length - k)))}%   median ${f2(r[r.length >> 1])}%   worst trade ${f2(r[0])}%   5th pct ${f2(r[Math.floor(r.length * 0.05)])}%`);
  const edge = m(main5);
  console.log(`  Missing-delisting check: edge ${f2(edge)}% per trade is erased if 1% of trades lose an extra ${f2(edge / 0.01, 0)}%, or 5% of trades an extra ${f2(edge / 0.05, 0)}%.`);
  console.log(`  Worst symbols in this set: ` + [...new Set(main5.filter(x => x.ret < -15).map(x => x.sym + " " + f2(x.ret, 0) + "%"))].slice(0, 12).join(", ")); }

console.log("\n5) Threshold sensitivity (5-day hold, no stop; mean per trade, edge vs baseline " + f2(m(base5)) + "%)");
console.log("  RSI2 max / drop in 3d / close<5d avg:      n    mean  edge   win%");
for (const [rm, dr, b5] of [[5, -0.05, true], [5, -0.03, true], [5, -0.08, true], [10, -0.05, true], [10, -0.03, true], [10, 0, false], [3, -0.05, true], [15, -0.05, true], [5, 0, false]]) {
  const tr = collect(dip(rm, dr, b5), X5);
  console.log(`  ${String(rm).padStart(4)} / ${(dr * 100).toFixed(0).padStart(3)}% / ${String(b5).padEnd(5)}            ${String(tr.length).padStart(8)} ${f2(m(tr)).padStart(6)} ${f2(m(tr) - m(base5)).padStart(6)} ${f2(tr.filter(x => x.ret > 0).length / tr.length * 100, 0).padStart(5)}`);
}

console.log("\n6) Portfolio simulation: up to 10 concurrent positions, 10% each, 5-day hold, lowest RSI2 first, realized P&L on exit date");
{ const byDate = new Map(); for (const x of main5) (byDate.get(x.date) || byDate.set(x.date, []).get(x.date)).push(x);
  const dates = [...byDate.keys()].sort(); const open = []; let eq = 1, peak = 1, maxDD = 0, taken = 0;
  const allDates = SPYS.d.filter(d => d >= dates[0]);
  for (const d of allDates) {
    for (let i = open.length - 1; i >= 0; i--) if (open[i].exitDate <= d) { eq += 0.1 * open[i].ret / 100 * eq; open.splice(i, 1); peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak); }
    const c = (byDate.get(d) || []).sort((a, b) => a.rsi - b.rsi);
    for (const x of c) { if (open.length >= 10) break; open.push(x); taken++; }
  }
  const yrs = (Date.parse(allDates.at(-1)) - Date.parse(allDates[0])) / (365.25 * 864e5);
  const spyI = SPYS.dateIdx.get(allDates[0]), spyR = SPYS.c.at(-1) / SPYS.o[spyI];
  let spPeak = 0, spDD = 0; for (let i = spyI; i < SPYS.n; i++) { spPeak = Math.max(spPeak, SPYS.c[i]); spDD = Math.max(spDD, 1 - SPYS.c[i] / spPeak); }
  console.log(`  trades taken ${taken} of ${main5.length} signals over ${f2(yrs, 1)} years; final equity ${f2(eq)}x (${f2((eq ** (1 / yrs) - 1) * 100, 1)}%/yr), max realized drawdown ${f2(maxDD * 100, 1)}%`);
  console.log(`  SPY buy and hold same dates: ${f2(spyR)}x (${f2((spyR ** (1 / yrs) - 1) * 100, 1)}%/yr), max drawdown ${f2(spDD * 100, 1)}%. The strategy holds cash on many days, so compare drawdown as well as return.`); }

console.log("\n7) 10-day hold with 3 ATR stop (the lower-tail-risk variant)");
{ const b = collect(null, X10, true), a = collect(MAIN, X10); const r = a.map(x => x.ret).sort((p, q) => p - q);
  console.log(`  n ${a.length}, mean ${f2(m(a))}%, baseline ${f2(m(b))}%, win ${f2(a.filter(x => x.ret > 0).length / a.length * 100, 0)}%, stopped ${f2(a.filter(x => x.kind === "stop").length / a.length * 100, 0)}%, worst ${f2(r[0])}%, 5th pct ${f2(r[Math.floor(r.length * 0.05)])}%`); }
