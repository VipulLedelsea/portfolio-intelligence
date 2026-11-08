"""Holding-period test (research only): how long should a trade be allowed to run? Return per trade and per day held for max holds of 1 to 10 days.

Shares the data, features and point-in-time rules of ml_experiment.py. Original docstring follows.

Walk-forward machine-learning test (research only, not shipped).

Question: can a model trained on daily price and volume features pick stocks that beat the average stock over the next
5 trading days, out of sample, after costs? Same data, point-in-time S&P 500 membership and costs as backtest6.mjs.

Signals use data up to the close of day t. Entry is the next open, exit is the close of day t+5, 0.1% cost per side.
Training uses only dates at least 6 trading days before each test block (embargo), so no label overlaps the test period.
"""
import json, sys
import numpy as np, pandas as pd
from scipy.stats import spearmanr
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
from sklearn.inspection import permutation_importance

COST = 0.001
H = 10
rng = np.random.default_rng(7)

current = json.load(open("bars.json")); former = json.load(open("bars_former.json"))
raw = {**former, **current}
intervals = {}
for line in open("members.csv").read().strip().split("\n")[1:]:
    t, a, b = (line.split(",") + [""])[:3]
    intervals.setdefault(t, []).append((a, b or "9999-12-31"))

def frame(rows):
    df = pd.DataFrame(rows, columns=["date", "o", "h", "l", "c", "v"])
    return df

spy = frame(raw["SPY"]).set_index("date")
spy_feat = pd.DataFrame({
    "spy_r5": spy.c / spy.c.shift(5) - 1, "spy_r21": spy.c / spy.c.shift(21) - 1,
    "spy_above200": (spy.c > spy.c.rolling(200).mean()).astype(float),
    "spy_vol20": spy.c.pct_change().rolling(20).std(),
})
for k in range(1, H + 1): spy_feat[f"spy_d{k}"] = spy.c.shift(-k) / spy.c.shift(-(k - 1)) - 1

def wilder(x, n):
    return x.ewm(alpha=1 / n, adjust=False).mean()

def features(sym, rows):
    d = frame(rows)
    if len(d) < 300 or (d[["o", "h", "l", "c"]] <= 0).any().any(): return None
    c, o, h, l, v = d.c, d.o, d.h, d.l, d.v
    pc = c.shift(1); ret1 = c / pc - 1
    tr = pd.concat([h - l, (h - pc).abs(), (l - pc).abs()], axis=1).max(axis=1)
    atr = tr.rolling(14).mean()
    f = pd.DataFrame({"date": d.date, "sym": sym})
    for k in (1, 2, 3, 5, 10, 21, 63, 126): f[f"r{k}"] = c / c.shift(k) - 1
    f["mom12_1"] = c.shift(21) / c.shift(252) - 1
    for p in (5, 20, 50, 200): f[f"d_sma{p}"] = c / c.rolling(p).mean() - 1
    g = ret1.clip(lower=0); ls = (-ret1).clip(lower=0)
    f["rsi2"] = 100 - 100 / (1 + wilder(g, 2) / (wilder(ls, 2) + 1e-12))
    f["rsi14"] = 100 - 100 / (1 + wilder(g, 14) / (wilder(ls, 14) + 1e-12))
    f["atr_pct"] = atr / c
    f["range_atr"] = (h - l) / atr.shift(1)
    f["gap"] = o / pc - 1
    f["close_loc"] = (c - l) / (h - l + 1e-12)
    f["vol_ratio"] = v / v.rolling(50).mean().shift(1)
    f["d_hi252"] = c / c.rolling(252).max() - 1
    f["d_lo252"] = c / c.rolling(252).min() - 1
    f["vol20"] = ret1.rolling(20).std()
    f["down5"] = (ret1 < 0).rolling(5).sum()
    up = h.diff(); dn = -l.diff()
    pdm = ((up > dn) & (up > 0)) * up; mdm = ((dn > up) & (dn > 0)) * dn
    trs = wilder(tr, 14); pdi = 100 * wilder(pdm, 14) / trs; mdi = 100 * wilder(mdm, 14) / trs
    f["adx"] = wilder(100 * (pdi - mdi).abs() / (pdi + mdi + 1e-12), 14)
    f["adx_chg5"] = f["adx"] - f["adx"].shift(5)
    f["c0"] = c
    for n in (3, 5, 10, 20): f[f"ll{n}"] = l.rolling(n).min() / c; f[f"hh{n}"] = h.rolling(n).max() / c
    for n in (5, 10, 20): f[f"ma{n}"] = c.rolling(n).mean() / c
    f["vol5"] = ret1.rolling(5).std(); f["vol10"] = ret1.rolling(10).std()
    f["atr5_ratio"] = tr.rolling(5).mean() / atr; f["absgap"] = f["gap"].abs()
    f["max_abs_ret21"] = ret1.abs().rolling(21).max(); f["range_pct"] = (h - l) / c
    minlow = pd.concat([l.shift(-k) for k in range(1, H + 1)], axis=1).min(axis=1)
    maxhigh = pd.concat([h.shift(-k) for k in range(1, H + 1)], axis=1).max(axis=1)
    f["mae"] = ((o.shift(-1) - minlow) / o.shift(-1)).clip(lower=0)
    f["rng5"] = (maxhigh - minlow) / o.shift(-1)
    f["mfe"] = ((maxhigh - o.shift(-1)) / o.shift(-1)).clip(lower=0)
    for k in range(1, H + 1):
        f[f"fo{k}"] = o.shift(-k); f[f"fh{k}"] = h.shift(-k); f[f"fl{k}"] = l.shift(-k); f[f"fc{k}"] = c.shift(-k)
    # label: next open to close of t+H, net of costs
    entry = o.shift(-1); exit_ = c.shift(-H)
    f["y"] = exit_ / entry - 1 - 2 * COST
    bad = (ret1.abs() > 0.35).astype(float)
    f["bad"] = ((bad.rolling(260, min_periods=1).max() > 0) | (bad[::-1].rolling(H + 1, min_periods=1).max()[::-1] > 0)).values
    mem = intervals.get(sym, [])
    f["member"] = [any(a <= x <= b for a, b in mem) for x in d.date]
    return f

