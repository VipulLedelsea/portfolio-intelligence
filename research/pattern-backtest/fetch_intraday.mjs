// Intraday bars from Yahoo's chart endpoint for the current S&P 500 plus SPY: 5-minute bars for the last 60 days -> bars_5m.json,
// hourly bars for about 3 years -> bars_1h.json. Regular session only. Each row: ["YYYY-MM-DD HH:MM" New York time, o, h, l, c, v].
import { readFileSync, writeFileSync } from "node:fs";
const syms = [...new Set(readFileSync("sp500.csv", "utf8").trim().split("\n").slice(1).map(r => r.split(",")[0].replace(/"/g, "").trim()).filter(Boolean)), "SPY"];
async function get(sym, q) { const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym.replace(/\./g, "-")}?${q}`;
  for (let a = 0; a < 4; a++) { try { const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } }); if (r.status === 404) return null; if (!r.ok) throw new Error("HTTP " + r.status);
      const res = (await r.json()).chart?.result?.[0], q0 = res?.indicators?.quote?.[0]; if (!q0 || !res.timestamp) return null;
      const firstOfDay = new Map(); for (const t of res.timestamp) { const day = Math.floor(t / 86400); if (!firstOfDay.has(day) || t < firstOfDay.get(day)) firstOfDay.set(day, t); }
      const rows = []; for (let i = 0; i < res.timestamp.length; i++) { const t = res.timestamp[i], c = q0.close[i], o = q0.open[i]; if (!(c > 0) || !(o > 0) || !(q0.high[i] > 0) || !(q0.low[i] > 0)) continue;
        const f = firstOfDay.get(Math.floor(t / 86400)), off = (f % 86400) === 13.5 * 3600 ? -14400 : -18000, loc = new Date((t + off) * 1000).toISOString(), hm = loc.slice(11, 16); if (hm < "09:30" || hm >= "16:00") continue;
        rows.push([loc.slice(0, 10) + " " + hm, +o.toFixed(4), +q0.high[i].toFixed(4), +q0.low[i].toFixed(4), +c.toFixed(4), q0.volume[i] || 0]); }
      return rows.length ? rows : null; } catch (e) { await new Promise(r => setTimeout(r, 2000 * (a + 1))); } } return null; }
for (const [file, q] of [["bars_5m.json", "interval=5m&range=60d"], ["bars_1h.json", "interval=60m&range=730d"]]) { const out = {}, miss = []; let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (i < syms.length) { const s = syms[i++]; const r = await get(s, q); if (r) out[s] = r; else miss.push(s); await new Promise(r => setTimeout(r, 120)); } }));
  writeFileSync(file, JSON.stringify(out)); const lens = Object.values(out).map(v => v.length).sort((a, b) => a - b);
  console.log(file, "got", Object.keys(out).length, "missing", miss.length, miss.slice(0, 20).join(" "), "bars median", lens[lens.length >> 1], "SPY", out.SPY?.[0]?.[0], "to", out.SPY?.at(-1)?.[0], "first day bars", out.SPY?.filter(r => r[0].startsWith(out.SPY[0][0].slice(0, 10))).length); }
