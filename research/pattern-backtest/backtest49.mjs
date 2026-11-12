// Earnings momentum (post-earnings drift) as a ranking signal (from "151 Trading Strategies", section 3.2).
// Reports with the EPS estimate and actual from Robinhood's feed (earnings_eps.json, about the last five quarters, 2025-03 on), point-in-time S&P 500.
// Reaction day = the first session that trades on the news (the report day for "am", the next session for "pm").
// Surprise measures, both known at the reaction day's close:
//   EPS   beat / miss, and (actual - estimate) / price before the report, in fifths
//   EAR   the stock's reaction-day return minus SPY's, in fifths
// Part 1: drift after the reaction: buy at the next open, hold 5, 10, 21 or 42 sessions, return minus the average index stock over the same span (same entry, same cost). t is clustered by report week.
// Part 2: the app's Supertrend flips that come within 20 sessions after a report, sorted by that report's surprise (Supertrend-line exit, 0.1% cost per side).
// Run: node backtest49.mjs > backtest49.out
import { readFileSync } from "node:fs";
import { data, SPY, memberAt, secOf, exitSim, stats, mean, f2, WARM } from "./lib14.mjs";
const EPS = JSON.parse(readFileSync("earnings_eps.json", "utf8")), HOR = [5, 10, 21, 42];
const week = d => { const t = new Date(d + "T00:00:00Z"); return Math.floor((t.getTime() / 864e5 + 3) / 7); };

const ev = []; let skipped = 0;
for (const [sym, rows] of Object.entries(EPS)) { const S = data.get(sym); if (!S || sym === "SPY") continue;
  for (const [date, timing, est, act] of rows) {
    if (timing !== "am" && timing !== "pm") { skipped++; continue; }
    let r = S.d.findIndex(x => timing === "am" ? x >= date : x > date); if (r < 1 || r + 1 >= S.n) continue;
    if (!memberAt(sym, S.d[r])) continue; const j = SPY.dateIdx.get(S.d[r]); if (j === undefined || j < 1) continue;
    if (week(S.d[r]) - week(date) > 1) continue; // a gap in the bars
    const ear = (S.c[r] / S.c[r - 1] - 1 - (SPY.c[j] / SPY.c[j - 1] - 1)) * 100, sue = (act - est) / S.c[r - 1] * 100, sueP = (act - est) / Math.max(Math.abs(est), 0.05);
    const e = { sym, date: S.d[r], wk: week(S.d[r]), r, j, ear, sue, sueP, beat: act > est ? 1 : act < est ? -1 : 0, fwd: {}, raw: {}, fs: {}, spy: {} };
    for (const h of HOR) { if (r + h >= S.n || j + h >= SPY.n || S.d[r + h] !== SPY.d[j + h] || S.hasBad(r + 1, r + h)) continue;
      e.raw[h] = (S.c[r + h] / S.o[r + 1] - 1 - 0.002) * 100; e.spy[h] = e.raw[h] - (SPY.c[j + h] / SPY.o[j + 1] - 1) * 100; }
    ev.push(e); } }
// benchmark: the average index member (and the average member of the same sector) bought at the same open and held the same span, same cost.
// SPY is not used as the benchmark because the average stock lagged the cap-weighted index in this window.
const bench = new Map();
const benchAt = (j, h) => { const k = j + "|" + h; if (bench.has(k)) return bench.get(k); const all = [], sec = new Map();
  for (const [sym, S] of data) { if (sym === "SPY") continue; const t = S.dateIdx.get(SPY.d[j]); if (t === undefined || t + h >= S.n || S.d[t + h] !== SPY.d[j + h] || !memberAt(sym, S.d[t]) || S.hasBad(t + 1, t + h)) continue;
    const x = (S.c[t + h] / S.o[t + 1] - 1 - 0.002) * 100; all.push(x); const sc = secOf(sym); if (sc) (sec.get(sc) || sec.set(sc, []).get(sc)).push(x); }
  const v = { all: mean(all), sec }; bench.set(k, v); return v; };
