// Round two: pivot-based chart patterns from the FOREX.com article, tested with pattern-native stops/targets,
// optional confirmation delay, and matched random-entry controls. Usage: node round2.mjs stocks|forex
import { readFileSync } from "node:fs";
const MODE = process.argv[2] || "stocks";
const COST = MODE === "forex" ? 0.0001 : 0.001; // per side
const SPLIT = "2024-11-05";
const WARM = 260, K = 5, W = 130;

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

// ---------- data ----------
let raw = {}, intervals = new Map(), current = {};
if (MODE === "forex") raw = JSON.parse(readFileSync("bars_fx.json", "utf8"));
else {
  current = JSON.parse(readFileSync("bars.json", "utf8"));
  raw = { ...JSON.parse(readFileSync("bars_former.json", "utf8")), ...current };
  for (const l of readFileSync("members.csv", "utf8").trim().split("\n").slice(1)) { const [t, a, b] = l.split(","); (intervals.get(t) || intervals.set(t, []).get(t)).push([a, b || "9999-12-31"]); }
}
const memberAt = (sym, date) => MODE === "forex" || (intervals.get(sym) || []).some(([a, b]) => date >= a && date <= b) || (sym in current && false);

function prep(rows) {
  const n = rows.length, d = [], o = [], h = [], l = [], c = [];
  for (const r of rows) { d.push(r[0]); o.push(r[1]); h.push(r[2]); l.push(r[3]); c.push(r[4]); }
  const tr = h.map((x, i) => i ? Math.max(x - l[i], Math.abs(x - c[i - 1]), Math.abs(l[i] - c[i - 1])) : x - l[i]);
  const atr = tr.map((_, i) => i >= 13 ? mean(tr.slice(i - 13, i + 1)) : NaN);
  const cs = [0]; for (const x of c) cs.push(cs[cs.length - 1] + x);
  const sma = (i, p) => i + 1 >= p ? (cs[i + 1] - cs[i + 1 - p]) / p : NaN;
  const bad = c.map((x, i) => i && Math.abs(x / c[i - 1] - 1) > 0.35 ? 1 : 0);
  const bs = [0]; for (const x of bad) bs.push(bs[bs.length - 1] + x);
  const hasBad = (a, b) => bs[Math.min(n, b + 1)] - bs[Math.max(0, a)] > 0;
  const pivH = new Array(n).fill(false), pivL = new Array(n).fill(false);
  for (let i = K; i < n - K; i++) {
    let hi = true, lo = true;
    for (let j = i - K; j <= i + K; j++) { if (j === i) continue; if (h[j] > h[i] || (j < i && h[j] === h[i])) hi = false; if (l[j] < l[i] || (j < i && l[j] === l[i])) lo = false; }
    pivH[i] = hi; pivL[i] = lo;
  }
  return { n, d, o, h, l, c, atr, sma, hasBad, pivH, pivL };
}
const pivots = (S, t, win) => { const H = [], L = []; for (let i = Math.max(K, t - win); i <= t - K; i++) { if (S.pivH[i]) H.push(i); if (S.pivL[i]) L.push(i); } return { H, L }; };
const maxOf = (a, f, t) => { let m = -Infinity; for (let i = f; i <= t; i++) m = Math.max(m, a[i]); return m; };
const minOf = (a, f, t) => { let m = Infinity; for (let i = f; i <= t; i++) m = Math.min(m, a[i]); return m; };

