"""Stock-selection test (research only): which characteristics of a dip candidate go with better 5-day outcomes?

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
H = 5
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
rg = np.random.default_rng(8)
FEATURES = {
    "12-1 month momentum": "mom12_1", "63-day return (before the dip)": "r63", "21-day return": "r21", "Distance above 200-day average": "d_sma200",
    "Distance from 52-week high": "d_hi252", "Daily range (ATR % of price)": "atr_pct", "Volume vs 50-day average": "vol_ratio",
    "Dip depth: 3-day return": "r3", "RSI(2)": "rsi2", "Trend strength (ADX)": "adx", "Gap at the signal day": "gap", "Today's range in ATRs": "range_atr",
}
SETS = {
    "Dips, market under stress (SPY -1.5% in 5d)": lambda d: (d.d_sma200 > 0) & (d.rsi2 < 10) & (d.spy_r5 <= -0.015),
    "All dips": lambda d: (d.d_sma200 > 0) & (d.rsi2 < 10),
}
for nm, f in SETS.items():
    D = lab[f(lab)].copy()
    D["y"] = D.y * 100                       # 5-day net return, % (next open to close of day 5, 0.2% costs)
    D["y_dm"] = D.y - D.groupby("date").y.transform("mean")   # minus that day's average dip, to strip market-wide effects
    print(f"\n=== {nm}: {len(D):,} trades; mean {D.y.mean():+.3f}%, win {np.mean(D.y > 0) * 100:.0f}% ===")
    print(f"  {'characteristic':36s}  quintile means (low -> high) of 5-day return %                 top-bottom   95% CI (date-clustered)   demeaned t-b   by year (t-b)")
    for label, col in FEATURES.items():
        D["q"] = pd.qcut(D[col].rank(method="first"), 5, labels=False)
        m = D.groupby("q").y.mean(); tb = m.iloc[-1] - m.iloc[0]
        dm = D.groupby("q").y_dm.mean(); tbd = dm.iloc[-1] - dm.iloc[0]
        g = D.assign(top=(D.q == 4), bot=(D.q == 0)); byd = g.groupby("date")
        ts, tc = byd.apply(lambda x: x.loc[x.top, "y"].sum(), include_groups=False).values, byd.apply(lambda x: x.top.sum(), include_groups=False).values
        bs, bc = byd.apply(lambda x: x.loc[x.bot, "y"].sum(), include_groups=False).values, byd.apply(lambda x: x.bot.sum(), include_groups=False).values
        boots = []
        for _ in range(300):
            ix = rg.integers(0, len(ts), len(ts)); a, b, c_, d_ = ts[ix].sum(), tc[ix].sum(), bs[ix].sum(), bc[ix].sum()
            if b > 0 and d_ > 0: boots.append(a / b - c_ / d_)
        lo, hi = np.percentile(boots, [2.5, 97.5])
        yrs = " ".join(f"{y[2:]}:{(D[(D.q == 4) & D.date.str.startswith(y)].y.mean() - D[(D.q == 0) & D.date.str.startswith(y)].y.mean()):+.2f}" for y in sorted(set(x[:4] for x in D.date)) if ((D.q == 4) & D.date.str.startswith(y)).sum() > 30)
        print(f"  {label:36s}  " + " ".join(f"{v:+6.2f}" for v in m.values) + f"      {tb:+6.2f}   [{lo:+6.2f},{hi:+6.2f}]          {tbd:+6.2f}      {yrs}")

# ---- Is the dip the stock's own, or the market's / sector's? ----
sector = {}
for line in open("sp500.csv").read().strip().split("\n")[1:]:
    parts = line.split(","); sector[parts[0].replace('"', "")] = parts[2] if len(parts) > 2 else "Unknown"
P["sector"] = P.sym.map(sector).fillna("Unknown")
P["sec_r3"] = P.groupby(["date", "sector"]).r3.transform("mean")
P["mkt_r3"] = P.groupby("date").r3.transform("mean")
lab["sec_rel"] = (lab.r3 - P.loc[lab.index, "sec_r3"]) * 100
lab["mkt_rel"] = (lab.r3 - P.loc[lab.index, "mkt_r3"]) * 100
lab["sector_drop"] = P.loc[lab.index, "sec_r3"] * 100
print("\n\n=== Own-stock dip versus sector and market dip (5-day return %, quintiles low -> high) ===")
for nm, f in SETS.items():
    D = lab[f(lab)].copy(); D["y"] = D.y * 100
    print(f"\n {nm}: {len(D):,} trades")
    for label, col in {"3-day drop relative to its sector (low = fell more than sector)": "sec_rel", "3-day drop relative to all stocks (low = fell more)": "mkt_rel", "Sector's own 3-day return (low = sector fell most)": "sector_drop"}.items():
        D["q"] = pd.qcut(D[col].rank(method="first"), 5, labels=False); m = D.groupby("q").y.mean()
        print(f"  {label:66s} " + " ".join(f"{v:+6.2f}" for v in m.values) + f"   top-bottom {m.iloc[-1] - m.iloc[0]:+.2f}")
