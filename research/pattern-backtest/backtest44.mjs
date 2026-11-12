// Two follow-ups on 20 years of point-in-time S&P 500 daily bars (research only):
//  A. "HTF Sweep CISD Setups [WillyAlgoTrader]" (TradingView M0FCXfZC), default long setup rebuilt from its published source, on a DAILY chart.
//     The script is built for 1m-15m charts; on a daily chart its own auto-pairing uses the MONTHLY candle as the higher timeframe. Weekly is tested too.
//  B. The daily double bottom with its own stop and measured-move target, looked at closely: halves, years, matched control, portfolio.
// Entry fills are simulated on daily bars, stop first when a bar touches both, 0.1% cost per side.
// node --max-old-space-size=12000 backtest44.mjs
import { data, memberAt, SPY, mean, f2, COST } from "./lib41.mjs";
import { addPivots, detect } from "./patterns43.mjs";
const WARM = 260, SPLIT = "2017-01-01"; data.delete("QQQ");
const sdv = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = a => a.length > 2 ? mean(a) / (sdv(a) / Math.sqrt(a.length)) : NaN;
let seed = 4242; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const stocks = [...data.entries()].filter(([s]) => s !== "SPY");
const byDate = new Map(); // SPY date index -> [[S, t]] of members
for (const [sym, S] of stocks) for (let t = WARM; t < S.n - 62; t++) { if (!memberAt(sym, S.d[t]) || S.hasBad(t - 255, t + 61)) continue; const j = SPY.dateIdx.get(S.d[t]); if (j !== undefined) (byDate.get(j) || byDate.set(j, []).get(j)).push([S, t]); }

// A trade from a known fill. plan = [[R multiple, fraction], ...]; be = move the stop to entry after the first target. Returns percent, net of costs.
function run(S, f, en, stop, plan, be, H, fillBarStopOnly) { const risk = en - stop; let s = stop, rem = 1, got = 0, next = 0;
  for (let k = f; k < Math.min(S.n, f + H); k++) { const first = k === f && fillBarStopOnly;
    if (!first && k > f && S.o[k] <= s) { got += rem * (S.o[k] / en - 1); rem = 0; break; }
    if (S.l[k] <= s) { got += rem * (s / en - 1); rem = 0; break; }
    if (first) continue;
    while (next < plan.length && S.h[k] >= en + plan[next][0] * risk) { const px = Math.max(en + plan[next][0] * risk, k > f ? S.o[k] : 0); const fr = next === plan.length - 1 ? rem : plan[next][1]; got += fr * (px / en - 1); rem -= fr; next++; if (be && next === 1) s = en; }
    if (rem <= 1e-9) { rem = 0; break; } }
  if (rem > 0) got += rem * (S.c[Math.min(S.n - 1, f + H - 1)] / en - 1);
  return (got - 2 * COST) * 100; }
const PLANS = [["all out at 1R", [[1, 1]], false], ["all out at 2R", [[2, 1]], false], ["all out at 3R", [[3, 1]], false], ["thirds at 1R/2R/3R, break-even after 1R (script)", [[1, 1 / 3], [2, 1 / 3], [3, 1 / 3]], true]];
// summary with a same-day control: K random members bought at the next open with the same stop distance (percent of entry) and the same plan
function summarize(name, trades, H, K = 10) { // trades: {S, j (SPY date idx of the signal), f, en, stop, lim}
  console.log(`${name}: ${trades.length} trades, ${new Set(trades.map(x => x.j)).size} dates`); if (trades.length < 30) return;
  for (const [pn, plan, be] of PLANS) { const r = [], per = new Map(), rr = [];
    for (const x of trades) { const v = x.gap ? -2 * COST * 100 : run(x.S, x.f, x.en, x.stop, plan, be, H, x.lim); const pct = x.gap ? 0.03 : 1 - x.stop / x.en, pool = byDate.get(x.j) || [], cs = [];
      for (let i = 0; i < K && pool.length; i++) { const [S2, t2] = pool[Math.floor(rnd() * pool.length)]; const e2 = S2.o[t2 + 1]; cs.push(run(S2, t2 + 1, e2, e2 * (1 - pct), plan, be, H, false)); }
      r.push(v); rr.push(v / (pct * 100)); if (cs.length) { let p = per.get(x.j); if (!p) per.set(x.j, p = [0, 0]); p[0] += v - mean(cs); p[1]++; } }
    const a = [], b = []; for (const [j, p] of per) (SPY.d[j] >= SPLIT ? b : a).push(p[0] / p[1]); const all = a.concat(b), w = r.filter(x => x > 0);
    console.log(`   ${pn.padEnd(48)} win ${f2(w.length / r.length * 100, 1)}%  avg ${f2(mean(r))}%  avg R ${f2(mean(rr))}  | vs random same-day stocks ${f2(mean(all))}% (t ${f2(tstat(all), 1)})  2006-16 ${f2(mean(a))}%  2017-26 ${f2(mean(b))}%`); } }