for (const e of ev) for (const h of HOR) { if (e.raw[h] === undefined) continue; const b = benchAt(e.j, h); e.fwd[h] = e.raw[h] - b.all; const g = b.sec.get(secOf(e.sym)); if (g && g.length >= 8) e.fs[h] = e.raw[h] - mean(g); }
let KEY = "fwd";
// fifths within each calendar quarter of reports, so a group is not one earnings season
const qKey = d => d.slice(0, 4) + "Q" + (Math.floor((+d.slice(5, 7) - 1) / 3) + 1);
for (const k of ["ear", "sue", "sueP"]) { const by = new Map(); for (const e of ev) (by.get(qKey(e.date)) || by.set(qKey(e.date), []).get(qKey(e.date))).push(e);
  for (const g of by.values()) { g.sort((a, b) => a[k] - b[k]); g.forEach((e, i) => e[k + "Q"] = Math.min(4, Math.floor(i / g.length * 5))); } }
// cluster-robust t of a mean, and of a difference of two group means (clusters = report weeks)
const ct = (x, wk) => { const n = x.length; if (n < 10) return NaN; const m = mean(x), c = new Map(); x.forEach((v, i) => c.set(wk[i], (c.get(wk[i]) || 0) + v - m)); let s = 0; for (const v of c.values()) s += v * v; return m / (Math.sqrt(s) / n); };
const ctDiff = (A, B, h) => { const a = A.filter(e => e[KEY][h] !== undefined), b = B.filter(e => e[KEY][h] !== undefined); if (a.length < 10 || b.length < 10) return "n/a";
  const ma = mean(a.map(e => e[KEY][h])), mb = mean(b.map(e => e[KEY][h])), c = new Map();
  for (const e of a) c.set(e.wk, (c.get(e.wk) || 0) + (e[KEY][h] - ma) / a.length); for (const e of b) c.set(e.wk, (c.get(e.wk) || 0) - (e[KEY][h] - mb) / b.length);
  let s = 0; for (const v of c.values()) s += v * v; return `${f2(ma - mb)}% (t ${f2((ma - mb) / Math.sqrt(s), 1)})`; };
const cell = (G, h) => { const g = G.filter(e => e[KEY][h] !== undefined); if (g.length < 10) return "n/a".padEnd(31); const x = g.map(e => e[KEY][h]);
  return `${f2(mean(x)).padStart(5)}% t ${f2(ct(x, g.map(e => e.wk)), 1).padStart(4)} beat avg ${f2(x.filter(v => v > 0).length / x.length * 100, 0)}%`.padEnd(31); };
const table = (title, groups, E) => { console.log(`\n${title}`); console.log("group".padEnd(30) + "n".padEnd(7) + HOR.map(h => `${h} sessions, minus avg stock`.padEnd(31)).join(""));
  for (const [name, f] of groups) { const G = E.filter(f); console.log(name.padEnd(30) + String(G.length).padEnd(7) + HOR.map(h => cell(G, h)).join("")); } };
