// The stress-dip book: market-stress pullbacks with a tight stop. Tests (1) the book itself, (2) an earnings-in-hold flag, (3) regime sizing by how deep the market drop is.
import { readFileSync } from "node:fs";
import { data, SPY, memberAt, stats, mean, f2, COST, WARM } from "./lib14.mjs";
const SPLIT = "2024-11-05", earn = JSON.parse(readFileSync("earnings.json", "utf8"));
const spy5 = (S, t) => { const j = SPY.dateIdx.get(S.d[t]); return j !== undefined && j >= 5 ? SPY.c[j] / SPY.c[j - 5] - 1 : NaN; };
const spyBelow200 = (S, t) => { const j = SPY.dateIdx.get(S.d[t]); return j !== undefined && SPY.c[j] < SPY.sma200[j]; };
const spyAtr = (S, t) => { const j = SPY.dateIdx.get(S.d[t]); return j !== undefined ? SPY.atr14[j] / SPY.c[j] * 100 : NaN; };
const BOOKS = {
  "B1 pullback (5d<0) + Supertrend up + SPY 5d<=-1.5%": (S, t) => S.c[t] < S.c[t - 5] && S.st[t] === 1 && spy5(S, t) <= -0.015,
  "B2 RSI2<10 above 200d + SPY 5d<=-1.5%": (S, t) => S.c[t] > S.sma200[t] && S.rsi2[t] < 10 && spy5(S, t) <= -0.015,
  "B3 pullback + above 50d + SPY 5d<=-1.5%": (S, t) => S.c[t] < S.c[t - 5] && S.c[t] > S.sma50[t] && spy5(S, t) <= -0.015,
};
const EX = { "stop 2 ATR / target 1 ATR": [2, 1], "stop 1.5 ATR / target 0.75 ATR": [1.5, 0.75] }, H = 10;
function sim(S, t, sA, tA) { const e = t + 1; if (e + H - 1 >= S.n) return null; const entry = S.o[e], atr = S.atr14[t]; if (!(entry > 0)) return null; const stop = entry - sA * atr, tp = entry + tA * atr; let exit = S.c[e + H - 1], day = H;
  for (let j = e; j < e + H; j++) { if (j > e && S.o[j] <= stop) { exit = S.o[j]; day = j - e + 1; break; } if (S.l[j] <= stop) { exit = stop; day = j - e + 1; break; } if (j > e && S.o[j] >= tp) { exit = S.o[j]; day = j - e + 1; break; } if (S.h[j] >= tp) { exit = tp; day = j - e + 1; break; } }
  return { ret: (exit / entry - 1 - 2 * COST) * 100, day, entryIdx: e, stopPct: 100 * sA * atr / entry }; }
const nextSession = (S, date) => { const i = S.dateIdx.get(date); return i === undefined ? date : (S.d[i + 1] || date); };
const sh = (name, tr) => { const s = stats(tr); const w = tr.map(x => x.ret).sort((a, b) => a - b); return `${name.padEnd(30)} n=${String(s.n).padStart(5)} win ${f2(s.win, 1).padStart(5)}% avg ${f2(s.avg).padStart(5)}% avg win ${f2(s.avgWin).padStart(5)} loss ${f2(s.avgLoss).padStart(5)} worst5% ${f2(w[Math.floor(w.length * 0.05)], 1)}%`; };
for (const [exn, [sA, tA]] of Object.entries(EX)) for (const [bn, rule] of Object.entries(BOOKS)) {
  const tr = [];
  for (const [sym, S] of data) { if (sym === "SPY") continue; let free = -1;
    for (let t = WARM; t < S.n - H - 2; t++) { if (t <= free || !memberAt(sym, S.d[t]) || !(S.atr14[t] > 0) || S.hasBad(t - 252, t + H + 1)) continue; let ok = false; try { ok = rule(S, t); } catch {} if (!ok) continue;
      const r = sim(S, t, sA, tA); if (!r) continue; free = t + H;
      const ev = earn[sym]; let flag = null; if (ev && ev.length) { const first = ev[0][0]; if (S.d[t + 1] >= first) { const a = S.d[r.entryIdx], b = S.d[r.entryIdx + r.day - 1]; flag = ev.some(([d, when]) => { const rd = when === "pm" ? nextSession(S, d) : d; return rd >= a && rd <= b; }); } }
      tr.push({ ...r, sym, date: S.d[r.entryIdx], flag, s5: spy5(S, t) * 100, below200: spyBelow200(S, t), spyAtr: spyAtr(S, t), stopPct: r.stopPct }); } }
  console.log(`\n################ ${bn} | ${exn} (avg stop ${f2(mean(tr.map(x => x.stopPct)), 1)}% of price)`);
  console.log(sh("ALL", tr)); console.log(sh("  train", tr.filter(x => x.date < SPLIT))); console.log(sh("  test", tr.filter(x => x.date >= SPLIT)));
  const days = new Map(); for (const x of tr) (days.get(x.date) || days.set(x.date, []).get(x.date)).push(x.ret);
  const bk = [...days.values()].map(a => mean(a)); console.log(`  signal days ${days.size}, avg ${f2(tr.length / days.size, 1)} trades per signal day; equal-weight basket per day: mean ${f2(mean(bk))}%, positive on ${f2(bk.filter(x => x > 0).length / bk.length * 100, 0)}% of days`);
  // earnings flag (only stocks/dates with earnings coverage)
  const cov = tr.filter(x => x.flag !== null), fl = cov.filter(x => x.flag), cl = cov.filter(x => !x.flag);
  console.log(`  earnings flag (covered trades ${cov.length}):`); console.log("   " + sh("report inside hold", fl)); console.log("   " + sh("no report in hold", cl));
  // regime depth buckets and sizing
  const B = [["SPY 5d -1.5% to -2.5%", x => x.s5 > -2.5], ["SPY 5d -2.5% to -4%", x => x.s5 <= -2.5 && x.s5 > -4], ["SPY 5d below -4%", x => x.s5 <= -4]];
  console.log("  by market drop depth:"); for (const [l, f] of B) console.log("   " + sh(l, tr.filter(f)));
  console.log("   " + sh("SPY above 200d", tr.filter(x => !x.below200))); console.log("   " + sh("SPY below 200d", tr.filter(x => x.below200)));
  const vm = [...tr.map(x => x.spyAtr)].sort((a, b) => a - b)[Math.floor(tr.length / 2)]; console.log("   " + sh(`SPY ATR% <= median (${f2(vm)}%)`, tr.filter(x => x.spyAtr <= vm))); console.log("   " + sh("SPY ATR% > median", tr.filter(x => x.spyAtr > vm)));
  const wgt = x => x.s5 <= -4 ? 2 : x.s5 <= -2.5 ? 1.5 : 1, wsum = a => a.reduce((s, x) => s + wgt(x) * x.ret, 0) / a.reduce((s, x) => s + wgt(x), 0);
  console.log(`  sizing x1 / x1.5 (drop<=-2.5%) / x2 (drop<=-4%): equal-weight avg ${f2(mean(tr.map(x => x.ret)))}% vs weighted ${f2(wsum(tr))}% (train ${f2(wsum(tr.filter(x => x.date < SPLIT)))}, test ${f2(wsum(tr.filter(x => x.date >= SPLIT)))}); sizing does not change the win rate`);
}
