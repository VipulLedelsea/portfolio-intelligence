// Swing Exhaustion Fade ideas (research only). Does a learned "is the swing low already in" probability,
// and a liquidity-sweep flag, improve long entries? Same data, costs and point-in-time rules as backtest8.mjs.
// Odds table is pooled across the whole universe and uses only swings that were CONFIRMED before the signal date (no lookahead).
import { readFileSync } from "node:fs";
const current = JSON.parse(readFileSync("bars.json", "utf8"));
const former = JSON.parse(readFileSync("bars_former.json", "utf8"));
const raw = { ...former, ...current };
const intervals = new Map();
for (const l of readFileSync("members.csv", "utf8").trim().split("\n").slice(1)) { const [t, a, b] = l.split(","); (intervals.get(t) || intervals.set(t, []).get(t)).push([a, b || "9999-12-31"]); }
const memberAt = (sym, date) => (intervals.get(sym) || []).some(([a, b]) => date >= a && date <= b);
const COST = 0.001, SPLIT = "2024-11-05", WARM = 260, K = 2.5, MIN_EVENTS = 3000;
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const f2 = (x, p = 2) => Number.isFinite(x) ? x.toFixed(p) : "n/a";

function prep(rows) {
  const n = rows.length, d = [], o = [], h = [], l = [], c = [];
  for (const r of rows) { d.push(r[0]); o.push(r[1]); h.push(r[2]); l.push(r[3]); c.push(r[4]); }
  const tr = h.map((x, i) => i ? Math.max(x - l[i], Math.abs(x - c[i - 1]), Math.abs(l[i] - c[i - 1])) : x - l[i]);
  const atr14 = tr.map((_, i) => i >= 13 ? mean(tr.slice(i - 13, i + 1)) : NaN);
  const csum = [0]; for (const x of c) csum.push(csum[csum.length - 1] + x);
  const sma = (i, p) => i + 1 >= p ? (csum[i + 1] - csum[i + 1 - p]) / p : NaN;
  const bad = c.map((x, i) => i && Math.abs(x / c[i - 1] - 1) > 0.35 ? 1 : 0);
  const badSum = [0]; for (const x of bad) badSum.push(badSum[badSum.length - 1] + x);
  const hasBad = (a, b) => badSum[Math.min(n, b + 1)] - badSum[Math.max(0, a)] > 0;
  const rsi2 = new Array(n).fill(NaN); { let ag = 0, al = 0;
    for (let i = 1; i < n; i++) { const ch = c[i] - c[i - 1], g = Math.max(ch, 0), ls = Math.max(-ch, 0);
      if (i <= 2) { ag += g / 2; al += ls / 2; } else { ag = (ag + g) / 2; al = (al + ls) / 2; }
      if (i >= 2) rsi2[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } }
  return { n, d, o, h, l, c, atr14, sma, hasBad, rsi2 };
}

// ---- causal ATR zigzag; records every bar of a live DOWN leg, labelled later by whether the leg's low was already in ----
const sizeBin = s => s < 2 ? 0 : s < 3 ? 1 : s < 4 ? 2 : s < 6 ? 3 : s < 9 ? 4 : 5;
function swings(sym, S) {
  const { n, h, l, c, atr14 } = S, obs = [], events = [], priorLows = [];
  let dir = -1, ext = l[14], extIdx = 14, start = h[14], legObs = [], candTaken = false;
  for (let t = 15; t < n; t++) {
    const a = atr14[t]; if (!(a > 0)) continue;
    if (dir === -1) {
      if (l[t] < ext) { ext = l[t]; extIdx = t; }
      const retr = (c[t] - ext) / a;
      if (retr >= K) {
        for (const o of legObs) { o.label = o.extIdx === extIdx ? 1 : 0; events.push({ date: S.d[t], key: o.key, label: o.label }); }
        priorLows.push({ px: ext, idx: extIdx });
        const upIdx0 = extIdx + 1; let up = -Infinity, upIdx = t;
        for (let i = upIdx0; i <= t; i++) if (h[i] > up) { up = h[i]; upIdx = i; }
        dir = 1; ext = up; extIdx = upIdx; legObs = []; start = up;
      } else {
        const size = (start - ext) / a, depth = retr / K;
        const key = Math.min(9, Math.floor(depth * 10)) * 6 + sizeBin(size);
        let sweep = 0; for (let j = priorLows.length - 1; j >= 0 && t - priorLows[j].idx <= 120; j--) { if (ext < priorLows[j].px && c[t] > priorLows[j].px) { sweep = 1; break; } }
        const inBand = depth >= 0.35 && depth <= 0.8 && size >= 2;
        const o = { sym, t, date: S.d[t], depth, size, key, extIdx, sweep, cand: inBand && !candTaken, label: -1, p: NaN, w: NaN };
        if (inBand) candTaken = true;
        legObs.push(o); obs.push(o);
      }
    } else {
      if (h[t] > ext) { ext = h[t]; extIdx = t; }
      if ((ext - c[t]) / a >= K) {
        let lo = Infinity, loIdx = t; for (let i = extIdx + 1; i <= t; i++) if (l[i] < lo) { lo = l[i]; loIdx = i; }
        start = ext; dir = -1; ext = lo; extIdx = loIdx; legObs = []; candTaken = false;
      }
    }
  }
  return { obs, events };
}

const data = new Map(), allObs = [], allEvents = [];
for (const sym of Object.keys(raw)) { if (sym === "SPY") continue; const rows = raw[sym]; if (rows.length < 300 || rows.some(r => !(r[4] > 0))) continue;
  const S = prep(rows); data.set(sym, S); const r = swings(sym, S);
  for (const o of r.obs) if (memberAt(sym, o.date) && o.t >= WARM && !S.hasBad(o.t - 252, o.t)) allObs.push(o);
  for (const e of r.events) allEvents.push(e); }

// ---- learned odds, as of each date (events confirmed strictly before) ----
const wilson = (p, n, z = 1.28) => (p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / (1 + z * z / n);
allEvents.sort((a, b) => a.date < b.date ? -1 : 1); allObs.sort((a, b) => a.date < b.date ? -1 : 1);
const H = new Array(60).fill(0), N = new Array(60).fill(0);
let ei = 0, startDate = null;
for (const o of allObs) {
  while (ei < allEvents.length && allEvents[ei].date < o.date) { const e = allEvents[ei++]; N[e.key]++; H[e.key] += e.label; }
  if (ei < MIN_EVENTS) continue; if (!startDate) startDate = o.date;
  const d = Math.floor(o.key / 6), s = o.key % 6; let h = H[o.key], nn = N[o.key];
  for (const dd of [d - 1, d + 1]) if (dd >= 0 && dd <= 9) { h += 0.5 * H[dd * 6 + s]; nn += 0.5 * N[dd * 6 + s]; }
  if (nn < 30) continue; o.p = h / nn; o.w = wilson(o.p, nn);
}
const live = allObs.filter(o => Number.isFinite(o.p));
console.log(`swing legs learned: ${allEvents.length} bar-labels; predictions start ${startDate}; usable bars ${live.length}; universe ${data.size} stocks; k=${K}`);

// ---- 1. calibration: does predicted p match what happened (candidates only, labels known) ----
const cands = live.filter(o => o.cand && o.label >= 0);
console.log(`\n== 1. CALIBRATION on setup bars (retracement 35-80% of k, swing >= 2 ATR, first bar per leg; n = ${cands.length}) ==`);
const sorted = [...cands].sort((a, b) => a.p - b.p), Q = 5;
console.log("predicted-p quintile     mean predicted   actual 'low already in'   n");
for (let q = 0; q < Q; q++) { const g = sorted.slice(Math.floor(q * sorted.length / Q), Math.floor((q + 1) * sorted.length / Q)); console.log(`  Q${q + 1}${q === 0 ? " (lowest)" : q === Q - 1 ? " (highest)" : ""}`.padEnd(24) + f2(mean(g.map(o => o.p)) * 100, 1).padStart(10) + "%" + (f2(mean(g.map(o => o.label)) * 100, 1) + "%").padStart(22) + String(g.length).padStart(10)); }
const wv = cands.map(o => o.w).sort((a, b) => a - b), pv = cands.map(o => o.p).sort((a, b) => a - b), qv = (a, x) => a[Math.floor(a.length * x)];
console.log(`  p distribution: 10%=${f2(qv(pv, .1))} 50%=${f2(qv(pv, .5))} 90%=${f2(qv(pv, .9))}; Wilson: 10%=${f2(qv(wv, .1))} 50%=${f2(qv(wv, .5))} 90%=${f2(qv(wv, .9))}; share with Wilson>=0.60: ${f2(cands.filter(o => o.w >= 0.6).length / cands.length * 100, 1)}%`);

// ---- 2. trading outcomes ----
function trade(S, t, X) {
  const e = t + 1, last = e + X.H - 1; if (last >= S.n) return null;
  if (S.hasBad(t - 252, last)) return null;
  const entry = S.o[e], atr = S.atr14[t]; if (!(entry > 0) || !(atr > 0)) return null;
  const stop = X.S ? entry - X.S * atr : -Infinity, tp = X.T ? entry + X.T * atr : Infinity;
  let exit = S.c[last];
  for (let k = e; k <= last; k++) {
    if (k > e && S.o[k] <= stop) { exit = S.o[k]; break; } if (S.l[k] <= stop) { exit = stop; break; }
    if (k > e && S.o[k] >= tp) { exit = S.o[k]; break; } if (S.h[k] >= tp) { exit = tp; break; }
  }
  return { ret: (exit / entry - 1 - 2 * COST) * 100, date: S.d[e] };
}
const EXITS = { "5d hold, no levels": { H: 5 }, "5d, stop 2 ATR, target 1 ATR": { H: 5, S: 2, T: 1 }, "10d, stop 2 ATR, target 2 ATR": { H: 10, S: 2, T: 2 } };
const bySym = new Map(); for (const o of live) (bySym.get(o.sym) || bySym.set(o.sym, []).get(o.sym)).push(o);
const dipOk = (S, t) => S.c[t] > S.sma(t, 200) && S.rsi2[t] < 5 && S.c[t] < S.sma(t, 5) && S.c[t] / S.c[t - 3] - 1 < -0.05;
const runGroup = (pred, X, base) => { // pred(o,S) over live bars (or every 3rd stock-day for base)
  const out = [];
  for (const [sym, S] of data) {
    if (base) { for (let t = WARM; t < S.n - 1; t += 3) { if (S.d[t] < startDate || !memberAt(sym, S.d[t])) continue; const r = trade(S, t, X); if (r) out.push(r); } continue; }
    let free = -1; for (const o of bySym.get(sym) || []) { if (o.t <= free || !pred(o, S)) continue; const r = trade(S, o.t, X); if (r) { out.push(r); free = o.t + X.H; } }
  }
  return out;
};
const wk = d => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
const byWeek = tr => { const m = new Map(); for (const x of tr) (m.get(wk(x.date)) || m.set(wk(x.date), []).get(wk(x.date))).push(x.ret); return new Map([...m].map(([k, v]) => [k, mean(v)])); };
function pairedT(a, b) { const A = byWeek(a), B = byWeek(b), d = []; for (const [k, v] of A) if (B.has(k)) d.push(v - B.get(k)); if (d.length < 8) return NaN; const m = mean(d), sd = Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (d.length - 1)); return m / (sd / Math.sqrt(d.length)); }
const pMed = qv(pv, .5), pTop = qv(pv, 2 / 3), pBot = qv(pv, 1 / 3);
const GROUPS = [ // [name, predicate, parent name]
  ["A  SEF setup, no odds filter (control)", o => o.cand, null],
  ["A1 setup + Wilson>=0.60", o => o.cand && o.w >= 0.6, "A"],
  ["A2 setup + top-third odds", o => o.cand && o.p >= pTop, "A"],
  ["A3 setup + bottom-third odds", o => o.cand && o.p <= pBot, "A"],
  ["A4 setup + liquidity sweep", o => o.cand && o.sweep, "A"],
  ["A5 setup + top-third odds + sweep", o => o.cand && o.p >= pTop && o.sweep, "A"],
  ["D  current dip entry (control)", (o, S) => dipOk(S, o.t), null],
  ["D1 dip + Wilson>=0.60", (o, S) => dipOk(S, o.t) && o.w >= 0.6, "D"],
  ["D2 dip + above-median odds", (o, S) => dipOk(S, o.t) && o.p >= pMed, "D"],
  ["D3 dip + below-median odds", (o, S) => dipOk(S, o.t) && o.p < pMed, "D"],
  ["D4 dip + liquidity sweep", (o, S) => dipOk(S, o.t) && o.sweep, "D"],
  ["D5 dip + no sweep", (o, S) => dipOk(S, o.t) && !o.sweep, "D"],
];
console.log(`\n== 2. FORWARD RETURNS (long, entry next open, 0.1%/side, from ${startDate}; thresholds: top-third p>=${f2(pTop)}, median ${f2(pMed)}, bottom-third p<=${f2(pBot)}) ==`);
for (const [xn, X] of Object.entries(EXITS)) {
  console.log(`\n--- exit: ${xn} ---`);
  console.log("group".padEnd(42) + "n".padStart(6) + "mean%".padStart(8) + "win%".padStart(7) + "1stH".padStart(7) + "2ndH".padStart(7) + "  edge vs parent (t)".padStart(24) + "  vs any-day (t)".padStart(18));
  const base = runGroup(null, X, true), res = {};
  console.log("any stock-day (baseline)".padEnd(42) + String(base.length).padStart(6) + f2(mean(base.map(x => x.ret))).padStart(8));
  for (const [name, pred, parent] of GROUPS) {
    const tr = runGroup(pred, X, false); res[name.split(" ")[0]] = tr;
    const r = tr.map(x => x.ret), h1 = tr.filter(x => x.date < SPLIT).map(x => x.ret), h2 = tr.filter(x => x.date >= SPLIT).map(x => x.ret);
    const par = parent ? res[parent] : null;
    const edge = par ? `${f2(mean(r) - mean(par.map(x => x.ret)))} (${f2(pairedT(tr, par), 1)})` : "";
    console.log(name.padEnd(42) + String(tr.length).padStart(6) + f2(mean(r)).padStart(8) + f2(r.filter(x => x > 0).length / r.length * 100, 0).padStart(7) + f2(mean(h1)).padStart(7) + f2(mean(h2)).padStart(7) + edge.padStart(24) + `${f2(mean(r) - mean(base.map(x => x.ret)))} (${f2(pairedT(tr, base), 1)})`.padStart(18));
  }
}
