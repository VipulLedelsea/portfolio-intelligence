"""General stock-selection test (research only): which stock-level signals rank the next 5, 10 and 21 days of returns, for any entry?

Original docstring follows.

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
    # label: next open to close of t+H, net of costs
    entry = o.shift(-1); exit_ = c.shift(-H)
    f["y"] = exit_ / entry - 1 - 2 * COST
    f["y10"] = c.shift(-10) / entry - 1 - 2 * COST
    f["y21"] = c.shift(-21) / entry - 1 - 2 * COST
    # earnings-style event proxy: a big gap on heavy volume (no earnings calendar is needed)
    avgv = v.rolling(50).mean().shift(1)
    ev = ((f["gap"].abs() >= 0.04) & (v >= 2.5 * avgv))
    idx = pd.Series(np.arange(len(d)), index=d.index)
    last_ev = idx.where(ev).ffill()
    f["ev_days"] = (idx - last_ev).clip(upper=90).fillna(90)
    f["ev_gap"] = f["gap"].where(ev).ffill().where(f["ev_days"] < 60, 0.0).fillna(0.0)
    f["ev_ret_since"] = (c / c.where(ev).ffill() - 1).where(f["ev_days"] < 60, 0.0).fillna(0.0)
    f["dvol"] = np.log((c * v.rolling(50).mean()).clip(lower=1))
    f["inv_vol"] = -f["vol20"]
    bad = (ret1.abs() > 0.35).astype(float)
    f["bad"] = ((bad.rolling(260, min_periods=1).max() > 0) | (bad[::-1].rolling(22, min_periods=1).max()[::-1] > 0)).values
    mem = intervals.get(sym, [])
    f["member"] = [any(a <= x <= b for a, b in mem) for x in d.date]
    return f

parts = [x for s, r in raw.items() if s != "SPY" for x in [features(s, r)] if x is not None]
P = pd.concat(parts, ignore_index=True)
P = P.merge(spy_feat, left_on="date", right_index=True, how="left")
P = P[P.member & ~P.bad].drop(columns=["member", "bad"])
FEATS = [c for c in P.columns if c not in ("date", "sym", "y", "y10", "y21")]
P = P.dropna(subset=FEATS)
for col in ("r5", "r21", "rsi2", "atr_pct", "vol_ratio", "mom12_1", "d_sma200", "d_sma20", "range_atr"):
    P[f"rk_{col}"] = P.groupby("date")[col].rank(pct=True)
FEATS += [c for c in P.columns if c.startswith("rk_")]
P = P.replace([np.inf, -np.inf], np.nan).dropna(subset=FEATS)
# sector-relative features
sector = {}
for line in open("sp500.csv").read().strip().split("\n")[1:]:
    parts = line.split(","); sector[parts[0].replace('"', "")] = parts[2] if len(parts) > 2 else "Unknown"
P["sector"] = P.sym.map(sector).fillna("Unknown")
P["sec_r63"] = P.groupby(["date", "sector"]).r63.transform("mean")
P["rel_sec_r63"] = P.r63 - P.sec_r63
P["rk_dvol"] = P.groupby("date").dvol.rank(pct=True)
FACTORS = {
    "12-1 month momentum": "mom12_1", "126-day return": "r126", "63-day return": "r63", "21-day return": "r21", "5-day return (reversal)": "r5", "1-day return": "r1",
    "Distance above 200-day avg": "d_sma200", "Distance above 50-day avg": "d_sma50", "Distance from 52-week high": "d_hi252", "Distance above 52-week low": "d_lo252",
    "Low volatility (-20d vol)": "inv_vol", "ATR % of price": "atr_pct", "Size proxy (dollar volume)": "dvol", "Volume vs 50-day avg": "vol_ratio",
    "Trend strength (ADX)": "adx", "RSI(2) (low = oversold)": "rsi2", "RSI(14)": "rsi14",
    "Sector momentum (63d)": "sec_r63", "Stock vs its sector (63d)": "rel_sec_r63",
    "Earnings-style gap size (last 60d)": "ev_gap", "Return since that gap": "ev_ret_since",
}
print(f"rows {len(P):,}, symbols {P.sym.nunique()}, dates {P.date.min()} to {P.date.max()}")
print("\n== Rank information coefficient of each factor with the NEXT 5, 10 and 21 trading days of returns (positive = higher factor, higher return) ==")
print("   Daily cross-sectional Spearman averaged over time; t uses non-overlapping dates (every h-th). Years positive = count of years with a positive average IC.")
print(f"  {'factor':36s}" + "".join(f"{'IC ' + str(h) + 'd':>9s}{'t':>6s}{'yrs+':>6s}" for h in (5, 10, 21)))
rows = []
for label, col in FACTORS.items():
    out = []
    for h, ycol in ((5, "y"), (10, "y10"), (21, "y21")):
        d = P.dropna(subset=[ycol, col])
        ic = d.groupby("date").apply(lambda g: spearmanr(g[col], g[ycol])[0] if g[col].nunique() > 5 else np.nan, include_groups=False).dropna()
        sub = ic.iloc[::h]; t = sub.mean() / (sub.std() / np.sqrt(len(sub)))
        yrs = ic.groupby(ic.index.str[:4]).mean(); out.append((ic.mean(), t, int((yrs > 0).sum()), len(yrs)))
    rows.append((label, out))
    print(f"  {label:36s}" + "".join(f"{o[0]:+9.4f}{o[1]:+6.1f}{o[2]:>4d}/{o[3]}" for o in out))
