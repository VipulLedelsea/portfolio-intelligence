// After entry: can chart and volume tell that a stock is ABOUT to start a downtrend? For every day of every Supertrend flip trade (still open, Supertrend up),
// build chart and volume warning flags known at that close, then measure how well they predict (a) a drop of 6% or more within the next 10 sessions and (b) the
// Supertrend exit firing within 5 sessions. Per-flag lift, combinations, a logistic model, and first-alert-per-trade simulations of alert rules (with reasons).
import { data, memberAt, exitSim, mean, f2, WARM } from "./lib14.mjs";
const SPLIT = "2024-11-05", DROP = 0.06, HD = 10, HX = 5;
const pivLows = S => { const pl = []; for (let i = 3; i < S.n - 3; i++) { let lo = true; for (let k = 1; k <= 3; k++) if (!(S.l[i] < S.l[i - k] && S.l[i] < S.l[i + k])) { lo = false; break; } if (lo) pl.push(i); } return pl; };
const mx = (a, i, j) => { let m = -Infinity; for (let k = i; k <= j; k++) if (a[k] > m) m = a[k]; return m; }, mn = (a, i, j) => { let m = Infinity; for (let k = i; k <= j; k++) if (a[k] < m) m = a[k]; return m; };
const FLAGS = ["chart: close under 10-day EMA (first day)", "chart: close under 20-day EMA (first day)", "chart: close within 1 ATR of the Supertrend line", "chart: close within 0.5 ATR of the Supertrend line",
  "chart: close under the lowest low of the last 5 days", "chart: close under the last swing low (pivot)", "chart: gave back 50%+ of the open gain (after +5%)", "chart: 3+ ATR below the trade's peak close",
  "chart: extended 3+ ATR over the 20-day avg and a reversal candle", "chart: gap down 1% or more", "chart: wide-range down day closing near the low", "chart: bearish engulfing", "chart: shooting star after a run",
  "momentum: RSI14 crossed under 50", "momentum: MACD histogram crossed under 0", "momentum: price at a 20-day high but RSI lower than at the prior high", "trend: ADX 25+ and falling for 3 days", "trend: -DI crossed over +DI",
  "volume: 3+ distribution days in the last 10", "volume: high-volume down day (1.5x avg, -1.5%)", "volume: breakdown under the 10-day low on above-average volume", "volume: price at a 20-day high but OBV is not",
  "volume: climax (2.5x avg on an up day, 3+ ATR extended)", "volume: money flow (CMF 20) below zero", "volume: down-day volume 25%+ above up-day volume (10 days)"];