// ---------- detectors: return events for a breakout that happens on the close of day t ----------
function detect(S, t) {
  const ev = []; const { c, h, l } = S;
  const { H, L } = pivots(S, t, W);
  const add = (name, dir, level, stop, target) => {
    const risk = Math.abs(c[t] - stop) / c[t], reward = Math.abs(target - c[t]) / c[t];
    if (risk < 0.01 && MODE !== "forex") return; if (risk < 0.002) return;
    if (risk > 0.25 || reward < 0.005) return;
    ev.push({ name, dir, level, stop, target });
  };
  const firstBreakUp = (level, from) => c[t] > level && c[t - 1] <= level && maxOf(c, from, t - 1) <= level;
  const firstBreakDn = (level, from) => c[t] < level && c[t - 1] >= level && minOf(c, from, t - 1) >= level;
  // Double bottom / top
  if (L.length >= 2) {
    const i2 = L[L.length - 1], i1 = L[L.length - 2], gap = i2 - i1;
    if (gap >= 15 && gap <= 60 && t - i2 <= 40 && Math.abs(l[i2] - l[i1]) / l[i1] <= 0.03) {
      const neck = maxOf(h, i1, i2), bottom = Math.min(l[i1], l[i2]);
      const down = c[i1] < S.sma(i1, 50) && bottom <= 0.9 * maxOf(h, Math.max(0, i1 - 40), i1);
      if (neck / Math.max(l[i1], l[i2]) - 1 >= 0.07 && down && firstBreakUp(neck, i2)) add("Double bottom", 1, neck, bottom, neck + (neck - bottom));
    }
  }
  if (H.length >= 2) {
    const i2 = H[H.length - 1], i1 = H[H.length - 2], gap = i2 - i1;
    if (gap >= 15 && gap <= 60 && t - i2 <= 40 && Math.abs(h[i2] - h[i1]) / h[i1] <= 0.03) {
      const neck = minOf(l, i1, i2), top = Math.max(h[i1], h[i2]);
      const up = c[i1] > S.sma(i1, 50) && top >= 1.1 * minOf(l, Math.max(0, i1 - 40), i1);
      if (Math.min(h[i1], h[i2]) / neck - 1 >= 0.07 && up && firstBreakDn(neck, i2)) add("Double top", -1, neck, top, neck - (top - neck));
    }
  }
  // Head and shoulders (top) and inverse
  if (H.length >= 3) {
    const [i1, i2, i3] = H.slice(-3);
    if (i2 - i1 >= 5 && i2 - i1 <= 50 && i3 - i2 >= 5 && i3 - i2 <= 50 && t - i3 <= 40) {
      const head = h[i2], ls = h[i1], rs = h[i3];
      if (head >= 1.03 * Math.max(ls, rs) && Math.abs(ls - rs) / ((ls + rs) / 2) <= 0.05) {
        const t1 = minOf(l, i1, i2), t2 = minOf(l, i2, i3), neck = (t1 + t2) / 2;
        if (Math.abs(t1 - t2) / neck <= 0.04 && c[i1] > S.sma(i1, 50) && firstBreakDn(neck, i3)) add("Head and shoulders", -1, neck, rs, neck - (head - neck));
      }
    }
  }
  if (L.length >= 3) {
    const [i1, i2, i3] = L.slice(-3);
    if (i2 - i1 >= 5 && i2 - i1 <= 50 && i3 - i2 >= 5 && i3 - i2 <= 50 && t - i3 <= 40) {
      const head = l[i2], ls = l[i1], rs = l[i3];
      if (head <= 0.97 * Math.min(ls, rs) && Math.abs(ls - rs) / ((ls + rs) / 2) <= 0.05) {
        const p1 = maxOf(h, i1, i2), p2 = maxOf(h, i2, i3), neck = (p1 + p2) / 2;
        if (Math.abs(p1 - p2) / neck <= 0.04 && c[i1] < S.sma(i1, 50) && firstBreakUp(neck, i3)) add("Inverse head and shoulders", 1, neck, rs, neck + (neck - head));
      }
    }
  }
  // Triangles and wedges use the last pivots within 80 days
  const Hw = H.filter(i => i >= t - 80), Lw = L.filter(i => i >= t - 80);
  if (Hw.length >= 2 && Lw.length >= 2) {
    const h1 = Hw[Hw.length - 2], h2 = Hw[Hw.length - 1], l1 = Lw[Lw.length - 2], l2 = Lw[Lw.length - 1];
    const span = Math.max(h2, l2) - Math.min(h1, l1);
    if (span >= 15) {
      const flatTop = Math.abs(h[h1] - h[h2]) / h[h1] <= 0.015, flatBot = Math.abs(l[l1] - l[l2]) / l[l1] <= 0.015;
      const risingLows = l[l2] >= 1.01 * l[l1], fallingHighs = h[h2] <= 0.99 * h[h1];
      const fallingLows = l[l2] <= 0.99 * l[l1], risingHighs = h[h2] >= 1.01 * h[h1];
      const res = Math.max(h[h1], h[h2]), sup = Math.min(l[l1], l[l2]);
      if (flatTop && risingLows && c[h1] > S.sma(h1, 50) && firstBreakUp(res, Math.max(h2, l2))) add("Ascending triangle", 1, res, l[l2], res + (res - l[l1]));
      if (flatBot && fallingHighs && c[l1] < S.sma(l1, 50) && firstBreakDn(sup, Math.max(h2, l2))) add("Descending triangle", -1, sup, h[h2], sup - (h[h1] - sup));
      if (fallingHighs && risingLows) {
        const height = h[h1] - l[l1];
        if (firstBreakUp(h[h2], Math.max(h2, l2))) add("Symmetrical triangle (up)", 1, h[h2], l[l2], h[h2] + height);
        if (firstBreakDn(l[l2], Math.max(h2, l2))) add("Symmetrical triangle (down)", -1, l[l2], h[h2], l[l2] - height);
      }
      // Wedges: both lines slope the same way and converge
      const slopeH = (h[h2] - h[h1]) / (h2 - h1), slopeL = (l[l2] - l[l1]) / (l2 - l1);
      if (fallingHighs && fallingLows && slopeH < slopeL) {
        const upper = h[h2] + slopeH * (t - h2), upperPrev = h[h2] + slopeH * (t - 1 - h2);
        if (c[t] > upper && c[t - 1] <= upperPrev) add("Falling wedge", 1, upper, l[l2], upper + (h[h1] - l[l1]));
      }
      if (risingHighs && risingLows && slopeL > slopeH) {
        const lower = l[l2] + slopeL * (t - l2), lowerPrev = l[l2] + slopeL * (t - 1 - l2);
        if (c[t] < lower && c[t - 1] >= lowerPrev) add("Rising wedge", -1, lower, h[h2], lower - (h[h1] - l[l1]));
      }
    }
  }
  // Bull flag (pole then shallow, contracting pullback) and cup and handle (continuation and after-downtrend versions)
  if (t >= 40) {
    let p = t - 16; for (let i = t - 16; i <= t - 1; i++) if (h[i] > h[p]) p = i;
    if (p <= t - 4) {
      let lowPole = Infinity, lpi = p; for (let i = p - 15; i <= p; i++) if (l[i] < lowPole) { lowPole = l[i]; lpi = i; }
      if (h[p] / lowPole - 1 >= 0.2) {
        const flagHigh = maxOf(h, p + 1, t - 1), flagLow = minOf(l, p + 1, t - 1);
        let fr = 0, pr = 0; for (let i = p + 1; i <= t - 1; i++) fr += h[i] - l[i]; for (let i = lpi; i <= p; i++) pr += h[i] - l[i];
        if ((h[p] - flagLow) / (h[p] - lowPole) <= 0.5 && fr / (t - 1 - p) <= 0.8 * (pr / (p - lpi + 1)) && firstBreakUp(flagHigh, p + 1)) add("Bull flag", 1, flagHigh, flagLow, flagHigh + (h[p] - lowPole));
      }
    }
  }
  if (t >= 140) {
    for (const W2 of [35, 50, 70, 100, 130]) { let hit = null; for (const hh of [5, 8, 12, 15]) {
      const c0 = t - hh, a = c0 - W2; if (a < 5) continue;
      const rimL = maxOf(h, a - 3, a + 3); let bottom = Infinity, b = a; for (let i = a + 3; i <= c0 - 3; i++) if (l[i] < bottom) { bottom = l[i]; b = i; }
      const depth = (rimL - bottom) / rimL; if (depth < 0.12 || depth > 0.35 || b < a + 0.25 * W2 || b > a + 0.75 * W2) continue;
      const rimR = maxOf(h, c0 - 4, c0); if (rimR < 0.92 * rimL || rimR > 1.05 * rimL) continue;
      const hHigh = maxOf(h, c0 + 1, t - 1), hLow = minOf(l, c0 + 1, t - 1); if (hHigh > rimR * 1.01) continue;
      if ((rimR - hLow) / rimR > 0.12 || (rimR - hLow) > 0.5 * (rimR - bottom)) continue;
      if (c[t] > rimR && c[t - 1] <= rimR) { hit = { rimR, hLow, bottom }; break; } }
      if (hit) { const up = c[t] > S.sma(t, 200); add(up ? "Cup and handle (after uptrend)" : "Cup and handle (after downtrend)", 1, hit.rimR, hit.hLow, hit.rimR + (hit.rimR - hit.bottom)); break; } }
  }
  return ev;
}

