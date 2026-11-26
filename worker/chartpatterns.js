// Chart patterns a stock is making right now, read from its daily bars. Information only: our 20-year backtest (research/pattern-backtest,
// round2.mjs, backtest43.mjs, backtest44.mjs) found no pattern that beat random stocks given the same stop and target, so nothing in the
// ranking, stop or exit reads this. The pivot rules follow research/pattern-backtest/patterns43.mjs, changed to also report a pattern that
// is still forming (price inside it, near the breakout line) as well as one that broke out in the last few days.
//
// `rows` are completed daily bars, oldest first: { date, open, high, low, close }. Returns a list (at most 3, newest signal first) of
// { name, bias: "bullish" | "bearish", status: "forming" | "breakout", level, stop, target, lines: [{ d1, p1, d2, p2 }, ...], since }
// or null when there are too few bars. `lines` are the trendlines or levels to draw; `since` is the date the pattern started.
function detectChartPatterns(rows) {
  const n = Array.isArray(rows) ? rows.length : 0;
  if (n < 80) return null;
  const K = 5, WIN = 130, t = n - 1;
  const h = rows.map(r => r.high), l = rows.map(r => r.low), c = rows.map(r => r.close), d = rows.map(r => String(r.date).slice(0, 10));
  const sma = (i, p) => { if (i + 1 < p) return NaN; let s = 0; for (let j = i + 1 - p; j <= i; j++) s += c[j]; return s / p; };
  const maxOf = (a, f, to) => { let m = -Infinity; for (let i = f; i <= to; i++) m = Math.max(m, a[i]); return m; };
  const minOf = (a, f, to) => { let m = Infinity; for (let i = f; i <= to; i++) m = Math.min(m, a[i]); return m; };
  const H = [], L = [];
  for (let i = Math.max(K, t - WIN); i <= t - K; i++) {
    let hi = true, lo = true;
    for (let j = i - K; j <= i + K; j++) { if (j === i) continue; if (h[j] > h[i] || (j < i && h[j] === h[i])) hi = false; if (l[j] < l[i] || (j < i && l[j] === l[i])) lo = false; }
    if (hi) H.push(i); if (lo) L.push(i);
  }
  const out = [];
  const line = (i1, p1, i2, p2) => ({ d1: d[i1], p1, d2: d[i2], p2 });
  const push = (name, bias, status, level, stop, target, lines, since) => {
    const risk = Math.abs(c[t] - stop) / c[t];
    if (!(risk > 0.002 && risk < 0.3)) return;
    out.push({ name, bias, status, level: +level.toFixed(2), stop: +stop.toFixed(2), target: +target.toFixed(2), lines: lines.map(x => ({ d1: x.d1, p1: +x.p1.toFixed(2), d2: x.d2, p2: +x.p2.toFixed(2) })), since: d[since] });
  };
  // A breakout bar in the last `recent` days that was the first close beyond the level since `from`.
  const brokeUp = (level, from, recent = 4) => { for (let b = t; b > t - recent && b > from; b--) if (c[b] > level && maxOf(c, Math.max(from, 0), b - 1) <= level) return b; return -1; };
  const brokeDn = (level, from, recent = 4) => { for (let b = t; b > t - recent && b > from; b--) if (c[b] < level && minOf(c, Math.max(from, 0), b - 1) >= level) return b; return -1; };
  const near = (level, pct) => Math.abs(c[t] - level) / level <= pct;

  // Double bottom and double top.
  if (L.length >= 2) {
    const i2 = L[L.length - 1], i1 = L[L.length - 2], gap = i2 - i1;
    if (gap >= 15 && gap <= 60 && t - i2 <= 40 && Math.abs(l[i2] - l[i1]) / l[i1] <= 0.03) {
      const neck = maxOf(h, i1, i2), bottom = Math.min(l[i1], l[i2]);
      const down = c[i1] < sma(i1, 50) && bottom <= 0.9 * maxOf(h, Math.max(0, i1 - 40), i1);
      if (neck / Math.max(l[i1], l[i2]) - 1 >= 0.07 && down && c[t] > bottom) {
        const b = brokeUp(neck, i2), target = neck + (neck - bottom);
        const lines = [line(i1, l[i1], i2, l[i2]), line(i1, neck, t, neck)];
        if (b >= 0) push("Double bottom", "bullish", "breakout", neck, bottom, target, lines, i1);
        else if (c[t] <= neck && near(neck, 0.04)) push("Double bottom", "bullish", "forming", neck, bottom, target, lines, i1);
      }
    }
  }
  if (H.length >= 2) {
    const i2 = H[H.length - 1], i1 = H[H.length - 2], gap = i2 - i1;
    if (gap >= 15 && gap <= 60 && t - i2 <= 40 && Math.abs(h[i2] - h[i1]) / h[i1] <= 0.03) {
      const neck = minOf(l, i1, i2), top = Math.max(h[i1], h[i2]);
      const up = c[i1] > sma(i1, 50) && top >= 1.1 * minOf(l, Math.max(0, i1 - 40), i1);
      if (Math.min(h[i1], h[i2]) / neck - 1 >= 0.07 && up && c[t] < top) {
        const b = brokeDn(neck, i2), target = neck - (top - neck);
        const lines = [line(i1, h[i1], i2, h[i2]), line(i1, neck, t, neck)];
        if (b >= 0) push("Double top", "bearish", "breakout", neck, top, target, lines, i1);
        else if (c[t] >= neck && near(neck, 0.04)) push("Double top", "bearish", "forming", neck, top, target, lines, i1);
      }
    }
  }
  // Head and shoulders (top) and inverse.
  if (H.length >= 3) {
    const [i1, i2, i3] = H.slice(-3);
    if (i2 - i1 >= 5 && i2 - i1 <= 50 && i3 - i2 >= 5 && i3 - i2 <= 50 && t - i3 <= 40) {
      const head = h[i2], ls = h[i1], rs = h[i3];
      if (head >= 1.03 * Math.max(ls, rs) && Math.abs(ls - rs) / ((ls + rs) / 2) <= 0.05) {
        const t1 = minOf(l, i1, i2), t2 = minOf(l, i2, i3), neck = (t1 + t2) / 2;
        if (Math.abs(t1 - t2) / neck <= 0.04 && c[i1] > sma(i1, 50) && c[t] < head) {
          const b = brokeDn(neck, i3), lines = [line(i1, ls, i2, head), line(i2, head, i3, rs), line(i1, neck, t, neck)];
          if (b >= 0) push("Head and shoulders", "bearish", "breakout", neck, rs, neck - (head - neck), lines, i1);
          else if (c[t] >= neck && near(neck, 0.04)) push("Head and shoulders", "bearish", "forming", neck, rs, neck - (head - neck), lines, i1);
        }
      }
    }
  }
  if (L.length >= 3) {
    const [i1, i2, i3] = L.slice(-3);
    if (i2 - i1 >= 5 && i2 - i1 <= 50 && i3 - i2 >= 5 && i3 - i2 <= 50 && t - i3 <= 40) {
      const head = l[i2], ls = l[i1], rs = l[i3];
      if (head <= 0.97 * Math.min(ls, rs) && Math.abs(ls - rs) / ((ls + rs) / 2) <= 0.05) {
        const p1 = maxOf(h, i1, i2), p2 = maxOf(h, i2, i3), neck = (p1 + p2) / 2;
        if (Math.abs(p1 - p2) / neck <= 0.04 && c[i1] < sma(i1, 50) && c[t] > head) {
          const b = brokeUp(neck, i3), lines = [line(i1, ls, i2, head), line(i2, head, i3, rs), line(i1, neck, t, neck)];
          if (b >= 0) push("Inverse head and shoulders", "bullish", "breakout", neck, rs, neck + (neck - head), lines, i1);
          else if (c[t] <= neck && near(neck, 0.04)) push("Inverse head and shoulders", "bullish", "forming", neck, rs, neck + (neck - head), lines, i1);
        }
      }
    }
  }
  // Triangles and wedges from the last two swing highs and lows inside 80 days.
  const Hw = H.filter(i => i >= t - 80), Lw = L.filter(i => i >= t - 80);
  if (Hw.length >= 2 && Lw.length >= 2) {
    const h1 = Hw[Hw.length - 2], h2 = Hw[Hw.length - 1], l1 = Lw[Lw.length - 2], l2 = Lw[Lw.length - 1];
    const start = Math.min(h1, l1);
    if (Math.max(h2, l2) - start >= 15) {
      const slopeH = (h[h2] - h[h1]) / (h2 - h1), slopeL = (l[l2] - l[l1]) / (l2 - l1);
      const upper = t_ => h[h2] + slopeH * (t_ - h2), lower = t_ => l[l2] + slopeL * (t_ - l2);
      const flatTop = Math.abs(h[h1] - h[h2]) / h[h1] <= 0.015, flatBot = Math.abs(l[l1] - l[l2]) / l[l1] <= 0.015;
      const risingLows = l[l2] >= 1.01 * l[l1], fallingHighs = h[h2] <= 0.99 * h[h1], fallingLows = l[l2] <= 0.99 * l[l1], risingHighs = h[h2] >= 1.01 * h[h1];
      const inside = upper(t) > lower(t) && c[t] <= upper(t) * 1.0 && c[t] >= lower(t) * 1.0;  // price still between the two lines
      const lines = [line(h1, h[h1], t, upper(t)), line(l1, l[l1], t, lower(t))];
      const res = Math.max(h[h1], h[h2]), sup = Math.min(l[l1], l[l2]), height = h[h1] - l[l1];
      if (flatTop && risingLows && c[h1] > sma(h1, 50)) {
        const b = brokeUp(res, Math.max(h2, l2));
        const flat = [line(h1, h[h1], t, res), line(l1, l[l1], t, lower(t))];
        if (b >= 0) push("Ascending triangle", "bullish", "breakout", res, l[l2], res + (res - l[l1]), flat, start);
        else if (c[t] <= res && near(res, 0.03) && c[t] > lower(t)) push("Ascending triangle", "bullish", "forming", res, l[l2], res + (res - l[l1]), flat, start);
      } else if (flatBot && fallingHighs && c[l1] < sma(l1, 50)) {
        const b = brokeDn(sup, Math.max(h2, l2));
        const flat = [line(h1, h[h1], t, upper(t)), line(l1, l[l1], t, sup)];
        if (b >= 0) push("Descending triangle", "bearish", "breakout", sup, h[h2], sup - (h[h1] - sup), flat, start);
        else if (c[t] >= sup && near(sup, 0.03) && c[t] < upper(t)) push("Descending triangle", "bearish", "forming", sup, h[h2], sup - (h[h1] - sup), flat, start);
      } else if (fallingHighs && risingLows) {
        const bu = brokeUp(upper(t), Math.max(h2, l2), 3), bd = brokeDn(lower(t), Math.max(h2, l2), 3);
        if (bu >= 0) push("Symmetrical triangle", "bullish", "breakout", upper(t), l[l2], upper(t) + height, lines, start);
        else if (bd >= 0) push("Symmetrical triangle", "bearish", "breakout", lower(t), h[h2], lower(t) - height, lines, start);
        else if (inside) push("Symmetrical triangle", "bullish", "forming", upper(t), l[l2], upper(t) + height, lines, start);
      } else if (fallingHighs && fallingLows && slopeH < slopeL) {
        if (c[t] > upper(t) && c[t - 1] <= upper(t - 1)) push("Falling wedge", "bullish", "breakout", upper(t), l[l2], upper(t) + height, lines, start);
        else if (inside && near(upper(t), 0.03)) push("Falling wedge", "bullish", "forming", upper(t), l[l2], upper(t) + height, lines, start);
      } else if (risingHighs && risingLows && slopeL > slopeH) {
        if (c[t] < lower(t) && c[t - 1] >= lower(t - 1)) push("Rising wedge", "bearish", "breakout", lower(t), h[h2], lower(t) - height, lines, start);
        else if (inside && near(lower(t), 0.03)) push("Rising wedge", "bearish", "forming", lower(t), h[h2], lower(t) - height, lines, start);
      }
    }
  }
  // Bull flag: a pole of 20% or more, then a shallow, quieter pause. Forming while price is inside the flag.
  if (t >= 40) {
    let p = t - 16; for (let i = t - 16; i <= t - 1; i++) if (h[i] > h[p]) p = i;
    if (p <= t - 4) {
      let lowPole = Infinity, lpi = p; for (let i = Math.max(0, p - 15); i <= p; i++) if (l[i] < lowPole) { lowPole = l[i]; lpi = i; }
      if (h[p] / lowPole - 1 >= 0.2) {
        const flagHigh = maxOf(h, p + 1, t - 1), flagLow = minOf(l, p + 1, t - 1);
        let fr = 0, pr = 0; for (let i = p + 1; i <= t - 1; i++) fr += h[i] - l[i]; for (let i = lpi; i <= p; i++) pr += h[i] - l[i];
        if ((h[p] - flagLow) / (h[p] - lowPole) <= 0.5 && fr / (t - 1 - p) <= 0.8 * (pr / (p - lpi + 1))) {
          const lines = [line(lpi, lowPole, p, h[p]), line(p + 1, flagHigh, t, flagHigh), line(p + 1, flagLow, t, flagLow)];
          const b = brokeUp(flagHigh, p + 1);
          if (b >= 0) push("Bull flag", "bullish", "breakout", flagHigh, flagLow, flagHigh + (h[p] - lowPole), lines, lpi);
          else if (c[t] <= flagHigh && c[t] >= flagLow) push("Bull flag", "bullish", "forming", flagHigh, flagLow, flagHigh + (h[p] - lowPole), lines, lpi);
        }
      }
    }
  }
  // Cup and handle: a rounded base, a shallow handle, price near or just over the right rim.
  if (t >= 140) {
    for (const W2 of [35, 50, 70, 100, 130]) {
      let hit = null;
      for (const hh of [5, 8, 12, 15]) {
        const c0 = t - hh, a = c0 - W2; if (a < 5) continue;
        const rimL = maxOf(h, a - 3, a + 3); let bottom = Infinity, b = a; for (let i = a + 3; i <= c0 - 3; i++) if (l[i] < bottom) { bottom = l[i]; b = i; }
        const depth = (rimL - bottom) / rimL; if (depth < 0.12 || depth > 0.35 || b < a + 0.25 * W2 || b > a + 0.75 * W2) continue;
        const rimR = maxOf(h, c0 - 4, c0); if (rimR < 0.92 * rimL || rimR > 1.05 * rimL) continue;
        const hHigh = maxOf(h, c0 + 1, t - 1), hLow = minOf(l, c0 + 1, t - 1); if (hHigh > rimR * 1.01) continue;
        if ((rimR - hLow) / rimR > 0.12 || (rimR - hLow) > 0.5 * (rimR - bottom)) continue;
        if (c[t] >= hLow && c[t] <= rimR * 1.04) { hit = { rimR, hLow, bottom, a, b, c0, broke: c[t] > rimR }; break; }
      }
      if (hit) {
        const lines = [line(hit.a, hit.rimR, t, hit.rimR), line(hit.b, hit.bottom, hit.b, hit.bottom)];
        push("Cup and handle", "bullish", hit.broke ? "breakout" : "forming", hit.rimR, hit.hLow, hit.rimR + (hit.rimR - hit.bottom), [lines[0]], hit.a);
        break;
      }
    }
  }
  // Prefer breakouts, then the most recent starts; keep three at most, one per name.
  const seen = new Set();
  return out.filter(p => !seen.has(p.name) && seen.add(p.name)).sort((x, y) => (x.status === y.status ? 0 : x.status === "breakout" ? -1 : 1) || (x.since < y.since ? 1 : -1)).slice(0, 3);
}
