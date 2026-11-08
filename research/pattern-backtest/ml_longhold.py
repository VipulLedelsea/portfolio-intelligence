"""Long-hold test (research only): what happens if trades are allowed to run 10, 20, 40 or 60 days, with fixed, no-target and trailing exits?

Entries: dips (RSI(2) < 10 above the 200-day average), dips while SPY is down 1.5% in 5 days, and any stock-day (every 5th day), on the
point-in-time S&P 500. Entry at the next open, 0.1% cost per side. Levels are in daily ATRs at the signal close. Signals in the last 60
trading days are dropped so every hold length uses the same trades. Overlapping signals in one stock are kept (means are unaffected, but
the trades are not independent).
"""
import json
import numpy as np, pandas as pd
from numpy.lib.stride_tricks import sliding_window_view as swv

COST = 0.001
MAXH = 60
current = json.load(open("bars.json")); former = json.load(open("bars_former.json"))
raw = {**former, **current}
intervals = {}
for line in open("members.csv").read().strip().split("\n")[1:]:
    t, a, b = (line.split(",") + [""])[:3]
    intervals.setdefault(t, []).append((a, b or "9999-12-31"))
spy = pd.DataFrame(raw["SPY"], columns=["date", "o", "h", "l", "c", "v"]).set_index("date")
spy_r5 = spy.c / spy.c.shift(5) - 1
spy_daily = (spy.c.iloc[-1] / spy.c.iloc[0]) ** (1 / (len(spy) - 1)) - 1

SETS = ("stress", "dip", "any")
store = {k: dict(O=[], H=[], L=[], C=[], entry=[], atr=[], date=[]) for k in SETS}
for sym, rows in raw.items():
    if sym == "SPY" or len(rows) < 300: continue
    d = pd.DataFrame(rows, columns=["date", "o", "h", "l", "c", "v"])
    if (d[["o", "h", "l", "c"]] <= 0).any().any(): continue
    c, o, h, l = d.c, d.o, d.h, d.l
    tr = pd.concat([h - l, (h - c.shift(1)).abs(), (l - c.shift(1)).abs()], axis=1).max(axis=1)
    atr = tr.rolling(14).mean()
    ch = c.diff(); up, dn = ch.clip(lower=0), (-ch).clip(lower=0)
    rsi2 = 100 - 100 / (1 + up.ewm(alpha=0.5, adjust=False).mean() / (dn.ewm(alpha=0.5, adjust=False).mean() + 1e-12))
    bad = (c.pct_change().abs() > 0.35)
    bad_any = bad.rolling(260, min_periods=1).max().astype(bool) | bad[::-1].rolling(MAXH + 2, min_periods=1).max()[::-1].astype(bool)
    member = np.array([any(a_ <= x <= b_ for a_, b_ in intervals.get(sym, [])) for x in d.date])
    ok = member & ~bad_any.values & (atr.notna().values) & (c.rolling(200).mean().notna().values)
    dip = ok & (c > c.rolling(200).mean()).values & (rsi2 < 10).values
    stress = dip & (d.date.map(spy_r5).fillna(0) <= -0.015).values
    anyd = ok & (np.arange(len(d)) % 5 == 0)
    n = len(d)
    oa, ha, la, ca = o.values, h.values, l.values, c.values
    W = {name: swv(arr, MAXH) for name, arr in (("O", oa), ("H", ha), ("L", la), ("C", ca))}
    for key, flag in (("stress", stress), ("dip", dip), ("any", anyd)):
        t_idx = np.flatnonzero(flag); t_idx = t_idx[t_idx + 1 + MAXH <= n]
        if not len(t_idx): continue
        e = t_idx + 1
        for name in "OHLC": store[key][name].append(W[name][e])
        store[key]["entry"].append(oa[e]); store[key]["atr"].append(atr.values[t_idx]); store[key]["date"].append(d.date.values[e])
data = {k: {n: np.concatenate(v) for n, v in s.items()} for k, s in store.items()}

def sim(D, hold, stop_atr, tgt_atr=None, trail_atr=None):
    n = len(D["entry"]); entry, atr = D["entry"], D["atr"]
    stop = entry - stop_atr * atr; tgt = entry + tgt_atr * atr if tgt_atr else np.full(n, np.inf)
    exit_ = D["C"][:, hold - 1].copy(); kind = np.zeros(n, dtype=np.int8); day = np.full(n, hold); alive = np.ones(n, dtype=bool)
    hc = entry.copy()
    for k in range(hold):
        o_, h_, l_, c_ = D["O"][:, k], D["H"][:, k], D["L"][:, k], D["C"][:, k]
        gs = alive & (k > 0) & (o_ <= stop); ts = alive & ~gs & (l_ <= stop)
        gt = alive & ~gs & ~ts & (k > 0) & (o_ >= tgt); tt = alive & ~gs & ~ts & ~gt & (h_ >= tgt)
        done = gs | ts | gt | tt
        exit_ = np.where(gs, o_, np.where(ts, stop, np.where(gt, o_, np.where(tt, tgt, exit_))))
        kind = np.where(gs | ts, 1, np.where(gt | tt, 2, kind)); day = np.where(alive & done, k + 1, day); alive = alive & ~done
        if trail_atr:
            hc = np.maximum(hc, c_); stop = np.where(alive, np.maximum(stop, hc - trail_atr * atr), stop)
    return exit_ / entry - 1 - 2 * COST, kind, day

CONFIGS = {
    "stop 2 / target 1 ATR": dict(stop_atr=2, tgt_atr=1), "stop 2 / target 2 ATR": dict(stop_atr=2, tgt_atr=2), "stop 2 / target 4 ATR": dict(stop_atr=2, tgt_atr=4),
    "stop 3 ATR, no target": dict(stop_atr=3), "trail 3 ATR (start 3), no target": dict(stop_atr=3, trail_atr=3), "trail 2 ATR (start 2), no target": dict(stop_atr=2, trail_atr=2),
}
NAMES = {"stress": "Dips, market under stress (SPY -1.5% in 5d)", "dip": "All dips", "any": "Any stock-day (every 5th day)"}
print(f"S&P 500 buy-and-hold over the same period: {spy_daily * 100:+.3f}% per day ({spy_daily * 252 * 100:+.0f}% a year)")
for key in SETS:
    D = data[key]; yr = np.array([x[:4] for x in D["date"]])
    print(f"\n=== {NAMES[key]}: {len(D['entry']):,} trades ===")
    for cn, kw in CONFIGS.items():
        print(f"  {cn}")
        print(f"    {'max hold':>8s} {'mean%/trade':>11s} {'win%':>5s} {'avg days':>8s} {'target%':>7s} {'stop%':>6s} {'%/day held':>10s} {'avg win':>8s} {'avg loss':>8s}  by year (mean%/trade)")
        for hold in (5, 10, 20, 40, 60):
            r, kind, day = sim(D, hold, **kw)
            W, L = r[r > 0], r[r <= 0]
            yrs = " ".join(f"{y[2:]}:{r[yr == y].mean() * 100:+.1f}" for y in sorted(set(yr)) if (yr == y).sum() > 50)
            print(f"    {hold:8d} {r.mean() * 100:+11.3f} {np.mean(r > 0) * 100:5.0f} {day.mean():8.1f} {np.mean(kind == 2) * 100:7.1f} {np.mean(kind == 1) * 100:6.1f} {r.mean() * 100 / day.mean():+10.3f} {W.mean() * 100:+8.1f} {L.mean() * 100:+8.1f}  {yrs}")
