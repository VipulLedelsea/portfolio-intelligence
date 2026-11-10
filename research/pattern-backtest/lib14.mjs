// Shared library for the win-rate research (backtest14+). Point-in-time S&P 500, daily bars, next-open entry, 0.1% cost per side.
import { readFileSync } from "node:fs";
export const COST = 0.001, WARM = 260, CAP = 120;
const current = JSON.parse(readFileSync("bars.json", "utf8"));
const former = JSON.parse(readFileSync("bars_former.json", "utf8"));
export const raw = { ...former, ...current };
const intervals = new Map();
for (const l of readFileSync("members.csv", "utf8").trim().split("\n").slice(1)) { const [t, a, b] = l.split(","); (intervals.get(t) || intervals.set(t, []).get(t)).push([a, b || "9999-12-31"]); }
export const memberAt = (sym, date) => (intervals.get(sym) || []).some(([a, b]) => date >= a && date <= b);
const sectorOf = new Map();
for (const l of readFileSync("sp500.csv", "utf8").trim().split("\n").slice(1)) { const m = l.match(/^([^,]+),("[^"]*"|[^,]*),([^,]*),/); if (m) sectorOf.set(m[1], m[3]); }
export const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };

export function prep(rows) {
  const n = rows.length, d = [], o = [], h = [], l = [], c = [], v = [];
  for (const r of rows) { d.push(r[0]); o.push(r[1]); h.push(r[2]); l.push(r[3]); c.push(r[4]); v.push(r[5] || 0); }
  const tr = h.map((x, i) => i ? Math.max(x - l[i], Math.abs(x - c[i - 1]), Math.abs(l[i] - c[i - 1])) : x - l[i]);
  const rollMean = (a, p) => { const out = new Array(n).fill(NaN); let s = 0; for (let i = 0; i < n; i++) { s += a[i]; if (i >= p) s -= a[i - p]; if (i >= p - 1) out[i] = s / p; } return out; };
  const atr14 = rollMean(tr, 14), atr50 = rollMean(tr, 50);
  const sma20 = rollMean(c, 20), sma50 = rollMean(c, 50), sma100 = rollMean(c, 100), sma200 = rollMean(c, 200), vol50 = rollMean(v, 50), vol20 = rollMean(v, 20);
  const ema = p => { const k = 2 / (p + 1), out = new Array(n).fill(NaN); out[0] = c[0]; for (let i = 1; i < n; i++) out[i] = c[i] * k + out[i - 1] * (1 - k); return out; };
  const ema10 = ema(10), ema20 = ema(20), e12 = ema(12), e26 = ema(26), macd = e12.map((x, i) => x - e26[i]);
  const sig = (() => { const k = 0.2, out = new Array(n).fill(NaN); out[0] = macd[0]; for (let i = 1; i < n; i++) out[i] = macd[i] * k + out[i - 1] * (1 - k); return out; })();
  const hist = macd.map((x, i) => x - sig[i]);
  const bad = c.map((x, i) => i && Math.abs(x / c[i - 1] - 1) > 0.35 ? 1 : 0);
  const badSum = [0]; for (const x of bad) badSum.push(badSum[badSum.length - 1] + x);
  const hasBad = (a, b) => badSum[Math.min(n, b + 1)] - badSum[Math.max(0, a)] > 0;
  const rsi = (p) => { const out = new Array(n).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < n; i++) { const ch = c[i] - c[i - 1], g = Math.max(ch, 0), ls = Math.max(-ch, 0);
    if (i <= p) { ag += g / p; al += ls / p; } else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + ls) / p; }
    if (i >= p) out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } return out; };
  const rsi14 = rsi(14), rsi2 = rsi(2);
  // Supertrend(10,3)
  const stAtr = []; { let prev = NaN; for (let i = 0; i < n; i++) { prev = i < 10 ? NaN : i === 10 ? mean(tr.slice(1, 11)) : (prev * 9 + tr[i]) / 10; stAtr.push(prev); } }
  const st = new Array(n).fill(0), stLine = new Array(n).fill(NaN), stAge = new Array(n).fill(NaN); { let fu = NaN, fl = NaN, age = 0;
    for (let i = 10; i < n; i++) { const mid = (h[i] + l[i]) / 2, bu = mid + 3 * stAtr[i], bl = mid - 3 * stAtr[i];
      if (i === 10) { fu = bu; fl = bl; st[i] = c[i] >= mid ? 1 : -1; } else {
        fu = (bu < fu || c[i - 1] > fu) ? bu : fu; fl = (bl > fl || c[i - 1] < fl) ? bl : fl;
        st[i] = st[i - 1] === -1 ? (c[i] > fu ? 1 : -1) : (c[i] < fl ? -1 : 1); }
      age = i > 10 && st[i] === st[i - 1] ? age + 1 : 0; stAge[i] = age; stLine[i] = st[i] === 1 ? fl : fu; } }
  // ADX with DI
  const adx = new Array(n).fill(NaN), pdi = new Array(n).fill(NaN), mdi = new Array(n).fill(NaN); { let tr14 = 0, p14 = 0, m14 = 0; const dx = [];
    for (let i = 1; i < n; i++) { const up = h[i] - h[i - 1], dn = l[i - 1] - l[i], pdm = up > dn && up > 0 ? up : 0, mdm = dn > up && dn > 0 ? dn : 0;
      if (i <= 14) { tr14 += tr[i]; p14 += pdm; m14 += mdm; } else { tr14 = tr14 - tr14 / 14 + tr[i]; p14 = p14 - p14 / 14 + pdm; m14 = m14 - m14 / 14 + mdm; }
      if (i >= 14) { pdi[i] = 100 * p14 / tr14; mdi[i] = 100 * m14 / tr14; dx.push(100 * Math.abs(pdi[i] - mdi[i]) / (pdi[i] + mdi[i] || 1)); const k = dx.length; adx[i] = k === 14 ? mean(dx) : k > 14 ? (adx[i - 1] * 13 + dx[k - 1]) / 14 : NaN; } } }
  // Bollinger width percentile (126d), OBV, 252d high, volatility
  const sd20 = new Array(n).fill(NaN); for (let i = 19; i < n; i++) sd20[i] = sd(c.slice(i - 19, i + 1));
  const bbw = sd20.map((s, i) => 4 * s / sma20[i]);
  const bbwPct = new Array(n).fill(NaN); for (let i = 150; i < n; i++) { let k = 0; for (let j = i - 125; j <= i; j++) if (bbw[j] <= bbw[i]) k++; bbwPct[i] = k / 126; }
  const obv = [0]; for (let i = 1; i < n; i++) obv.push(obv[i - 1] + (c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0));
  const obvMa = rollMean(obv, 20);
  const hi252 = new Array(n).fill(NaN); for (let i = 252; i < n; i++) { let m = -Infinity; for (let j = i - 252; j < i; j++) m = Math.max(m, h[j]); hi252[i] = m; }
  const hi20 = new Array(n).fill(NaN); for (let i = 20; i < n; i++) { let m = -Infinity; for (let j = i - 20; j < i; j++) m = Math.max(m, h[j]); hi20[i] = m; }
  const dvol = c.map((x, i) => x * v[i]), dvol20 = rollMean(dvol, 20);
  return { n, d, o, h, l, c, v, tr, atr14, atr50, sma20, sma50, sma100, sma200, vol20, vol50, ema10, ema20, macd, hist, rsi14, rsi2, st, stLine, stAge, adx, pdi, mdi, bbwPct, obv, obvMa, hi252, hi20, dvol20, hasBad, dateIdx: new Map(d.map((x, i) => [x, i])) };
}

