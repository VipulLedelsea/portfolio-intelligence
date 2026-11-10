// Gate check for the app's profit lock: replay the WORKER's own profitLockState (imported from worker/runtime.js) over every daily Supertrend flip, day by day,
// and compare the result with the backtest (backtest36.mjs: arm at a close up 3%, stop at entry +1%: 61.8% wins, +1.17% per trade, hold 38.7% wins, +1.45%).
import { readFileSync } from "node:fs";
import { data, exitSim, mean, f2, memberAt, WARM, COST } from "./lib14.mjs";
const source = readFileSync(new URL("../../worker/runtime.js", import.meta.url), "utf8").replace(/^export default \{/m, "const __default = {");
const rt = await import("data:text/javascript;base64," + Buffer.from(`${source}\nexport { profitLockState };`).toString("base64"));
const SPLIT = "2024-11-05", results = [];
for (const [sym, S] of data) { if (sym === "SPY") continue;
  for (let t = WARM; t < S.n - 130; t++) { if (!(S.st[t] === 1 && S.st[t - 1] === -1) || !memberAt(sym, S.d[t]) || !(S.atr14[t] > 0)) continue; const hold = exitSim(S, t, { st: true }); if (!hold || S.hasBad(t - 252, t + 1 + hold.days + 1)) continue;
    const e = t + 1, entry = S.o[e], last = Math.min(S.n - 1, e + 119); let armedAt = null, hitAt = null, ret = null; const bars = [];
    for (let d = e; d <= last && ret === null; d++) { bars.push({ d: S.d[d], l: S.l[d], h: S.h[d], c: S.c[d] });
      // the line exit that day (close under the Supertrend line) ends the trade before the lock matters
      const lock = rt.profitLockState({ buy: entry, boughtDate: S.d[e], bars: bars.slice(1), price: S.c[d], armedAt, hitAt, stop: 0 });
      if (lock.armed && !armedAt) armedAt = lock.armed_on;
      if (lock.armed && lock.hit) { // price came back to the lock: exit at the lock (or the open if it gapped under) on the day of the touch, or the close if only the live price was under it
        const touched = lock.touched_on ? bars.find(b => b.d === lock.touched_on) : null, k = touched ? S.d.indexOf(touched.d) : d; const px = touched ? (S.o[k] <= lock.level ? S.o[k] : lock.level) : S.c[d];
        ret = (px / entry - 1 - 2 * COST) * 100; break; }
      if (S.st[d] === -1) break; }
    results.push({ ret: ret ?? hold.ret, hold: hold.ret, date: S.d[e] }); } }
const sum = (a, f = x => x) => { const r = a.map(f), n = r.length, w = r.filter(x => x > 0.5), l = r.filter(x => x <= -0.5); return `wins ${f2(w.length / n * 100, 1)}%  losses ${f2(l.length / n * 100, 1)}%  avg ${f2(mean(r))}% (win ${f2(mean(w), 1)} / loss ${f2(mean(l), 1)})`; };
console.log(`flips replayed: ${results.length}`);
console.log("HOLD to the line:       " + sum(results, x => x.hold));
console.log("WORKER profit lock:     " + sum(results, x => x.ret));
console.log("  early half:           " + sum(results.filter(x => x.date < SPLIT), x => x.ret) + "   (hold " + sum(results.filter(x => x.date < SPLIT), x => x.hold) + ")");
console.log("  late half:            " + sum(results.filter(x => x.date >= SPLIT), x => x.ret) + "   (hold " + sum(results.filter(x => x.date >= SPLIT), x => x.hold) + ")");
console.log("Backtest reference (backtest36: up 3% -> stop to entry +1%): wins 61.8%, losses 35.6%, avg +1.17%; early +1.47 / late +0.78; hold wins 38.7%, avg +1.45%");