const GROUPS = {
  "EPS beat or miss": [["beat", e => e.beat > 0], ["met", e => e.beat === 0], ["miss", e => e.beat < 0]],
  "EPS surprise / price, fifths": [0, 1, 2, 3, 4].map(q => [`fifth ${q + 1}${q === 0 ? " (worst miss)" : q === 4 ? " (biggest beat)" : ""}`, e => e.sueQ === q]),
  "EPS surprise / |estimate|, fifths (other scaling)": [0, 1, 2, 3, 4].map(q => [`fifth ${q + 1}${q === 0 ? " (worst miss)" : q === 4 ? " (biggest beat)" : ""}`, e => e.suePQ === q]),
  "Reaction-day return vs SPY (EAR), fifths": [0, 1, 2, 3, 4].map(q => [`fifth ${q + 1}${q === 0 ? " (sold off)" : q === 4 ? " (jumped)" : ""}`, e => e.earQ === q]),
  "Both together": [["beat and reaction up", e => e.beat > 0 && e.ear > 0], ["beat and reaction >= +3%", e => e.beat > 0 && e.ear >= 3], ["top fifth on both", e => e.sueQ === 4 && e.earQ === 4],
    ["beat but reaction down", e => e.beat > 0 && e.ear < 0], ["miss but reaction up", e => e.beat < 0 && e.ear > 0], ["miss and reaction down", e => e.beat < 0 && e.ear < 0], ["bottom fifth on both", e => e.sueQ === 0 && e.earQ === 0]],
};
const dts = ev.map(e => e.date).sort();
console.log(`Part 1: ${ev.length} reports, reaction days ${dts[0]} to ${dts.at(-1)}, ${new Set(ev.map(e => e.sym)).size} stocks, ${new Set(ev.map(e => e.wk)).size} report weeks; ${skipped} skipped (no am/pm timing).`);
console.log(`Beat ${f2(ev.filter(e => e.beat > 0).length / ev.length * 100, 0)}%, miss ${f2(ev.filter(e => e.beat < 0).length / ev.length * 100, 0)}%. Average reaction-day move vs SPY: beat ${f2(mean(ev.filter(e => e.beat > 0).map(e => e.ear)))}%, miss ${f2(mean(ev.filter(e => e.beat < 0).map(e => e.ear)))}%.`);
table("ALL REPORTS (baseline): any stock bought at the open after its reaction day", [["all reports", () => true]], ev);
for (const [t, g] of Object.entries(GROUPS)) table(t, g, ev);
const D = (name, fa, fb, E = ev) => console.log(name.padEnd(46) + HOR.map(h => `${h}d: ${ctDiff(E.filter(fa), E.filter(fb), h)}`.padEnd(26)).join(""));
const top = ev.filter(e => e.sueQ === 4), rawLine = (name, G) => console.log(name.padEnd(30) + HOR.map(h => { const x = G.map(e => e.raw[h]).filter(v => v !== undefined); return `${h}d: avg ${f2(mean(x))}% up ${f2(x.filter(v => v > 0).length / x.length * 100, 0)}%`.padEnd(28); }).join(""));
console.log("\nRaw return after costs (not against a benchmark):"); rawLine("all reports", ev); rawLine("EPS surprise top fifth", top); rawLine("EPS surprise bottom fifth", ev.filter(e => e.sueQ === 0));
console.log("\nSPY-relative, for reference (the average stock lagged SPY in this window):"); KEY = "spy"; console.log("all reports".padEnd(30) + String(ev.length).padEnd(7) + HOR.map(h => cell(ev, h)).join("")); KEY = "fwd";
for (const [label, E, key] of [["all reports", ev, "fwd"], ["reports in 2025", ev.filter(e => e.date < "2026"), "fwd"], ["reports in 2026", ev.filter(e => e.date >= "2026"), "fwd"], ["all reports, against the SECTOR average", ev, "fs"]]) { KEY = key;
  console.log(`\nDifferences between groups, ${label} (n=${E.length}), average return minus the average stock:`);
  D("beat minus miss", e => e.beat > 0, e => e.beat < 0, E); D("EPS surprise top fifth minus bottom fifth", e => e.sueQ === 4, e => e.sueQ === 0, E);
  D("EPS surprise / |estimate| top minus bottom fifth", e => e.suePQ === 4, e => e.suePQ === 0, E); D("EPS surprise top fifth minus all other reports", e => e.sueQ === 4, e => e.sueQ !== 4, E);
  D("reaction top fifth minus bottom fifth", e => e.earQ === 4, e => e.earQ === 0, E); D("beat and up minus miss and down", e => e.beat > 0 && e.ear > 0, e => e.beat < 0 && e.ear < 0, E);
  D("beat and up minus all other reports", e => e.beat > 0 && e.ear > 0, e => !(e.beat > 0 && e.ear > 0), E); }

KEY = "fwd"; console.log("\nEPS surprise / price, top fifth minus bottom fifth, by report quarter (average stock benchmark):");
for (const q of [...new Set(ev.map(e => qKey(e.date)))].sort()) { const E = ev.filter(e => qKey(e.date) === q); console.log(`${q} (n=${E.length})`.padEnd(46) + HOR.map(h => `${h}d: ${ctDiff(E.filter(e => e.sueQ === 4), E.filter(e => e.sueQ === 0), h)}`.padEnd(26)).join("")); }
// a rule usable live: the cut-off is the 80th percentile of EPS surprise / price among the PREVIOUS calendar quarter of reports (nothing from the same season)
{ const qs = [...new Set(ev.map(e => qKey(e.date)))].sort(), cut = new Map(); for (let i = 1; i < qs.length; i++) { const v = ev.filter(e => qKey(e.date) === qs[i - 1]).map(e => e.sue).sort((x, y) => x - y); cut.set(qs[i], v[Math.floor(v.length * 0.8)]); }
  const E = ev.filter(e => cut.has(qKey(e.date))), hi = E.filter(e => e.sue >= cut.get(qKey(e.date))), lo = E.filter(e => e.sue < cut.get(qKey(e.date)));
  console.log(`\nLive-usable cut-off (previous quarter 80th percentile; cut-offs ${[...cut.values()].map(v => f2(v, 3)).join(", ")} % of price), reports from ${qs[1]} on:`);
  console.log("at or above the cut-off".padEnd(30) + String(hi.length).padEnd(7) + HOR.map(h => cell(hi, h)).join("")); console.log("below the cut-off".padEnd(30) + String(lo.length).padEnd(7) + HOR.map(h => cell(lo, h)).join(""));
  console.log("difference".padEnd(46) + HOR.map(h => `${h}d: ${ctDiff(hi, lo, h)}`.padEnd(26)).join("")); }