export const data = new Map();
for (const sym of Object.keys(raw)) { const rows = raw[sym]; if (rows.length < 300 || rows.some(r => !(r[4] > 0))) continue; data.set(sym, prep(rows)); }
export const SPY = data.get("SPY");
// cross-sectional context per date: breadth and sector strength
const ctx = new Map(); // date -> { n50, d50, n200, d200, sec: Map(sector -> [sum, cnt]), uniSum, uniCnt }
for (const [sym, S] of data) { if (sym === "SPY") continue; const sec = sectorOf.get(sym) || null;
  for (let t = 200; t < S.n; t++) { const date = S.d[t]; let x = ctx.get(date); if (!x) ctx.set(date, x = { n50: 0, d50: 0, n200: 0, d200: 0, sec: new Map(), uS: 0, uC: 0 });
    x.d50++; if (S.c[t] > S.sma50[t]) x.n50++; x.d200++; if (S.c[t] > S.sma200[t]) x.n200++;
    if (t >= 63) { const r = S.c[t] / S.c[t - 63] - 1; x.uS += r; x.uC++; if (sec) { const a = x.sec.get(sec) || x.sec.set(sec, [0, 0]).get(sec); a[0] += r; a[1]++; } } } }
export const secOf = sym => sectorOf.get(sym) || null;
const pct = (a, i, k) => i >= k ? a[i] / a[i - k] - 1 : NaN;