// ================= A. HTF sweep -> breaker (script defaults) =================
function sweepSetups(S, sym, htfKey, mode) { const out = [], n = S.n; const piv = new Array(n).fill(false);
  for (let i = 3; i < n - 3; i++) { let ok = true; for (let k = 1; k <= 3; k++) if (S.h[i - k] >= S.h[i] || S.h[i + k] > S.h[i]) { ok = false; break; } piv[i] = ok; }
  let levels = [], curKey = null, curLow = Infinity, ctx = null, nHtf = 0;
  for (let i = 1; i < n - 62; i++) { const key = htfKey(S.d[i]);
    if (key !== curKey) { if (curKey !== null && nHtf > 1) { levels.push({ p: curLow }); if (levels.length > 10) levels.shift(); } curKey = key; curLow = Infinity; nHtf++; }
    let swept = false; for (const L of levels) if (!L.taken && S.l[i] < L.p) { L.taken = true; swept = true; } levels = levels.filter(L => !L.taken); curLow = Math.min(curLow, S.l[i]);
    if (swept) ctx = { sw: i, ext: S.l[i], extBar: i };
    if (!ctx) continue; if (i - ctx.sw > 36) { ctx = null; continue; }
    if (S.l[i] < ctx.ext) { ctx.ext = S.l[i]; ctx.extBar = i; }
    if (i < WARM || !memberAt(sym, S.d[i]) || S.hasBad(i - 255, i + 61)) continue;
    const a = S.atr14[i]; if (!(S.c[i] - S.o[i] >= 0.5 * a)) continue;
    let pb = -1; for (let k = ctx.extBar - 1; k >= Math.max(3, ctx.sw - 30); k--) if (piv[k] && k + 3 <= i) { pb = k; break; } if (pb < 0 || !(S.c[i] > S.h[pb])) continue;
    const j = SPY.dateIdx.get(S.d[i]); if (j === undefined) { ctx = null; continue; }
    const stop = ctx.ext; let e = S.c[pb]; ctx = null;
    if (mode === "market" || S.c[i] <= e) { const en = S.o[i + 1]; if (!(en > stop)) continue; const rk = (S.c[i] - stop) / a; if (rk < 0.25 || rk > 3) continue; out.push({ S, j, f: i + 1, en, stop, lim: false, mkt: true }); continue; }
    if (!(e > stop)) continue; const rk = (e - stop) / a; if (rk < 0.25 || rk > 3) continue;
    let filled = false; for (let k = i + 1; k <= Math.min(n - 62, i + 60); k++) { if (S.l[k] <= e) { const jf = SPY.dateIdx.get(S.d[k - 1]); if (jf !== undefined) out.push({ S, j: jf, f: k, en: Math.min(e, S.o[k]), stop, lim: true, mkt: false, wait: k - i, gap: S.o[k] <= stop, j0: j, dPct: 1 - e / S.c[i], sPct: stop / e, y: S.d[k].slice(0, 4), sym }); filled = true; break; } if (S.c[k] < stop) break; }
    out.push.n = (out.push.n || 0); if (!filled) out.unfilled = (out.unfilled || 0) + 1; }
  return out; }

// Fair control for the limit entry: random members on the SIGNAL date given the same resting order (limit the same percent under the close,
// stop the same percent under the limit, same 60-bar expiry and cancel rule). Only filled orders are compared.
function limitControl(trades, plan, be, K = 10) { const per = new Map(); let cf = 0, ct = 0;
  for (const x of trades) { const pool = byDate.get(x.j0) || [], cs = [];
    for (let q = 0; q < K && pool.length; q++) { const [S2, t2] = pool[Math.floor(rnd() * pool.length)]; const e2 = S2.c[t2] * (1 - x.dPct), st2 = e2 * x.sPct; ct++;
      for (let k = t2 + 1; k <= Math.min(S2.n - 62, t2 + 60); k++) { if (S2.l[k] <= e2) { cf++; cs.push(S2.o[k] <= st2 ? -2 * COST * 100 : run(S2, k, Math.min(e2, S2.o[k]), st2, plan, be, 60, true)); break; } if (S2.c[k] < st2) break; } }
    if (!cs.length) continue; const v = x.gap ? -2 * COST * 100 : run(x.S, x.f, x.en, x.stop, plan, be, 60, true); let p = per.get(x.j0); if (!p) per.set(x.j0, p = [0, 0, 0]); p[0] += v - mean(cs); p[1]++; p[2] += mean(cs); }
  const a = [], b = [], c = []; for (const [j, p] of per) { (SPY.d[j] >= SPLIT ? b : a).push(p[0] / p[1]); c.push(p[2] / p[1]); } const all = a.concat(b);
  return `control avg ${f2(mean(c))}% (fill rate ${f2(cf / ct * 100, 0)}%), difference ${f2(mean(all))}% (t ${f2(tstat(all), 1)})  2006-16 ${f2(mean(a))}%  2017-26 ${f2(mean(b))}%`; }