console.log("\nIs the top fifth just one kind of stock? Sector mix of the EPS-surprise top fifth vs all reports:");
{ const mix = G => { const m = new Map(); for (const e of G) m.set(secOf(e.sym) || "?", (m.get(secOf(e.sym) || "?") || 0) + 1); return m; }; const a = mix(top), b = mix(ev);
  console.log([...b.keys()].sort((x, y) => (a.get(y) || 0) - (a.get(x) || 0)).map(k => `${k} ${f2((a.get(k) || 0) / top.length * 100, 0)}% (all ${f2(b.get(k) / ev.length * 100, 0)}%)`).join("; ")); }
// ---- Part 2: Supertrend flips after a report ----
const evBy = new Map(); for (const e of ev) (evBy.get(e.sym) || evBy.set(e.sym, []).get(e.sym)).push(e);
const flips = [];
for (const [sym, S] of data) { const E = evBy.get(sym); if (sym === "SPY" || !E) continue; E.sort((a, b) => a.r - b.r);
  for (let t = Math.max(WARM, E[0].r); t < S.n - 1; t++) { if (!(S.st[t] === 1 && S.st[t - 1] === -1) || !memberAt(sym, S.d[t]) || !(S.atr14[t] > 0)) continue;
    const r = exitSim(S, t, { st: true, maxHold: 60 }), r20 = exitSim(S, t, { timeN: 20, maxHold: 20 }); if (!r20 || S.hasBad(t - 252, t + 22)) continue;
    const last = E.filter(e => e.r <= t).at(-1), age = last ? t - last.r : 999;
    flips.push({ date: S.d[t + 1], wk: week(S.d[t + 1]), ret: r ? r.ret : NaN, days: r ? r.days : NaN, ret20: r20.ret, gated: S.adx[t] >= 20 && S.adx[t] > S.adx[t - 5], recent: age <= 20, e: last }); } }
const sh = (a, k = "ret") => { const g = a.filter(x => Number.isFinite(x[k])); if (g.length < 5) return `n=${g.length}`; const s = stats(g.map(x => ({ ret: x[k], days: x.days || 0 }))); return `n=${String(s.n).padStart(4)} win ${f2(s.win, 0).padStart(3)}% avg ${f2(s.avg).padStart(5)}% (t ${f2(ct(g.map(x => x[k]), g.map(x => x.wk)), 1)})`; };
for (const [label, F] of [["APP-GATED flips (ADX >= 20 and rising)", flips.filter(f => f.gated)], ["ALL daily flips", flips]]) {
  console.log(`\n################ Part 2, ${label}: ${F.length} flips from ${F.map(f => f.date).sort()[0]}`);
  console.log("group".padEnd(44) + "Supertrend-line exit (60-session limit)".padEnd(46) + "fixed 20 sessions");
  const rows = [["all flips", () => true], ["no report in the last 20 sessions", f => !f.recent], ["report in the last 20 sessions", f => f.recent],
    ["  that report: EPS beat", f => f.recent && f.e.beat > 0], ["  that report: EPS miss", f => f.recent && f.e.beat < 0],
    ["  that report: reaction up", f => f.recent && f.e.ear > 0], ["  that report: reaction down", f => f.recent && f.e.ear < 0],
    ["  that report: beat and reaction up", f => f.recent && f.e.beat > 0 && f.e.ear > 0], ["  that report: beat and reaction >= +3%", f => f.recent && f.e.beat > 0 && f.e.ear >= 3],
    ["  that report: miss or reaction down", f => f.recent && !(f.e.beat > 0 && f.e.ear > 0)],
    ["  that report: EPS surprise top fifth", f => f.recent && f.e.sueQ === 4], ["  that report: EPS surprise fifths 1-4", f => f.recent && f.e.sueQ < 4], ["  that report: EPS surprise bottom two fifths", f => f.recent && f.e.sueQ <= 1],
  ];
  for (const [name, fn] of rows) { const G = F.filter(fn); console.log(name.padEnd(44) + sh(G).padEnd(46) + sh(G, "ret20")); } }
