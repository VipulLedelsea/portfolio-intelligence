// Intraday test of the two TradingView scripts (research only): HTF Sweep CISD Setups and Atrox Quad Consensus, long side,
// on 5-minute and 15-minute bars (last 60 trading days) and hourly bars (about 3 years), current S&P 500, regular session.
// Signals on a bar close, market entries at the next bar's open, stop first when a bar touches both, positions may be held overnight.
// Cost 0.02% per side (spread only). Every result is compared with random stocks at the same timestamp given the same order and exit,
// and differences are averaged per day.   node --max-old-space-size=12000 backtest45.mjs
import { readFileSync } from "node:fs";
import { atrox } from "./atrox.mjs";
const COST = 0.0002, H = 120;
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN, f2 = (x, p = 2) => Number.isFinite(x) ? x.toFixed(p) : "n/a";
const sdv = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = a => a.length > 2 ? mean(a) / (sdv(a) / Math.sqrt(a.length)) : NaN;
let seed = 777; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
function prep(rows) { const n = rows.length, d = [], o = [], h = [], l = [], c = [], v = []; for (const r of rows) { d.push(r[0]); o.push(r[1]); h.push(r[2]); l.push(r[3]); c.push(r[4]); v.push(r[5]); }
  const tr = h.map((x, i) => i ? Math.max(x - l[i], Math.abs(x - c[i - 1]), Math.abs(l[i] - c[i - 1])) : x - l[i]); const atr14 = new Array(n).fill(NaN); let s = 0; for (let i = 0; i < n; i++) { s += tr[i]; if (i >= 14) s -= tr[i - 14]; if (i >= 13) atr14[i] = s / 14; }
  return { n, d, o, h, l, c, v, tr, atr14 }; }
const mins = d => +d.slice(11, 13) * 60 + +d.slice(14, 16) - 570;
function aggregate(rows, m) { const out = []; let key = null, cur = null; for (const r of rows) { const k = r[0].slice(0, 10) + Math.floor(mins(r[0]) / m); if (k !== key) { cur = [r[0], r[1], r[2], r[3], r[4], 0]; out.push(cur); key = k; } cur[2] = Math.max(cur[2], r[2]); cur[3] = Math.min(cur[3], r[3]); cur[4] = r[4]; cur[5] += r[5]; } return out; }
function load(file, agg) { const raw = JSON.parse(readFileSync(file, "utf8")), list = []; for (const [sym, rows0] of Object.entries(raw)) { if (sym === "SPY") continue; const rows = agg ? aggregate(rows0, agg) : rows0; if (rows.length < 400) continue; if (rows.some((r, i) => i && Math.abs(r[4] / rows[i - 1][4] - 1) > 0.4)) continue; const S = prep(rows); S.sym = sym; list.push(S); }
  const pool = new Map(); for (const S of list) for (let t = 60; t < S.n - H - 2; t++) (pool.get(S.d[t]) || pool.set(S.d[t], []).get(S.d[t])).push([S, t]); return { list, pool }; }
function run(S, f, en, stop, plan, be, fillBarStopOnly) { const risk = en - stop; let s = stop, rem = 1, got = 0, next = 0;
  for (let k = f; k < Math.min(S.n, f + H); k++) { const first = k === f && fillBarStopOnly;
    if (!first && k > f && S.o[k] <= s) { got += rem * (S.o[k] / en - 1); rem = 0; break; }
    if (S.l[k] <= s) { got += rem * (s / en - 1); rem = 0; break; }
    if (first) continue;
    while (next < plan.length && S.h[k] >= en + plan[next][0] * risk) { const px = Math.max(en + plan[next][0] * risk, k > f ? S.o[k] : 0); const fr = next === plan.length - 1 ? rem : plan[next][1]; got += fr * (px / en - 1); rem -= fr; next++; if (be && next === 1) s = en; }
    if (rem <= 1e-9) { rem = 0; break; } }
  if (rem > 0) got += rem * (S.c[Math.min(S.n - 1, f + H - 1)] / en - 1);
  return (got - 2 * COST) * 100; }