// Portfolio for the limit version: 10 equal slots, a fill is taken only if a slot is free, all out at 2R, stop at the swept low, 60-bar limit.
function sweepPortfolio(trades, R) { const byFill = new Map(); for (const x of trades) { const j = SPY.dateIdx.get(x.S.d[x.f]); if (j !== undefined) (byFill.get(j) || byFill.set(j, []).get(j)).push(x); }
  let cash = 1, pos = [], eq = [], nTr = 0, nWin = 0, expo = 0; const byY = {}; let prevEq = 1;
  for (let j = WARM; j < SPY.n; j++) { const d = SPY.d[j];
    pos = pos.filter(p => { const t = p.S.dateIdx.get(d); if (t === undefined) return true; let px = NaN; if (S_o(p, t) <= p.stop) px = p.S.o[t]; else if (p.S.l[t] <= p.stop) px = p.stop; else if (p.S.o[t] >= p.tgt) px = p.S.o[t]; else if (p.S.h[t] >= p.tgt) px = p.tgt; else if (t - p.f >= 59) px = p.S.c[t];
      if (Number.isFinite(px)) { cash += p.sh * px * (1 - COST); nTr++; if (px * (1 - COST) ** 2 > p.en) nWin++; return false; } p.last = p.S.c[t]; return true; });
    const fills = (byFill.get(j) || []).slice().sort(() => rnd() - 0.5), eqNow = cash + pos.reduce((s, p) => s + p.sh * p.last, 0);
    for (const x of fills) { if (pos.length >= 10) break; const amt = Math.min(cash, eqNow / 10); if (amt <= 1e-9) break; if (x.gap) { cash -= amt * 2 * COST; nTr++; continue; } cash -= amt; const p = { S: x.S, f: x.f, en: x.en, stop: x.stop, tgt: x.en + R * (x.en - x.stop), sh: amt * (1 - COST) / x.en, last: x.S.c[x.f] };
      if (x.S.l[x.f] <= p.stop) { cash += p.sh * p.stop * (1 - COST); nTr++; } else pos.push(p); }
    const inv = pos.reduce((s, p) => s + p.sh * p.last, 0), e = cash + inv; eq.push(e); expo += inv / e; const y = d.slice(0, 4); if (j === SPY.n - 1 || SPY.d[j + 1].slice(0, 4) !== y) { byY[y] = (e / prevEq - 1) * 100; prevEq = e; } }
  const yrs = eq.length / 252; let pk = 0, dd = 0; for (const v of eq) { pk = Math.max(pk, v); dd = Math.max(dd, 1 - v / pk); }
  return `${f2((eq.at(-1) ** (1 / yrs) - 1) * 100, 1)}% a year, worst drop ${f2(dd * 100, 0)}%, ${nTr} trades, win ${f2(nWin / nTr * 100, 1)}%, invested ${f2(expo / eq.length * 100, 0)}%\n      by year: ${Object.keys(byY).sort().map(y => y.slice(2) + ": " + f2(byY[y], 0)).join("  ")}`; }
