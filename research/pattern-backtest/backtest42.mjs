// The rebound rules that survived backtest41, traded for real: one open trade per stock, then a 10-slot portfolio. Research only.
// 20-year point-in-time S&P 500, entry next open, 0.1% cost per side.   node --max-old-space-size=8192 backtest42.mjs
import { data, memberAt, SPY, mean, f2, COST } from "./lib41.mjs";
const WARM = 260; data.delete("QQQ");
const sj = (S, t) => SPY.dateIdx.get(S.d[t]);
const bear = (S, t) => { const j = sj(S, t); return j !== undefined && SPY.c[j] < SPY.sma200[j]; };
const deep = (S, t) => S.c[t] <= 0.6 * S.hi252[t] && S.c[t] > S.c[t - 126];
const RULES = {
  "A: 40%+ under high, up over 6 months": (S, t) => deep(S, t),
  "B: A, only while SPY is under its 200-day": (S, t) => deep(S, t) && bear(S, t),
  "C: A, above 100-day, 50-day over 200-day": (S, t) => deep(S, t) && S.c[t] > S.sma100[t] && S.sma50[t] > S.sma200[t],
  "D: panic dip in a bear market (RSI2<10, quiet volume, SPY wild and under 200-day)": (S, t) => { const j = sj(S, t); return j !== undefined && S.rsi2[t] < 10 && S.v[t] < 0.8 * S.vol50[t] && SPY.atr14[j] / SPY.c[j] >= 0.02 && SPY.c[j] < SPY.sma200[j]; },
  "control: any stock, any day": () => true,
  "control: any stock while SPY is under its 200-day": (S, t) => bear(S, t),
  "control: 40%+ under high (no 6-month rise needed)": (S, t) => S.c[t] <= 0.6 * S.hi252[t],
};
const EX = [[5, 3, 10], [9, 3, 20], [5, 5, 10]];
function sim(S, t, [TP, SL, H]) { const e = t + 1; if (e + H > S.n) return null; const entry = S.o[e], tgt = entry * (1 + TP / 100), stop = entry * (1 - SL / 100);
  for (let k = e; k < e + H; k++) { if (k > e && S.o[k] <= stop) return { r: S.o[k] / entry - 1, x: k }; if (S.l[k] <= stop) return { r: -SL / 100, x: k }; if (k > e && S.o[k] >= tgt) return { r: S.o[k] / entry - 1, x: k }; if (S.h[k] >= tgt) return { r: TP / 100, x: k }; }
  return { r: S.c[e + H - 1] / entry - 1, x: e + H - 1 }; }
const sdv = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
console.log("=== Per trade, one open trade per stock ===");
for (const [name, rule] of Object.entries(RULES)) { console.log(name);
  for (const ex of EX) { const tr = []; for (const [sym, S] of data) { if (sym === "SPY") continue; for (let t = WARM; t < S.n - 1; t++) { if (!memberAt(sym, S.d[t]) || sj(S, t) === undefined || S.hasBad(t - 255, t) || !rule(S, t)) continue; const r = sim(S, t, ex); if (!r) break; tr.push({ ret: (r.r - 2 * COST) * 100, y: S.d[t].slice(0, 4) }); t = r.x; } }
    const r = tr.map(x => x.ret), w = r.filter(x => x > 0), l = r.filter(x => x <= 0), by = {}; for (const x of tr) (by[x.y] ||= []).push(x.ret); const ys = Object.keys(by).sort(), pos = ys.filter(y => mean(by[y]) > 0).length;
    const a = tr.filter(x => x.y < "2017").map(x => x.ret), b = tr.filter(x => x.y >= "2017").map(x => x.ret);
    console.log(`   +${ex[0]}% / -${ex[1]}% / ${ex[2]}d  n ${String(r.length).padStart(6)}  win ${f2(w.length / r.length * 100, 1)}%  avg ${f2(mean(r))}%  avgWin ${f2(mean(w))}%  avgLoss ${f2(mean(l))}%  PF ${f2(w.reduce((s, x) => s + x, 0) / -l.reduce((s, x) => s + x, 0))}  | 2006-16 ${f2(mean(a))}% (n ${a.length})  2017-26 ${f2(mean(b))}% (n ${b.length})  | ${pos} of ${ys.length} years positive`);
    if (ex[0] === 5 && ex[1] === 3 && !name.startsWith("control: any stock, any")) console.log("      by year: " + ys.map(y => `${y.slice(2)}:${by[y].length}/${f2(mean(by[y]), 1)}`).join(" ")); } }

