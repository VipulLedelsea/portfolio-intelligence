// Long daily history (2005 on) from Yahoo's chart endpoint for every S&P 500 member since 2008, plus SPY and QQQ -> bars_long.json
// Prices are adjusted for splits and dividends (each bar scaled by adjclose / close). Tickers no longer listed return nothing.
import { readFileSync, writeFileSync } from "node:fs";
const syms = [...new Set(readFileSync("members.csv", "utf8").trim().split("\n").slice(1).map(l => l.split(",")).filter(([, , e]) => !e || e >= "2008-01-01").map(x => x[0])), "SPY", "QQQ"];
const out = {}, miss = [];
async function one(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym.replace(/\./g, "-")}?period1=1104537600&period2=1794000000&interval=1d&events=div%2Csplits`;
  for (let a = 0; a < 4; a++) {
    try { const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
      if (r.status === 404) { miss.push(sym); return; } if (!r.ok) throw new Error("HTTP " + r.status);
      const res = (await r.json()).chart?.result?.[0]; const q = res?.indicators?.quote?.[0], adj = res?.indicators?.adjclose?.[0]?.adjclose; if (!q || !res.timestamp) { miss.push(sym); return; }
      const rows = []; for (let i = 0; i < res.timestamp.length; i++) { const c = q.close[i]; if (!(c > 0) || !(q.open[i] > 0)) continue; const f = adj && adj[i] > 0 ? adj[i] / c : 1;
        rows.push([new Date((res.timestamp[i] + res.meta.gmtoffset) * 1000).toISOString().slice(0, 10), +(q.open[i] * f).toFixed(4), +(q.high[i] * f).toFixed(4), +(q.low[i] * f).toFixed(4), +(c * f).toFixed(4), q.volume[i] || 0]); }
      if (rows.length) out[sym] = rows; else miss.push(sym); return;
    } catch (e) { await new Promise(r => setTimeout(r, 2000 * (a + 1))); if (a === 3) miss.push(sym + "!"); } }
}
let i = 0; await Promise.all(Array.from({ length: 4 }, async () => { while (i < syms.length) { await one(syms[i++]); await new Promise(r => setTimeout(r, 120)); } }));
writeFileSync("bars_long.json", JSON.stringify(out));
const lens = Object.values(out).map(v => v.length).sort((a, b) => a - b);
console.log("asked", syms.length, "got", Object.keys(out).length, "missing", miss.length, "bars median", lens[lens.length >> 1], "SPY", out.SPY?.[0]?.[0], out.SPY?.at(-1)?.[0]);
console.log("missing:", miss.join(" "));