const PLANS = [["all out at 1R", [[1, 1]], false], ["all out at 2R", [[2, 1]], false], ["all out at 3R", [[3, 1]], false], ["thirds at 1R/2R/3R, break-even after 1R", [[1, 1 / 3], [2, 1 / 3], [3, 1 / 3]], true]];
const line = (pn, r, per, extra = "") => { const days = new Map(); for (const [d, v] of per) { const k = d.slice(0, 10); let p = days.get(k); if (!p) days.set(k, p = [0, 0]); p[0] += v; p[1]++; } const dd = [...days.values()].map(p => p[0] / p[1]);
  return `   ${pn.padEnd(42)} win ${f2(r.filter(x => x > 0).length / r.length * 100, 1)}%  avg ${f2(mean(r), 3)}%  | vs random same-time stocks, same order: ${f2(mean(dd), 3)}% (t ${f2(tstat(dd), 1)}, ${dd.length} days)${extra}`; };

// ---------- HTF sweep -> breaker (script defaults), long ----------
function sweepSetups(S, htfKey, mode) { const out = [], n = S.n, piv = new Array(n).fill(false); let unf = 0;
  for (let i = 3; i < n - 3; i++) { let ok = true; for (let k = 1; k <= 3; k++) if (S.h[i - k] >= S.h[i] || S.h[i + k] > S.h[i]) { ok = false; break; } piv[i] = ok; }
  let levels = [], curKey = null, curLow = Infinity, ctx = null, nHtf = 0;
  for (let i = 1; i < n - H - 2; i++) { const key = htfKey(S.d[i]);
    if (key !== curKey) { if (curKey !== null && nHtf > 1) { levels.push({ p: curLow }); if (levels.length > 10) levels.shift(); } curKey = key; curLow = Infinity; nHtf++; }
    let swept = false; for (const L of levels) if (!L.taken && S.l[i] < L.p) { L.taken = true; swept = true; } levels = levels.filter(L => !L.taken); curLow = Math.min(curLow, S.l[i]);
    if (swept) ctx = { sw: i, ext: S.l[i], extBar: i };
    if (!ctx) continue; if (i - ctx.sw > 36) { ctx = null; continue; }
    if (S.l[i] < ctx.ext) { ctx.ext = S.l[i]; ctx.extBar = i; }
    const a = S.atr14[i]; if (i < 60 || !(S.c[i] - S.o[i] >= 0.5 * a)) continue;
    let pb = -1; for (let k = ctx.extBar - 1; k >= Math.max(3, ctx.sw - 30); k--) if (piv[k] && k + 3 <= i) { pb = k; break; } if (pb < 0 || !(S.c[i] > S.h[pb])) continue;
    const stop = ctx.ext, e = S.c[pb]; ctx = null;
    if (mode === "market" || S.c[i] <= e) { const en = S.o[i + 1], rk = (S.c[i] - stop) / a; if (!(en > stop) || rk < 0.25 || rk > 3) continue; out.push({ S, i, f: i + 1, en, stop, lim: false }); continue; }
    const rk = (e - stop) / a; if (!(e > stop) || rk < 0.25 || rk > 3) continue; let filled = false;
    for (let k = i + 1; k <= Math.min(n - H - 2, i + 60); k++) { if (S.l[k] <= e) { out.push({ S, i, f: k, en: Math.min(e, S.o[k]), stop, lim: true, gap: S.o[k] <= stop, dPct: 1 - e / S.c[i], sPct: stop / e, wait: k - i }); filled = true; break; } if (S.c[k] < stop) break; }
    if (!filled) unf++; }
  return { out, unf }; }
function sweepReport(U, name, htfKey) { console.log(`\n-- HTF Sweep CISD, ${name}`);
  for (const mode of ["limit", "market"]) { let tr = [], unf = 0; for (const S of U.list) { const r = sweepSetups(S, htfKey, mode); tr = tr.concat(r.out); unf += r.unf; }
    if (mode === "limit") console.log(`  script default entry (limit at the breaker candle's close): ${tr.length + unf} setups, ${f2(unf / (tr.length + unf) * 100, 0)}% never filled, ${tr.filter(x => x.gap).length} opened below the stop, average wait ${f2(mean(tr.filter(x => x.lim).map(x => x.wait)), 1)} bars, average stop distance ${f2(mean(tr.map(x => (1 - x.stop / x.en) * 100)), 2)}%`);
    else console.log(`  market entry at the next bar's open: ${tr.length} trades, average stop distance ${f2(mean(tr.map(x => (1 - x.stop / x.en) * 100)), 2)}%`);
    if (tr.length < 50) continue;
    for (const [pn, plan, be] of PLANS) { const r = [], per = [];
      for (const x of tr) { const v = x.gap ? -2 * COST * 100 : run(x.S, x.f, x.en, x.stop, plan, be, x.lim); r.push(v); const pool = U.pool.get(x.S.d[x.i]) || [], cs = [];
        for (let q = 0; q < 5 && pool.length; q++) { const [S2, t2] = pool[Math.floor(rnd() * pool.length)];
          if (!x.lim) { const e2 = S2.o[t2 + 1]; cs.push(run(S2, t2 + 1, e2, e2 * (x.stop / x.en), plan, be, false)); }
          else { const e2 = S2.c[t2] * (1 - x.dPct), st2 = e2 * x.sPct; for (let k = t2 + 1; k <= Math.min(S2.n - H - 2, t2 + 60); k++) { if (S2.l[k] <= e2) { cs.push(S2.o[k] <= st2 ? -2 * COST * 100 : run(S2, k, Math.min(e2, S2.o[k]), st2, plan, be, true)); break; } if (S2.c[k] < st2) break; } } }
        if (cs.length) per.push([x.S.d[x.i], v - mean(cs)]); }
      console.log(line(pn, r, per)); } } }