// ---------- trade simulation ----------
function sim(S, dir, e, stop, target, hold) {
  const last = e + hold - 1; if (last >= S.n) return null;
  const entry = S.o[e]; if (!(entry > 0)) return null;
  if (dir === 1 ? (entry <= stop || entry >= target) : (entry >= stop || entry <= target)) return null;
  let exit = S.c[last], kind = "time", day = hold;
  for (let k = e; k <= last; k++) {
    const gapS = dir === 1 ? S.o[k] <= stop : S.o[k] >= stop, gapT = dir === 1 ? S.o[k] >= target : S.o[k] <= target;
    const tS = dir === 1 ? S.l[k] <= stop : S.h[k] >= stop, tT = dir === 1 ? S.h[k] >= target : S.l[k] <= target;
    if (k > e && gapS) { exit = S.o[k]; kind = "stop"; day = k - e + 1; break; }
    if (tS) { exit = stop; kind = "stop"; day = k - e + 1; break; }
    if (k > e && gapT) { exit = S.o[k]; kind = "target"; day = k - e + 1; break; }
    if (tT) { exit = target; kind = "target"; day = k - e + 1; break; }
  }
  return { ret: dir * (exit / entry - 1) * 100 - 2 * COST * 100, kind, day };
}

// ---------- build universe ----------
const syms = Object.keys(raw).filter(s => s !== "SPY");
const U = []; // {sym, S}
for (const sym of syms) { const rows = raw[sym]; if (rows.length < 400 || rows.some(r => !(r[4] > 0))) continue; U.push({ sym, S: prep(rows) }); }
const eligible = (u, t) => MODE === "forex" || memberAt(u.sym, u.S.d[t]) || (u.sym in current && false);
console.log(`mode ${MODE}: ${U.length} instruments`);

