// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// A JavaScript port of "Machine Learning: Lorentzian Classification" (v2.0) and the parts of the "MLExtensions" library it
// calls, both © jdehorty and published under the MPL 2.0:
//   https://www.tradingview.com/script/WhBzgfDu-Machine-Learning-Lorentzian-Classification/
//   https://www.tradingview.com/script/ia5ozyMF-MLExtensions/
// Ported line for line from the Pine Script source with the indicator's default settings: source close, 8 neighbours, 5 features
// (RSI 14/1, WT 10/11, CCI 20/1, ADX 20, RSI 9/1), volatility and regime filters on, ADX, EMA and SMA filters off.
// Not ported: kernel regression, entry and exit labels, bar colours and the trade-stats table (display and trade management only).
//
// What it does, in the source's own terms: each bar is labelled by comparing the close four bars earlier with the bar's own close
// (`src[4] < src[0] ? short : src[4] > src[0] ? long : neutral`). On every bar the loop walks the history, keeps up to 8 bars whose
// Lorentzian distance to the current bar passes its rolling threshold (skipping every index divisible by 4), and the prediction is
// the sum of their labels, from -8 to +8. `distances` and `predictions` persist from bar to bar, as `var` arrays do in Pine.
//
// `rows` are completed bars, oldest first: { open, high, low, close }. The indicator is run from the first bar given, so with one
// year of daily bars it sees about 250 bars where the TradingView default looks back up to 2,000.
function lorentzianClassification(rows) {
  const n = rows.length;
  if (n < 60) return null;
  const NEIGHBORS = 8, MAX_BARS_BACK = 2000, na = NaN, isNa = Number.isNaN, nz = (v, d = 0) => isNa(v) ? d : v;
  const open = rows.map(r => r.open ?? r.close), high = rows.map(r => r.high), low = rows.map(r => r.low), close = rows.map(r => r.close);
  const hlc3 = rows.map((r, i) => (high[i] + low[i] + close[i]) / 3), ohlc4 = rows.map((r, i) => (open[i] + high[i] + low[i] + close[i]) / 4);

  // ---- Pine built-ins (ta.sma, ta.ema, ta.rma, ta.rsi, ta.cci, ta.atr), with their na handling and SMA seeding ----
  const sma = (src, len) => { const out = new Array(n).fill(na); for (let i = len - 1; i < n; i++) { let sum = 0; for (let j = i - len + 1; j <= i; j++) sum += src[j]; out[i] = sum / len; } return out; };
  const smoothed = alpha => (src, len) => { const seed = sma(src, len), out = new Array(n).fill(na);
    for (let i = 0; i < n; i++) out[i] = i === 0 || isNa(out[i - 1]) ? seed[i] : alpha(len) * src[i] + (1 - alpha(len)) * out[i - 1];
    return out; };
  const ema = smoothed(len => 2 / (len + 1)), rma = smoothed(len => 1 / len);
  const rsi = (src, len) => { const up = src.map((v, i) => i === 0 ? na : Math.max(v - src[i - 1], 0)), down = src.map((v, i) => i === 0 ? na : Math.max(src[i - 1] - v, 0));
    const u = rma(up, len), d = rma(down, len);
    return u.map((v, i) => isNa(v) ? na : d[i] === 0 ? 100 : v === 0 ? 0 : 100 - 100 / (1 + v / d[i])); };
  const cci = (src, len) => { const ma = sma(src, len); return src.map((v, i) => { if (isNa(ma[i])) return na; let dev = 0; for (let j = i - len + 1; j <= i; j++) dev += Math.abs(src[j] - ma[i]); return (v - ma[i]) / (0.015 * dev / len); }); };
  const trueRange = rows.map((r, i) => i === 0 ? high[i] - low[i] : Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])));
  const atr = len => rma(trueRange, len);

  // ---- MLExtensions: rescale, normalize, n_rsi, n_cci, n_wt, n_adx ----
  const rescale = (src, oldMin, oldMax, newMin, newMax) => src.map(v => newMin + (newMax - newMin) * (v - oldMin) / Math.max(oldMax - oldMin, 10e-10));
  const normalize = (src, min, max) => { let historicMin = 10e10, historicMax = -10e10;
    return src.map(v => { historicMin = Math.min(nz(v, historicMin), historicMin); historicMax = Math.max(nz(v, historicMax), historicMax);
      return min + (max - min) * (v - historicMin) / Math.max(historicMax - historicMin, 10e-10); }); };
  const n_rsi = (src, n1, n2) => rescale(ema(rsi(src, n1), n2), 0, 100, 0, 1);
  const n_cci = (src, n1, n2) => normalize(ema(cci(src, n1), n2), 0, 1);
  const n_wt = (src, n1, n2) => { const ema1 = ema(src, n1), ema2 = ema(src.map((v, i) => Math.abs(v - ema1[i])), n1);
    const ci = src.map((v, i) => (v - ema1[i]) / (0.015 * ema2[i])), wt1 = ema(ci, n2), wt2 = sma(wt1, 4);
    return normalize(wt1.map((v, i) => v - wt2[i]), 0, 1); };
  const n_adx = (highSrc, lowSrc, closeSrc, length) => { const dx = new Array(n).fill(na); let trSmooth = 0, plusSmooth = 0, minusSmooth = 0;
    for (let i = 0; i < n; i++) {
      const prevClose = i ? closeSrc[i - 1] : 0, prevHigh = i ? highSrc[i - 1] : 0, prevLow = i ? lowSrc[i - 1] : 0; // nz(x[1]) is 0 on the first bar
      const tr = Math.max(Math.max(highSrc[i] - lowSrc[i], Math.abs(highSrc[i] - prevClose)), Math.abs(lowSrc[i] - prevClose));
      const plus = highSrc[i] - prevHigh > prevLow - lowSrc[i] ? Math.max(highSrc[i] - prevHigh, 0) : 0;
      const minus = prevLow - lowSrc[i] > highSrc[i] - prevHigh ? Math.max(prevLow - lowSrc[i], 0) : 0;
      trSmooth = trSmooth - trSmooth / length + tr; plusSmooth = plusSmooth - plusSmooth / length + plus; minusSmooth = minusSmooth - minusSmooth / length + minus;
      const diPositive = plusSmooth / trSmooth * 100, diNegative = minusSmooth / trSmooth * 100;
      dx[i] = Math.abs(diPositive - diNegative) / (diPositive + diNegative) * 100;
    }
    return rescale(rma(dx, length), 0, 100, 0, 1); };

  // ---- MLExtensions filters: filter_volatility(1, 10) and regime_filter(ohlc4, -0.1) ----
  const recentAtr = atr(1), historicalAtr = atr(10);
  const volatility = i => recentAtr[i] > historicalAtr[i];
  const regime = (() => { const slope = new Array(n).fill(na); let value1 = na, value2 = na, klmf = na;
    for (let i = 0; i < n; i++) {
      value1 = 0.2 * (ohlc4[i] - (i ? ohlc4[i - 1] : na)) + 0.8 * nz(value1);
      value2 = 0.1 * (high[i] - low[i]) + 0.8 * nz(value2);
      const omega = Math.abs(value1 / value2), alpha = (-Math.pow(omega, 2) + Math.sqrt(Math.pow(omega, 4) + 16 * Math.pow(omega, 2))) / 8;
      const previous = klmf;
      klmf = alpha * ohlc4[i] + (1 - alpha) * nz(klmf);
      slope[i] = Math.abs(klmf - previous);
    }
    const average = ema(slope, 200);
    return i => (slope[i] - average[i]) / average[i] >= -0.1; })();

  // ---- The indicator: features, labels, the approximate nearest-neighbour loop, signal ----
  const features = [n_rsi(close, 14, 1), n_wt(hlc3, 10, 11), n_cci(close, 20, 1), n_adx(high, low, close, 20), n_rsi(close, 9, 1)];
  const lastBarIndex = n - 1, maxBarsBackIndex = lastBarIndex >= MAX_BARS_BACK ? lastBarIndex - MAX_BARS_BACK : 0;
  const yTrain = [], distances = [], predictions = [];
  let prediction = 0, signal = 0, filterAll = false;
  const predictionByBar = [], signalByBar = [];
  for (let bar = 0; bar < n; bar++) {
    yTrain.push(bar >= 4 ? (close[bar - 4] < close[bar] ? -1 : close[bar - 4] > close[bar] ? 1 : 0) : 0);
    let lastDistance = -1.0;
    const size = Math.min(MAX_BARS_BACK - 1, yTrain.length - 1), sizeLoop = Math.min(MAX_BARS_BACK - 1, size);
    if (bar >= maxBarsBackIndex) {
      for (let i = maxBarsBackIndex; i <= sizeLoop; i++) {
        let d = 0;
        for (let f = 0; f < 5; f++) d += Math.log(1 + Math.abs(features[f][bar] - features[f][i]));
        if (d >= lastDistance && i % 4 !== 0) {
          lastDistance = d;
          distances.push(d);
          predictions.push(Math.round(yTrain[i]));
          if (predictions.length > NEIGHBORS) {
            lastDistance = distances[Math.round(NEIGHBORS * 3 / 4)];
            distances.shift();
            predictions.shift();
          }
        }
      }
      prediction = predictions.reduce((sum, value) => sum + value, 0);
    }
    filterAll = volatility(bar) && regime(bar);
    signal = prediction > 0 && filterAll ? 1 : prediction < 0 && filterAll ? -1 : signal;
    predictionByBar.push(prediction); signalByBar.push(signal);
  }
  // The last HISTORY_BARS readings, for the chart strip and the ranking agent. `p` is the prediction, `s` the indicator's own signal after its filters.
  const HISTORY_BARS = 60, from = Math.max(0, n - HISTORY_BARS);
  const history = predictionByBar.slice(from).map((p, i) => ({ d: rows[from + i].date ?? null, p, s: signalByBar[from + i] }));
  const sign = v => v > 0 ? 1 : v < 0 ? -1 : 0;
  let streak = 0; while (streak < n && sign(predictionByBar[n - 1 - streak]) === sign(prediction)) streak++;
  const before = streak < n ? sign(predictionByBar[n - 1 - streak]) : 0; // the lean just before the current one, 0 if none
  const avg = (a, b) => { const part = predictionByBar.slice(a, b); return part.length ? part.reduce((x, y) => x + y, 0) / part.length : 0; };
  const change = avg(n - 3, n) - avg(n - 8, n - 3);
  const trajectory = Math.abs(change) < 1 ? "steady" : (change > 0) === (prediction >= 0) ? "strengthening" : "fading";
  return {
    prediction, neighbors: NEIGHBORS, signal, filters_pass: filterAll,
    history, streak_bars: streak, previous_lean: before, trajectory,
    votes_long: predictions.filter(value => value > 0).length, votes_short: predictions.filter(value => value < 0).length,
    bars: n,
  };
}
