import { readFileSync, writeFileSync } from "node:fs";
const bars = JSON.parse(readFileSync("bars.json", "utf8")), former = JSON.parse(readFileSync("bars_former.json", "utf8"));
const rows = readFileSync("members.csv", "utf8").trim().split("\n").slice(1).map(l => l.split(","));
const want = [...new Set(rows.filter(([t, s, e]) => (!e || e >= "2021-11-05") && s <= "2026-11-05").map(r => r[0]))];
const missing = want.filter(t => !bars[t] && !former[t]);
const found = [], none = [];
for (const t of missing) {
  let ok = false;
  try {
    const r = await fetch(`https://api.robinhood.com/quotes/historicals/?symbols=${encodeURIComponent(t)}&bounds=regular&interval=day&span=5year`, { headers: { accept: "application/json" } });
    const j = await r.json(); const item = (j.results || [])[0];
    if (item?.historicals?.length) { former[t] = item.historicals.map(h => [h.begins_at.slice(0, 10), +h.open_price, +h.high_price, +h.low_price, +h.close_price, +h.volume]); ok = true; found.push(t); }
  } catch (e) {}
  if (!ok) none.push(t);
  await new Promise(r => setTimeout(r, 120));
}
writeFileSync("bars_former.json", JSON.stringify(former));
const last = t => former[t]?.at(-1)?.[0];
console.log("recovered individually:", found.length, "still no data:", none.length);
console.log("former with data, last bar dates (sample):", Object.keys(former).slice(0, 8).map(t => t + ":" + last(t)).join(" "));
console.log("no data:", none.join(" "));
