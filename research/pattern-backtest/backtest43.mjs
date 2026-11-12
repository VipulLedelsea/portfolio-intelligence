// Chart patterns and a wider set of indicators, daily and weekly, on 20 years of point-in-time S&P 500 bars (research only).
// Every signal fires on a close; entry is the next daily open; 0.1% cost per side. Each trade is compared with the average
// of ALL index members bought the same day with the same exit ("excess"), and results are averaged per date so that a few
// crowded dates cannot carry a rule. Rules are picked on 2006-2016 and checked on 2017-2026.
// node --max-old-space-size=12000 backtest43.mjs
import { data, memberAt, SPY, prep, mean, f2, COST } from "./lib41.mjs";
import { addPivots, detect, K } from "./patterns43.mjs";
const WARM = 260, SPLIT = "2017-01-01"; data.delete("QQQ");
const sdv = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = a => a.length > 2 ? mean(a) / (sdv(a) / Math.sqrt(a.length)) : NaN;

// ---------- extra indicators ----------
function ind(S) { const { n, o, h, l, c, v, tr } = S; const A = () => new Array(n).fill(NaN);
  const rmax = (a, p) => { const out = A(); for (let i = p - 1; i < n; i++) { let m = -Infinity; for (let j = i - p + 1; j <= i; j++) if (a[j] > m) m = a[j]; out[i] = m; } return out; };
  const rmin = (a, p) => { const out = A(); for (let i = p - 1; i < n; i++) { let m = Infinity; for (let j = i - p + 1; j <= i; j++) if (a[j] < m) m = a[j]; out[i] = m; } return out; };
  const rmean = (a, p) => { const out = A(); let s = 0; for (let i = 0; i < n; i++) { s += a[i]; if (i >= p) s -= a[i - p]; if (i >= p - 1) out[i] = s / p; } return out; };
  const ema = (a, p) => { const k = 2 / (p + 1), out = A(); out[0] = a[0]; for (let i = 1; i < n; i++) out[i] = a[i] * k + out[i - 1] * (1 - k); return out; };
  const hh14 = rmax(h, 14), ll14 = rmin(l, 14), rawK = c.map((x, i) => 100 * (x - ll14[i]) / ((hh14[i] - ll14[i]) || 1)), stoch = rmean(rawK.map(x => Number.isFinite(x) ? x : 50), 3);
  const tp = c.map((x, i) => (x + h[i] + l[i]) / 3), tpMa = rmean(tp, 20), cci = A(); for (let i = 19; i < n; i++) { let md = 0; for (let j = i - 19; j <= i; j++) md += Math.abs(tp[j] - tpMa[i]); cci[i] = (tp[i] - tpMa[i]) / (0.015 * md / 20 || 1); }
  const mfi = A(); for (let i = 14; i < n; i++) { let p = 0, q = 0; for (let j = i - 13; j <= i; j++) { const f = tp[j] * v[j]; if (tp[j] > tp[j - 1]) p += f; else if (tp[j] < tp[j - 1]) q += f; } mfi[i] = q === 0 ? 100 : 100 - 100 / (1 + p / q); }
  const sd20 = A(); for (let i = 19; i < n; i++) { let s = 0; for (let j = i - 19; j <= i; j++) s += (c[j] - S.sma20[i]) ** 2; sd20[i] = Math.sqrt(s / 20); }
  const ub = sd20.map((s, i) => S.sma20[i] + 2 * s), lb = sd20.map((s, i) => S.sma20[i] - 2 * s), atr20 = rmean(tr, 20), ku = atr20.map((a, i) => S.ema20[i] + 1.5 * a), kl = atr20.map((a, i) => S.ema20[i] - 1.5 * a);
  const sq = ub.map((u, i) => u < ku[i] && lb[i] > kl[i]);
  const ph20 = rmax(h, 20), ph55 = rmax(h, 55), pc50 = rmax(c, 50), hh9 = rmax(h, 9), ll9 = rmin(l, 9), hh26 = rmax(h, 26), ll26 = rmin(l, 26), hh52 = rmax(h, 52), ll52 = rmin(l, 52);
  const tenkan = hh9.map((x, i) => (x + ll9[i]) / 2), kijun = hh26.map((x, i) => (x + ll26[i]) / 2), cloudTop = A(); for (let i = 78; i < n; i++) cloudTop[i] = Math.max((tenkan[i - 26] + kijun[i - 26]) / 2, (hh52[i - 26] + ll52[i - 26]) / 2);
  const sar = new Array(n).fill(0); { let up = c[1] >= c[0], ep = up ? h[0] : l[0], s = up ? l[0] : h[0], af = 0.02; for (let i = 1; i < n; i++) { s = s + af * (ep - s);
    if (up) { s = Math.min(s, l[i - 1], i > 1 ? l[i - 2] : l[i - 1]); if (l[i] < s) { up = false; s = ep; ep = l[i]; af = 0.02; } else if (h[i] > ep) { ep = h[i]; af = Math.min(0.2, af + 0.02); } }
    else { s = Math.max(s, h[i - 1], i > 1 ? h[i - 2] : h[i - 1]); if (h[i] > s) { up = true; s = ep; ep = h[i]; af = 0.02; } else if (l[i] < ep) { ep = l[i]; af = Math.min(0.2, af + 0.02); } } sar[i] = up ? 1 : -1; } }
  const arUp = A(), arDn = A(); for (let i = 25; i < n; i++) { let hi = i - 25, lo = i - 25; for (let j = i - 25; j <= i; j++) { if (h[j] >= h[hi]) hi = j; if (l[j] <= l[lo]) lo = j; } arUp[i] = 100 * (25 - (i - hi)) / 25; arDn[i] = 100 * (25 - (i - lo)) / 25; }
  const mfv = c.map((x, i) => (h[i] - l[i]) > 0 ? ((x - l[i]) - (h[i] - x)) / (h[i] - l[i]) * v[i] : 0), mfvS = rmean(mfv, 20), vS = rmean(v, 20), cmf = mfvS.map((x, i) => x / (vS[i] || 1));
  const haG = new Array(n).fill(false); { let po = o[0], pc = (o[0] + h[0] + l[0] + c[0]) / 4; for (let i = 1; i < n; i++) { const ho = (po + pc) / 2, hc = (o[i] + h[i] + l[i] + c[i]) / 4; haG[i] = hc > ho; po = ho; pc = hc; } }
  const obvHi = rmax(S.obv, 50);
  return { stoch, cci, mfi, ub, lb, ku, sq, ph20, ph55, pc50, tenkan, kijun, cloudTop, sar, arUp, arDn, cmf, haG, e9: ema(c, 9), e21: ema(c, 21), obvHi, ...atrox(S) };
}

