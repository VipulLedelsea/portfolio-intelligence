// Strong stocks in a rising market with a Supertrend trailing exit, on 20 years of data (research only).
// Point-in-time S&P 500 (members.csv), Yahoo daily bars adjusted for splits and dividends (bars_long.json from fetch_long.mjs),
// signal at the close, entry next open, 0.1% cost per side.   node backtest40.mjs
import { readFileSync } from "node:fs";
import { memberAt, prep, mean, f2, COST } from "./lib14.mjs";
const raw = JSON.parse(readFileSync("bars_long.json", "utf8"));
const data = new Map(); for (const [s, rows] of Object.entries(raw)) if (rows.length >= 300) data.set(s, prep(rows));
const SPY = data.get("SPY"), QQQ = data.get("QQQ"); data.delete("SPY"); data.delete("QQQ");
const WARM = 260;
const sdv = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = a => a.length > 2 ? mean(a) / (sdv(a) / Math.sqrt(a.length)) : NaN;
let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const idxOk = (I, date) => { const j = I.dateIdx.get(date); return j !== undefined && j >= 60 && I.c[j] > I.sma50[j] && I.sma50[j] > I.sma50[j - 10]; };
const mktOk = new Map(); for (const d of SPY.d) mktOk.set(d, idxOk(SPY, d) && idxOk(QQQ, d));
const rsAll = new Map();
for (const [sym, S] of data) for (let t = 126; t < S.n; t++) { if (!memberAt(sym, S.d[t])) continue; (rsAll.get(S.d[t]) || rsAll.set(S.d[t], []).get(S.d[t])).push(S.c[t] / S.c[t - 126] - 1); }
const rsCut = new Map(); for (const [d, a] of rsAll) { a.sort((x, y) => x - y); rsCut.set(d, a[Math.floor(a.length * 0.8)]); }
const leader = (S, t) => S.c[t] / S.c[t - 126] - 1 >= rsCut.get(S.d[t]) && S.c[t] > S.sma50[t] && S.c[t] > S.sma200[t];
const ok = (S, t) => S.st[t] === 1 && !S.hasBad(t - 130, t);
// entry rules: fn(sym, S, t)
const RULES = {
  "leaders + rising market": (sym, S, t) => ok(S, t) && mktOk.get(S.d[t]) && leader(S, t),
  "leaders, any market": (sym, S, t) => ok(S, t) && leader(S, t),
  "any stock + rising market": (sym, S, t) => ok(S, t) && mktOk.get(S.d[t]),
  "any stock, any market": (sym, S, t) => ok(S, t),
};
// one trade. mode TRAIL: out on a close under the Supertrend line (next open). T5: all out at +5% too. HALF: half at +5%, rest stop to breakeven and trail.
function sim(S, t, mode) {
  const e = t + 1; if (e >= S.n) return null; const entry = S.o[e]; const tgt = mode === "TRAIL" ? Infinity : entry * 1.05;
  let stop = -Infinity, half = false, got = 0, rem = 1, exit = NaN, x = S.n - 1;
  for (let k = e; k < S.n; k++) {
    if (k > e && S.o[k] <= stop) { exit = S.o[k]; x = k; break; }
    if (S.l[k] <= stop) { exit = stop; x = k; break; }
    if (!half && (S.h[k] >= tgt || (k > e && S.o[k] >= tgt))) { const px = k > e && S.o[k] >= tgt ? S.o[k] : tgt;
      if (mode === "HALF") { half = true; got = 0.5 * (px / entry - 1); rem = 0.5; stop = entry; } else { exit = px; x = k; break; } }
    if (S.st[k] === -1) { if (k + 1 < S.n) { exit = S.o[k + 1]; x = k + 1; } else { exit = S.c[k]; x = k; } break; }
  }
  if (!Number.isFinite(exit)) exit = S.c[S.n - 1];
  return { ret: (got + rem * (exit / entry - 1) - 2 * COST) * 100, days: x - e + 1, date: S.d[e], x };
}
function trades(rule, mode) { const out = [];
  for (const [sym, S] of data) for (let t = WARM; t < S.n - 1; t++) { if (!memberAt(sym, S.d[t]) || !rule(sym, S, t)) continue; const r = sim(S, t, mode); if (!r) break; out.push(r); t = r.x; }
  return out; }
function rep(tr) { const r = tr.map(x => x.ret), w = r.filter(x => x > 0), l = r.filter(x => x <= 0);
  return `n ${String(r.length).padStart(6)}  win ${f2(w.length / r.length * 100, 1)}%  avg ${f2(mean(r))}%  avgWin ${f2(mean(w))}%  avgLoss ${f2(mean(l))}%  PF ${f2(w.reduce((a, b) => a + b, 0) / -l.reduce((a, b) => a + b, 0))}  days ${f2(mean(tr.map(x => x.days)), 1)}  per day ${f2(mean(r) / mean(tr.map(x => x.days)), 3)}%  t ${f2(tstat(r), 1)}`; }

