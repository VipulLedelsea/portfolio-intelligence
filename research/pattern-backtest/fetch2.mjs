import { readFileSync, writeFileSync } from "node:fs";
const bars = JSON.parse(readFileSync("bars.json", "utf8"));
const rows = readFileSync("members.csv", "utf8").trim().split("\n").slice(1).map(l => l.split(","));
const want = [...new Set(rows.filter(([t, s, e]) => (!e || e >= "2021-11-05") && s <= "2026-11-05").map(r => r[0]))];
const missing = want.filter(t => !bars[t]);
console.log("members in window", want.length, "missing bars", missing.length);
const got = {}, none = [];
for (let i = 0; i < missing.length; i += 20) {
  const batch = missing.slice(i, i + 20);
  const url = `https://api.robinhood.com/quotes/historicals/?symbols=${batch.map(encodeURIComponent).join(",")}&bounds=regular&interval=day&span=5year`;
  try {
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) { console.log("HTTP", r.status, "batch", i); continue; }
    const j = await r.json();
    for (const item of j.results || []) if (item?.symbol && item.historicals?.length) got[item.symbol] = item.historicals.map(h => [h.begins_at.slice(0, 10), +h.open_price, +h.high_price, +h.low_price, +h.close_price, +h.volume]);
  } catch (e) { console.log("batch failed", i, e.message); }
  await new Promise(r => setTimeout(r, 300));
}
for (const t of missing) if (!got[t]) none.push(t);
writeFileSync("bars_former.json", JSON.stringify(got));
console.log("former members with data", Object.keys(got).length, "no data (delisted/renamed)", none.length);
console.log("sample without data:", none.slice(0, 25).join(" "));
