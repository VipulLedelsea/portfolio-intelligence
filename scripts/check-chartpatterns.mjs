// Checks the chart-pattern detector (worker/chartpatterns.js) on made-up bars: it must find a bull flag that is still forming and a
// double bottom that just broke out, find nothing in a straight line, and return null for too few bars.
import { readFile } from "node:fs/promises";
const detect = new Function(`${await readFile(new URL("../worker/chartpatterns.js", import.meta.url), "utf8")};return detectChartPatterns;`)();
const bars = (closes, quietFrom = Infinity) => closes.map((c, i) => { const w = i >= quietFrom ? 0.001 : 0.006; return { date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), open: c, high: c * (1 + w), low: c * (1 - w), close: c }; });
const ramp = (from, to, n) => Array.from({ length: n }, (_, i) => from + (to - from) * (i + 1) / n);
const fail = message => { console.error("chart pattern check failed: " + message); process.exit(1); };

if (detect(bars(ramp(100, 110, 30))) !== null) fail("too few bars should give null");
if ((detect(bars(ramp(100, 130, 120))) || []).length) fail("a straight line is not a pattern");
// 70 quiet bars, a 35% pole in 10 bars, then a shallow, quieter 8-bar pause: a bull flag still forming.
const flagCloses = [...ramp(100, 100.5, 70), ...ramp(100.5, 135, 10), ...ramp(135, 131, 4), ...ramp(131, 133, 4)];
const f = detect(bars(flagCloses, 80)) || [];
if (!f.some(p => p.name === "Bull flag" && p.status === "forming")) fail("bull flag not found: " + JSON.stringify(f.map(p => p.name + " " + p.status)));
// Downtrend, two lows 25 bars apart at the same level with a 15% rally between, then a close over the neckline.
const down = [...ramp(130, 100, 60), ...ramp(100, 115, 12), ...ramp(115, 100.5, 13), ...ramp(100.5, 116, 14)];
const d = detect(bars(down)) || [];
if (!d.some(p => p.name === "Double bottom" && p.bias === "bullish")) fail("double bottom not found: " + JSON.stringify(d.map(p => p.name + " " + p.status)));
for (const p of [...f, ...d]) if (!p.lines.length || p.lines.some(l => !l.d1 || !l.d2 || !Number.isFinite(l.p1) || !Number.isFinite(l.p2))) fail("bad lines on " + p.name);
console.log("chart pattern checks passed");