// ---- condition library: each is [name, group, fn(S, t, sym)] -> boolean ----
export const CONDS = [];
const add = (name, group, fn) => CONDS.push({ name, group, fn });
// trend
add("c>sma20", "trend", (S, t) => S.c[t] > S.sma20[t]); add("c>sma50", "trend", (S, t) => S.c[t] > S.sma50[t]);
add("c>sma100", "trend", (S, t) => S.c[t] > S.sma100[t]); add("c>sma200", "trend", (S, t) => S.c[t] > S.sma200[t]);
add("sma50>sma200", "trend", (S, t) => S.sma50[t] > S.sma200[t]); add("sma20>sma50", "trend", (S, t) => S.sma20[t] > S.sma50[t]);
add("sma50 rising 20d", "trend", (S, t) => S.sma50[t] > S.sma50[t - 20]); add("sma200 rising 20d", "trend", (S, t) => S.sma200[t] > S.sma200[t - 20]);
add("ema10>ema20", "trend", (S, t) => S.ema10[t] > S.ema20[t]);
add("ST age <=2d", "trend", (S, t) => S.stAge[t] <= 2); add("ST age <=10d", "trend", (S, t) => S.stAge[t] <= 10); add("ST age >20d", "trend", (S, t) => S.stAge[t] > 20);
add("ADX>=25", "trend", (S, t) => S.adx[t] >= 25); add("ADX>=30", "trend", (S, t) => S.adx[t] >= 30); add("ADX rising 5d", "trend", (S, t) => S.adx[t] > S.adx[t - 5]);
add("+DI>-DI", "trend", (S, t) => S.pdi[t] > S.mdi[t]); add("+DI-(-DI)>=10", "trend", (S, t) => S.pdi[t] - S.mdi[t] >= 10);
add("MACD>0", "trend", (S, t) => S.macd[t] > 0); add("MACD hist rising", "trend", (S, t) => S.hist[t] > S.hist[t - 1]);
// location vs highs and averages
add("within 5% of 52w high", "location", (S, t) => S.c[t] >= 0.95 * S.hi252[t]); add("within 10% of 52w high", "location", (S, t) => S.c[t] >= 0.90 * S.hi252[t]);
add("within 20% of 52w high", "location", (S, t) => S.c[t] >= 0.80 * S.hi252[t]); add("new 20d high", "location", (S, t) => S.c[t] > S.hi20[t]);
add("ext vs sma20 <=1 ATR", "location", (S, t) => (S.c[t] - S.sma20[t]) / S.atr14[t] <= 1); add("ext vs sma20 <=2 ATR", "location", (S, t) => (S.c[t] - S.sma20[t]) / S.atr14[t] <= 2);
add("ext vs sma20 >=3 ATR", "location", (S, t) => (S.c[t] - S.sma20[t]) / S.atr14[t] >= 3); add("ext vs sma50 <=3 ATR", "location", (S, t) => (S.c[t] - S.sma50[t]) / S.atr14[t] <= 3);
add("close within 2 ATR of ST line", "location", (S, t) => (S.c[t] - S.stLine[t]) / S.atr14[t] <= 2); add("close within 3 ATR of ST line", "location", (S, t) => (S.c[t] - S.stLine[t]) / S.atr14[t] <= 3);
// momentum
add("RSI14 50-70", "momentum", (S, t) => S.rsi14[t] >= 50 && S.rsi14[t] <= 70); add("RSI14>60", "momentum", (S, t) => S.rsi14[t] > 60); add("RSI14<70", "momentum", (S, t) => S.rsi14[t] < 70);
add("RSI14 rising 3d", "momentum", (S, t) => S.rsi14[t] > S.rsi14[t - 3]); add("RSI2<50 (small dip)", "momentum", (S, t) => S.rsi2[t] < 50); add("RSI2>80", "momentum", (S, t) => S.rsi2[t] > 80);
add("ROC20>0", "momentum", (S, t) => pct(S.c, t, 20) > 0); add("ROC20>10%", "momentum", (S, t) => pct(S.c, t, 20) > 0.10); add("ROC63>20%", "momentum", (S, t) => pct(S.c, t, 63) > 0.20);
add("ROC126>0", "momentum", (S, t) => pct(S.c, t, 126) > 0); add("ROC5<0 (pullback)", "momentum", (S, t) => pct(S.c, t, 5) < 0);
// relative strength
const rs = (S, t, k) => { const j = SPY.dateIdx.get(S.d[t]); return j === undefined || j < k ? NaN : pct(S.c, t, k) - pct(SPY.c, j, k); };
add("RS63 vs SPY>0", "relstr", (S, t) => rs(S, t, 63) > 0); add("RS63 vs SPY>10%", "relstr", (S, t) => rs(S, t, 63) > 0.10); add("RS126 vs SPY>0", "relstr", (S, t) => rs(S, t, 126) > 0);
add("RS21 vs SPY>0", "relstr", (S, t) => rs(S, t, 21) > 0);
add("sector 63d > market", "relstr", (S, t, sym) => { const s = secOf(sym), x = ctx.get(S.d[t]); if (!s || !x) return false; const a = x.sec.get(s); return !!a && a[0] / a[1] > x.uS / x.uC; });
// volatility
add("ATR% <=2", "volatility", (S, t) => S.atr14[t] / S.c[t] <= 0.02); add("ATR% <=3", "volatility", (S, t) => S.atr14[t] / S.c[t] <= 0.03); add("ATR% >=4", "volatility", (S, t) => S.atr14[t] / S.c[t] >= 0.04);
add("BB width low (pct<=30)", "volatility", (S, t) => S.bbwPct[t] <= 0.30); add("BB width high (pct>=70)", "volatility", (S, t) => S.bbwPct[t] >= 0.70);
add("ATR14<ATR50 (calming)", "volatility", (S, t) => S.atr14[t] < S.atr50[t]);
// volume
add("rel vol>=1.5", "volume", (S, t) => S.v[t] >= 1.5 * S.vol50[t]); add("rel vol>=1", "volume", (S, t) => S.v[t] >= S.vol50[t]); add("rel vol<0.8 (quiet)", "volume", (S, t) => S.v[t] < 0.8 * S.vol50[t]);
add("OBV>OBV 20d avg", "volume", (S, t) => S.obv[t] > S.obvMa[t]); add("$vol20 top half (>=$50M)", "volume", (S, t) => S.dvol20[t] >= 5e7);
// candle location
add("close in top 25% of range", "candle", (S, t) => (S.c[t] - S.l[t]) / ((S.h[t] - S.l[t]) || 1) >= 0.75); add("up close", "candle", (S, t) => S.c[t] > S.c[t - 1]);
add("gap up >=1%", "candle", (S, t) => S.o[t] >= 1.01 * S.c[t - 1]); add("inside day", "candle", (S, t) => S.h[t] < S.h[t - 1] && S.l[t] > S.l[t - 1]);
// market regime
const spyAt = (S, t) => SPY.dateIdx.get(S.d[t]);
add("SPY>sma200", "market", (S, t) => { const j = spyAt(S, t); return j !== undefined && SPY.c[j] > SPY.sma200[j]; });
add("SPY>sma50", "market", (S, t) => { const j = spyAt(S, t); return j !== undefined && SPY.c[j] > SPY.sma50[j]; });
add("SPY 20d>0", "market", (S, t) => { const j = spyAt(S, t); return j !== undefined && pct(SPY.c, j, 20) > 0; });
add("SPY calm (ATR%<1.3)", "market", (S, t) => { const j = spyAt(S, t); return j !== undefined && SPY.atr14[j] / SPY.c[j] < 0.013; });
add("SPY within 3% of high", "market", (S, t) => { const j = spyAt(S, t); return j !== undefined && SPY.c[j] >= 0.97 * SPY.hi252[j]; });
add("breadth >50d >=60%", "market", (S, t) => { const x = ctx.get(S.d[t]); return !!x && x.n50 / x.d50 >= 0.60; });
add("breadth >200d >=60%", "market", (S, t) => { const x = ctx.get(S.d[t]); return !!x && x.n200 / x.d200 >= 0.60; });

