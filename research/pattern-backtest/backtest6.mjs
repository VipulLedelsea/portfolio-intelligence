// Edge search (research only, not shipped): which entries and exits make money on a point-in-time S&P 500 universe?
// Rules are fixed up front (see ENTRIES and EXITS). Signals fire at the close, entry is the next open, 0.1% cost per side.
// Every entry set is compared with "any stock-day" run through the SAME exit and the SAME market filter.
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

// ---- build per-symbol data and the momentum picks ----
const syms = Object.keys(raw).filter(s => s !== "SPY");
const data = new Map();
for (const sym of syms) { const rows = raw[sym]; if (rows.length < 300 || rows.some(r => !(r[4] > 0))) continue; data.set(sym, prep(rows)); }
const cal = SPYS.d;
for (let ci = WARM; ci < cal.length - 1; ci += 21) {
  const date = cal[ci], scored = [];
  for (const [sym, S] of data) {
    const i = S.dateIdx.get(date); if (i === undefined || i < 252 || !memberAt(sym, date)) continue;
    scored.push([sym, S.c[i - 21] / S.c[i - 252] - 1]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  for (const [sym] of scored.slice(0, Math.floor(scored.length / 10))) momPick.set(sym + "|" + date, true);
}

// ---- run ----
const FILTERS = { "no market filter": () => true, "SPY above 200d only": mktUp };
const exitNames = Object.keys(EXITS);
const R = {}; // R[entry][filter][exit] = trades
const entryNames = [...Object.keys(ENTRIES), "BASELINE: any stock-day"];
for (const en of entryNames) { R[en] = {}; for (const f of Object.keys(FILTERS)) { R[en][f] = {}; for (const x of exitNames) R[en][f][x] = []; } }
for (const [sym, S] of data) {
  for (const en of entryNames) {
    const isBase = en.startsWith("BASELINE"), sig = isBase ? sigAll : ENTRIES[en];
    const free = {}; for (const x of exitNames) free[x] = -1; // one open trade per stock per exit rule (not for the baseline)
    for (let t = WARM; t < S.n - 1; t++) {
      if (!memberAt(sym, S.d[t])) continue;
      if (!isBase && !sig(S, t, sym)) continue;
      const up = mktUp(S.d[t]);
      for (const x of exitNames) {
        if (!isBase && t <= free[x]) continue;
        const r = trade(S, t, EXITS[x]); if (!r) continue;
        if (!isBase) free[x] = t + r.day;
        R[en]["no market filter"][x].push(r);
        if (up) R[en]["SPY above 200d only"][x].push(r);
      }
    }
  }
}

function stats(tr) {
  const r = tr.map(x => x.ret), w = r.filter(x => x > 0), L = r.filter(x => x <= 0);
  return { n: r.length, mean: mean(r), win: w.length / (r.length || 1) * 100, pf: L.length ? w.reduce((s, x) => s + x, 0) / Math.abs(L.reduce((s, x) => s + x, 0)) : NaN,
    aw: mean(w), al: mean(L), stp: tr.filter(x => x.kind === "stop").length / (r.length || 1) * 100, days: mean(tr.map(x => x.day)), r };
}
const f2 = (x, p = 2) => Number.isFinite(x) ? x.toFixed(p) : "n/a";
console.log(`Point-in-time S&P 500, ${data.size} symbols, ${SPYS.d[WARM]} to ${SPYS.d.at(-1)}. Per-trade net return after 0.2% round-trip cost.`);
console.log(`"vs base" = mean minus the any-stock-day baseline with the same exit and filter; t is optimistic because trades overlap in time.\n`);
const rows = [];
for (const f of Object.keys(FILTERS)) {
  console.log(`=== ${f} ===`);
  for (const x of exitNames) {
    const b = stats(R["BASELINE: any stock-day"][f][x]);
    console.log(`\n-- Exit: ${x}   (baseline: n ${b.n}, mean ${f2(b.mean)}%, win ${f2(b.win, 0)}%)`);
    console.log("   entry".padEnd(40) + "n".padStart(7) + "mean%".padStart(7) + "vs base".padStart(8) + "t".padStart(6) + "win%".padStart(6) + "avgW".padStart(6) + "avgL".padStart(7) + "PF".padStart(6) + "stop%".padStart(6) + "days".padStart(6) + "  1st half / 2nd half (vs base)");
    for (const en of Object.keys(ENTRIES)) {
      const tr = R[en][f][x], s = stats(tr); if (!s.n) continue;
      const diff = s.mean - b.mean, t = diff / Math.sqrt(variance(s.r) / s.n + variance(b.r) / b.n);
      const half = (arr, bs, cmp) => mean(arr.filter(y => cmp(y.date)).map(y => y.ret)) - mean(bs.filter(y => cmp(y.date)).map(y => y.ret));
      const h1 = half(tr, R["BASELINE: any stock-day"][f][x], d => d < SPLIT), h2 = half(tr, R["BASELINE: any stock-day"][f][x], d => d >= SPLIT);
      console.log(("   " + en).padEnd(40) + String(s.n).padStart(7) + f2(s.mean).padStart(7) + f2(diff).padStart(8) + f2(t, 1).padStart(6) + f2(s.win, 0).padStart(6) + f2(s.aw, 1).padStart(6) + f2(s.al, 1).padStart(7) + f2(s.pf).padStart(6) + f2(s.stp, 0).padStart(6) + f2(s.days, 1).padStart(6) + `  ${f2(h1).padStart(6)} / ${f2(h2).padStart(6)}`);
      rows.push({ f, x, en, n: s.n, mean: s.mean, diff, t, pf: s.pf, h1, h2 });
    }
  }
}
console.log("\n=== Ranked by mean per trade (n >= 300, both halves of the vs-base edge positive) ===");
for (const r of rows.filter(r => r.n >= 300 && r.h1 > 0 && r.h2 > 0).sort((a, b) => b.mean - a.mean).slice(0, 12)) console.log(`${f2(r.mean).padStart(6)}%  vs base ${f2(r.diff).padStart(5)}  t ${f2(r.t, 1).padStart(5)}  n ${String(r.n).padStart(5)}  PF ${f2(r.pf)}  ${r.en} | ${r.x} | ${r.f}`);
console.log(`\nConfigurations tested: ${rows.length}. With that many comparisons a few will look good by chance.`);
