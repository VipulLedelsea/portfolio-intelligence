"""Supertrend-first test (research only): stops and exits for the SUPERTREND strategy, including a support-based stop and the Supertrend line itself.

Entries (daily bars, point-in-time S&P 500, next-open entry, 0.1% cost per side):
  FLIP   : daily Supertrend(10,3) flips up, ADX(14) >= 20 and rising over 5 days (the app's daily gate)
  FRESH3 : the Supertrend turned up within the last 3 days, same ADX gate (more signals)
  UPTREND: Supertrend is up and ADX >= 20 and rising, any day, every 5th day (a control that shows what the EXIT rule does without a fresh signal)
Exits compared: ATR stops with a profit target; a support stop (touch cluster) acted on a CLOSE breakdown with a skip rule when the support is
too far; the Supertrend line itself (exit when the day closes under it, fill at the next open); and a chandelier trail. Hold limits 10 to 60 days.
"""
import json
import numpy as np, pandas as pd

COST = 0.001
current = json.load(open("bars.json")); former = json.load(open("bars_former.json"))
raw = {**former, **current}
intervals = {}
for line in open("members.csv").read().strip().split("\n")[1:]:
    t, a, b = (line.split(",") + [""])[:3]
    intervals.setdefault(t, []).append((a, b or "9999-12-31"))

def supertrend(h, l, c, tr):
    n = len(c); atr = np.full(n, np.nan); dirn = np.zeros(n, dtype=int); line = np.full(n, np.nan)
    if n < 12: return dirn, line
    atr[10] = tr[1:11].mean()
    for i in range(11, n): atr[i] = (atr[i - 1] * 9 + tr[i]) / 10
    fu = fl = np.nan
    for i in range(10, n):
        mid = (h[i] + l[i]) / 2; bu, bl = mid + 3 * atr[i], mid - 3 * atr[i]
        if i == 10: fu, fl = bu, bl; dirn[i] = 1 if c[i] >= mid else -1
        else:
            fu = bu if (bu < fu or c[i - 1] > fu) else fu
            fl = bl if (bl > fl or c[i - 1] < fl) else fl
            dirn[i] = (1 if c[i] > fu else -1) if dirn[i - 1] == -1 else (-1 if c[i] < fl else 1)
        line[i] = fl if dirn[i] == 1 else fu
    return dirn, line

def adx_calc(h, l, tr):
    n = len(h); out = np.full(n, np.nan); tr14 = p14 = m14 = 0.0; dx = []
    for i in range(1, n):
        up, dn = h[i] - h[i - 1], l[i - 1] - l[i]
        pdm = up if (up > dn and up > 0) else 0.0; mdm = dn if (dn > up and dn > 0) else 0.0
        if i <= 14: tr14 += tr[i]; p14 += pdm; m14 += mdm
        else: tr14 = tr14 - tr14 / 14 + tr[i]; p14 = p14 - p14 / 14 + pdm; m14 = m14 - m14 / 14 + mdm
        if i >= 14:
            pdi, mdi = 100 * p14 / tr14, 100 * m14 / tr14
            dx.append(100 * abs(pdi - mdi) / (pdi + mdi or 1)); k = len(dx)
            out[i] = np.mean(dx) if k == 14 else (out[i - 1] * 13 + dx[-1]) / 14 if k > 14 else np.nan
    return out