// pool of random control days
const pool = [];
for (let ui = 0; ui < U.length; ui++) { const { S } = U[ui]; for (let t = WARM; t < S.n - 25; t += 3) if (eligible(U[ui], t) && !S.hasBad(t - 252, t + 25)) pool.push([ui, t]); }

const surgePool = [];
for (let ui = 0; ui < U.length; ui++) { const { S } = U[ui]; for (let t = WARM; t < S.n - 25; t++) if (eligible(U[ui], t) && S.c[t] / minOf(S.l, t - 20, t) >= 1.2 && !S.hasBad(t - 252, t + 25)) surgePool.push([ui, t]); }
console.log("surge-control pool", surgePool.length);
const CONFIGS = [
  { name: "native stop/target, hold up to 5d, immediate", hold: 5, confirm: 0, native: true },
  { name: "native stop/target, hold up to 20d, immediate", hold: 20, confirm: 0, native: true },
  { name: "native stop/target, hold up to 20d, confirmed 2 sessions", hold: 20, confirm: 2, native: true },
  { name: "scanner-like ATR exit (stop 1R, 90% of 2R), hold up to 5d, immediate", hold: 5, confirm: 0, native: false },
];
const results = {}; // cfg -> pattern -> [{ret, diff, date}]
for (const cfg of CONFIGS) results[cfg.name] = {};
const lastEv = new Map();
for (let ui = 0; ui < U.length; ui++) {
  const { sym, S } = U[ui];
  for (let t = WARM; t < S.n - 30; t++) {
    if (!eligible(U[ui], t)) continue;
    const evs = detect(S, t); if (!evs.length) continue;
    for (const ev of evs) {
      const key = sym + ev.name; if (lastEv.has(key) && t - lastEv.get(key) < 10) continue; lastEv.set(key, t);
      if (S.hasBad(t - 252, t + 25)) continue;
      const atr = S.atr[t], priceT = S.c[t];
      for (const cfg of CONFIGS) {
        const e = t + 1 + cfg.confirm;
        if (cfg.confirm) { let ok = true; for (let k = 1; k <= cfg.confirm; k++) if (ev.dir === 1 ? !(S.c[t + k] > ev.level) : !(S.c[t + k] < ev.level)) ok = false; if (!ok) continue; }
        if (e + cfg.hold >= S.n) continue;
        let stop, target, sA, tA;
        const entryPx = S.o[e];
        if (cfg.native) { stop = ev.stop; target = ev.target; }
        else { const R = Math.max(2 * 0.55 * atr, entryPx * 0.0125); stop = entryPx - ev.dir * R; target = entryPx + ev.dir * 0.9 * 2 * R; }
        const r = sim(S, ev.dir, e, stop, target, cfg.hold); if (!r) continue;
        sA = Math.abs(entryPx - stop) / atr; tA = Math.abs(target - entryPx) / atr;
        // matched control: random days, same direction, same stop and target distances in ATR units, same hold and entry timing
        const ctl = [];
        for (let m = 0; m < 25; m++) {
          const [uj, tj] = pool[Math.floor(rnd() * pool.length)], Sj = U[uj].S, ej = tj + 1 + cfg.confirm;
          if (ej + cfg.hold >= Sj.n) continue;
          const px = Sj.o[ej], a = Sj.atr[tj]; if (!(px > 0) || !(a > 0)) continue;
          const cr = sim(Sj, ev.dir, ej, px - ev.dir * sA * a, px + ev.dir * tA * a, cfg.hold); if (cr) ctl.push(cr.ret);
        }
        if (ctl.length < 10) continue;
        (results[cfg.name][ev.name] ||= []).push({ ret: r.ret, diff: r.ret - mean(ctl), kind: r.kind, day: r.day, date: S.d[e], dir: ev.dir, ctl: mean(ctl) });
        if (ev.name === "Bull flag" && surgePool.length) {
          const c2 = [];
          for (let m = 0; m < 25; m++) {
            const [uj, tj] = surgePool[Math.floor(rnd() * surgePool.length)], Sj = U[uj].S, ej = tj + 1 + cfg.confirm;
            if (ej + cfg.hold >= Sj.n) continue;
            const px = Sj.o[ej], a = Sj.atr[tj]; if (!(px > 0) || !(a > 0)) continue;
            const cr = sim(Sj, 1, ej, px - sA * a, px + tA * a, cfg.hold); if (cr) c2.push(cr.ret);
          }
          if (c2.length >= 10) (results[cfg.name]["Bull flag vs SURGE-matched control"] ||= []).push({ ret: r.ret, diff: r.ret - mean(c2), kind: r.kind, day: r.day, date: S.d[e], dir: 1, ctl: mean(c2) });
        }
      }
    }
  }
}