import { existsSync, readFileSync, writeFileSync } from "node:fs";
let obs = [];
if (existsSync("obs33.json")) obs = JSON.parse(readFileSync("obs33.json", "utf8"));
else {
for (const [sym, S] of data) { if (sym === "SPY") continue; const pl = pivLows(S);
  for (let t = WARM; t < S.n - 140; t++) { if (!(S.st[t] === 1 && S.st[t - 1] === -1) || !memberAt(sym, S.d[t]) || !(S.atr14[t] > 0)) continue; const r = exitSim(S, t, { st: true }); if (!r || S.hasBad(t - 252, t + 1 + r.days + 1)) continue;
    const e = t + 1, entry = S.o[e], exitSig = (() => { for (let k = e; k < S.n; k++) if (S.st[k] === -1) return k; return -1; })(); if (exitSig < 0) continue; let peak = entry, hiBefore = entry;
    for (let d = e + 2; d < exitSig && d < S.n - HD - 1; d++) { peak = Math.max(peak, mx(S.c, e, d)); const atr = S.atr14[d], c = S.c[d], o = S.o[d], h = S.h[d], l = S.l[d], v = S.v[d], va = S.vol50[d]; if (!(atr > 0 && va > 0)) continue;
      const rng = h - l || 1, ext = (c - S.sma20[d]) / atr, body = Math.abs(c - o), upWick = h - Math.max(c, o), gain = peak / entry - 1;
      let dist = 0, up = 0, dn = 0; for (let i = d - 9; i <= d; i++) { if (S.c[i] < S.c[i - 1] && S.v[i] >= S.v[i - 1] && S.v[i] > va) dist++; if (S.c[i] < S.c[i - 1]) dn += S.v[i]; else up += S.v[i]; }
      const c20hi = c >= mx(S.c, d - 19, d), lastPiv = [...pl].reverse().find(i => i + 3 <= d && i >= d - 40);
      let clv = 0, vs = 0; for (let i = d - 19; i <= d; i++) { clv += ((S.c[i] - S.l[i]) - (S.h[i] - S.c[i])) / ((S.h[i] - S.l[i]) || 1) * S.v[i]; vs += S.v[i]; }
      const f = [ c < S.ema10[d] && S.c[d - 1] >= S.ema10[d - 1], c < S.ema20[d] && S.c[d - 1] >= S.ema20[d - 1], (c - S.stLine[d]) / atr < 1, (c - S.stLine[d]) / atr < 0.5,
        c < mn(S.l, d - 5, d - 1), lastPiv !== undefined && c < S.l[lastPiv], gain >= 0.05 && (peak - c) / (peak - entry) >= 0.5, (peak - c) >= 3 * atr,
        ext >= 3 && c < o && rng >= 1.5 * atr, o <= S.c[d - 1] * 0.99, c < S.c[d - 1] && rng >= 2 * atr && (c - l) / rng <= 0.25, c < o && S.c[d - 1] > S.o[d - 1] && o >= S.c[d - 1] && c <= S.o[d - 1],
        upWick >= 2 * body && (c - l) / rng <= 0.33 && ext >= 2, S.rsi14[d] < 50 && S.rsi14[d - 1] >= 50, S.hist[d] < 0 && S.hist[d - 1] >= 0, c20hi && S.rsi14[d] < mx(S.rsi14, d - 19, d - 1) - 3,
        S.adx[d] >= 25 && S.adx[d] < S.adx[d - 3] && S.adx[d - 3] <= S.adx[d - 6] * 1.0 + 100 && S.adx[d - 1] < S.adx[d - 3], S.mdi[d] > S.pdi[d] && S.mdi[d - 1] <= S.pdi[d - 1],
        dist >= 3, v >= 1.5 * va && c <= S.c[d - 1] * 0.985, c < mn(S.l, d - 10, d - 1) && v >= va, c20hi && S.obv[d] < mx(S.obv, d - 19, d - 1), v >= 2.5 * va && c > o && ext >= 3, clv / (vs || 1) < 0, dn > 1.25 * up].map(Boolean);
      let drop = false, xs = false, lead = -1; for (let k = d + 1; k <= Math.min(S.n - 1, d + HD); k++) if (S.l[k] <= c * (1 - DROP)) { drop = true; break; }
      for (let k = d + 1; k <= Math.min(S.n - 1, d + HX); k++) if (S.st[k] === -1) { xs = true; break; } for (let k = d + 1; k < S.n; k++) if (S.st[k] === -1) { lead = k - d; break; }
      obs.push({ trade: `${sym}|${e}`, sym, date: S.d[d], d, k: d - e + 1, f, drop, xs, lead, pnl: (c / entry - 1) * 100, exitPx: S.o[Math.min(exitSig + 1, S.n - 1)], c, early: S.d[d] < SPLIT,
        x: [(c - S.stLine[d]) / atr, ext, (peak - c) / atr, gain * 100, (c / entry - 1) * 100, S.rsi14[d], S.adx[d], v / va, dist, (up ? dn / up : 1), S.hist[d] / atr, (c - S.ema20[d]) / atr, (S.mdi[d] - S.pdi[d]), clv / (vs || 1)] }); } } }
writeFileSync("obs33.json", JSON.stringify(obs)); }
const base = o => o.filter(x => x.drop).length / o.length * 100, T = obs.filter(x => x.early), E = obs.filter(x => !x.early);
console.log(`observations (open-trade days, Supertrend still up): ${obs.length} from ${new Set(obs.map(o => o.trade)).size} trades. P(drop >= 6% within 10 sessions) = ${f2(base(obs), 1)}% (train ${f2(base(T), 1)}%, test ${f2(base(E), 1)}%); P(Supertrend exit within 5 sessions) = ${f2(obs.filter(x => x.xs).length / obs.length * 100, 1)}%`);
console.log("\n== each warning flag alone: P(drop 6%+ in 10d) when it fires vs when it does not; P(Supertrend exit within 5d) when it fires ==");
console.log("flag".padEnd(70) + "fires".padStart(7) + "P(drop)".padStart(9) + "not".padStart(7) + "lift".padStart(6) + "  train/test".padStart(14) + "  P(exit<=5d)");
const rowsF = FLAGS.map((nm, i) => { const F = obs.filter(x => x.f[i]), N = obs.filter(x => !x.f[i]); const a = base(F), b = base(N); return { nm, i, n: F.length, share: F.length / obs.length * 100, a, b, lift: a / b, tr: base(F.filter(x => x.early)), te: base(F.filter(x => !x.early)), xs: F.filter(x => x.xs).length / (F.length || 1) * 100 }; }).filter(r => r.n >= 200).sort((x, y) => y.lift - x.lift);
for (const r of rowsF) console.log(r.nm.padEnd(70) + `${r.n}`.padStart(7) + (f2(r.a, 1) + "%").padStart(9) + (f2(r.b, 1) + "%").padStart(7) + f2(r.lift, 2).padStart(6) + `  ${f2(r.tr, 0)}%/${f2(r.te, 0)}%`.padStart(14) + `  ${f2(r.xs, 0)}%`);
// logistic regression on flags + numeric context, train early -> test late
const X = o => [...o.f.map(b => b ? 1 : 0), ...o.x]; const NF = X(obs[0]).length;
const mu = new Float64Array(NF), sd = new Float64Array(NF); { const M = 20000, step = Math.ceil(obs.length / M); const sm = obs.filter((_, i) => i % step === 0).map(X); for (let j = 0; j < NF; j++) { mu[j] = mean(sm.map(r => r[j])); sd[j] = Math.sqrt(mean(sm.map(r => (r[j] - mu[j]) ** 2))) || 1; } }
const flat = set => { const A = new Float64Array(set.length * NF); set.forEach((o, i) => { const r = X(o); for (let j = 0; j < NF; j++) A[i * NF + j] = (r[j] - mu[j]) / sd[j]; }); return A; };
const fit = (set, Zs, y) => { const m = set.length, w = new Float64Array(NF + 1), yy = set.map(o => y(o) ? 1 : 0); for (let it = 0; it < 150; it++) { const g = new Float64Array(NF + 1); for (let i = 0; i < m; i++) { let z = w[NF]; const b = i * NF; for (let j = 0; j < NF; j++) z += w[j] * Zs[b + j]; const e = 1 / (1 + Math.exp(-z)) - yy[i]; for (let j = 0; j < NF; j++) g[j] += e * Zs[b + j]; g[NF] += e; } for (let j = 0; j <= NF; j++) w[j] -= 1.0 * (g[j] / m + (j < NF ? 0.001 * w[j] : 0)); } return w; };
const scoreAll = (w, Zs, n) => { const out = new Float64Array(n); for (let i = 0; i < n; i++) { let z = w[NF]; const b = i * NF; for (let j = 0; j < NF; j++) z += w[j] * Zs[b + j]; out[i] = z; } return out; };
const auc = (pos, neg) => { const all = [...pos.map(s => [s, 1]), ...neg.map(s => [s, 0])].sort((a, b) => a[0] - b[0]); let i = 0, sp = 0; while (i < all.length) { let j = i; while (j < all.length && all[j][0] === all[i][0]) j++; const av = (i + j + 1) / 2; for (let k = i; k < j; k++) if (all[k][1]) sp += av; i = j; } return (sp - pos.length * (pos.length + 1) / 2) / (pos.length * neg.length); };
const sub = (a, n) => a.filter((_, i) => i % Math.ceil(a.length / n) === 0);
console.log("\n== logistic model on all flags and numbers (trained before 2024-11-05, judged after) ==");
const trS = sub(T, 50000), teS = sub(E, 40000), ZT = flat(trS), ZE = flat(teS);
for (const [nm, y] of [["drop >= 6% within 10 sessions", o => o.drop], ["Supertrend exit within 5 sessions", o => o.xs]]) { const w = fit(trS, ZT, y), s1 = scoreAll(w, ZT, trS.length), s2 = scoreAll(w, ZE, teS.length);
  const split = (set, s) => [set.map((o, i) => y(o) ? s[i] : null).filter(v => v !== null), set.map((o, i) => y(o) ? null : s[i]).filter(v => v !== null)];
  const [p1, n1] = split(trS, s1), [p2, n2] = split(teS, s2); const a1 = auc(p1, n1), a2 = auc(p2, n2);
  const sc = teS.map((o, i) => ({ s: s2[i], y: y(o) })).sort((p, q) => q.s - p.s), top = k => sc.slice(0, Math.floor(sc.length * k)), pr = a => a.filter(x => x.y).length / a.length * 100;
  const dist = auc(teS.filter(y).map(o => -o.x[0]), teS.filter(o => !y(o)).map(o => -o.x[0]));
  console.log(`  ${nm}: AUC train ${f2(a1, 3)}, TEST ${f2(a2, 3)} (distance-to-line alone: ${f2(dist, 3)}); base rate ${f2(pr(sc), 1)}%; top 10% of scores: ${f2(pr(top(0.10)), 1)}%; top 5%: ${f2(pr(top(0.05)), 1)}%; top 1%: ${f2(pr(top(0.01)), 1)}%`); }
