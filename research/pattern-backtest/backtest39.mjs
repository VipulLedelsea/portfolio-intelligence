// Tight-base breakout in leaders (research only). Point-in-time S&P 500, daily bars, signal at the close, entry next open, 0.1% cost per side.
// node backtest39.mjs
import { readFileSync } from "node:fs";
import { data, memberAt, SPY, prep, mean, f2, COST } from "./lib14.mjs";
const QQQ = prep(JSON.parse(readFileSync("qqq.json", "utf8")));
const earn = JSON.parse(readFileSync("earnings.json", "utf8"));
const WARM = 260, CAP = 120;
let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const sdv = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = a => a.length > 2 ? mean(a) / (sdv(a) / Math.sqrt(a.length)) : NaN;

// market filter: index above its 50-day average and that average higher than 10 days ago
const idxOk = (I, date) => { const j = I.dateIdx.get(date); return j !== undefined && j >= 60 && I.c[j] > I.sma50[j] && I.sma50[j] > I.sma50[j - 10]; };
const mktOk = new Map(); for (const d of SPY.d) mktOk.set(d, idxOk(SPY, d) && idxOk(QQQ, d));

// relative strength: 126-day return, top 20% of index members on that date
const rsAll = new Map();
for (const [sym, S] of data) { if (sym === "SPY") continue; for (let t = 126; t < S.n; t++) { if (!memberAt(sym, S.d[t])) continue; (rsAll.get(S.d[t]) || rsAll.set(S.d[t], []).get(S.d[t])).push(S.c[t] / S.c[t - 126] - 1); } }
const rsCut = new Map(); for (const [d, a] of rsAll) { a.sort((x, y) => x - y); rsCut.set(d, a[Math.floor(a.length * 0.8)]); }
const isLeader = (S, t) => S.c[t] / S.c[t - 126] - 1 >= rsCut.get(S.d[t]) && S.c[t] > S.sma50[t] && S.c[t] > S.sma200[t];

// earnings within the next 5 sessions (only known from each stock's first listed report onward)
const earnSoon = (sym, S, t) => { const e = earn[sym]; if (!e || !e.length || S.d[t] < e[0][0]) return null; const lim = S.d[Math.min(S.n - 1, t + 5)]; return e.some(([d]) => d > S.d[t] && d <= lim) || (t + 5 >= S.n && e.some(([d]) => d > S.d[t])); };

// base: returns { stop, L } or null. P = { cap, run, contr, vol, volDry, hold }
function findBase(S, t, P) {
  for (let L = 15; L >= 5; L--) {
    const a = t - L, b = t - 1; if (a - 41 < 0) return null;
    let bh = -Infinity, bl = Infinity, trS = 0, vS = 0, held = true;
    for (let k = a; k <= b; k++) { bh = Math.max(bh, S.h[k]); bl = Math.min(bl, S.l[k]); trS += S.tr[k]; vS += S.v[k]; if (S.c[k] < S.ema20[k]) held = false; }
    if (!(S.c[t] > bh)) continue;
    if ((S.c[t] - bl) / S.c[t] > P.cap / 100) continue;
    if (P.hold && !held) continue;
    let lo = Infinity; for (let k = a - 40; k <= a; k++) lo = Math.min(lo, S.l[k]);
    if (bh / lo < 1 + P.run / 100) continue;
    let trP = 0; for (let k = a - 20; k < a; k++) trP += S.tr[k];
    if (P.contr && trS / L > P.contr * trP / 20) continue;
    if (P.volDry && vS / L >= S.vol50[a - 1]) continue;
    if (S.hasBad(a - 45, t)) continue;
    return { stop: bl, L };
  }
  return null;
}

