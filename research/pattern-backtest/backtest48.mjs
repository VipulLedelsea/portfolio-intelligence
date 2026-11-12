// Residual momentum as a ranking signal (from "151 Trading Strategies", section 3.7; Blitz, Huij and Martens 2011).
// Point-in-time S&P 500 on the 20-year bars. Every 21st trading day each member gets:
//   MOM      plain 12-1 month momentum: close 21 days ago / close 252 days ago - 1
//   MOM/VOL  the same divided by the stock's daily volatility over that window (control: is any gain just the volatility scaling?)
//   RMOM-M   residual momentum against the market: daily return regressed on SPY over the last 756 days (with intercept);
//            the residuals from day -252 to day -21 are summed and divided by their standard deviation
//   RMOM-MS  the same against SPY and the stock's sector average (equal weight, the stock itself left out)
// Part 1: does the signal rank the next 21 trading days (next open to the close 21 days on)? Rank IC, top fifth minus the universe, top minus bottom fifth.
// Part 2: does it sort the app's Supertrend flips (win rate and average, Supertrend-line exit, 0.1% cost per side)?
// Run: node --max-old-space-size=6000 backtest48.mjs > backtest48.out
import { data, SPY, memberAt, secOf, exitSim, stats, mean, f2, WARM } from "./lib41.mjs";
const N = SPY.n, cal = SPY.d, EST = 756, STEP = 21, FIRST = 780;
const syms = [...data.keys()].filter(s => s !== "SPY" && s !== "QQQ");
const sdev = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };

// daily returns aligned to the SPY calendar
const R = new Map(), IX = new Map();
for (const s of syms) { const S = data.get(s), r = new Float64Array(N).fill(NaN), ix = new Int32Array(N).fill(-1);
  for (let j = 0; j < N; j++) { const t = S.dateIdx.get(cal[j]); if (t === undefined) continue; ix[j] = t; if (t > 0 && j > 0 && S.d[t - 1] === cal[j - 1] && Math.abs(S.c[t] / S.c[t - 1] - 1) <= 0.35) r[j] = S.c[t] / S.c[t - 1] - 1; }
  R.set(s, r); IX.set(s, ix); }
const mkt = new Float64Array(N); for (let j = 1; j < N; j++) mkt[j] = SPY.c[j] / SPY.c[j - 1] - 1;
const secSum = new Map(), secCnt = new Map();
for (const s of syms) { const sec = secOf(s); if (!sec) continue; if (!secSum.has(sec)) { secSum.set(sec, new Float64Array(N)); secCnt.set(sec, new Int32Array(N)); }
  const a = secSum.get(sec), c = secCnt.get(sec), r = R.get(s); for (let j = 0; j < N; j++) if (r[j] === r[j]) { a[j] += r[j]; c[j]++; } }

// residual momentum score at calendar index j (uses returns up to j - 21 for the score, up to j for nothing else)
function rmom(sym, j, useSector) {
  const y = R.get(sym), sec = secOf(sym); if (useSector && !sec) return NaN;
  const sS = useSector ? secSum.get(sec) : null, sC = useSector ? secCnt.get(sec) : null;
  const x2 = k => (sS[k] - y[k]) / (sC[k] - 1);
  let n = 0, my = 0, m1 = 0, m2 = 0;
  for (let k = j - EST + 1; k <= j - STEP; k++) { if (y[k] !== y[k] || (useSector && sC[k] < 6)) continue; n++; my += y[k]; m1 += mkt[k]; if (useSector) m2 += x2(k); }
  if (n < 650) return NaN; my /= n; m1 /= n; m2 /= n;
  let s11 = 0, s22 = 0, s12 = 0, s1y = 0, s2y = 0;
  for (let k = j - EST + 1; k <= j - STEP; k++) { if (y[k] !== y[k] || (useSector && sC[k] < 6)) continue; const a = mkt[k] - m1, b = useSector ? x2(k) - m2 : 0, c = y[k] - my; s11 += a * a; s22 += b * b; s12 += a * b; s1y += a * c; s2y += b * c; }
  let b1, b2 = 0; if (useSector) { const det = s11 * s22 - s12 * s12; if (!(det > 1e-12)) return NaN; b1 = (s22 * s1y - s12 * s2y) / det; b2 = (s11 * s2y - s12 * s1y) / det; } else b1 = s1y / s11;
  const a0 = my - b1 * m1 - b2 * m2, e = [];
  for (let k = j - 252 + 1; k <= j - STEP; k++) { if (y[k] !== y[k] || (useSector && sC[k] < 6)) continue; e.push(y[k] - a0 - b1 * mkt[k] - (useSector ? b2 * x2(k) : 0)); }
  if (e.length < 200) return NaN; const sd = sdev(e); return sd > 0 ? e.reduce((s, x) => s + x, 0) / (sd * Math.sqrt(e.length)) : NaN;
}
const SIG = ["MOM", "MOM/VOL", "RMOM-M", "RMOM-MS"];
const rankOf = v => { const o = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]), r = new Array(v.length); for (let i = 0; i < o.length; i++) r[o[i][1]] = i; return r; };
const corr = (a, b) => { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / Math.sqrt(da * db); };

