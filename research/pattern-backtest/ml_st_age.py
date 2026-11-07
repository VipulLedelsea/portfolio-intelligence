"""Entry-age test (research only): does a Supertrend setup that is days old but still near its original buy point work as well as a fresh one?

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
    entry_ref = np.full(n, np.nan)
    for i in range(1, n - 1):
        entry_ref[i] = o[i + 1] if (dirn[i] == 1 and since[i] == 0) else entry_ref[i - 1]
    ext_atr = (c - entry_ref) / atr14
    allup = ok & (dirn == 1) & gate & (since <= 30) & (np.arange(n) % 2 == 0)
    fresh = ok & (dirn == 1) & (since <= 3) & gate
    upt = ok & (dirn == 1) & gate & (np.arange(n) % 5 == 0)
    # swing-low pivots for support
    sym_data[sym] = dict(o=o, h=h, l=l, c=c, atr=atr14, dir=dirn, line=line, adx=adx, date=d.date.values, since=since, ext=ext_atr)
    for t in np.flatnonzero(allup):
        if t + 2 < n: SETS.setdefault('ALL', []).append((sym, t))
    for key, f in (("FLIP", flip), ("FRESH3", fresh), ("UPTREND", upt)):
        for t in np.flatnonzero(f):
            if t + 1 < n: SETS[key].append((sym, t))


def run(S, t):
    o, c, dirn = S["o"], S["c"], S["dir"]; n = len(c); e = t + 1; entry = o[e]
    if not entry > 0: return None
    for k in range(e, min(n - 1, e + HOLD_MAX - 1) + 1):
        if dirn[k] == -1:
            fill = o[k + 1] if k + 1 < n else c[k]
            return (fill / entry - 1 - 2 * COST) * 100, k - e + 1
    last = min(n - 1, e + HOLD_MAX - 1)
    return (c[last] / entry - 1 - 2 * COST) * 100, last - e + 1

rows = []
for sym, t in SETS["ALL"]:
    S = sym_data[sym]; r = run(S, t)
    if r: rows.append((S["since"][t], S["ext"][t], r[0], r[1], S["date"][t + 1][:4]))
D = pd.DataFrame(rows, columns=["age", "ext", "ret", "days", "yr"]).dropna()
D["age_b"] = pd.cut(D.age, [-1, 0, 3, 10, 30], labels=["day 0 (the flip)", "1-3 days old", "4-10 days old", "11-30 days old"])
D["ext_b"] = pd.cut(D.ext, [-99, -1.0, 0.0, 0.5, 2.0, 99], labels=["under the buy point by 1+ ATR", "0 to 1 ATR under", "0 to 0.5 ATR over (near)", "0.5 to 2 ATR over", "2+ ATR over"])
print(f"{len(D):,} Supertrend-up signal days (daily Supertrend up, ADX gate, up to 30 days after the flip). Exit: a day closes under the line, next open, no time cap.")
print("\nBy age of the setup only:")
print(D.groupby("age_b", observed=True).agg(n=("ret", "size"), mean=("ret", "mean"), win=("ret", lambda x: (x > 0).mean() * 100), days=("days", "mean")).round(2).to_string())
print("\nBy how far the price has moved from the original buy point (in ATRs) only:")
print(D.groupby("ext_b", observed=True).agg(n=("ret", "size"), mean=("ret", "mean"), win=("ret", lambda x: (x > 0).mean() * 100), days=("days", "mean")).round(2).to_string())
print("\nAge x distance from the buy point (mean % per trade, n):")
tab = D.groupby(["age_b", "ext_b"], observed=True).agg(n=("ret", "size"), mean=("ret", "mean"))
for (a, b), r in tab.iterrows(): print(f"  {str(a):18s} {str(b):32s} n {int(r.n):5d}  mean {r['mean']:+6.2f}%")
print("\nBy year, setups 1-10 days old and 0 to 0.5 ATR over the buy point (near) versus day-0 flips:")
near = D[(D.age >= 1) & (D.age <= 10) & (D.ext >= -0.0) & (D.ext <= 0.5)]; flip0 = D[D.age == 0]
for y in sorted(D.yr.unique()):
    a, b = near[near.yr == y], flip0[flip0.yr == y]
    if len(a) > 15 and len(b) > 15: print(f"  {y}: near-but-older {a.ret.mean():+5.2f}% (n {len(a)})   day-0 {b.ret.mean():+5.2f}% (n {len(b)})")