HOLD_MAX = 60
SETS = {"FLIP": [], "FRESH3": [], "UPTREND": []}   # each entry: dict with arrays for one signal
sym_data = {}
for sym, rows in raw.items():
    if sym == "SPY" or len(rows) < 320: continue
    d = pd.DataFrame(rows, columns=["date", "o", "h", "l", "c", "v"])
    if (d[["o", "h", "l", "c"]] <= 0).any().any(): continue
    o, h, l, c = (d[x].values.astype(float) for x in "ohlc"); n = len(d)
    trs = np.maximum.reduce([h - l, np.abs(h - np.r_[c[0], c[:-1]]), np.abs(l - np.r_[c[0], c[:-1]])]); trs[0] = h[0] - l[0]
    atr14 = pd.Series(trs).rolling(14).mean().values
    dirn, line = supertrend(h, l, c, trs); adx = adx_calc(h, l, trs)
    sma50 = pd.Series(c).rolling(50).mean().values
    pc = pd.Series(c).pct_change().abs()
    bad = (pc > 0.35).rolling(260, min_periods=1).max().astype(bool).values | (pc > 0.35)[::-1].rolling(HOLD_MAX + 2, min_periods=1).max()[::-1].astype(bool).values
    member = np.array([any(a_ <= x <= b_ for a_, b_ in intervals.get(sym, [])) for x in d.date])
    ok = member & ~bad & ~np.isnan(atr14) & ~np.isnan(adx) & (np.arange(n) > 260)
    since = np.zeros(n, dtype=int)
    for i in range(1, n): since[i] = 0 if (dirn[i] == 1 and dirn[i - 1] != 1) else since[i - 1] + 1
    gate = np.zeros(n, dtype=bool); gate[5:] = (adx[5:] >= 20) & (adx[5:] > adx[:-5])
    flip = ok & (dirn == 1) & (since == 0) & gate
    fresh = ok & (dirn == 1) & (since <= 3) & gate
    upt = ok & (dirn == 1) & gate & (np.arange(n) % 5 == 0)
    # swing-low pivots for support
    piv = np.zeros(n, dtype=bool)
    for i in range(3, n - 3): piv[i] = l[i] <= l[i - 3:i + 4].min()
    sym_data[sym] = dict(o=o, h=h, l=l, c=c, atr=atr14, dir=dirn, line=line, sma50=sma50, piv=np.flatnonzero(piv), date=d.date.values)
    for key, f in (("FLIP", flip), ("FRESH3", fresh), ("UPTREND", upt)):
        for t in np.flatnonzero(f):
            if t + 1 < n: SETS[key].append((sym, t))

def support_stop(S, t, entry):
    """Stop price under the nearest touch cluster (2+ swing lows within half an ATR) at least 1 ATR below the close, minus 0.25 ATR; floor 1 ATR from the entry."""
    atr, c, l, piv = S["atr"][t], S["c"][t], S["l"], S["piv"]
    lo, hi = np.searchsorted(piv, max(0, t - 120)), np.searchsorted(piv, t - 3, side="right")
    lv = l[piv[lo:hi]]; lv = lv[lv <= c - atr]
    level = np.nan
    if len(lv):
        level = lv.max()
        for L in np.sort(lv)[::-1][:25]:
            if np.sum(np.abs(lv - L) <= 0.5 * atr) >= 2: level = L; break
    if np.isnan(level): return np.nan
    return min(level - 0.25 * atr, entry - 1.0 * atr)

def run(S, t, cfg):
    o, h, l, c, atr, dirn = S["o"], S["h"], S["l"], S["c"], S["atr"], S["dir"]
    n = len(c); e = t + 1; entry = o[e]; a = atr[t]
    if not entry > 0 or e + cfg["hold"] > n: return None
    stop = tgt = None
    kind_stop = cfg.get("stop")
    if kind_stop == "atr": stop = entry - cfg["stop_atr"] * a
    if kind_stop == "support":
        stop = support_stop(S, t, entry)
        if np.isnan(stop) or (entry - stop) > 3.0 * a: return "skip"
    if kind_stop == "support_any":
        stop = support_stop(S, t, entry)
        if np.isnan(stop): stop = entry - 2 * a
    tgt = entry + cfg["tgt_atr"] * a if cfg.get("tgt_atr") else np.inf
    hc = entry
    for k in range(e, e + cfg["hold"]):
        if kind_stop == "atr" or (kind_stop in ("support", "support_any") and not cfg.get("close_basis")):
            if k > e and o[k] <= stop: return (o[k], "stop", k - e + 1)
            if l[k] <= stop: return (stop, "stop", k - e + 1)
        if k > e and o[k] >= tgt: return (o[k], "target", k - e + 1)
        if h[k] >= tgt: return (tgt, "target", k - e + 1)
        if kind_stop in ("support", "support_any") and cfg.get("close_basis") and c[k] < stop:
            return ((o[k + 1] if k + 1 < n and k + 1 < e + cfg["hold"] else c[k]), "stop", k - e + 1)
        if cfg.get("st_exit") and dirn[k] == -1:
            return ((o[k + 1] if k + 1 < n and k + 1 < e + cfg["hold"] else c[k]), "supertrend", k - e + 1)
        if cfg.get("trail"):
            hc = max(hc, c[k])
            if c[k] < hc - cfg["trail"] * a: return ((o[k + 1] if k + 1 < n and k + 1 < e + cfg["hold"] else c[k]), "trail", k - e + 1)
    return (c[e + cfg["hold"] - 1], "time", cfg["hold"])