// ---- Part 1: monthly cross-sections ----
const per = []; // { date, sig: { name: { ic, top, spread, hitTop, n } } }
const pctAt = new Map(); // `${sym}|${j}` -> { name: percentile 0..1 }
for (let j = FIRST; j + STEP < N; j += STEP) {
  const rows = [];
  for (const s of syms) { if (!memberAt(s, cal[j])) continue; const ix = IX.get(s), t = ix[j]; if (t < 760 || ix[j + STEP] !== t + STEP || ix[j - 252] !== t - 252) continue; const S = data.get(s);
    if (S.hasBad(t - 756, t + STEP)) continue;
    const mom = S.c[t - STEP] / S.c[t - 252] - 1, y = R.get(s), w = []; for (let k = j - 252 + 1; k <= j - STEP; k++) if (y[k] === y[k]) w.push(y[k]);
    const fwd = (S.c[t + STEP] / S.o[t + 1] - 1) * 100;
    rows.push({ s, fwd, v: { "MOM": mom, "MOM/VOL": w.length > 200 ? mom / sdev(w) : NaN, "RMOM-M": rmom(s, j, false), "RMOM-MS": rmom(s, j, true) } }); }
  if (rows.length < 200) continue;
  const rec = { date: cal[j], sig: {} };
  for (const name of SIG) { const u = rows.filter(r => Number.isFinite(r.v[name])); if (u.length < 150) continue;
    const rk = rankOf(u.map(r => r.v[name])), fr = rankOf(u.map(r => r.fwd)), uni = mean(u.map(r => r.fwd)), q = u.length / 5;
    const top = u.filter((r, i) => rk[i] >= u.length - q), bot = u.filter((r, i) => rk[i] < q);
    rec.sig[name] = { ic: corr(rk, fr), top: mean(top.map(r => r.fwd)) - uni, spread: mean(top.map(r => r.fwd)) - mean(bot.map(r => r.fwd)), hitTop: top.filter(r => r.fwd > 0).length / top.length * 100, hitUni: u.filter(r => r.fwd > 0).length / u.length * 100, n: u.length };
    u.forEach((r, i) => { const k = `${r.s}|${j}`; (pctAt.get(k) || pctAt.set(k, {}).get(k))[name] = (rk[i] + 0.5) / u.length; }); }
  // overlap of the top fifths: how different is residual momentum from plain momentum?
  const both = rows.filter(r => Number.isFinite(r.v["MOM"]) && Number.isFinite(r.v["RMOM-MS"])); if (both.length > 150) rec.rho = corr(rankOf(both.map(r => r.v["MOM"])), rankOf(both.map(r => r.v["RMOM-MS"])));
  per.push(rec);
}
const tstat = a => mean(a) / (sdev(a) / Math.sqrt(a.length));
const ERAS = [["all", "0000", "9999"], ["2008-2012", "2008", "2013"], ["2013-2017", "2013", "2018"], ["2018-2022", "2018", "2023"], ["2023-2026", "2023", "9999"]];
console.log(`Part 1: ${per.length} monthly cross-sections, ${per[0].date} to ${per.at(-1).date}, average ${f2(mean(per.map(p => p.sig.MOM?.n || 0)), 0)} stocks each. Forward = next open to the close 21 trading days on, in %.`);
console.log(`Rank correlation of MOM with RMOM-MS across stocks, average: ${f2(mean(per.filter(p => p.rho === p.rho && p.rho !== undefined).map(p => p.rho)))}`);
for (const [era, a, b] of ERAS) { const P = per.filter(p => p.date >= a && p.date < b);
  console.log(`\n--- ${era} (${P.length} periods) ---`);
  console.log("signal".padEnd(10) + "rank IC (t)".padEnd(18) + "IC>0".padEnd(7) + "top fifth - universe (t)".padEnd(27) + "top - bottom fifth (t)".padEnd(26) + "top fifth up% / universe up%".padEnd(30) + "worst month top-bottom");
  for (const name of SIG) { const x = P.map(p => p.sig[name]).filter(Boolean); if (x.length < 5) continue; const ic = x.map(v => v.ic), top = x.map(v => v.top), sp = x.map(v => v.spread);
    console.log(name.padEnd(10) + `${f2(mean(ic), 3)} (${f2(tstat(ic), 1)})`.padEnd(18) + `${f2(ic.filter(v => v > 0).length / ic.length * 100, 0)}%`.padEnd(7) + `${f2(mean(top))}% (${f2(tstat(top), 1)})`.padEnd(27) + `${f2(mean(sp))}% (${f2(tstat(sp), 1)})`.padEnd(26) + `${f2(mean(x.map(v => v.hitTop)), 1)}% / ${f2(mean(x.map(v => v.hitUni)), 1)}%`.padEnd(30) + `${f2(Math.min(...sp))}%`); } }