// exits. mode: "T5" all out at +5%; "HALF" half at +5%, rest stop to breakeven and trail on Supertrend; "TRAIL" Supertrend only; "R3" all out at +3R
function sim(S, t, stopPx, mode) {
  const e = t + 1; if (e >= S.n) return null; const entry = S.o[e]; const risk = (entry - stopPx) / entry; if (!(risk > 0.004)) return null;
  const last = Math.min(S.n - 1, e + CAP - 1);
  const tgt = mode === "R3" ? entry * (1 + 3 * risk) : mode === "TRAIL" ? Infinity : entry * 1.05;
  let stop = stopPx, half = false, got = 0, rem = 1, days = 0, exit = NaN;
  for (let k = e; k <= last; k++) {
    days = k - e + 1;
    if (k > e && S.o[k] <= stop) { exit = S.o[k]; break; }
    if (S.l[k] <= stop) { exit = stop; break; }
    if (!half && (S.h[k] >= tgt || (k > e && S.o[k] >= tgt))) { const px = k > e && S.o[k] >= tgt ? S.o[k] : tgt;
      if (mode === "HALF") { half = true; got += 0.5 * (px / entry - 1); rem = 0.5; stop = Math.max(stop, entry); } else { exit = px; break; } }
    if (mode !== "T5" && mode !== "R3" && S.st[k] === -1) { const nx = Math.min(k + 1, S.n - 1); exit = nx > k ? S.o[nx] : S.c[k]; days = nx - e + 1; break; }
  }
  if (!Number.isFinite(exit)) exit = S.c[last];
  const ret = (got + rem * (exit / entry - 1) - 2 * COST) * 100;
  return { ret, R: ret / (risk * 100), risk: risk * 100, days, date: S.d[e], hitT: half };
}
const MODES = ["T5", "HALF", "TRAIL", "R3"];

// signals
function signals(P) {
  const out = [];
  for (const [sym, S] of data) { if (sym === "SPY") continue; let block = -1;
    for (let t = WARM; t < S.n - 1; t++) { if (t <= block) continue; const d = S.d[t];
      if (!memberAt(sym, d)) continue; if (P.mkt && !mktOk.get(d)) continue; if (P.rs && !isLeader(S, t)) continue; if (S.st[t] !== 1) continue;
      if (!(S.v[t] >= P.vol * S.vol50[t - 1])) continue;
      const B = findBase(S, t, P); if (!B) continue;
      if (P.earn && earnSoon(sym, S, t) !== false) continue;
      out.push({ sym, S, t, stop: B.stop, L: B.L, es: earnSoon(sym, S, t) }); block = t + 10; } }
  return out;
}
// control pools by month: leader-days in a good market (and optionally a 20% surge in the last 55 days), no base or breakout needed
const pools = { lead: new Map(), surge: new Map() };
for (const [sym, S] of data) { if (sym === "SPY") continue;
  for (let t = WARM; t < S.n - 1; t++) { const d = S.d[t]; if (!memberAt(sym, d) || !mktOk.get(d) || !isLeader(S, t) || S.st[t] !== 1) continue; const m = d.slice(0, 7);
    (pools.lead.get(m) || pools.lead.set(m, []).get(m)).push([S, t]);
    let hi = -Infinity, lo = Infinity; for (let k = t - 15; k <= t; k++) hi = Math.max(hi, S.h[k]); for (let k = t - 55; k <= t; k++) lo = Math.min(lo, S.l[k]);
    if (hi / lo >= 1.2 && !S.hasBad(t - 60, t)) (pools.surge.get(m) || pools.surge.set(m, []).get(m)).push([S, t]); } }
function control(sig, pool, mode, K = 20) { // each trade against K random same-month entries with the same stop distance (measured from the signal close)
  const diffs = [], ctl = [];
  for (const g of sig) { const p = pool.get(g.S.d[g.t].slice(0, 7)); const r = sim(g.S, g.t, g.stop, mode); if (!p || !r) continue; const pct = 1 - g.stop / g.S.c[g.t]; const xs = [];
    for (let i = 0; i < K; i++) { const [S2, t2] = p[Math.floor(rnd() * p.length)]; const x = sim(S2, t2, S2.c[t2] * (1 - pct), mode); if (x) xs.push(x.ret); }
    if (xs.length) { ctl.push(mean(xs)); diffs.push(r.ret - mean(xs)); } }
  return { ctl: mean(ctl), diff: mean(diffs), t: tstat(diffs) };
}
function report(tr) { const r = tr.map(x => x.ret), w = r.filter(x => x > 0), l = r.filter(x => x <= 0);
  return { n: r.length, win: w.length / r.length * 100, avg: mean(r), aw: mean(w), al: mean(l), R: mean(tr.map(x => x.R)), pf: w.reduce((a, b) => a + b, 0) / -l.reduce((a, b) => a + b, 0), days: mean(tr.map(x => x.days)), t: tstat(r), risk: mean(tr.map(x => x.risk)) }; }
