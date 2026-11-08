// Past and upcoming report dates from Robinhood's earnings feed for every stock in bars.json / bars_former.json.
// Output: earnings.json { SYMBOL: [[date, timing], ...] } (timing "am" = before the open, "pm" = after the close).
// The feed holds about the last five quarters, so tests that use it cover roughly the last 17 months. Run: node fetch_earnings.mjs
import { readFileSync, writeFileSync } from "node:fs";
const syms = Object.keys({ ...JSON.parse(readFileSync("bars_former.json", "utf8")), ...JSON.parse(readFileSync("bars.json", "utf8")) });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = {}; let empty = 0;
for (const s of syms) {
  let rows = null;
  for (let i = 0; i < 3 && !rows; i++) {
    try { const r = await fetch(`https://api.robinhood.com/marketdata/earnings/?symbol=${encodeURIComponent(s)}`, { headers: { accept: "application/json", "user-agent": "PortfolioIntelligence/1.0" } }); if (r.ok) rows = (await r.json()).results || []; else await sleep(800); } catch { await sleep(800); }
  }
  if (rows?.length) out[s] = rows.filter(x => x.report?.date).map(x => [x.report.date.slice(0, 10), x.report.timing || null]).sort(); else empty++;
  await sleep(60);
}
writeFileSync("earnings.json", JSON.stringify(out));
const dates = Object.values(out).flat().map(r => r[0]).sort();
console.log(`stocks with dates ${Object.keys(out).length}, none ${empty}, earliest ${dates[0]}, latest ${dates.at(-1)}`);