// ---------- "Atrox Black Edition - Quad Consensus" (TradingView script vFlmqpJW), re-implemented from its published source ----------
// Engines: AtroNox (Bollinger 100, 1.5 trend line), Raptor (Supertrend on close, 6.5 x ATR11, close >= SMA9), Scalper (Supertrend on close, 7 x ATR10),
// Elite (range filter, period 200, multiplier 7.5). Consensus: engines that signalled within the window, score 0-100, ATR5 / EMA5(ATR5) between 0.8 and 2.5.
function atrox(S) { const { n, o, h, l, c, tr } = S; const A = v => new Array(n).fill(v);
  const rma = (a, p) => { const out = A(NaN); let s = 0; for (let i = 0; i < n; i++) { if (i < p) { s += a[i]; if (i === p - 1) out[i] = s / p; } else out[i] = (out[i - 1] * (p - 1) + a[i]) / p; } return out; };
  const ema = (a, p) => { const k = 2 / (p + 1), out = A(NaN); let prev = NaN; for (let i = 0; i < n; i++) { if (!Number.isFinite(a[i])) continue; prev = Number.isFinite(prev) ? a[i] * k + prev * (1 - k) : a[i]; out[i] = prev; } return out; };
  const stp = (factor, len) => { const atr = rma(tr, len), dir = A(1), line = A(NaN); let pu = 0, pl = 0, pst = 0;
    for (let i = 0; i < n; i++) { if (!Number.isFinite(atr[i])) continue; let ub = c[i] + factor * atr[i], lb = c[i] - factor * atr[i];
      lb = lb > pl || c[i - 1] < pl ? lb : pl; ub = ub < pu || c[i - 1] > pu ? ub : pu;
      const d = !Number.isFinite(atr[i - 1]) ? 1 : pst === pu ? (c[i] > ub ? -1 : 1) : (c[i] < lb ? 1 : -1); dir[i] = d; line[i] = d === -1 ? lb : ub; pu = ub; pl = lb; pst = line[i]; } return line; };
  const L = [A(false), A(false), A(false), A(false)], Sh = [A(false), A(false), A(false), A(false)];
  // AtroNox
  const trend = A(0); { let tl = NaN, ptl = NaN; for (let i = 0; i < n; i++) { ptl = tl; if (i >= 99) { let m = 0; for (let j = i - 99; j <= i; j++) m += c[j]; m /= 100; let q = 0; for (let j = i - 99; j <= i; j++) q += (c[j] - m) ** 2; const dev = Math.sqrt(q / 100) * 1.5;
        if (c[i] > m + dev) { tl = l[i]; if (!Number.isFinite(ptl) || tl < ptl) tl = ptl; } else if (c[i] < m - dev) { tl = h[i]; if (!Number.isFinite(ptl) || tl > ptl) tl = ptl; } else tl = Number.isFinite(ptl) ? ptl : c[i]; } else tl = Number.isFinite(ptl) ? ptl : c[i];
      trend[i] = i === 0 ? 0 : tl > ptl ? 1 : tl < ptl ? -1 : trend[i - 1]; if (i > 0) { L[0][i] = trend[i - 1] === -1 && trend[i] === 1; Sh[0][i] = trend[i - 1] === 1 && trend[i] === -1; } } }
  // Raptor and Scalper
  { const st = stp(6.5, 11); let s9 = 0; for (let i = 0; i < n; i++) { s9 += c[i]; if (i >= 9) s9 -= c[i - 9]; const sma9 = i >= 8 ? s9 / 9 : NaN; if (i > 0 && Number.isFinite(st[i - 1])) { L[1][i] = c[i] > st[i] && c[i - 1] <= st[i - 1] && c[i] >= sma9; Sh[1][i] = c[i] < st[i] && c[i - 1] >= st[i - 1] && c[i] <= sma9; } } }
  { const st = stp(7, 10); for (let i = 1; i < n; i++) if (Number.isFinite(st[i - 1])) { L[2][i] = c[i] > st[i] && c[i - 1] <= st[i - 1]; Sh[2][i] = c[i] < st[i] && c[i - 1] >= st[i - 1]; } }
  // Elite range filter
  { const d = c.map((x, i) => i ? Math.abs(x - c[i - 1]) : NaN), r = ema(ema(d, 200), 399).map(x => x * 7.5); let f = c[0], fd = 0, ini = 0;
    for (let i = 1; i < n; i++) { const pf = f; if (Number.isFinite(r[i])) { if (c[i] - r[i] > pf) f = c[i] - r[i]; if (c[i] + r[i] < pf) f = c[i] + r[i]; } fd = f > pf ? 1 : f < pf ? -1 : fd;
      const lc = c[i] > f && fd === 1 && c[i] !== c[i - 1], sc = c[i] < f && fd === -1 && c[i] !== c[i - 1]; L[3][i] = lc && ini === -1; Sh[3][i] = sc && ini === 1; ini = lc ? 1 : sc ? -1 : ini; } }
  // score parts
  const rsi7 = A(NaN); { let ag = 0, al = 0; for (let i = 1; i < n; i++) { const ch = c[i] - c[i - 1], g = Math.max(ch, 0), ls = Math.max(-ch, 0); if (i <= 7) { ag += g / 7; al += ls / 7; } else { ag = (ag * 6 + g) / 7; al = (al * 6 + ls) / 7; } if (i >= 7) rsi7[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } }
  const atr5 = rma(tr, 5), atr5ma = ema(atr5, 5), ratio = atr5.map((x, i) => atr5ma[i] > 0 ? x / atr5ma[i] : 1);
  const cons = (use, win, minSys, minScore) => { const out = A(false), last = use.map(() => [-999, -999]); let lastLong = -999;
    for (let i = 0; i < n; i++) { let lc = 0, sc = 0; use.forEach((e, k) => { if (L[e][i]) last[k][0] = i; if (Sh[e][i]) last[k][1] = i; if (i - last[k][0] <= win) lc++; if (i - last[k][1] <= win) sc++; });
      const score = (cnt, dir) => cnt / 4 * 40 + (ratio[i] > 1.2 ? 20 : ratio[i] > 1 ? 15 : ratio[i] > 0.8 ? 10 : 0) + (rsi7[i] > 30 && rsi7[i] < 70 ? 20 : rsi7[i] > 20 && rsi7[i] < 80 ? 10 : rsi7[i] > 10 && rsi7[i] < 90 ? 5 : 0) + (trend[i] === dir ? 20 : 0);
      const volOK = ratio[i] >= 0.8 && ratio[i] <= 2.5, ls = score(lc, 1), ss = score(sc, -1), lC = lc >= minSys && ls >= minScore && volOK, sC = sc >= minSys && ss >= minScore && volOK;
      if (lC && (!sC || lc > sc || (lc === sc && ls > ss)) && i - lastLong > win) { out[i] = true; lastLong = i; } } return out; };
  return { axL: L, axDefault: cons([1, 2, 3], 15, 3, 60), axAll3: cons([0, 1, 2, 3], 15, 3, 60), axAll4: cons([0, 1, 2, 3], 15, 4, 60), axBalanced: cons([0, 1, 2, 3], 5, 3, 60), axConservative: cons([0, 1, 2, 3], 3, 4, 70), axAggressive: cons([0, 1, 2, 3], 7, 3, 50), axTwo: cons([0, 1, 2, 3], 4, 2, 55) };
}
const up = (a, b, t) => a[t] > b[t] && a[t - 1] <= b[t - 1], upL = (a, lv, t) => a[t] > lv && a[t - 1] <= lv;
const div = (S, t, osc, lim) => { const i2 = t - K; if (i2 < 70 || !S.pivL[i2]) return false; for (let i1 = i2 - 8; i1 >= i2 - 60; i1--) if (S.pivL[i1]) return S.l[i2] < S.l[i1] && osc[i2] > osc[i1] && osc[i1] < lim; return false; };
const EV = [
  ["Golden cross (50 over 200)", (S, X, t) => up(S.sma50, S.sma200, t)],
  ["MACD crosses over its signal", (S, X, t) => upL(S.hist, 0, t)],
  ["MACD crosses over its signal below zero", (S, X, t) => upL(S.hist, 0, t) && S.macd[t] < 0],
  ["MACD crosses above zero", (S, X, t) => upL(S.macd, 0, t)],
  ["Stochastic crosses up through 20", (S, X, t) => upL(X.stoch, 20, t)],
  ["CCI crosses above +100", (S, X, t) => upL(X.cci, 100, t)],
  ["CCI crosses up through -100", (S, X, t) => upL(X.cci, -100, t)],
  ["Money Flow Index crosses up through 20", (S, X, t) => upL(X.mfi, 20, t)],
  ["Close over the upper Bollinger band", (S, X, t) => up(S.c, X.ub, t)],
  ["Close back above the lower Bollinger band", (S, X, t) => up(S.c, X.lb, t)],
  ["Squeeze fires up (5+ bars inside Keltner)", (S, X, t) => { if (X.sq[t] || S.c[t] <= S.sma20[t]) return false; for (let k = 1; k <= 5; k++) if (!X.sq[t - k]) return false; return true; }],
  ["Donchian 20-bar breakout", (S, X, t) => S.c[t] > X.ph20[t - 1] && S.c[t - 1] <= X.ph20[t - 2]],
  ["Donchian 55-bar breakout", (S, X, t) => S.c[t] > X.ph55[t - 1] && S.c[t - 1] <= X.ph55[t - 2]],
  ["Ichimoku: close crosses above the cloud", (S, X, t) => up(S.c, X.cloudTop, t)],
  ["Ichimoku: Tenkan over Kijun above the cloud", (S, X, t) => up(X.tenkan, X.kijun, t) && S.c[t] > X.cloudTop[t]],
  ["Parabolic SAR flips up", (S, X, t) => X.sar[t] === 1 && X.sar[t - 1] === -1],
  ["Aroon up crosses over Aroon down", (S, X, t) => up(X.arUp, X.arDn, t)],
  ["Chaikin Money Flow crosses above 0", (S, X, t) => upL(X.cmf, 0, t)],
  ["Chaikin Money Flow crosses above +0.15", (S, X, t) => upL(X.cmf, 0.15, t)],
  ["Heikin-Ashi turns green after 3+ red", (S, X, t) => X.haG[t] && !X.haG[t - 1] && !X.haG[t - 2] && !X.haG[t - 3]],
  ["RSI bullish divergence", (S, X, t) => div(S, t, S.rsi14, 40)],
  ["MACD histogram bullish divergence", (S, X, t) => div(S, t, S.hist, 0)],
  ["Close over the upper Keltner channel", (S, X, t) => up(S.c, X.ku, t)],
  ["EMA 9 crosses over EMA 21", (S, X, t) => up(X.e9, X.e21, t)],
  ["+DI crosses over -DI with ADX 20+", (S, X, t) => up(S.pdi, S.mdi, t) && S.adx[t] >= 20],
  ["RSI14 crosses above 50", (S, X, t) => upL(S.rsi14, 50, t)],
  ["RSI14 crosses up through 30", (S, X, t) => upL(S.rsi14, 30, t)],
  ["Pocket pivot (up volume over every down day of 10)", (S, X, t) => { if (S.c[t] <= S.c[t - 1]) return false; for (let k = 1; k <= 10; k++) if (S.c[t - k] < S.c[t - k - 1] && S.v[t - k] >= S.v[t]) return false; return S.c[t] > S.sma50[t]; }],
  ["Close reclaims the 200-bar average", (S, X, t) => up(S.c, S.sma200, t)],
  ["Supertrend flips up", (S, X, t) => S.st[t] === 1 && S.st[t - 1] === -1],
  ["OBV at a 50-bar high before price", (S, X, t) => S.obv[t] > X.obvHi[t - 1] && S.c[t] < X.pc50[t - 1]],
  ["Atrox engine: AtroNox (Bollinger trend line turns up)", (S, X, t) => X.axL[0][t]],
  ["Atrox engine: Raptor (Supertrend 6.5 cross + SMA9)", (S, X, t) => X.axL[1][t]],
  ["Atrox engine: Scalper (Supertrend 7 cross)", (S, X, t) => X.axL[2][t]],
  ["Atrox engine: Elite (range filter turns long)", (S, X, t) => X.axL[3][t]],
  ["Atrox consensus: script defaults (Raptor+Scalper+Elite all within 15 bars)", (S, X, t) => X.axDefault[t]],
  ["Atrox consensus: all 4 engines on, 3 of 4 within 15 bars", (S, X, t) => X.axAll3[t]],
  ["Atrox consensus: all 4 engines on, 4 of 4 within 15 bars", (S, X, t) => X.axAll4[t]],
  ["Atrox consensus: Balanced preset (3 of 4 within 5)", (S, X, t) => X.axBalanced[t]],
  ["Atrox consensus: Conservative preset (4 of 4 within 3, score 70)", (S, X, t) => X.axConservative[t]],
  ["Atrox consensus: Aggressive preset (3 of 4 within 7, score 50)", (S, X, t) => X.axAggressive[t]],
  ["Atrox consensus: Scalping preset (2 of 4 within 4, score 55)", (S, X, t) => X.axTwo[t]],
];
const LONGPAT = ["Double bottom", "Inverse head and shoulders", "Ascending triangle", "Symmetrical triangle (up)", "Falling wedge", "Bull flag"];
const CTX = [["stock over 200-day", (S, t) => S.c[t] > S.sma200[t]], ["stock under 200-day", (S, t) => S.c[t] < S.sma200[t]], ["SPY over 200-day", (S, t, j) => SPY.c[j] > SPY.sma200[j]], ["SPY under 200-day", (S, t, j) => SPY.c[j] < SPY.sma200[j]],
  ["daily Supertrend up", (S, t) => S.st[t] === 1], ["weekly Supertrend up", (S, t, j, w) => w === 1], ["weekly Supertrend down", (S, t, j, w) => w === -1], ["volume 1.5x+", (S, t) => S.v[t] >= 1.5 * S.vol50[t]], ["ADX 25+", (S, t) => S.adx[t] >= 25],
  ["RSI14 under 50", (S, t) => S.rsi14[t] < 50], ["RSI14 over 60", (S, t) => S.rsi14[t] > 60], ["within 10% of 52w high", (S, t) => S.c[t] >= 0.9 * S.hi252[t]], ["20%+ under 52w high", (S, t) => S.c[t] <= 0.8 * S.hi252[t]],
  ["ATR 3%+", (S, t) => S.atr14[t] / S.c[t] >= 0.03], ["ATR under 2%", (S, t) => S.atr14[t] / S.c[t] < 0.02]];

// ---------- outcomes (percent, net of costs), NaN when there is not enough room ----------
const XN = ["+5/-3/10d", "1:3 (2 ATR stop, 6 ATR target, 30d)", "trail (8% stop, Supertrend, 120d)", "hold 20d", "hold 60d", "Atrox defaults (target 2.5 ATR, stop 12 ATR, 60d)", "Atrox Balanced (target 3 ATR, stop 1 ATR, 30d)"], NX = XN.length;
function bracket(S, t, tgt, stop, H) { const e = t + 1; if (e + H > S.n) return NaN; const en = S.o[e];
  for (let k = e; k < e + H; k++) { if (k > e && S.o[k] <= stop(en)) return S.o[k] / en - 1; if (S.l[k] <= stop(en)) return stop(en) / en - 1; if (k > e && S.o[k] >= tgt(en)) return S.o[k] / en - 1; if (S.h[k] >= tgt(en)) return tgt(en) / en - 1; }
  return S.c[e + H - 1] / en - 1; }
function outcomes(S, t) { const e = t + 1, r = new Float32Array(NX).fill(NaN); if (e + 120 > S.n) return r; const en = S.o[e], a = S.atr14[t]; const net = x => (x - 2 * COST) * 100;
  r[0] = net(bracket(S, t, x => x * 1.05, x => x * 0.97, 10)); r[1] = net(bracket(S, t, x => x + 6 * a, x => x - 2 * a, 30));
  { let ex = NaN; const stop = en * 0.92; for (let k = e; k < e + 120; k++) { if (k > e && S.o[k] <= stop) { ex = S.o[k]; break; } if (S.l[k] <= stop) { ex = stop; break; } if (S.st[k] === -1) { ex = S.o[k + 1] ?? S.c[k]; break; } } if (!Number.isFinite(ex)) ex = S.c[e + 119]; r[2] = net(ex / en - 1); }
  r[5] = net(bracket(S, t, x => x + 2.5 * a, x => x - 12 * a, 60)); r[6] = net(bracket(S, t, x => x + 3 * a, x => x - 1 * a, 30)); r[3] = net(S.c[e + 19] / en - 1); r[4] = net(S.c[e + 59] / en - 1); return r; }

// ---------- build ----------
const ND = SPY.n, base = Array.from({ length: NX }, () => [new Float64Array(ND), new Float64Array(ND)]);
const names = [...EV.map(e => e[0]), ...LONGPAT.map(p => "Pattern: " + p), ...EV.map(e => "Weekly " + e[0]), ...LONGPAT.map(p => "Weekly pattern: " + p)], NE = names.length, nId = new Map(names.map((x, i) => [x, i]));
const rows = names.map(() => []); // each: [stockIdx, t, dateIdx, ctxMask, out(Float32Array), native?]
const stocks = [];
function weekly(S) { const wk = [], wkOf = new Int32Array(S.n); let cur = null, key = -1;
  for (let i = 0; i < S.n; i++) { const k = Math.floor((Date.parse(S.d[i]) / 864e5 + 3) / 7); if (k !== key) { cur = [S.d[i], S.o[i], S.h[i], S.l[i], S.c[i], 0]; wk.push(cur); key = k; } cur[0] = S.d[i]; cur[2] = Math.max(cur[2], S.h[i]); cur[3] = Math.min(cur[3], S.l[i]); cur[4] = S.c[i]; cur[5] += S.v[i]; wkOf[i] = wk.length - 1; }
  return { wk, wkOf }; }
let nDays = 0; const stUp = [0, 0], stUpNew = [0, 0];
for (const [sym, S] of data) { if (sym === "SPY") continue; const si = stocks.push(S) - 1; addPivots(S); const X = ind(S);
  const { wk, wkOf } = weekly(S); const Wk = wk.length >= 150 ? addPivots(prep(wk)) : null, WX = Wk ? ind(Wk) : null;
  const outs = new Array(S.n).fill(null), ctxs = new Int32Array(S.n), dids = new Int32Array(S.n).fill(-1);
  const wkSt = t => { if (!Wk) return 0; const w = wkOf[t], done = t === S.n - 1 || wkOf[t + 1] !== w ? w : w - 1; return done >= 12 ? Wk.st[done] : 0; };
  for (let t = WARM; t < S.n - 121; t++) { const d = S.d[t], j = SPY.dateIdx.get(d); if (j === undefined || !memberAt(sym, d) || S.hasBad(t - 255, t + 121)) continue;
    const r = outcomes(S, t); outs[t] = r; dids[t] = j; nDays++; for (let x = 0; x < NX; x++) if (Number.isFinite(r[x])) { base[x][0][j] += r[x]; base[x][1][j]++; }
    if (S.st[t] === 1 && Number.isFinite(r[2])) { stUp[0] += r[2]; stUp[1]++; if (S.stAge[t] <= 20) { stUpNew[0] += r[2]; stUpNew[1]++; } } const w = wkSt(t); let m = 0; for (let k = 0; k < CTX.length; k++) if (CTX[k][1](S, t, j, w)) m |= 1 << k; ctxs[t] = m;
    for (let e = 0; e < EV.length; e++) if (EV[e][1](S, X, t)) rows[e].push([si, t, j, m, r]);
    for (const ev of detect(S, t)) { const id = nId.get("Pattern: " + ev.name); if (id !== undefined && ev.dir === 1) rows[id].push([si, t, j, m, r, ev]); } }
  if (Wk) for (let w = 60; w < Wk.n - 1; w++) { const t = S.dateIdx.get(Wk.d[w]); if (t === undefined || !outs[t]) continue;
    for (let e = 0; e < EV.length; e++) if (EV[e][1](Wk, WX, w)) rows[nId.get("Weekly " + EV[e][0])].push([si, t, dids[t], ctxs[t], outs[t]]);
    for (const ev of detect(Wk, w)) { const id = nId.get("Weekly pattern: " + ev.name); if (id !== undefined && ev.dir === 1) rows[id].push([si, t, dids[t], ctxs[t], outs[t], ev]); } }
}
const bAvg = (x, j) => base[x][0][j] / base[x][1][j];
const isTest = j => SPY.d[j] >= SPLIT;
// stats for a list of rows on exit x: per-date averaging of (trade - same-day average of all members)
function stat(list, x, mask = 0) { const per = new Map(); let n = 0, w = 0, s = 0;
  for (const r of list) { if ((r[3] & mask) !== mask) continue; const v = r[4][x]; if (!Number.isFinite(v)) continue; n++; s += v; if (v > 0) w++; let p = per.get(r[2]); if (!p) per.set(r[2], p = [0, 0]); p[0] += v - bAvg(x, r[2]); p[1]++; }
  const a = [], b = []; for (const [j, p] of per) (isTest(j) ? b : a).push(p[0] / p[1]); const all = a.concat(b);
  return { n, dates: per.size, win: w / n * 100, avg: s / n, ex: mean(all), t: tstat(all), exA: mean(a), tA: tstat(a), nA: a.length, exB: mean(b), tB: tstat(b), nB: b.length }; }
console.log(`${nDays} stock-days, ${SPY.d[WARM]} to ${SPY.d[SPY.n - 122]}. Baseline (any member, any day): ` + XN.map((nm, x) => { let s = 0, c = 0, wsum = 0; for (let j = 0; j < ND; j++) { s += base[x][0][j]; c += base[x][1][j]; } return `${nm} ${f2(s / c)}%`; }).join(" | "));

console.log(`\n=== 1. Every signal alone. "excess" = trade minus the same-day average of all members with the same exit, averaged per date (t in brackets) ===`);
for (const x of [0, 1, 3, 2]) { console.log(`\n--- exit: ${XN[x]} ---`); const out = names.map((nm, e) => ({ nm, s: stat(rows[e], x) })).filter(o => o.s.n >= 30).sort((a, b) => b.s.t - a.s.t);
  for (const { nm, s } of out) console.log(`${nm.padEnd(58)} n ${String(s.n).padStart(6)} dates ${String(s.dates).padStart(4)}  win ${f2(s.win, 1).padStart(5)}%  avg ${f2(s.avg).padStart(6)}%  excess ${f2(s.ex).padStart(6)}% (t ${f2(s.t, 1).padStart(5)})  2006-16 ${f2(s.exA).padStart(6)}%  2017-26 ${f2(s.exB).padStart(6)}%`); }

console.log(`\n=== 2. Patterns with their own stop (where the pattern fails) and measured-move target, 40-day limit, against 5 random members bought the same day with the same stop and target distances ===`);
{ let seed = 99; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; const byDate = new Map();
  stocks.forEach((S, si) => { for (let t = WARM; t < S.n - 121; t++) { const j = SPY.dateIdx.get(S.d[t]); if (j !== undefined) (byDate.get(j) || byDate.set(j, []).get(j)).push([S, t]); } });
  for (const pre of ["Pattern: ", "Weekly pattern: "]) for (const p of LONGPAT) { const list = rows[nId.get(pre + p)]; const r = [], d = [], rr = [];
    for (const [si, t, j, m, o, ev] of list) { const S = stocks[si], c = S.c[t], sp = ev.stop / c, tp = ev.target / c; const v = bracket(S, t, x => Math.max(x * 1.002, c * tp), x => Math.min(x * 0.998, c * sp), 40); if (!Number.isFinite(v)) continue;
      const pool = byDate.get(j), cs = []; for (let k = 0; k < 5; k++) { const [S2, t2] = pool[Math.floor(rnd() * pool.length)]; const c2 = S2.c[t2]; const u = bracket(S2, t2, x => Math.max(x * 1.002, c2 * tp), x => Math.min(x * 0.998, c2 * sp), 40); if (Number.isFinite(u)) cs.push(u); }
      r.push((v - 2 * COST) * 100); rr.push((tp - 1) / (1 - sp)); if (cs.length) d.push((v - mean(cs)) * 100); }
    if (r.length >= 20) console.log(`${(pre + p).padEnd(46)} n ${String(r.length).padStart(5)}  win ${f2(r.filter(x => x > 0).length / r.length * 100, 1)}%  avg ${f2(mean(r))}%  reward:risk ${f2(mean(rr), 1)}  vs random same-day ${f2(mean(d))}% (t ${f2(tstat(d), 1)})`); } }

console.log(`\n=== 3. Signal + up to two conditions, picked on 2006-2016 by per-date excess (t), then 2017-2026 ===`);
const masks = []; for (let a = 0; a < CTX.length; a++) { masks.push([1 << a, CTX[a][0]]); for (let b = a + 1; b < CTX.length; b++) masks.push([(1 << a) | (1 << b), CTX[a][0] + " + " + CTX[b][0]]); }
for (const x of [0, 1, 3]) { const res = [];
  for (let e = 0; e < NE; e++) { if (rows[e].length < 300) continue; for (const [m, nm] of masks) { const s = stat(rows[e], x, m); if (s.nA >= 80 && s.n >= 400 && s.nB >= 40) res.push({ nm: names[e] + "  +  " + nm, s, e, m }); } }
  res.sort((a, b) => b.s.tA - a.s.tA); console.log(`\n--- exit: ${XN[x]} (${res.length} combinations tried; top 12 of the first half) ---`);
  for (const { nm, s } of res.slice(0, 12)) console.log(`${nm}\n      n ${s.n} dates ${s.dates} win ${f2(s.win, 1)}% avg ${f2(s.avg)}%  | 2006-16 excess ${f2(s.exA)}% (t ${f2(s.tA, 1)})  | 2017-26 excess ${f2(s.exB)}% (t ${f2(s.tB, 1)})`);
  const held = res.filter(r => r.s.tA >= 3 && r.s.tB >= 2).length, tried = res.filter(r => r.s.tA >= 3).length; console.log(`   of ${tried} combinations with t >= 3 in 2006-16, ${held} also had t >= 2 in 2017-26; ${res.filter(r => r.s.tB >= 2).length} of all ${res.length} had t >= 2 in 2017-26 (about ${Math.round(res.length * 0.023)} expected by chance)`); }

console.log(`\n=== 4. Check on the trail exit. Its all-days baseline includes days when Supertrend is already down (sold at once), so any signal that needs an uptrend shows "excess". Fair baselines: any member-day with daily Supertrend up ${f2(stUp[0] / stUp[1])}% per trade (n ${stUp[1]}); Supertrend up for 20 days or fewer ${f2(stUpNew[0] / stUpNew[1])}% (n ${stUpNew[1]}) ===`);
for (const nm of ["Supertrend flips up", "Weekly EMA 9 crosses over EMA 21", "Pocket pivot (up volume over every down day of 10)", "Close over the upper Keltner channel", "Aroon up crosses over Aroon down", "Donchian 20-bar breakout", "Donchian 55-bar breakout", "Close over the upper Bollinger band", "Weekly CCI crosses above +100"]) { const s2 = stat(rows[nId.get(nm)], 2, 1 << 4); console.log(`${nm.padEnd(52)} with daily Supertrend up: n ${s2.n}  win ${f2(s2.win, 1)}%  avg ${f2(s2.avg)}%`); }

console.log(`\n=== 5. Atrox Quad Consensus (TradingView), daily and weekly, on every exit. Excess is per date against all members with the same exit ===`);
for (let e = 0; e < NE; e++) { if (!names[e].includes("Atrox")) continue; console.log(names[e] + `  (n ${rows[e].length})`); if (rows[e].length < 30) continue;
  for (const x of [5, 6, 0, 1, 3, 4]) { const s5 = stat(rows[e], x); console.log(`     ${XN[x].padEnd(48)} win ${f2(s5.win, 1).padStart(5)}%  avg ${f2(s5.avg).padStart(6)}%  excess ${f2(s5.ex).padStart(6)}% (t ${f2(s5.t, 1).padStart(5)})  2006-16 ${f2(s5.exA).padStart(6)}%  2017-26 ${f2(s5.exB).padStart(6)}%`); } }