const line = (name, s) => `${name.padEnd(34)} n ${String(s.n).padStart(4)}  win ${f2(s.win, 1)}%  avg ${f2(s.avg)}%  avgWin ${f2(s.aw)}%  avgLoss ${f2(s.al)}%  avgR ${f2(s.R)}  PF ${f2(s.pf)}  days ${f2(s.days, 1)}  t ${f2(s.t, 1)}`;

const BASE = { cap: 4, run: 20, contr: 0.85, vol: 1.5, volDry: true, hold: true, mkt: true, rs: true, earn: false };
const run = (P, mode) => signals(P).map(g => ({ ...sim(g.S, g.t, g.stop, mode), g })).filter(x => Number.isFinite(x.ret));

console.log("=== Spec as written (stop cap 4%, 20% prior run, base 5-15 days, 1.5x volume, SPY and QQQ filter, top 20% 6-month strength) ===");
const sig = signals(BASE);
console.log(`signals ${sig.length}, stocks ${new Set(sig.map(g => g.sym)).size}, first ${sig.map(g => g.S.d[g.t]).sort()[0]}, last ${sig.map(g => g.S.d[g.t]).sort().at(-1)}`);
for (const m of MODES) { const tr = run(BASE, m); if (!tr.length) continue; const s = report(tr); console.log(line(m, s) + `  stop ${f2(s.risk)}%`);
  const c1 = control(sig, pools.lead, m), c2 = control(sig, pools.surge, m);
  console.log(`   vs random leader-days: control ${f2(c1.ctl)}%, difference ${f2(c1.diff)}% (t ${f2(c1.t, 1)})   vs surged leaders: control ${f2(c2.ctl)}%, difference ${f2(c2.diff)}% (t ${f2(c2.t, 1)})`);
  const by = {}; for (const x of tr) (by[x.date.slice(0, 4)] ||= []).push(x.ret); console.log("   by year: " + Object.keys(by).sort().map(y => `${y} n${by[y].length} ${f2(mean(by[y]))}%`).join("  ")); }

console.log("\n=== Sensitivity (one change at a time from the spec) ===");
const VAR = [["stop cap 6%", { cap: 6 }], ["stop cap 8%", { cap: 8 }], ["stop cap 10%", { cap: 10 }], ["prior run 10%", { run: 10 }], ["prior run 10%, cap 6%", { run: 10, cap: 6 }], ["no prior run needed, cap 6%", { run: 0, cap: 6 }], ["volume 1.0x", { vol: 1.0 }], ["volume 1.0x, cap 6%", { vol: 1.0, cap: 6 }],
  ["no contraction or dry-volume rule", { contr: 0, volDry: false }], ["no market filter", { mkt: false }], ["no strength filter", { rs: false }],
  ["loose: cap 8, run 10, vol 1.0", { cap: 8, run: 10, vol: 1.0 }], ["loose + no contraction rules", { cap: 8, run: 10, vol: 1.0, contr: 0, volDry: false }]];
for (const [name, ch] of VAR) { const P = { ...BASE, ...ch }; const sg = signals(P); console.log(`-- ${name}: ${sg.length} signals`);
  for (const m of MODES) { const tr = run(P, m); if (tr.length < 5) continue; const s = report(tr); const c = control(sg, pools.lead, m), c2 = control(sg, pools.surge, m);
    console.log("  " + line(m, s) + `  | vs leaders ${f2(c.diff)}% (t ${f2(c.t, 1)}) vs surged ${f2(c2.diff)}% (t ${f2(c2.t, 1)})`); } }

console.log("\n=== Earnings within 5 sessions (only where report dates are known, 2025 onward), loose variant, HALF exit ===");
{ const P = { ...BASE, cap: 8, run: 10, vol: 1.0 }; const tr = run(P, "HALF").filter(x => x.g.es !== null); for (const [nm, f] of [["report within 5 sessions", x => x.g.es === true], ["no report within 5 sessions", x => x.g.es === false]]) { const a = tr.filter(f); if (a.length > 4) console.log(line(nm, report(a))); else console.log(nm, "n", a.length); } }