// ---- exits ----
// V = { st: true (exit when a close is under the daily Supertrend line, fill next open), target: pct, stop: pct, be: [armPct, lockPct], trail: ATR multiple, timeN, maxHold }
export function exitSim(S, t, V = { st: true }) {
  const e = t + 1; if (e >= S.n) return null; const entry = S.o[e]; if (!(entry > 0)) return null;
  const cap = V.maxHold || CAP, last = Math.min(S.n - 1, e + cap - 1); if (e + cap - 1 >= S.n) return null;
  let stop = V.stop ? entry * (1 - V.stop / 100) : -Infinity, armed = false, hiC = entry, exit = NaN, days = 0;
  const tgt = V.target ? entry * (1 + V.target / 100) : Infinity;
  for (let k = e; k <= last; k++) {
    if (V.trail && k > e) stop = Math.max(stop, hiC - V.trail * S.atr14[t]);
    if (S.o[k] <= stop && k > e) { exit = S.o[k]; days = k - e + 1; break; }
    if (S.l[k] <= stop) { exit = stop; days = k - e + 1; break; }
    if (k > e && S.o[k] >= tgt) { exit = S.o[k]; days = k - e + 1; break; }
    if (S.h[k] >= tgt) { exit = tgt; days = k - e + 1; break; }
    if (V.be && !armed && S.h[k] >= entry * (1 + V.be[0] / 100)) { armed = true; stop = Math.max(stop, entry * (1 + V.be[1] / 100)); }
    hiC = Math.max(hiC, S.c[k]);
    if (V.timeN && k - e + 1 >= V.timeN) { exit = S.c[k]; days = k - e + 1; break; }
    if (V.st && S.st[k] === -1 && k > e - 1) { const nx = Math.min(k + 1, S.n - 1); exit = nx > k ? S.o[nx] : S.c[k]; days = nx - e + 1; break; }
  }
  if (!Number.isFinite(exit)) { exit = S.c[last]; days = last - e + 1; }
  return { ret: (exit / entry - 1 - 2 * COST) * 100, days, date: S.d[e] };
}
export const stats = tr => { const r = tr.map(x => x.ret), w = r.filter(x => x > 0), L = r.filter(x => x <= 0);
  return { n: r.length, win: r.length ? w.length / r.length * 100 : NaN, avg: mean(r), avgWin: mean(w), avgLoss: mean(L), days: mean(tr.map(x => x.days)),
    pf: L.length ? w.reduce((a, b) => a + b, 0) / -L.reduce((a, b) => a + b, 0) : Infinity }; };
export const f2 = (x, p = 2) => Number.isFinite(x) ? x.toFixed(p) : "n/a";
