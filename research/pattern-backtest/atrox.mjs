// Shared copy of the Atrox Quad Consensus re-implementation (same code as in backtest43.mjs). Needs S = { n, o, h, l, c, tr }.
// ---------- "Atrox Black Edition - Quad Consensus" (TradingView script vFlmqpJW), re-implemented from its published source ----------
// Engines: AtroNox (Bollinger 100, 1.5 trend line), Raptor (Supertrend on close, 6.5 x ATR11, close >= SMA9), Scalper (Supertrend on close, 7 x ATR10),
// Elite (range filter, period 200, multiplier 7.5). Consensus: engines that signalled within the window, score 0-100, ATR5 / EMA5(ATR5) between 0.8 and 2.5.
export function atrox(S) { const { n, o, h, l, c, tr } = S; const A = v => new Array(n).fill(v);
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
