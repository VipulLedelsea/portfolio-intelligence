"""Supertrend exit test (research only): with no time cap, which early-warning signs that the trend may turn down should trigger an exit, on top of the Supertrend line?

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

HOLD_MAX = 250
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
    sma20 = pd.Series(c).rolling(20).mean().values
    sma10 = pd.Series(c).rolling(10).mean().values
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
    sym_data[sym] = dict(o=o, h=h, l=l, c=c, atr=atr14, dir=dirn, line=line, sma50=sma50, sma20=sma20, sma10=sma10, adx=adx, date=d.date.values)
    for key, f in (("FLIP", flip), ("FRESH3", fresh), ("UPTREND", upt)):
        for t in np.flatnonzero(f):
            if t + 1 < n: SETS[key].append((sym, t))

spy = pd.DataFrame(raw["SPY"], columns=["date", "o", "h", "l", "c", "v"]).set_index("date")
spy_below50 = (spy.c < spy.c.rolling(50).mean()).to_dict()
for key in ("UPTREND",): SETS.pop(key, None)

def run(S, t, rule):
    o, h, l, c, atr, dirn, line, adx = S["o"], S["h"], S["l"], S["c"], S["atr"], S["dir"], S["line"], S["adx"]
    n = len(c); e = t + 1; entry = o[e]; a = atr[t]
    if not entry > 0: return None
    hc = entry; peak_adx = adx[t]; last = min(n - 1, e + HOLD_MAX - 1); mfe = 0.0
    for k in range(e, last + 1):
        hc = max(hc, c[k]); peak_adx = max(peak_adx, adx[k] if not np.isnan(adx[k]) else peak_adx); mfe = max(mfe, h[k] / entry - 1)
        why = None
        if dirn[k] == -1: why = "line"
        elif rule == "close < 50-day average" and c[k] < S["sma50"][k]: why = "ma50"
        elif rule == "close < 20-day average" and c[k] < S["sma20"][k]: why = "ma20"
        elif rule == "2 closes < 10-day average" and k > e and c[k] < S["sma10"][k] and c[k - 1] < S["sma10"][k - 1]: why = "ma10x2"
        elif rule == "ADX falls under 20" and adx[k] < 20: why = "adx20"
        elif rule == "ADX falls 25% from its peak" and adx[k] <= 0.75 * peak_adx: why = "adxpeak"
        elif rule == "close 3 ATR under the highest close" and c[k] < hc - 3 * a: why = "trail3"
        elif rule == "close 2 ATR under the highest close" and c[k] < hc - 2 * a: why = "trail2"
        elif rule == "market (SPY) closes under its 50-day" and spy_below50.get(S["date"][k], False): why = "market"
        elif rule == "gave back half of the peak gain (once up 1 ATR)" and hc >= entry + a and c[k] <= entry + 0.5 * (hc - entry): why = "giveback"
        if why:
            fill = o[k + 1] if k + 1 < n else c[k]
            return (fill / entry - 1 - 2 * COST) * 100, why, k - e + 1, mfe * 100
    return (c[last] / entry - 1 - 2 * COST) * 100, "end", last - e + 1, mfe * 100

RULES = ["Supertrend line only", "close < 50-day average", "close < 20-day average", "2 closes < 10-day average", "ADX falls under 20", "ADX falls 25% from its peak",
         "close 3 ATR under the highest close", "close 2 ATR under the highest close", "market (SPY) closes under its 50-day", "gave back half of the peak gain (once up 1 ATR)"]
for key in ("FLIP", "FRESH3"):
    sigs = [(s, t) for s, t in SETS[key] if t + 2 < len(sym_data[s]["c"])]
    print(f"\n=== {key}: {len(sigs):,} signals; no time cap (data ends are closed at the last bar) ===")
    print(f"  {'early-warning exit added to the Supertrend line':54s} {'n':>5s} {'mean%':>7s} {'win%':>5s} {'days':>5s} {'avgW':>6s} {'avgL':>6s} {'w5%':>6s} {'%/day':>7s} {'given back':>10s} {'by rule':>8s}  by year")
    for rule in RULES:
        res = [run(sym_data[s], t, rule) for s, t in sigs]; keep = [(r, sym_data[s]["date"][t + 1][:4]) for r, (s, t) in zip(res, sigs) if r]
        ret = np.array([x[0][0] for x in keep]); why = np.array([x[0][1] for x in keep]); days = np.array([x[0][2] for x in keep]); mfe = np.array([x[0][3] for x in keep]); yrs = np.array([x[1] for x in keep])
        W, L = ret[ret > 0], ret[ret <= 0]; ls = np.sort(ret)
        by = " ".join(f"{y[2:]}:{ret[yrs == y].mean():+.1f}" for y in sorted(set(yrs)) if (yrs == y).sum() >= 15)
        early = np.mean(why != "line") * 100
        print(f"  {rule:54s} {len(ret):5d} {ret.mean():+7.2f} {np.mean(ret > 0) * 100:5.0f} {days.mean():5.1f} {W.mean():+6.1f} {L.mean():+6.1f} {ls[:max(1, len(ls) // 20)].mean():+6.1f} {ret.mean() / days.mean():+7.3f} {mfe.mean() - ret.mean():10.1f} {early:7.0f}%  {by}")