const fmt = (rows) => {
  const r = rows.map(x => x.ret), w = r.filter(x => x > 0), lo = r.filter(x => x <= 0), d = rows.map(x => x.diff);
  const pf = lo.length ? w.reduce((s, x) => s + x, 0) / Math.abs(lo.reduce((s, x) => s + x, 0)) : NaN;
  const t = rows.length > 2 ? mean(d) / (sd(d) / Math.sqrt(d.length)) : NaN;
  const f = rows.filter(x => x.date < SPLIT), l2 = rows.filter(x => x.date >= SPLIT);
  const tg = rows.filter(x => x.kind === "target").length / rows.length * 100, st = rows.filter(x => x.kind === "stop").length / rows.length * 100;
  return `n=${String(rows.length).padStart(5)} win ${(w.length / r.length * 100).toFixed(0).padStart(2)}% mean ${mean(r).toFixed(2).padStart(5)}% PF ${isNaN(pf) ? " - " : pf.toFixed(2)} tgt ${tg.toFixed(0).padStart(2)}% stop ${st.toFixed(0).padStart(2)}% | vs matched random ${mean(d) >= 0 ? "+" : ""}${mean(d).toFixed(2)}% (t ${t.toFixed(1)}; 1st ${f.length ? mean(f.map(x => x.diff)).toFixed(2) : "-"}, 2nd ${l2.length ? mean(l2.map(x => x.diff)).toFixed(2) : "-"})`;
};
for (const cfg of CONFIGS) {
  console.log(`\n=== ${cfg.name} (cost ${(COST * 200).toFixed(2)}% round trip) ===`);
  const all = [];
  for (const [name, rows] of Object.entries(results[cfg.name]).sort()) { if (rows.length < 8) { console.log(`${name.padEnd(36)} n=${rows.length} (too few)`); continue; } console.log(`${name.padEnd(36)} ${fmt(rows)}`); if (!name.includes("SURGE")) all.push(...rows); }
  if (all.length) { console.log(`${"ALL patterns pooled".padEnd(36)} ${fmt(all)}`); const lg = all.filter(x => x.dir === 1), sh = all.filter(x => x.dir === -1); if (lg.length > 8) console.log(`${"  long patterns".padEnd(36)} ${fmt(lg)}`); if (sh.length > 8) console.log(`${"  short patterns".padEnd(36)} ${fmt(sh)}`); }
}