// ---- portfolio ----
let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
function portfolio(rule, [TP, SL, H], N) { const dates = SPY.d.slice(WARM); let cash = 1; const pos = new Map(), eq = []; let nTr = 0, nWin = 0, expo = 0, cands = [];
  for (const d of dates) {
    for (const [sym, p] of pos) { const S = p.S, t = S.dateIdx.get(d); if (t === undefined) { if (S.d[S.n - 1] < d) { cash += p.sh * p.last * (1 - COST); nTr++; pos.delete(sym); } continue; }
      let px = NaN; if (S.o[t] <= p.stop) px = S.o[t]; else if (S.l[t] <= p.stop) px = p.stop; else if (S.o[t] >= p.tgt) px = S.o[t]; else if (S.h[t] >= p.tgt) px = p.tgt; else if (++p.age >= H) px = S.c[t];
      if (Number.isFinite(px)) { cash += p.sh * px * (1 - COST); nTr++; if (px * (1 - COST) * (1 - COST) > p.entry) nWin++; pos.delete(sym); } else p.last = S.c[t]; }
    if (pos.size < N && cands.length) { const eqNow = cash + [...pos.values()].reduce((s, p) => s + p.sh * p.last, 0);
      for (const [sym, S] of cands) { if (pos.size >= N) break; if (pos.has(sym)) continue; const t = S.dateIdx.get(d); if (t === undefined) continue; const amt = Math.min(cash, eqNow / N); if (amt <= 1e-9) break; const px = S.o[t]; cash -= amt;
        const p = { S, sh: amt * (1 - COST) / px, entry: px, stop: px * (1 - SL / 100), tgt: px * (1 + TP / 100), age: 1, last: S.c[t] };
        let ex = NaN; if (S.l[t] <= p.stop) ex = p.stop; else if (S.h[t] >= p.tgt) ex = p.tgt; else if (H <= 1) ex = S.c[t];
        if (Number.isFinite(ex)) { cash += p.sh * ex * (1 - COST); nTr++; if (ex * (1 - COST) * (1 - COST) > px) nWin++; } else pos.set(sym, p); } }
    cands = []; for (const [sym, S] of data) { if (sym === "SPY") continue; const t = S.dateIdx.get(d); if (t === undefined || t < WARM || t >= S.n - 1 || !memberAt(sym, d) || S.hasBad(t - 255, t) || !rule(S, t)) continue; cands.push([sym, S, rnd()]); } cands.sort((a, b) => a[2] - b[2]);
    const inv = [...pos.values()].reduce((s, p) => s + p.sh * p.last, 0); eq.push(cash + inv); expo += inv / (cash + inv); }
  const yrs = dates.length / 252; let pk = 0, dd = 0; for (const v of eq) { pk = Math.max(pk, v); dd = Math.max(dd, 1 - v / pk); }
  const byY = {}; let prev = 1; dates.forEach((d, i) => { const y = d.slice(0, 4); if (i === dates.length - 1 || dates[i + 1].slice(0, 4) !== y) { byY[y] = (eq[i] / prev - 1) * 100; prev = eq[i]; } });
  const rets = eq.map((v, i) => i ? v / eq[i - 1] - 1 : 0);
  return { cagr: (eq.at(-1) ** (1 / yrs) - 1) * 100, dd: dd * 100, sharpe: mean(rets) / sdv(rets) * Math.sqrt(252), nTr, win: nWin / nTr * 100, expo: expo / dates.length * 100, byY }; }
console.log("\n=== Portfolio, 10 equal slots, random pick among the day's candidates (mean of 5 runs), cash earns nothing ===");
const spyC = SPY.c.slice(WARM - 1); console.log(`SPY buy and hold: ${f2(((spyC.at(-1) / spyC[0]) ** (252 / (spyC.length - 1)) - 1) * 100, 1)}% a year`);
const keep = {};
for (const name of Object.keys(RULES).slice(0, 4)) for (const ex of EX.slice(0, 2)) { const rs = []; for (let i = 0; i < 5; i++) rs.push(portfolio(RULES[name], ex, 10)); const av = k => mean(rs.map(x => x[k])); keep[name + ex[0]] = rs;
  console.log(`${name.slice(0, 44).padEnd(44)} +${ex[0]}/-${ex[1]}/${ex[2]}d  ${f2(av("cagr"), 1)}% a year (${f2(Math.min(...rs.map(x => x.cagr)), 1)} to ${f2(Math.max(...rs.map(x => x.cagr)), 1)})  worst drop ${f2(av("dd"), 0)}%  Sharpe ${f2(av("sharpe"))}  trades ${Math.round(av("nTr"))}  win ${f2(av("win"), 1)}%  invested ${f2(av("expo"), 0)}%`); }
console.log("\nYear by year, +5/-3/10d (mean of 5 runs):");
const ys = Object.keys(keep[Object.keys(keep)[0]][0].byY).sort();
for (const y of ys) console.log(y + "  " + Object.keys(RULES).slice(0, 4).map(n => `${n[0]} ${f2(mean(keep[n + 5].map(x => x.byY[y])), 1).padStart(6)}%`).join("   "));
