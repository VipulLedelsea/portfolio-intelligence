// IBD-style market outlook backtest: follow-through days, distribution days, and a suggested market exposure (0-100%).
// Data: SPY + QQQ daily bars since 2005 (stand-ins for the S&P 500 and Nasdaq Composite; volume is ETF volume). Exposure set at a close earns the NEXT day's return.
// Cost 0.05% per 100% change of exposure. Rules are the public ones (secondary sources); the state machine and exposure ladder are OUR mapping, not IBD's.
import { readFileSync } from "node:fs";
const raw = JSON.parse(readFileSync("bars_long.json", "utf8"));
const IX = { SPY: raw.SPY, QQQ: raw.QQQ };
const n = IX.SPY.length, D = IX.SPY.map(r => r[0]);
if (IX.QQQ.length !== n || IX.QQQ.some((r, i) => r[0] !== D[i])) throw new Error("date mismatch");
const S = {};
for (const k of ["SPY", "QQQ"]) { const R = IX[k]; const c = R.map(r => r[4]), l = R.map(r => r[3]), v = R.map(r => r[5]);
  const sma = p => c.map((_, i) => { if (i < p - 1) return NaN; let s = 0; for (let j = i - p + 1; j <= i; j++) s += c[j]; return s / p; });
  const hi = c.map((_, i) => { let m = -Infinity; for (let j = Math.max(0, i - 251); j <= i; j++) m = Math.max(m, c[j]); return m; });
  S[k] = { c, l, v, sma50: sma(50), sma200: sma(200), dd: c.map((x, i) => x / hi[i] - 1) }; }
const rawCnt = {}; const WARM = 252, SPLIT = "2016-01-01";

function distCounts(s, P) { const out = new Array(n).fill(0), isD = s.c.map((x, i) => i > 0 && x / s.c[i - 1] - 1 <= -P.distPct && s.v[i] > s.v[i - 1]);
  for (let t = 0; t < n; t++) { let k = 0; for (let i = Math.max(1, t - P.expire + 1); i <= t; i++) if (isD[i] && s.c[t] < s.c[i] * (1 + P.rally5)) k++; out[t] = k; } return out; }