// ---- Part 2: Supertrend flips sorted by the signal at the latest monthly reading ----
const flips = [];
for (const s of syms) { const S = data.get(s);
  for (let t = WARM; t < S.n - 130; t++) { if (!(S.st[t] === 1 && S.st[t - 1] === -1) || !memberAt(s, S.d[t]) || !(S.atr14[t] > 0)) continue;
    const j = SPY.dateIdx.get(S.d[t]); if (j === undefined || j < FIRST) continue; const jr = FIRST + Math.floor((j - FIRST) / STEP) * STEP, p = pctAt.get(`${s}|${jr}`); if (!p) continue;
    const r = exitSim(S, t, { st: true }); if (!r || S.hasBad(t - 252, t + 1 + r.days + 1)) continue;
    flips.push({ date: S.d[t + 1], month: S.d[t + 1].slice(0, 7), ret: r.ret, days: r.days, gated: S.adx[t] >= 20 && S.adx[t] > S.adx[t - 5], p }); } }
const sh = a => { if (!a.length) return "n=0"; const s = stats(a); return `n=${String(s.n).padStart(5)} win ${f2(s.win, 0).padStart(3)}% avg ${f2(s.avg).padStart(5)}%`; };
let seed = 99; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
function boot(inR, outR) { const mo = new Map(); for (const [x, g] of [...inR.map(x => [x, 1]), ...outR.map(x => [x, 0])]) (mo.get(x.month) || mo.set(x.month, []).get(x.month)).push([x.ret, g]);
  const months = [...mo.keys()], dA = [], dW = [];
  for (let k = 0; k < 1000; k++) { let sa = 0, na = 0, wa = 0, sb = 0, nb = 0, wb = 0; for (let i = 0; i < months.length; i++) for (const [r, g] of mo.get(months[Math.floor(rnd() * months.length)])) { if (g) { sa += r; na++; if (r > 0) wa++; } else { sb += r; nb++; if (r > 0) wb++; } }
    if (na && nb) { dA.push(sa / na - sb / nb); dW.push((wa / na - wb / nb) * 100); } }
  dA.sort((p, q) => p - q); dW.sort((p, q) => p - q); const g = (arr, q) => arr[Math.floor(q * arr.length)]; return `avg diff 95% CI [${f2(g(dA, .025))}, ${f2(g(dA, .975))}] pts, win diff [${f2(g(dW, .025), 1)}, ${f2(g(dW, .975), 1)}] pts`; }
for (const [label, F] of [["APP-GATED flips (ADX >= 20 and rising)", flips.filter(f => f.gated)], ["ALL daily flips", flips]]) {
  console.log(`\n################ Part 2, ${label}: ${F.length} flips, ${F.length ? F.map(f => f.date).sort()[0] : ""} on. Supertrend-line exit. baseline ${sh(F)}`);
  for (const name of SIG) { const U = F.filter(f => Number.isFinite(f.p[name])); console.log(`\n${name}: flips by the stock's fifth among index members at the latest monthly reading`);
    console.log("fifth".padEnd(14) + "all years".padEnd(32) + "2008-2016".padEnd(32) + "2017-2026".padEnd(32) + "2023-2026");
    for (let q = 0; q < 5; q++) { const I = U.filter(f => Math.min(4, Math.floor(f.p[name] * 5)) === q);
      console.log(`${q + 1}${q === 0 ? " (lowest)" : q === 4 ? " (highest)" : ""}`.padEnd(14) + sh(I).padEnd(32) + sh(I.filter(f => f.date < "2017")).padEnd(32) + sh(I.filter(f => f.date >= "2017")).padEnd(32) + sh(I.filter(f => f.date >= "2023"))); }
    const top = U.filter(f => f.p[name] >= 0.8), rest = U.filter(f => f.p[name] < 0.8), half = U.filter(f => f.p[name] >= 0.5), low = U.filter(f => f.p[name] < 0.5);
    console.log(`  top fifth minus the rest, month-clustered bootstrap: ${boot(top, rest)}`);
    console.log(`  top half minus bottom half: ${sh(half)} vs ${sh(low)}; ${boot(half, low)}`); } }
