// Past reports with the EPS estimate and actual from Robinhood's earnings feed, for every stock in bars.json / bars_former.json.
// Output: earnings_eps.json { SYMBOL: [[date, timing, estimate, actual], ...] } (timing "am" = before the open, "pm" = after the close; only rows with both numbers).
// The feed holds about the last five quarters. Used by backtest48.mjs. Run: node fetch_earnings_eps.mjs
import { readFileSync, writeFileSync } from "node:fs";
const syms = Object.keys({ ...JSON.parse(readFileSync("bars_former.json", "utf8")), ...JSON.parse(readFileSync("bars.json", "utf8")) });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = {}; let empty = 0;
for (const s of syms) {
  let rows = null;
  for (let i = 0; i < 3 && !rows; i++) {
    try { const r = await fetch(`https://api.robinhood.com/marketdata/earnings/?symbol=${encodeURIComponent(s)}`, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0" } }); if (r.ok) rows = (await r.json()).results || []; else await sleep(800); } catch { await sleep(800); }
  }
  const keep = (rows || []).filter(x => x.report?.date && x.eps?.estimate != null && x.eps?.actual != null)
    .map(x => [x.report.date.slice(0, 10), x.report.timing || null, +x.eps.estimate, +x.eps.actual]).sort((a, b) => a[0] < b[0] ? -1 : 1);
  if (keep.length) out[s] = keep; else empty++;
  await sleep(60);
}
writeFileSync("earnings_eps.json", JSON.stringify(out));
const dates = Object.values(out).flat().map(r => r[0]).sort();
console.log(`stocks with reports ${Object.keys(out).length}, none ${empty}, reports ${dates.length}, earliest ${dates[0]}, latest ${dates.at(-1)}`);