const isDist = (s, P) => s.c.map((x, i) => i > 0 && x / s.c[i - 1] - 1 <= -P.distPct && s.v[i] > s.v[i - 1]);
function run(P) {
  const ID = { SPY: isDist(S.SPY, P), QQQ: isDist(S.QQQ, P) };
  let since = 0; // distribution days before this index are ignored (reset at a follow-through day)
  const cnt = (k, t) => { let c = 0; for (let i = Math.max(1, since, t - P.expire + 1); i <= t; i++) if (ID[k][i] && S[k].c[t] < S[k].c[i] * (1 + P.rally5)) c++; return c; };
  const state = new Array(n).fill(""), expo = new Array(n).fill(0), dist = new Array(n).fill(0), ftds = [];
  let pk = { SPY: 0, QQQ: 0 }, st = "CORR", att = { SPY: null, QQQ: null }, upSince = -1, ftdLow = null, ftdAt = -1;
  const t0 = WARM; { const a = S.SPY, b = S.QQQ; since = t0 - P.expire; st = (a.dd[t0] > -0.05 && b.dd[t0] > -0.05 && a.c[t0] > a.sma200[t0]) ? "UP" : "CORR"; pk = { SPY: S.SPY.c[t0], QQQ: S.QQQ.c[t0] }; if (st === "UP") upSince = t0 - 30; }
  for (let t = t0; t < n; t++) {
    const dmax = Math.max(cnt("SPY", t), cnt("QQQ", t));
    if (st === "CORR") pk = { SPY: S.SPY.c[t], QQQ: S.QQQ.c[t] }; else { pk.SPY = Math.max(pk.SPY, S.SPY.c[t]); pk.QQQ = Math.max(pk.QQQ, S.QQQ.c[t]); }
    const weak = S.SPY.c[t] < S.SPY.sma50[t] && S.QQQ.c[t] < S.QQQ.sma50[t]; // IBD does not call a correction on selling alone: both indexes must also be under their 50-day average
    const dpk = Math.min(S.SPY.c[t] / pk.SPY - 1, S.QQQ.c[t] / pk.QQQ - 1); // fall from the peak since the uptrend began
    if (st === "CORR") {
      for (const k of ["SPY", "QQQ"]) { const s = S[k]; let a = att[k];
        if (a && (s.l[t] < a.low || t - a.day1 + 1 > P.maxDay)) a = null; // undercut the day-1 low, or a stale attempt: start over
        if (!a && s.c[t] > s.c[t - 1]) { a = { day1: t, low: s.l[t] }; }
        att[k] = a; }
      for (const k of ["SPY", "QQQ"]) { const a = att[k], s = S[k]; if (!a) continue; const kday = t - a.day1 + 1;
        if (kday >= 4 && kday <= P.maxDay && s.c[t] / s.c[t - 1] - 1 >= P.ftdGain && s.v[t] > s.v[t - 1] && s.c[t] > a.low) { st = "UP"; upSince = t; since = t + 1; ftdLow = { k, low: s.l[t] }; ftdAt = t; ftds.push({ t, k }); att = { SPY: null, QQQ: null }; break; } }
    } else if (st === "UP") {
      if (dpk <= -P.ddCorr || (dmax >= P.corrAt && (!P.needWeak || weak))) { st = "CORR"; att = { SPY: null, QQQ: null }; }
      else if (ftdLow && t - ftdAt <= 15 && S[ftdLow.k].c[t] < ftdLow.low) { st = "CORR"; att = { SPY: null, QQQ: null }; ftds[ftds.length - 1].failed = true; }
      else if (dmax >= P.pressAt) st = "PRESS";
    } else if (st === "PRESS") {
      if (dpk <= -P.ddCorr || (dmax >= P.corrAt && (!P.needWeak || weak))) { st = "CORR"; att = { SPY: null, QQQ: null }; }
      else if (dmax <= P.pressAt - 2 && S.SPY.c[t] > S.SPY.sma50[t] && S.QQQ.c[t] > S.QQQ.sma50[t]) st = "UP";
    }
    state[t] = st; dist[t] = Math.max(rawCnt.SPY[t], rawCnt.QQQ[t]);
    const age = t - upSince;
    expo[t] = P.binary ? (st === "CORR" ? 0 : 1) : st === "CORR" ? 0.1 : st === "PRESS" ? 0.5 : age < 2 ? 0.4 : age < 5 ? 0.6 : age < 10 ? 0.8 : 1;
  }
  return { state, expo, dist, ftds };
}

const COST = 0.0005;
function perf(e, inst, a, b) { // e: exposure array (set at close t, earns t+1). inst: "SPY"|"QQQ"|"MIX". Range [a,b) of decision days.
  const ret = i => inst === "MIX" ? (S.SPY.c[i] / S.SPY.c[i - 1] + S.QQQ.c[i] / S.QQQ.c[i - 1]) / 2 - 1 : S[inst].c[i] / S[inst].c[i - 1] - 1;
  let eq = 1, pk = 1, mdd = 0, sum = 0, sq = 0, m = 0, expSum = 0; const r = [];
  for (let t = a; t < b - 1; t++) { const x = e[t] * ret(t + 1) - COST * Math.abs(e[t] - (t > a ? e[t - 1] : e[t])); eq *= 1 + x; pk = Math.max(pk, eq); mdd = Math.min(mdd, eq / pk - 1); sum += x; sq += x * x; m++; expSum += e[t]; r.push(x); }
  const yrs = m / 252, mu = sum / m, sd = Math.sqrt(sq / m - mu * mu);
  return { cagr: (eq ** (1 / yrs) - 1) * 100, mdd: mdd * 100, sharpe: mu / sd * Math.sqrt(252), avgExp: expSum / m * 100, calmar: (eq ** (1 / yrs) - 1) / Math.abs(mdd || 1e-9), eq };
}
const f = (x, d = 1) => (+x).toFixed(d);
const row = (name, p) => `${name.padEnd(34)} CAGR ${f(p.cagr).padStart(5)}%  maxDD ${f(p.mdd).padStart(6)}%  Sharpe ${f(p.sharpe, 2)}  avg exposure ${f(p.avgExp, 0).padStart(3)}%  Calmar ${f(p.calmar, 2)}`;
const idx = d => D.findIndex(x => x >= d), iSplit = idx(SPLIT), A = WARM, B = n;
const ones = new Array(n).fill(1), sma = (k, p) => S[k].c.map((x, i) => x > S[k]["sma" + p][i] ? 1 : 0);