console.log(`stocks with data ${data.size}, ${SPY.d[WARM]} to ${SPY.d.at(-1)}`);
console.log("\n=== Per trade (every qualifying stock, one open trade per stock) ===");
for (const [name, rule] of Object.entries(RULES)) for (const mode of ["TRAIL", "HALF", "T5"]) console.log(`${name.padEnd(28)} ${mode.padEnd(6)} ${rep(trades(rule, mode))}`);
console.log("\n=== By year, average per trade, TRAIL exit ===");
{ const A = trades(RULES["leaders + rising market"], "TRAIL"), B = trades(RULES["any stock, any market"], "TRAIL"), C = trades(RULES["leaders, any market"], "TRAIL");
  const by = a => { const m = {}; for (const x of a) (m[x.date.slice(0, 4)] ||= []).push(x.ret); return m; }; const a = by(A), b = by(B), c = by(C);
  for (const y of Object.keys(b).sort()) console.log(`${y}  leaders+market n ${String((a[y] || []).length).padStart(4)} ${f2(mean(a[y] || [])).padStart(6)}%   leaders n ${String((c[y] || []).length).padStart(4)} ${f2(mean(c[y] || [])).padStart(6)}%   any stock n ${String(b[y].length).padStart(5)} ${f2(mean(b[y])).padStart(6)}%`); }

// ---- portfolio: N equal slots, fills free slots at the open from the prior close's candidates ----
function portfolio(rule, mode, N, pick) {
  const dates = SPY.d.slice(WARM); let cash = 1; const pos = new Map(); const eq = []; let nTr = 0, nWin = 0, expo = 0; let prevCands = [];
  for (const d of dates) {
    // exits and intraday handling
    for (const [sym, p] of pos) { const S = p.S, t = S.dateIdx.get(d);
      if (t === undefined) { if (S.d[S.n - 1] < d) { cash += p.sh * p.last * (1 - COST); p.pnl += p.sh * p.last * (1 - COST); nTr++; if (p.pnl > p.cost) nWin++; pos.delete(sym); } continue; }
      const sell = (px, frac) => { const sh = p.sh * frac; cash += sh * px * (1 - COST); p.pnl += sh * px * (1 - COST); p.sh -= sh; };
      const close = px => { sell(px, 1); nTr++; if (p.pnl > p.cost) nWin++; pos.delete(sym); };
      if (p.exitNext) { close(S.o[t]); continue; }
      if (S.o[t] <= p.stop) { close(S.o[t]); continue; } if (S.l[t] <= p.stop) { close(p.stop); continue; }
      if (!p.half && mode !== "TRAIL" && S.h[t] >= p.tgt) { const px = Math.max(p.tgt, S.o[t]); if (mode === "HALF") { sell(px, 0.5); p.half = true; p.stop = p.entry; } else { close(px); continue; } }
      if (S.st[t] === -1) p.exitNext = true; p.last = S.c[t]; }
    // entries
    let free = N - pos.size; if (free > 0 && prevCands.length) { const eqNow = cash + [...pos.values()].reduce((s, p) => s + p.sh * p.last, 0);
      for (const [sym, S, score] of prevCands) { if (free <= 0) break; if (pos.has(sym)) continue; const t = S.dateIdx.get(d); if (t === undefined) continue; const amt = Math.min(cash, eqNow / N); if (amt <= 0) break;
        const px = S.o[t], sh = amt * (1 - COST) / px; cash -= amt; const p = { S, sh, entry: px, cost: amt, pnl: 0, stop: -Infinity, tgt: px * 1.05, half: false, exitNext: false, last: S.c[t] };
        if (mode !== "TRAIL" && S.h[t] >= p.tgt) { if (mode === "HALF") { const s2 = sh * 0.5; cash += s2 * p.tgt * (1 - COST); p.pnl += s2 * p.tgt * (1 - COST); p.sh -= s2; p.half = true; p.stop = px; } else { cash += sh * p.tgt * (1 - COST); nTr++; nWin++; continue; } }
        if (S.st[t] === -1) p.exitNext = true; pos.set(sym, p); free--; } }
    // candidates at today's close
    prevCands = []; if (N - pos.size > 0 || true) { for (const [sym, S] of data) { const t = S.dateIdx.get(d); if (t === undefined || t < WARM || !memberAt(sym, d) || !rule(sym, S, t)) continue; prevCands.push([sym, S, pick === "top" ? S.c[t] / S.c[t - 126] : rnd()]); } prevCands.sort((a, b) => b[2] - a[2]); }
    const inv = [...pos.values()].reduce((s, p) => s + p.sh * p.last, 0); eq.push(cash + inv); expo += inv / (cash + inv);
  }
  const yrs = dates.length / 252, cagr = (eq.at(-1) ** (1 / yrs) - 1) * 100; let pk = 0, dd = 0; for (const v of eq) { pk = Math.max(pk, v); dd = Math.max(dd, 1 - v / pk); }
  const byY = {}; let prev = 1; dates.forEach((d, i) => { const y = d.slice(0, 4); if (i === dates.length - 1 || dates[i + 1].slice(0, 4) !== y) { byY[y] = (eq[i] / prev - 1) * 100; prev = eq[i]; } });
  const rets = eq.map((v, i) => i ? v / eq[i - 1] - 1 : 0), sharpe = mean(rets) / sdv(rets) * Math.sqrt(252);
  return { cagr, dd: dd * 100, sharpe, nTr, win: nWin / nTr * 100, expo: expo / dates.length * 100, byY, final: eq.at(-1) };
}
const spy = (() => { const c = SPY.c.slice(WARM - 1), yrs = (c.length - 1) / 252; let pk = 0, dd = 0; for (const v of c) { pk = Math.max(pk, v); dd = Math.max(dd, 1 - v / pk); }
  const byY = {}; let prev = c[0]; SPY.d.slice(WARM).forEach((d, i, a) => { const y = d.slice(0, 4); if (i === a.length - 1 || a[i + 1].slice(0, 4) !== y) { byY[y] = (c[i + 1] / prev - 1) * 100; prev = c[i + 1]; } });
  const r = c.map((v, i) => i ? v / c[i - 1] - 1 : 0); return { cagr: ((c.at(-1) / c[0]) ** (1 / yrs) - 1) * 100, dd: dd * 100, sharpe: mean(r) / sdv(r) * Math.sqrt(252), byY }; })();