const S_o = (p, t) => t > p.f ? p.S.o[t] : Infinity;
const wkKey = d => Math.floor((Date.parse(d) / 864e5 + 3) / 7), moKey = d => d.slice(0, 7);
console.log("=== A. HTF Sweep CISD Setups, default long setup (sweep of a higher-timeframe low, then a displacement close over the last swing high = breaker; stop at the swept low) ===");
for (const [hn, key] of [["monthly HTF (the script's own pairing for a daily chart)", moKey], ["weekly HTF", wkKey]]) for (const mode of ["limit", "market"]) {
  let all = [], unf = 0; for (const [sym, S] of stocks) { const r = sweepSetups(S, sym, key, mode); unf += r.unfilled || 0; all = all.concat(r); }
  if (mode === "limit") { const lim = all.filter(x => x.lim); console.log(`\n-- ${hn}, script default entry (limit at the breaker candle's close, cancelled after 60 bars): ${all.length + unf} setups, ${unf} never filled (${f2(unf / (all.length + unf) * 100, 0)}%), ${all.length - lim.length} entered at once, average wait for a fill ${f2(mean(lim.map(x => x.wait)), 1)} days`); }
  else console.log(`\n-- ${hn}, market entry at the next open`);
  console.log(`   fills that opened below the stop (sold at once for the cost only): ${all.filter(x => x.gap).length}`); summarize("   all", all, 60);
  if (mode === "limit") { for (const [pn, plan, be] of PLANS) console.log(`   FAIR CONTROL (same resting order on random stocks) ${pn}: ` + limitControl(all, plan, be));
    for (const R of [2, 3]) console.log(`   PORTFOLIO, 10 slots, all out at ${R}R: ` + sweepPortfolio(all, R)); const yy = {}; for (const x of all) { (yy[x.y] ||= []).push(x.gap ? -0.2 : run(x.S, x.f, x.en, x.stop, [[2, 1]], false, 60, true)); } console.log("   by year, all out at 2R (n / avg %): " + Object.keys(yy).sort().map(y => `${y.slice(2)}: ${yy[y].length} / ${f2(mean(yy[y]), 1)}`).join("  ")); }
  const sp = j => SPY.c[j] > SPY.sma200[j]; summarize("   only while SPY is above its 200-day", all.filter(x => sp(x.j)), 60); }

// ================= B. double bottom =================
console.log("\n=== B. Daily double bottom, own stop (the lower of the two lows) and measured-move target, 40-day limit, entry next open ===");
const db = []; for (const [sym, S] of stocks) { addPivots(S); let last = -99;
  for (let t = WARM; t < S.n - 62; t++) { if (!memberAt(sym, S.d[t]) || S.hasBad(t - 255, t + 61)) continue; const j = SPY.dateIdx.get(S.d[t]); if (j === undefined) continue;
    for (const ev of detect(S, t)) if (ev.name === "Double bottom" && ev.dir === 1 && t - last > 5) { last = t; const en = S.o[t + 1], c = S.c[t]; const stop = Math.min(en * 0.998, ev.stop), tgt = Math.max(en * 1.002, ev.target); db.push({ sym, S, t, j, en, stop, tgt, rr: (tgt - en) / (en - stop), y: S.d[t].slice(0, 4) }); } } }
const one = (S, f, en, stop, tgt, H) => run(S, f, en, stop, [[(tgt - en) / (en - stop), 1]], false, H, false);
function dbStats(name, list, K = 20) { const r = [], per = new Map();
  for (const x of list) { const v = one(x.S, x.t + 1, x.en, x.stop, x.tgt, 40); r.push(v); const sp = x.stop / x.en, tp = x.tgt / x.en, pool = byDate.get(x.j) || [], cs = [];
    for (let i = 0; i < K && pool.length; i++) { const [S2, t2] = pool[Math.floor(rnd() * pool.length)]; const e2 = S2.o[t2 + 1]; cs.push(one(S2, t2 + 1, e2, e2 * sp, e2 * tp, 40)); }
    x.v = v; x.ctl = mean(cs); let p = per.get(x.j); if (!p) per.set(x.j, p = [0, 0]); p[0] += v - x.ctl; p[1]++; }
  const d = [...per.values()].map(p => p[0] / p[1]), w = r.filter(x => x > 0), l = r.filter(x => x <= 0);
  console.log(`${name.padEnd(46)} n ${String(r.length).padStart(5)}  win ${f2(w.length / r.length * 100, 1)}%  avg ${f2(mean(r))}%  avgWin ${f2(mean(w))}%  avgLoss ${f2(mean(l))}%  reward:risk ${f2(mean(list.map(x => x.rr)), 2)}  | random same-day stocks, same levels: win ${f2(list.filter(x => x.ctl > 0).length / list.length * 100, 0)}% of sets positive, avg ${f2(mean(list.map(x => x.ctl)))}%  | difference ${f2(mean(d))}% (t ${f2(tstat(d), 1)})`); }
