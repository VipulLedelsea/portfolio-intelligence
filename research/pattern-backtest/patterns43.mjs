// Pivot-based chart pattern detectors, lifted unchanged from round2.mjs (lines 41-148) so they can run on other data. Longs and shorts; events fire on the close of day t.
const MODE = "stocks", K = 5, W = 130;
export function addPivots(S) { const { n, h, l, c } = S; const pivH = new Array(n).fill(false), pivL = new Array(n).fill(false);
  for (let i = K; i < n - K; i++) { let hi = true, lo = true; for (let j = i - K; j <= i + K; j++) { if (j === i) continue; if (h[j] > h[i] || (j < i && h[j] === h[i])) hi = false; if (l[j] < l[i] || (j < i && l[j] === l[i])) lo = false; } pivH[i] = hi; pivL[i] = lo; }
  const cs = [0]; for (const x of c) cs.push(cs[cs.length - 1] + x); S.sma = (i, p) => i + 1 >= p ? (cs[i + 1] - cs[i + 1 - p]) / p : NaN; S.pivH = pivH; S.pivL = pivL; if (!S.atr) S.atr = S.atr14; return S; }
const pivots = (S, t, win) => { const H = [], L = []; for (let i = Math.max(K, t - win); i <= t - K; i++) { if (S.pivH[i]) H.push(i); if (S.pivL[i]) L.push(i); } return { H, L }; };
const maxOf = (a, f, t) => { let m = -Infinity; for (let i = f; i <= t; i++) m = Math.max(m, a[i]); return m; };
const minOf = (a, f, t) => { let m = Infinity; for (let i = f; i <= t; i++) m = Math.min(m, a[i]); return m; };

