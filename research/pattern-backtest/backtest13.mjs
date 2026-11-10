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
  // Supertrend(10,3) and ADX(14), Wilder smoothing
  const st = (() => {
    const atr = []; let prev = NaN;
    for (let i = 0; i < n; i++) { prev = i < 10 ? NaN : i === 10 ? mean(tr.slice(1, 11)) : (prev * 9 + tr[i]) / 10; atr.push(prev); }
    const dir = new Array(n).fill(0); let fu = NaN, fl = NaN;
    for (let i = 10; i < n; i++) {
      const mid = (h[i] + l[i]) / 2, bu = mid + 3 * atr[i], bl = mid - 3 * atr[i];
      if (i === 10) { fu = bu; fl = bl; dir[i] = c[i] >= mid ? 1 : -1; continue; }
      fu = (bu < fu || c[i - 1] > fu) ? bu : fu;
      fl = (bl > fl || c[i - 1] < fl) ? bl : fl;
      dir[i] = dir[i - 1] === -1 ? (c[i] > fu ? 1 : -1) : (c[i] < fl ? -1 : 1);
    }
    return dir;
  })();
  const adx = (() => {
    const out = new Array(n).fill(NaN); let tr14 = 0, p14 = 0, m14 = 0; const dx = [];
    for (let i = 1; i < n; i++) {
      const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
      const pdm = up > dn && up > 0 ? up : 0, mdm = dn > up && dn > 0 ? dn : 0;
      if (i <= 14) { tr14 += tr[i]; p14 += pdm; m14 += mdm; } else { tr14 = tr14 - tr14 / 14 + tr[i]; p14 = p14 - p14 / 14 + pdm; m14 = m14 - m14 / 14 + mdm; }
      if (i >= 14) { const pdi = 100 * p14 / tr14, mdi = 100 * m14 / tr14; dx.push(100 * Math.abs(pdi - mdi) / (pdi + mdi || 1)); const k = dx.length; out[i] = k === 14 ? mean(dx) : k > 14 ? (out[i - 1] * 13 + dx[k - 1]) / 14 : NaN; }
    }
    return out;
  })();
  return { n, d, o, h, l, c, atr14, sma, hasBad, rsi2, st, adx };
}


const sizeBin = s => s < 2 ? 0 : s < 3 ? 1 : s < 4 ? 2 : s < 6 ? 3 : s < 9 ? 4 : 5;
// causal ATR zigzag; every bar in a live leg (down = 0, up = 1) is recorded and labelled once the leg is confirmed: "was the extreme already in"
function swings(sym, S) {
  const { n, h, l, c, atr14 } = S, byT = new Array(n).fill(null), events = [], priorLows = [], priorHighs = [];
  let dir = 0, ext = l[14], extIdx = 14, start = h[14], legObs = [];
  for (let t = 15; t < n; t++) {
    const a = atr14[t]; if (!(a > 0)) continue;
    const down = dir === 0;
    if (down ? l[t] < ext : h[t] > ext) { ext = down ? l[t] : h[t]; extIdx = t; }
    const retr = down ? (c[t] - ext) / a : (ext - c[t]) / a;
    if (retr >= K) {
      for (const o of legObs) { o.label = o.extIdx === extIdx ? 1 : 0; events.push({ date: S.d[t], key: o.key, label: o.label }); }
      (down ? priorLows : priorHighs).push({ px: ext, idx: extIdx });
      let e2 = down ? -Infinity : Infinity, i2 = t;
      for (let i = extIdx + 1; i <= t; i++) { if (down ? h[i] > e2 : l[i] < e2) { e2 = down ? h[i] : l[i]; i2 = i; } }
      start = ext; ext = e2; extIdx = i2; dir = 1 - dir; legObs = []; continue;
    }
    const size = Math.abs(start - ext) / a, depth = retr / K;
    const key = dir * 60 + Math.min(9, Math.floor(depth * 10)) * 6 + sizeBin(size);
    let sweep = 0;
    if (down) { for (let j = priorLows.length - 1; j >= 0 && t - priorLows[j].idx <= 120; j--) if (ext < priorLows[j].px && c[t] > priorLows[j].px) { sweep = 1; break; } }
    else { for (let j = priorHighs.length - 1; j >= 0 && t - priorHighs[j].idx <= 120; j--) if (ext > priorHighs[j].px && c[t] < priorHighs[j].px) { sweep = 1; break; } }
    const o = { sym, t, date: S.d[t], dir, depth, size, key, extIdx, sweep, label: -1, p: NaN, w: NaN };
    legObs.push(o); byT[t] = o;
  }
  return { byT, events };
}
const data = new Map(), allObs = [], allEvents = [];
for (const sym of Object.keys(raw)) { if (sym === "SPY") continue; const rows = raw[sym]; if (rows.length < 300 || rows.some(r => !(r[4] > 0))) continue;
  const S = prep(rows); S.sw = swings(sym, S).byT; data.set(sym, S); const r = swings(sym, S); S.sw = r.byT;
  for (const o of r.byT) if (o && o.t >= WARM) allObs.push(o);
  for (const e of r.events) allEvents.push(e); }