dbStats("all", db); dbStats("2006-2016", db.filter(x => x.y < "2017")); dbStats("2017-2026", db.filter(x => x.y >= "2017"));
dbStats("SPY above its 200-day", db.filter(x => SPY.c[x.j] > SPY.sma200[x.j])); dbStats("SPY below its 200-day", db.filter(x => SPY.c[x.j] <= SPY.sma200[x.j]));
dbStats("reward:risk 1.0 or better", db.filter(x => x.rr >= 1)); dbStats("reward:risk under 1.0", db.filter(x => x.rr < 1));
console.log("by year (n / avg % / avg of matched random): " + [...new Set(db.map(x => x.y))].sort().map(y => { const a = db.filter(x => x.y === y); return `${y.slice(2)}: ${a.length} / ${f2(mean(a.map(x => x.v)), 1)} / ${f2(mean(a.map(x => x.ctl)), 1)}`; }).join("  "));
// same entries, simple fixed exits
for (const [nm, tp, sl, H] of [["+5% / -3% / 10d", 5, 3, 10], ["+9% / -3% / 20d", 9, 3, 20]]) { const r = db.map(x => one(x.S, x.t + 1, x.en, x.en * (1 - sl / 100), x.en * (1 + tp / 100), H)); const c = db.map(x => { const pool = byDate.get(x.j); const cs = []; for (let i = 0; i < 20; i++) { const [S2, t2] = pool[Math.floor(rnd() * pool.length)]; const e2 = S2.o[t2 + 1]; cs.push(one(S2, t2 + 1, e2, e2 * (1 - sl / 100), e2 * (1 + tp / 100), H)); } return mean(cs); });
  console.log(`same entries with ${nm}: win ${f2(r.filter(x => x > 0).length / r.length * 100, 1)}%  avg ${f2(mean(r))}%  random same-day ${f2(mean(c))}%`); }
// portfolio: 10 equal slots
{ const dates = SPY.d.slice(WARM), bySig = new Map(); for (const x of db) (bySig.get(x.j) || bySig.set(x.j, []).get(x.j)).push(x);
  let cash = 1, pos = [], eq = [], nTr = 0, nWin = 0, expo = 0;
  for (let j = WARM; j < SPY.n; j++) { const d = SPY.d[j];
    pos = pos.filter(p => { const t = p.S.dateIdx.get(d); if (t === undefined) return true; let px = NaN; if (t > p.f && p.S.o[t] <= p.stop) px = p.S.o[t]; else if (p.S.l[t] <= p.stop) px = p.stop; else if (t > p.f && p.S.o[t] >= p.tgt) px = p.S.o[t]; else if (p.S.h[t] >= p.tgt) px = p.tgt; else if (t - p.f >= 39) px = p.S.c[t];
      if (Number.isFinite(px)) { cash += p.sh * px * (1 - COST); nTr++; if (px * (1 - COST) ** 2 > p.en) nWin++; return false; } p.last = p.S.c[t]; return true; });
    const sig = bySig.get(j - 1) || []; const eqNow = cash + pos.reduce((s, p) => s + p.sh * p.last, 0);
    for (const x of sig) { if (pos.length >= 10) break; const t = x.S.dateIdx.get(d); if (t !== x.t + 1) continue; const amt = Math.min(cash, eqNow / 10); if (amt <= 1e-9) break; cash -= amt; const p = { S: x.S, f: t, en: x.en, stop: x.stop, tgt: x.tgt, sh: amt * (1 - COST) / x.en, last: x.S.c[t] };
      let px = NaN; if (x.S.l[t] <= p.stop) px = p.stop; else if (x.S.h[t] >= p.tgt) px = p.tgt; if (Number.isFinite(px)) { cash += p.sh * px * (1 - COST); nTr++; if (px * (1 - COST) ** 2 > p.en) nWin++; } else pos.push(p); }
    const inv = pos.reduce((s, p) => s + p.sh * p.last, 0); eq.push(cash + inv); expo += inv / (cash + inv); }
  const yrs = eq.length / 252; let pk = 0, dd = 0; for (const v of eq) { pk = Math.max(pk, v); dd = Math.max(dd, 1 - v / pk); } const spy = SPY.c.slice(WARM - 1);
  console.log(`portfolio, 10 equal slots, every double bottom taken while a slot is free: ${f2((eq.at(-1) ** (1 / yrs) - 1) * 100, 1)}% a year, worst drop ${f2(dd * 100, 0)}%, ${nTr} trades, win ${f2(nWin / nTr * 100, 1)}%, invested ${f2(expo / eq.length * 100, 0)}% of the time on average  (SPY ${f2(((spy.at(-1) / spy[0]) ** (252 / (spy.length - 1)) - 1) * 100, 1)}% a year)`);
  console.log(`signals per year: ${f2(db.length / yrs, 0)} across the whole index`); }
