import { writeFileSync } from "node:fs";
const r = await fetch("https://api.robinhood.com/quotes/historicals/?symbols=QQQ&bounds=regular&interval=day&span=5year", { headers: { accept: "application/json" } });
const j = await r.json();
const rows = j.results[0].historicals.map(h => [h.begins_at.slice(0, 10), +h.open_price, +h.high_price, +h.low_price, +h.close_price, +h.volume]);
writeFileSync("qqq.json", JSON.stringify(rows));
console.log(rows.length, rows[0][0], rows.at(-1)[0]);