const wilson = (p, n, z = 1.28) => (p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / (1 + z * z / n);
allEvents.sort((a, b) => a.date < b.date ? -1 : 1); allObs.sort((a, b) => a.date < b.date ? -1 : 1);
const H = new Array(120).fill(0), N = new Array(120).fill(0); let ei = 0, startDate = null;
for (const o of allObs) {
  while (ei < allEvents.length && allEvents[ei].date < o.date) { const e = allEvents[ei++]; N[e.key]++; H[e.key] += e.label; }
  if (ei < MIN_EVENTS) continue; if (!startDate) startDate = o.date;
  const base = o.dir * 60, d = Math.floor((o.key - base) / 6), s = o.key % 6; let h = H[o.key], nn = N[o.key];
  for (const dd of [d - 1, d + 1]) if (dd >= 0 && dd <= 9) { h += 0.5 * H[base + dd * 6 + s]; nn += 0.5 * N[base + dd * 6 + s]; }
  if (nn < 30) continue; o.p = h / nn; o.w = wilson(o.p, nn);
}
console.log(`learned labels ${allEvents.length}; predictions from ${startDate}; ${data.size} stocks`);

// ---- the app's long ideas ----
const sigST = (S, t) => t >= 60 && S.st[t] === 1 && S.st[t - 1] === -1 && S.adx[t] >= 20 && S.adx[t] > S.adx[t - 5];
const sigDip = (S, t) => S.c[t] > S.sma(t, 200) && S.rsi2[t] < 10;
const sigSharp = (S, t) => S.c[t] > S.sma(t, 200) && S.rsi2[t] < 5 && S.c[t] < S.sma(t, 5) && S.c[t] / S.c[t - 3] - 1 < -0.05;
const STRATS = { "SUPERTREND flip (long)": sigST, "DIP (RSI2<10 in uptrend)": sigDip, "DIP_SHARP": sigSharp };
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
const EXITS = { "5d hold, no levels": { H: 5 }, "10d, stop 2 ATR, target 2 ATR": { H: 10, S: 2, T: 2 } };
const wk = d => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
const byWeek = tr => { const m = new Map(); for (const x of tr) { const k = wk(x.date); (m.get(k) || m.set(k, []).get(k)).push(x.ret); } return new Map([...m].map(([k, v]) => [k, mean(v)])); };
function pairedT(a, b) { const A = byWeek(a), B = byWeek(b), d = []; for (const [k, v] of A) if (B.has(k)) d.push(v - B.get(k)); if (d.length < 8) return NaN; const m = mean(d), sd = Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (d.length - 1)); return m / (sd / Math.sqrt(d.length)); }
function auc(pos, neg) { // P(score of a winner > score of a loser)
  const all = [...pos.map(s => [s, 1]), ...neg.map(s => [s, 0])].sort((a, b) => a[0] - b[0]); let r = 0, i = 0, sumPos = 0;
  while (i < all.length) { let j = i; while (j < all.length && all[j][0] === all[i][0]) j++; const avg = (i + j + 1) / 2; for (let k = i; k < j; k++) if (all[k][1]) sumPos += avg; i = j; }
  return (sumPos - pos.length * (pos.length + 1) / 2) / (pos.length * neg.length); }
const q = (a, x) => { const s = [...a].sort((u, v) => u - v); return s[Math.floor(s.length * x)]; };
const f1 = x => f2(x, 1);