// ---------- Atrox consensus, long ----------
const AX = [["script defaults (Raptor+Scalper+Elite within 15 bars)", "axDefault"], ["all 4 engines, 3 of 4 within 15 bars", "axAll3"], ["Balanced preset (3 of 4 within 5)", "axBalanced"], ["Conservative preset (4 of 4 within 3, score 70)", "axConservative"], ["Aggressive preset (3 of 4 within 7, score 50)", "axAggressive"], ["Scalping preset (2 of 4 within 4, score 55)", "axTwo"]];
const AXEX = [["target 1.5 ATR, stop 1 ATR", 1, 1.5], ["target 3 ATR, stop 1 ATR (1:3)", 1, 3], ["target 2 ATR, stop 2 ATR", 2, 1], ["script default: target 2.5 ATR, stop 12 ATR", 12, 2.5 / 12]];
function atroxReport(U, name) { console.log(`\n-- Atrox Quad Consensus, ${name}`); const sig = new Map(AX.map(a => [a[1], []])), eng = [[], [], [], []];
  for (const S of U.list) { const X = atrox(S); for (let t = 420; t < S.n - H - 2; t++) { for (const [, k] of AX) if (X[k][t]) sig.get(k).push([S, t]); for (let e = 0; e < 4; e++) if (X.axL[e][t]) eng[e].push([S, t]); } }
  const rep = (nm, list) => { console.log(`  ${nm}: ${list.length} signals`); if (list.length < 50) return;
    for (const [en, sl, R] of AXEX) { const r = [], per = []; for (const [S, t] of list) { const a = S.atr14[t], e = S.o[t + 1]; if (!(a > 0) || e - sl * a <= 0) continue; const v = run(S, t + 1, e, e - sl * a, [[R, 1]], false, false); r.push(v);
        const pool = U.pool.get(S.d[t]) || [], cs = []; for (let q = 0; q < 5 && pool.length; q++) { const [S2, t2] = pool[Math.floor(rnd() * pool.length)]; const a2 = S2.atr14[t2], e2 = S2.o[t2 + 1]; if (a2 > 0 && e2 - sl * a2 > 0) cs.push(run(S2, t2 + 1, e2, e2 - sl * a2, [[R, 1]], false, false)); }
        if (cs.length) per.push([S.d[t], v - mean(cs)]); }
      console.log(line(en, r, per)); } };
  ["AtroNox", "Raptor", "Scalper", "Elite"].forEach((nm, e) => rep("engine alone: " + nm, eng[e])); for (const [nm, k] of AX) rep("consensus: " + nm, sig.get(k)); }

const hKey = m => d => d.slice(0, 10) + "|" + Math.floor(mins(d) / m), dKey = d => d.slice(0, 10);
for (const [name, file, agg, key, htfName] of [["5-minute chart, 60 trading days", "bars_5m.json", 0, hKey(60), "1-hour HTF (script pairing)"], ["15-minute chart, 60 trading days", "bars_5m.json", 15, hKey(240), "4-hour HTF (script pairing)"], ["hourly chart, about 3 years", "bars_1h.json", 0, dKey, "daily HTF (script pairing)"]]) {
  const U = load(file, agg); console.log(`\n================ ${name}: ${U.list.length} stocks, ${U.list[0].d[0]} to ${U.list[0].d.at(-1)}, average bar range (ATR14) ${f2(mean(U.list.map(S => S.atr14[S.n - 1] / S.c[S.n - 1] * 100)), 2)}% of price ================`);
  sweepReport(U, htfName, key); atroxReport(U, name); }
