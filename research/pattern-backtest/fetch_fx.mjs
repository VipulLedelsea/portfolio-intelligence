import { writeFileSync } from "node:fs";
const pairs = ["EURUSD","GBPUSD","USDJPY","USDCHF","AUDUSD","USDCAD","NZDUSD","EURGBP","EURJPY","GBPJPY","AUDJPY","EURCHF","EURAUD"];
const out = {};
for (const p of pairs) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${p}=X?interval=1d&range=5y&includePrePost=false`, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; research)" } });
  if (!r.ok) { console.log(p, "HTTP", r.status); continue; }
  const j = (await r.json()).chart?.result?.[0]; const q = j?.indicators?.quote?.[0]; if (!j?.timestamp) { console.log(p, "no data"); continue; }
  const rows = [];
  j.timestamp.forEach((t, i) => { if (q.close[i] != null && q.open[i] != null) rows.push([new Date(t * 1000).toISOString().slice(0, 10), q.open[i], q.high[i], q.low[i], q.close[i], 0]); });
  out[p] = rows; await new Promise(r => setTimeout(r, 400));
}
writeFileSync("bars_fx.json", JSON.stringify(out));
console.log(Object.keys(out).length, "pairs;", Object.values(out).map(v => v.length).join(","));