for (const [xn, X] of Object.entries(EXITS)) {
  console.log(`\n################ exit: ${xn} ################`);
  for (const [sn, sig] of Object.entries(STRATS)) {
    const rows = [];
    for (const [sym, S] of data) { let free = -1;
      for (let t = WARM; t < S.n - 1; t++) { if (S.d[t] < startDate || t <= free || !memberAt(sym, S.d[t]) || !sig(S, t)) continue;
        const o = S.sw[t]; const r = trade(S, t, X); if (!r) continue; free = t + X.H;
        // swing score oriented so HIGH = good for a long: down-leg -> P(low already in); up-leg -> 1 - P(high already in)
        const sc = o && Number.isFinite(o.p) ? (o.dir === 0 ? o.p : 1 - o.p) : NaN;
        rows.push({ ...r, sc, dir: o ? o.dir : -1, sweep: o && Number.isFinite(o.p) ? o.sweep : 0, ext: -(S.c[t] - S.sma(t, 20)) / S.atr14[t], rsi2: S.rsi2[t], hasSw: !!(o && Number.isFinite(o.p)) }); } }
    const R = rows.filter(r => r.hasSw); if (R.length < 100) { console.log(`\n${sn}: only ${R.length} usable`); continue; }
    const rets = R.map(r => r.ret), cut = q(rets, 0.2), allMean = mean(rets);
    console.log(`\n${sn}   n = ${R.length} (${f1(R.filter(r => r.dir === 0).length / R.length * 100)}% in a down-leg, rest in an up-leg)   mean ${f2(allMean)}%   win ${f1(rets.filter(x => x > 0).length / R.length * 100)}%   worst-20% line ${f2(cut)}%`);
    // how well does each feature rank winners above losers, and keep tail losers out
    const win = R.filter(r => r.ret > 0), los = R.filter(r => r.ret <= 0), tail = R.filter(r => r.ret <= cut), ok = R.filter(r => r.ret > cut);
    const feats = { "swing score (exhaustion odds)": r => r.sc, "sweep flag": r => r.sweep, "extension below 20d avg (existing-style)": r => r.ext, "RSI2 (existing, low=oversold)": r => -r.rsi2 };
    console.log("  feature                                       AUC win-vs-loss   AUC avoids worst-20%   (0.50 = no information)");
    for (const [fn, fv] of Object.entries(feats)) console.log("  " + fn.padEnd(44) + f2(auc(win.map(fv), los.map(fv)), 3).padStart(10) + f2(auc(ok.map(fv), tail.map(fv)), 3).padStart(22));
    // reject the worst-scoring third
    const scs = R.map(r => r.sc), lo3 = q(scs, 1 / 3), hi3 = q(scs, 2 / 3);
    const flagged = R.filter(r => r.sc <= lo3), kept = R.filter(r => r.sc > lo3), top = R.filter(r => r.sc >= hi3);
    const tailShare = flagged.filter(r => r.ret <= cut).length / tail.length;
    console.log(`  Reject worst-third swing score (<= ${f2(lo3)}): removed ${flagged.length}, kept ${kept.length}`);
    console.log(`    all ${f2(allMean)}%  ->  kept ${f2(mean(kept.map(r => r.ret)))}%  (removed avg ${f2(mean(flagged.map(r => r.ret)))}%; kept-vs-removed weekly t ${f1(pairedT(kept, flagged))}; halves of kept: ${f2(mean(kept.filter(r => r.date < SPLIT).map(r => r.ret)))}% / ${f2(mean(kept.filter(r => r.date >= SPLIT).map(r => r.ret)))}%; removed: ${f2(mean(flagged.filter(r => r.date < SPLIT).map(r => r.ret)))}% / ${f2(mean(flagged.filter(r => r.date >= SPLIT).map(r => r.ret)))}%)`);
    console.log(`    removed ${f1(tailShare * 100)}% of the worst-20% trades (random removal would be 33%); win rate all ${f1(win.length / R.length * 100)}% -> kept ${f1(kept.filter(r => r.ret > 0).length / kept.length * 100)}%`);
    const sw = R.filter(r => r.sweep), nsw = R.filter(r => !r.sweep);
    console.log(`  Sweep flag: with ${sw.length} trades ${f2(mean(sw.map(r => r.ret)))}% vs without ${f2(mean(nsw.map(r => r.ret)))}% (weekly t ${f1(pairedT(sw, nsw))})`);
    for (const dr of [0, 1]) { const g = R.filter(r => r.dir === dr); if (g.length < 150) continue; const m = q(g.map(r => r.sc), .5);
      const hi = g.filter(r => r.sc >= m), lw = g.filter(r => r.sc < m);
      console.log(`  ${dr === 0 ? "In a down-leg (odds the low is in)" : "In an up-leg (1 - odds the high is in)"}: better-half ${f2(mean(hi.map(r => r.ret)))}% (n ${hi.length}) vs worse-half ${f2(mean(lw.map(r => r.ret)))}% (n ${lw.length}), weekly t ${f1(pairedT(hi, lw))}`); }
    // is it new information? split on the existing-style extension, then on swing score
    const em = q(R.map(r => r.ext), .5), sm = q(scs, .5), cell = (e, s) => R.filter(r => (r.ext >= em) === e && (r.sc >= sm) === s);
    console.log("  2x2 on existing extension (rows) x swing score (cols), mean% (n):  swing-low  | swing-high");
    for (const e of [true, false]) console.log(`    ${e ? "more extended below avg" : "less extended         "}   ${[false, true].map(s => { const g = cell(e, s); return `${f2(mean(g.map(r => r.ret)))} (${g.length})`.padStart(16); }).join("   |")}`);
  }
}