CONFIGS = {
    "A  ATR 2 stop, 1 ATR target, 10 days (the app today)": dict(stop="atr", stop_atr=2, tgt_atr=1, hold=10),
    "B  ATR 2 stop, 2 ATR target, 10 days": dict(stop="atr", stop_atr=2, tgt_atr=2, hold=10),
    "C  Support stop on a close breakdown, skip if > 3 ATR, 1 ATR target, 10 days": dict(stop="support", close_basis=True, tgt_atr=1, hold=10),
    "D  Support stop, any support (no skip), close breakdown, 1 ATR target, 10 days": dict(stop="support_any", close_basis=True, tgt_atr=1, hold=10),
    "E  Supertrend line exit (close under it, next open), no target, 20 days": dict(st_exit=True, hold=20),
    "F  Supertrend line exit, no target, 60 days": dict(st_exit=True, hold=60),
    "G  Supertrend line exit + skip if no support within 3 ATR, 60 days": dict(stop="support", close_basis=True, st_exit=True, hold=60),
    "H  Chandelier trail 3 ATR from the highest close, no target, 60 days": dict(trail=3, hold=60),
    "I  ATR 3 stop, no target, 60 days": dict(stop="atr", stop_atr=3, hold=60),
}
rg = np.random.default_rng(3)
def summarize(label, res, dates, base_mean=None):
    res = [(r, d_) for r, d_ in zip(res, dates) if r is not None and r != "skip"]
    if not res: print(f"  {label:84s}      0"); return None
    ret = np.array([(x[0][0] / x[0][3] - 1 - 2 * COST) * 100 for x in res])      # x[0] = (exit, kind, days, entry)
    kinds = np.array([x[0][1] for x in res]); days = np.array([x[0][2] for x in res]); yrs = np.array([x[1][:4] for x in res])
    W, L = ret[ret > 0], ret[ret <= 0]
    byyr = " ".join(f"{y[2:]}:{ret[yrs == y].mean():+.1f}({(yrs == y).sum()})" for y in sorted(set(yrs)) if (yrs == y).sum() >= 15)
    print(f"  {label:84s} {len(ret):5d} {ret.mean():+7.2f} {np.mean(ret > 0) * 100:5.0f} {days.mean():5.1f} {W.mean() if len(W) else 0:+6.1f} {L.mean() if len(L) else 0:+6.1f} {ret.mean() / days.mean():+7.3f} {np.mean(kinds == 'stop') * 100:5.0f} {np.mean(kinds == 'target') * 100:5.0f} {np.mean(np.isin(kinds, ['supertrend', 'trail'])) * 100:5.0f}  {byyr}")
    return ret.mean()

for key in ("FLIP", "FRESH3", "UPTREND"):
    sigs = SETS[key]
    print(f"\n=== {key}: {len(sigs):,} signals ===")
    print(f"  {'exit rule':84s} {'n':>5s} {'mean%':>7s} {'win%':>5s} {'days':>5s} {'avgW':>6s} {'avgL':>6s} {'%/day':>7s} {'stop%':>5s} {'tgt%':>5s} {'st/tr%':>5s}  by year (mean%/trade)")
    for label, cfg in CONFIGS.items():
        out, dates = [], []
        for sym, t in sigs:
            S = sym_data[sym]; r = run(S, t, cfg)
            if r is None or r == "skip": out.append(r); dates.append(S["date"][t + 1]); continue
            out.append((r[0], r[1], r[2], S["o"][t + 1])); dates.append(S["date"][t + 1])
        summarize(label, out, dates)