// ---------- detectors: return events for a breakout that happens on the close of day t ----------
function detect(S, t) {
  const ev = []; const { c, h, l } = S;
  const { H, L } = pivots(S, t, W);
  const add = (name, dir, level, stop, target) => {
    const risk = Math.abs(c[t] - stop) / c[t], reward = Math.abs(target - c[t]) / c[t];
    if (risk < 0.01 && MODE !== "forex") return; if (risk < 0.002) return;
    if (risk > 0.25 || reward < 0.005) return;
    ev.push({ name, dir, level, stop, target });
  };
  const firstBreakUp = (level, from) => c[t] > level && c[t - 1] <= level && maxOf(c, from, t - 1) <= level;
  const firstBreakDn = (level, from) => c[t] < level && c[t - 1] >= level && minOf(c, from, t - 1) >= level;
  // Double bottom / top
  if (L.length >= 2) {
    const i2 = L[L.length - 1], i1 = L[L.length - 2], gap = i2 - i1;
    if (gap >= 15 && gap <= 60 && t - i2 <= 40 && Math.abs(l[i2] - l[i1]) / l[i1] <= 0.03) {
      const neck = maxOf(h, i1, i2), bottom = Math.min(l[i1], l[i2]);
      const down = c[i1] < S.sma(i1, 50) && bottom <= 0.9 * maxOf(h, Math.max(0, i1 - 40), i1);
      if (neck / Math.max(l[i1], l[i2]) - 1 >= 0.07 && down && firstBreakUp(neck, i2)) add("Double bottom", 1, neck, bottom, neck + (neck - bottom));
    }
  }
  if (H.length >= 2) {
    const i2 = H[H.length - 1], i1 = H[H.length - 2], gap = i2 - i1;
    if (gap >= 15 && gap <= 60 && t - i2 <= 40 && Math.abs(h[i2] - h[i1]) / h[i1] <= 0.03) {
      const neck = minOf(l, i1, i2), top = Math.max(h[i1], h[i2]);
      const up = c[i1] > S.sma(i1, 50) && top >= 1.1 * minOf(l, Math.max(0, i1 - 40), i1);
      if (Math.min(h[i1], h[i2]) / neck - 1 >= 0.07 && up && firstBreakDn(neck, i2)) add("Double top", -1, neck, top, neck - (top - neck));
    }
  }
  // Head and shoulders (top) and inverse
  if (H.length >= 3) {
    const [i1, i2, i3] = H.slice(-3);
    if (i2 - i1 >= 5 && i2 - i1 <= 50 && i3 - i2 >= 5 && i3 - i2 <= 50 && t - i3 <= 40) {
      const head = h[i2], ls = h[i1], rs = h[i3];
      if (head >= 1.03 * Math.max(ls, rs) && Math.abs(ls - rs) / ((ls + rs) / 2) <= 0.05) {
        const t1 = minOf(l, i1, i2), t2 = minOf(l, i2, i3), neck = (t1 + t2) / 2;
        if (Math.abs(t1 - t2) / neck <= 0.04 && c[i1] > S.sma(i1, 50) && firstBreakDn(neck, i3)) add("Head and shoulders", -1, neck, rs, neck - (head - neck));
      }
    }
  }
  if (L.length >= 3) {
    const [i1, i2, i3] = L.slice(-3);
    if (i2 - i1 >= 5 && i2 - i1 <= 50 && i3 - i2 >= 5 && i3 - i2 <= 50 && t - i3 <= 40) {
      const head = l[i2], ls = l[i1], rs = l[i3];
      if (head <= 0.97 * Math.min(ls, rs) && Math.abs(ls - rs) / ((ls + rs) / 2) <= 0.05) {
        const p1 = maxOf(h, i1, i2), p2 = maxOf(h, i2, i3), neck = (p1 + p2) / 2;
        if (Math.abs(p1 - p2) / neck <= 0.04 && c[i1] < S.sma(i1, 50) && firstBreakUp(neck, i3)) add("Inverse head and shoulders", 1, neck, rs, neck + (neck - head));
      }
    }
  }
  // Triangles and wedges use the last pivots within 80 days
  const Hw = H.filter(i => i >= t - 80), Lw = L.filter(i => i >= t - 80);
  if (Hw.length >= 2 && Lw.length >= 2) {
    const h1 = Hw[Hw.length - 2], h2 = Hw[Hw.length - 1], l1 = Lw[Lw.length - 2], l2 = Lw[Lw.length - 1];
    const span = Math.max(h2, l2) - Math.min(h1, l1);
    if (span >= 15) {
      const flatTop = Math.abs(h[h1] - h[h2]) / h[h1] <= 0.015, flatBot = Math.abs(l[l1] - l[l2]) / l[l1] <= 0.015;
      const risingLows = l[l2] >= 1.01 * l[l1], fallingHighs = h[h2] <= 0.99 * h[h1];
      const fallingLows = l[l2] <= 0.99 * l[l1], risingHighs = h[h2] >= 1.01 * h[h1];
      const res = Math.max(h[h1], h[h2]), sup = Math.min(l[l1], l[l2]);
      if (flatTop && risingLows && c[h1] > S.sma(h1, 50) && firstBreakUp(res, Math.max(h2, l2))) add("Ascending triangle", 1, res, l[l2], res + (res - l[l1]));
      if (flatBot && fallingHighs && c[l1] < S.sma(l1, 50) && firstBreakDn(sup, Math.max(h2, l2))) add("Descending triangle", -1, sup, h[h2], sup - (h[h1] - sup));
      if (fallingHighs && risingLows) {
        const height = h[h1] - l[l1];
        if (firstBreakUp(h[h2], Math.max(h2, l2))) add("Symmetrical triangle (up)", 1, h[h2], l[l2], h[h2] + height);
        if (firstBreakDn(l[l2], Math.max(h2, l2))) add("Symmetrical triangle (down)", -1, l[l2], h[h2], l[l2] - height);
      }
      // Wedges: both lines slope the same way and converge
      const slopeH = (h[h2] - h[h1]) / (h2 - h1), slopeL = (l[l2] - l[l1]) / (l2 - l1);
      if (fallingHighs && fallingLows && slopeH < slopeL) {
        const upper = h[h2] + slopeH * (t - h2), upperPrev = h[h2] + slopeH * (t - 1 - h2);
        if (c[t] > upper && c[t - 1] <= upperPrev) add("Falling wedge", 1, upper, l[l2], upper + (h[h1] - l[l1]));
      }
      if (risingHighs && risingLows && slopeL > slopeH) {
        const lower = l[l2] + slopeL * (t - l2), lowerPrev = l[l2] + slopeL * (t - 1 - l2);
        if (c[t] < lower && c[t - 1] >= lowerPrev) add("Rising wedge", -1, lower, h[h2], lower - (h[h1] - l[l1]));
      }
    }
  }
  // Bull flag (pole then shallow, contracting pullback) and cup and handle (continuation and after-downtrend versions)
  if (t >= 40) {
    let p = t - 16; for (let i = t - 16; i <= t - 1; i++) if (h[i] > h[p]) p = i;
    if (p <= t - 4) {
      let lowPole = Infinity, lpi = p; for (let i = p - 15; i <= p; i++) if (l[i] < lowPole) { lowPole = l[i]; lpi = i; }
      if (h[p] / lowPole - 1 >= 0.2) {
        const flagHigh = maxOf(h, p + 1, t - 1), flagLow = minOf(l, p + 1, t - 1);
        let fr = 0, pr = 0; for (let i = p + 1; i <= t - 1; i++) fr += h[i] - l[i]; for (let i = lpi; i <= p; i++) pr += h[i] - l[i];
        if ((h[p] - flagLow) / (h[p] - lowPole) <= 0.5 && fr / (t - 1 - p) <= 0.8 * (pr / (p - lpi + 1)) && firstBreakUp(flagHigh, p + 1)) add("Bull flag", 1, flagHigh, flagLow, flagHigh + (h[p] - lowPole));
      }
    }
  }
  if (t >= 140) {
    for (const W2 of [35, 50, 70, 100, 130]) { let hit = null; for (const hh of [5, 8, 12, 15]) {
      const c0 = t - hh, a = c0 - W2; if (a < 5) continue;
      const rimL = maxOf(h, a - 3, a + 3); let bottom = Infinity, b = a; for (let i = a + 3; i <= c0 - 3; i++) if (l[i] < bottom) { bottom = l[i]; b = i; }
      const depth = (rimL - bottom) / rimL; if (depth < 0.12 || depth > 0.35 || b < a + 0.25 * W2 || b > a + 0.75 * W2) continue;
      const rimR = maxOf(h, c0 - 4, c0); if (rimR < 0.92 * rimL || rimR > 1.05 * rimL) continue;
      const hHigh = maxOf(h, c0 + 1, t - 1), hLow = minOf(l, c0 + 1, t - 1); if (hHigh > rimR * 1.01) continue;
      if ((rimR - hLow) / rimR > 0.12 || (rimR - hLow) > 0.5 * (rimR - bottom)) continue;
      if (c[t] > rimR && c[t - 1] <= rimR) { hit = { rimR, hLow, bottom }; break; } }
      if (hit) { const up = c[t] > S.sma(t, 200); add(up ? "Cup and handle (after uptrend)" : "Cup and handle (after downtrend)", 1, hit.rimR, hit.hLow, hit.rimR + (hit.rimR - hit.bottom)); break; } }
  }
  return ev;
}
export { detect, K };