const BASE = { ftdGain: 0.0125, distPct: 0.002, expire: 25, rally5: 0.05, pressAt: 5, corrAt: 7, ddCorr: 0.08, maxDay: 30, binary: false, needWeak: true };
for (const k of ["SPY", "QQQ"]) rawCnt[k] = distCounts(S[k], BASE);
const M = run(BASE);
console.log(`Data ${D[A]} .. ${D[n - 1]} (${n - A} sessions), SPY + QQQ. Split train/test at ${SPLIT}.\nBase rules: FTD >=${BASE.ftdGain * 100}% on higher volume on day 4-${BASE.maxDay} of a rally attempt (either index); distribution day = down >=${BASE.distPct * 100}% on higher volume, expires after ${BASE.expire} sessions or +5%; UNDER PRESSURE at ${BASE.pressAt}+ (max of the two indices), CORRECTION at ${BASE.corrAt}+ or ${BASE.ddCorr * 100}% below the 252-day high; back to UP when count <= ${BASE.pressAt - 2} and both indices over the 50-day.\nExposure: CORRECTION 10%, UNDER PRESSURE 50%, UPTREND 40% -> 60% -> 80% -> 100% over the first 10 sessions after the follow-through.\n`);
for (const [lab, a, b] of [["FULL", A, B], ["TRAIN 2006-2015", A, iSplit], ["TEST 2016-2026", iSplit, B]]) {
  console.log(`== ${lab} ==`);
  for (const inst of ["SPY", "QQQ", "MIX"]) {
    console.log(`-- ${inst}`);
    console.log(row("buy & hold", perf(ones, inst, a, b)));
    console.log(row("IBD-style ladder", perf(M.expo, inst, a, b)));
    console.log(row("IBD-style, on/off (CORR=0)", perf(run({ ...BASE, binary: true }).expo, inst, a, b)));
    const k = inst === "MIX" ? "SPY" : inst;
    console.log(row("close over 200-day (on/off)", perf(sma(k, 200), inst, a, b)));
    console.log(row("close over 50-day (on/off)", perf(sma(k, 50), inst, a, b)));
  }
  console.log("");
}

console.log("== Crisis windows (MIX, total return of strategy vs buy & hold) ==");
for (const [lab, a, b] of [["2008 (2008-01..2009-03)", "2008-01-01", "2009-03-09"], ["COVID (2020-02-19..2020-04-30)", "2020-02-19", "2020-04-30"], ["2022 (2022-01..2022-10-14)", "2022-01-03", "2022-10-14"], ["2025 spring (2025-02-19..2025-05-30)", "2025-02-19", "2025-05-30"]]) {
  const x = perf(M.expo, "MIX", idx(a), idx(b)), y = perf(ones, "MIX", idx(a), idx(b)); console.log(`${lab.padEnd(40)} ladder ${f((x.eq - 1) * 100)}%   buy&hold ${f((y.eq - 1) * 100)}%`); }

console.log("\n== Does each state mean what it says? Next-day MIX return by state (annualized mean %, % of days down 1%+) ==");
for (const st of ["UP", "PRESS", "CORR"]) { const r = []; for (let t = A; t < n - 1; t++) if (M.state[t] === st) r.push((S.SPY.c[t + 1] / S.SPY.c[t] + S.QQQ.c[t + 1] / S.QQQ.c[t]) / 2 - 1);
  const mu = r.reduce((s, x) => s + x, 0) / r.length; console.log(`${st.padEnd(6)} days ${String(r.length).padStart(5)} (${f(r.length / (n - 1 - A) * 100, 0)}%)  annualized mean ${f(mu * 252 * 100)}%  days down 1%+: ${f(r.filter(x => x <= -0.01).length / r.length * 100)}%`); }