// alert rules, first alert per trade
const RULES = { "VOLUME: distribution (3+ days) or a high-volume down day, with the close under the 10-day EMA zone": o => (o.f[18] || o.f[19]) && (o.f[0] || o.x[11] < 0), "STRUCTURE: close under the last swing low or the 5-day low": o => o.f[5] || o.f[4], "GIVEBACK: gave back half the gain, or 3 ATR from the peak": o => o.f[6] || o.f[7],
  "REVERSAL: bearish engulfing, shooting star or exhaustion candle after a run": o => o.f[11] || o.f[12] || o.f[8], "MOMENTUM: RSI under 50 and MACD histogram under 0 and -DI over +DI": o => o.f[13] && o.x[10] < 0 && o.x[12] > 0,
  "ANY TWO of: volume warning, structure break, giveback, reversal candle": o => [o.f[18] || o.f[19] || o.f[22] || o.f[24], o.f[5] || o.f[4], o.f[6] || o.f[7], o.f[11] || o.f[12] || o.f[8]].filter(Boolean).length >= 2 };
const byTrade = new Map(); for (const o of obs) (byTrade.get(o.trade) || byTrade.set(o.trade, []).get(o.trade)).push(o);
console.log(`\n== alert rules: first alert in each trade (${byTrade.size} trades; ${f2(obs.filter(o => o.xs).length / obs.length * 100, 1)}% base chance of a 5-day Supertrend exit, ${f2(base(obs), 1)}% base chance of a 6% drop in 10 sessions) ==`);
for (const [nm, rule] of Object.entries(RULES)) { const first = []; let fired = 0; for (const [, a] of byTrade) { const hit = a.find(rule); if (hit) first.push(hit); } fired = first.length;
  const dropP = base(first), xsP = first.filter(o => o.xs).length / first.length * 100, leads = first.filter(o => o.lead > 0).map(o => o.lead).sort((a, b) => a - b), chg = first.map(o => (o.exitPx / o.c - 1) * 100), avoided = first.filter(o => o.exitPx < o.c).length / first.length * 100;
  const trTe = [first.filter(o => o.early), first.filter(o => !o.early)].map(a => `${f2(base(a), 0)}% (n ${a.length})`);
  console.log(`  ${nm}\n     fires in ${f2(fired / byTrade.size * 100, 0)}% of trades; after the alert: 6%+ drop within 10d ${f2(dropP, 1)}% (train ${trTe[0]} / test ${trTe[1]}); Supertrend exit within 5d ${f2(xsP, 0)}%; median days to the Supertrend exit ${leads[Math.floor(leads.length / 2)]}; price at the eventual exit vs the alert close: avg ${f2(mean(chg))}%, lower in ${f2(avoided, 0)}% of alerts`); }
