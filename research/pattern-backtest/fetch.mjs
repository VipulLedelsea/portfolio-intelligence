import { readFileSync, writeFileSync } from "node:fs";
const rows = readFileSync("sp500.csv", "utf8").trim().split("\n").slice(1);
const symbols = [...new Set(rows.map(r => r.split(",")[0].replace(/"/g, "").trim()).filter(Boolean))];
symbols.push("SPY");
const out = {};
for (let i = 0; i < symbols.length; i += 20) {
  const batch = symbols.slice(i, i + 20);
  const url = `https://api.robinhood.com/quotes/historicals/?symbols=${batch.join(",")}&bounds=regular&interval=day&span=5year`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      for (const item of j.results || []) if (item?.symbol && item.historicals?.length) out[item.symbol] = item.historicals.map(h => [h.begins_at.slice(0, 10), +h.open_price, +h.high_price, +h.low_price, +h.close_price, +h.volume]);
      break;
    } catch (e) { if (attempt === 2) console.log("batch failed", i, e.message); await new Promise(r => setTimeout(r, 1500)); }
  }
  await new Promise(r => setTimeout(r, 300));
}
writeFileSync("bars.json", JSON.stringify(out));
const lens = Object.values(out).map(v => v.length).sort((a, b) => a - b);
console.log("symbols", Object.keys(out).length, "bars min/median/max", lens[0], lens[lens.length >> 1], lens.at(-1), "first", out.SPY?.[0]?.[0], "last", out.SPY?.at(-1)?.[0]);