console.log("\n=== Portfolio (equal slots, no leverage, cash earns nothing) ===");
console.log(`${"SPY buy and hold (dividends included)".padEnd(52)} ${f2(spy.cagr, 1)}% a year  worst drop ${f2(spy.dd, 0)}%  Sharpe ${f2(spy.sharpe)}`);
const RUNS = [["leaders + rising market", "TRAIL", 10, "top"], ["leaders + rising market", "TRAIL", 10, "random"], ["leaders + rising market", "TRAIL", 20, "top"], ["leaders + rising market", "TRAIL", 20, "random"],
  ["leaders + rising market", "HALF", 10, "random"], ["leaders + rising market", "T5", 10, "random"], ["leaders, any market", "TRAIL", 10, "random"], ["leaders, any market", "TRAIL", 20, "random"],
  ["any stock + rising market", "TRAIL", 20, "random"], ["any stock, any market", "TRAIL", 20, "random"]];
const keep = {};
for (const [r, m, N, pick] of RUNS) { const reps = pick === "random" ? 5 : 1, rs = []; for (let i = 0; i < reps; i++) rs.push(portfolio(RULES[r], m, N, pick)); const av = k => mean(rs.map(x => x[k]));
  const name = `${r}, ${m}, ${N} slots, ${pick === "top" ? "strongest first" : "random pick (5 runs)"}`; keep[name] = rs;
  console.log(`${name.padEnd(52)} ${f2(av("cagr"), 1)}% a year${reps > 1 ? ` (${f2(Math.min(...rs.map(x => x.cagr)), 1)} to ${f2(Math.max(...rs.map(x => x.cagr)), 1)})` : ""}  worst drop ${f2(av("dd"), 0)}%  Sharpe ${f2(av("sharpe"))}  trades ${Math.round(av("nTr"))}  win ${f2(av("win"), 1)}%  invested ${f2(av("expo"), 0)}%`); }
console.log("\n=== Year by year: SPY vs leaders + rising market, TRAIL, 10 slots random (mean of 5) vs leaders any market, TRAIL, 10 slots random ===");
{ const a = keep["leaders + rising market, TRAIL, 10 slots, random pick (5 runs)"], b = keep["leaders, any market, TRAIL, 10 slots, random pick (5 runs)"];
  for (const y of Object.keys(spy.byY).sort()) console.log(`${y}  SPY ${f2(spy.byY[y], 1).padStart(6)}%   leaders+market ${f2(mean(a.map(x => x.byY[y])), 1).padStart(6)}%   leaders any market ${f2(mean(b.map(x => x.byY[y])), 1).padStart(6)}%`); }