parts = [x for s, r in raw.items() if s != "SPY" for x in [features(s, r)] if x is not None]
P = pd.concat(parts, ignore_index=True)
P = P.merge(spy_feat, left_on="date", right_index=True, how="left")
P = P[P.member & ~P.bad].drop(columns=["member", "bad"])
FEATS = [c for c in P.columns if c not in ("date", "sym", "y")]
P = P.dropna(subset=FEATS)
for col in ("r5", "r21", "rsi2", "atr_pct", "vol_ratio", "mom12_1", "d_sma200", "d_sma20", "range_atr"):
    P[f"rk_{col}"] = P.groupby("date")[col].rank(pct=True)
FEATS += [c for c in P.columns if c.startswith("rk_")]
P = P.replace([np.inf, -np.inf], np.nan).dropna(subset=FEATS)
lab = P.dropna(subset=["y"]).copy()
lab["y_ex"] = lab.y - lab.groupby("date").y.transform("mean")
lo, hi = lab.y_ex.quantile([0.01, 0.99]); lab["y_tr"] = lab.y_ex.clip(lo, hi)
dates = np.array(sorted(lab.date.unique()))

def sim(df, S, T, hold):
    """Long trade, stop S ATR below and target T ATR above the entry open, time exit at the close of day `hold`. Returns net return, exit kind and the day it ended."""
    n = len(df); entry = df.fo1.values; atr = df.atr_pct.values * df.c0.values
    stop = entry - S * atr; tgt = entry + T * atr
    exit_ = df[f"fc{hold}"].values.copy(); kind = np.zeros(n, dtype=np.int8); day = np.full(n, hold); alive = np.ones(n, dtype=bool)
    for k in range(1, hold + 1):
        o_, h_, l_ = (df[f"f{x}{k}"].values for x in "ohl")
        gs = alive & (k > 1) & (o_ <= stop); ts = alive & ~gs & (l_ <= stop)
        gt = alive & ~gs & ~ts & (k > 1) & (o_ >= tgt); tt = alive & ~gs & ~ts & ~gt & (h_ >= tgt)
        done = gs | ts | gt | tt
        exit_ = np.where(gs, o_, np.where(ts, stop, np.where(gt, o_, np.where(tt, tgt, exit_))))
        kind = np.where(gs | ts, 1, np.where(gt | tt, 2, kind)); day = np.where(alive & done, k, day); alive = alive & ~done
    return exit_ / entry - 1 - 2 * COST, kind, day

SETS = {
    "Dip entries, market under stress (SPY -1.5% in 5d)": lambda d: (d.d_sma200 > 0) & (d.rsi2 < 10) & (d.spy_r5 <= -0.015),
    "Dip entries, any market": lambda d: (d.d_sma200 > 0) & (d.rsi2 < 10),
    "Any stock-day (every 3rd date)": lambda d: pd.Series(d.date.map(hash) % 3 == 0, index=d.index),
}
for nm, f in SETS.items():
    D = lab[f(lab)].copy()
    print(f"\n=== {nm}: {len(D):,} trades ===")
    for S, T in ((2, 1), (2, 2), (1.5, 1)):
        print(f"  stop {S} ATR / target {T} ATR")
        print(f"    {'max hold':>9s} {'mean%/trade':>11s} {'win%':>5s} {'avg days':>8s} {'target%':>7s} {'stop%':>6s} {'%/day held':>10s} {'% per year*':>11s}")
        for hold in (1, 2, 3, 4, 5, 7, 10):
            r, kind, day = sim(D, S, T, hold)
            per_day = r.mean() * 100 / day.mean()
            print(f"    {hold:9d} {r.mean() * 100:+11.3f} {np.mean(r > 0) * 100:5.0f} {day.mean():8.2f} {np.mean(kind == 2) * 100:7.1f} {np.mean(kind == 1) * 100:6.1f} {per_day:+10.3f} {per_day * 252:+11.0f}")
    print("  * % per year = mean return per day held x 252, if capital were always in a trade of this kind (an upper bound: signals are not available every day)")
