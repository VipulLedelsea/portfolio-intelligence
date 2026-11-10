// Swing Exhaustion Fade ideas (research only). Does a learned "is the swing low already in" probability,
// and a liquidity-sweep flag, improve long entries? Same data, costs and point-in-time rules as backtest8.mjs.
// Odds table is pooled across the whole universe and uses only swings that were CONFIRMED before the signal date (no lookahead).
import { readFileSync } from "node:fs";
const current = JSON.parse(readFileSync("bars.json", "utf8"));
const former = JSON.parse(readFileSync("bars_former.json", "utf8"));
const raw = { ...former, ...current };
const intervals = new Map();
for (const l of readFileSync("members.csv", "utf8").trim().split("\n").slice(1)) { const [t, a, b] = l.split(","); (intervals.get(t) || intervals.set(t, []).get(t)).push([a, b || "9999-12-31"]); }
const memberAt = (sym, date) => (intervals.get(sym) || []).some(([a, b]) => date >= a && date <= b);
const COST = 0.001, SPLIT = "2024-11-05", WARM = 260, K = 2.5, MIN_EVENTS = 3000;
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const f2 = (x, p = 2) => Number.isFinite(x) ? x.toFixed(p) : "n/a";

function prep(rows) {
  const n = rows.length, d = [], o = [], h = [], l = [], c = [];
  for (const r of rows) { d.push(r[0]); o.push(r[1]); h.push(r[2]); l.push(r[3]); c.push(r[4]); }
  const tr = h.map((x, i) => i ? Math.max(x - l[i], Math.abs(x - c[i - 1]), Math.abs(l[i] - c[i - 1])) : x - l[i]);
  const atr14 = tr.map((_, i) => i >= 13 ? mean(tr.slice(i - 13, i + 1)) : NaN);
  const csum = [0]; for (const x of c) csum.push(csum[csum.length - 1] + x);
  const sma = (i, p) => i + 1 >= p ? (csum[i + 1] - csum[i + 1 - p]) / p : NaN;
  const bad = c.map((x, i) => i && Math.abs(x / c[i - 1] - 1) > 0.35 ? 1 : 0);
  const badSum = [0]; for (const x of bad) badSum.push(badSum[badSum.length - 1] + x);
  const hasBad = (a, b) => badSum[Math.min(n, b + 1)] - badSum[Math.max(0, a)] > 0;
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
  return { n, d, o, h, l, c, atr14, sma, hasBad, rsi2, st, adx };
}



const data = new Map();
for (const sym of Object.keys(raw)) { if (sym === "SPY") continue; const rows = raw[sym]; if (rows.length < 300 || rows.some(r => !(r[4] > 0))) continue; data.set(sym, prep(rows)); }
const sigST = (S, t) => t >= 60 && S.st[t] === 1 && S.st[t - 1] === -1 && S.adx[t] >= 20 && S.adx[t] > S.adx[t - 5];
const LEVELS = [2, 5, 10, 15, 20, 30], CAP = 120, out = [];
for (const [sym, S] of data) { let free = -1;
  for (let t = WARM; t < S.n - 2; t++) {
    if (t <= free || !memberAt(sym, S.d[t]) || !sigST(S, t)) continue;
    const e = t + 1, entry = S.o[e]; if (!(entry > 0)) continue;
    let k = e, exitIdx = -1;
    for (; k < Math.min(S.n - 1, e + CAP); k++) if (k > e && S.st[k] === -1) { exitIdx = k + 1; break; }
    let censored = false;
    if (exitIdx < 0) { if (e + CAP >= S.n) { censored = true; } exitIdx = Math.min(S.n - 1, e + CAP); }
    if (censored) continue;
    if (S.hasBad(t - 252, exitIdx)) continue;
    const exit = S.o[exitIdx] > 0 && exitIdx > e ? S.o[exitIdx] : S.c[exitIdx];
    const ret = (exit / entry - 1 - 2 * COST) * 100, days = exitIdx - e;
    const reach = {}; let mfe = 0;
    for (const L of LEVELS) { reach[L] = null; }
    for (let j = e; j < exitIdx; j++) { const g = (S.h[j] / entry - 1) * 100; mfe = Math.max(mfe, g); for (const L of LEVELS) if (reach[L] === null && g >= L) reach[L] = j - e + 1; }
    out.push({ sym, date: S.d[e], ret, days, mfe, reach }); free = exitIdx;
  } }
import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2], JSON.stringify(out));
const r = out.map(x => x.ret); console.log(out.length, "trades; mean", mean(r).toFixed(2), "win", (r.filter(x=>x>0).length/r.length*100).toFixed(0), "avg days", mean(out.map(x=>x.days)).toFixed(1));