console.log("\n== Distribution-day count (max of SPY/QQQ) -> forward 20-session SPY: mean return, P(fall of 5%+ from here at any point in 20 sessions) ==");
const fw = (t, h) => S.SPY.c[t + h] / S.SPY.c[t] - 1, mdd20 = t => { let m = 0; for (let j = 1; j <= 20; j++) m = Math.min(m, S.SPY.c[t + j] / S.SPY.c[t] - 1); return m; };
for (const [lab, lo, hi] of [["0-1", 0, 1], ["2-3", 2, 3], ["4-5", 4, 5], ["6-7", 6, 7], ["8+", 8, 99]]) { const ts = []; for (let t = A; t < n - 21; t++) if (M.dist[t] >= lo && M.dist[t] <= hi) ts.push(t);
  if (!ts.length) continue; console.log(`${lab.padEnd(5)} days ${String(ts.length).padStart(5)}  fwd20 mean ${f(ts.reduce((s, t) => s + fw(t, 20), 0) / ts.length * 100, 2)}%  P(-5% within 20d) ${f(ts.filter(t => mdd20(t) <= -0.05).length / ts.length * 100)}%`); }
{ const ts = []; for (let t = A; t < n - 21; t++) ts.push(t); console.log(`all   days ${String(ts.length).padStart(5)}  fwd20 mean ${f(ts.reduce((s, t) => s + fw(t, 20), 0) / ts.length * 100, 2)}%  P(-5% within 20d) ${f(ts.filter(t => mdd20(t) <= -0.05).length / ts.length * 100)}%`); }

console.log("\n== Follow-through days (state CORR -> UP). Forward SPY return and whether it failed (close under the FTD-day low within 15 sessions) ==");
const unc60 = (() => { let s = 0, c = 0; for (let t = A; t < n - 61; t++) { s += fw(t, 60); c++; } return s / c * 100; })();
for (const g of [0.01, 0.0125, 0.017]) { const R = run({ ...BASE, ftdGain: g }); const ev = R.ftds.filter(e => e.t < n - 61);
  const failed = ev.filter(e => e.failed).length, f60 = ev.map(e => fw(e.t, 60) * 100), f20 = ev.map(e => fw(e.t, 20) * 100), mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  console.log(`FTD gain >= ${f(g * 100, 2)}%: events ${ev.length}  failed within 15d ${failed} (${f(failed / ev.length * 100, 0)}%)  fwd20 mean ${f(mean(f20), 2)}%  fwd60 mean ${f(mean(f60), 2)}% (any day: ${f(unc60, 2)}%)  fwd60 > 0: ${f(f60.filter(x => x > 0).length / f60.length * 100, 0)}%`); }
console.log("\nBase-case FTD list (date, index, 20d / 60d forward SPY return, failed?):");
for (const e of M.ftds) console.log(`${D[e.t]} ${e.k}  ${e.t < n - 61 ? f(fw(e.t, 20) * 100, 1).padStart(6) + "% " + f(fw(e.t, 60) * 100, 1).padStart(6) + "%" : "     n/a"}  ${e.failed ? "FAILED" : ""}`);

console.log("\n== Sensitivity (MIX, full period, ladder): under-pressure / correction thresholds x FTD gain. Shown to check it is not a knife-edge, not to pick the best. ==");
console.log("press corr ftd%   CAGR  maxDD Sharpe avgExp");
for (const press of [4, 5, 6, 7]) for (const corr of [7, 8, 9]) for (const g of [0.01, 0.0125, 0.017]) { if (corr <= press) continue; const R = run({ ...BASE, pressAt: press, corrAt: corr, ftdGain: g }), p = perf(R.expo, "MIX", A, B);
  console.log(`${press}     ${corr}    ${f(g * 100, 2).padEnd(5)} ${f(p.cagr).padStart(5)} ${f(p.mdd).padStart(6)} ${f(p.sharpe, 2).padStart(6)} ${f(p.avgExp, 0).padStart(5)}`); }
