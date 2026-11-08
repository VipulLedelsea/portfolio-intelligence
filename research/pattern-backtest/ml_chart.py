"""Chart-based level test (research only): do stops below swing lows and targets at prior highs or moving averages beat fixed ATR multiples?

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
SPLIT = "2025-01-01"

def sim(df, stop, tgt):
    """5-day long trade with absolute stop and target prices from the chart. Entry is the next open. Stop first when a bar touches both; gaps fill at the open."""
    n = len(df); entry = df.fo1.values
    exit_ = df.fc5.values.copy(); kind = np.zeros(n, dtype=np.int8); alive = np.ones(n, dtype=bool)
    for k in range(1, H + 1):
        o_, h_, l_ = (df[f"f{x}{k}"].values for x in "ohl")
        gs = alive & (k > 1) & (o_ <= stop); ts = alive & ~gs & (l_ <= stop)
        gt = alive & ~gs & ~ts & (k > 1) & (o_ >= tgt); tt = alive & ~gs & ~ts & ~gt & (h_ >= tgt)
        exit_ = np.where(gs, o_, np.where(ts, stop, np.where(gt, o_, np.where(tt, tgt, exit_))))
        kind = np.where(gs | ts, 1, np.where(gt | tt, 2, kind)); alive = alive & ~(gs | ts | gt | tt)
    return exit_ / entry - 1 - 2 * COST, kind

def levels(df, stop_rule, tgt_rule, lo_s=1.0, hi_s=3.0, lo_t=0.5, hi_t=3.0):
    entry = df.fo1.values; atr = df.atr_pct.values * df.c0.values; c0 = df.c0.values
    # stop: from the chart, but never closer than lo_s ATR or farther than hi_s ATR
    if stop_rule[0] == "hyb":  # the closer of an ATR stop and a stop under the N-day low, never under 1 ATR
        sd = np.clip(np.minimum(stop_rule[1] * atr, entry - (df[f"ll{stop_rule[2]}"].values * c0 - 0.25 * atr)), 1.0 * atr, stop_rule[1] * atr)
    elif stop_rule[0] == "atr": sd = stop_rule[1] * atr
    else: sd = entry - (df[f"ll{stop_rule[1]}"].values * c0 - 0.25 * atr)
    sd = np.clip(sd, lo_s * atr, hi_s * atr) if stop_rule[0] not in ("atr", "hyb") else sd
    if tgt_rule[0] == "cap":  # an ATR target pulled in to just under the N-day high (a resistance), never under 0.5 ATR
        td = np.clip(np.minimum(tgt_rule[1] * atr, np.nan_to_num(df[f"hh{tgt_rule[2]}"].values * c0 - entry, nan=tgt_rule[1] * atr)), 0.5 * atr, tgt_rule[1] * atr)
    elif tgt_rule[0] == "atr": td = tgt_rule[1] * atr
    elif tgt_rule[0] == "hh": td = df[f"hh{tgt_rule[1]}"].values * c0 - entry
    else: td = df[f"ma{tgt_rule[1]}"].values * c0 - entry
    td = np.clip(np.nan_to_num(td, nan=atr), lo_t * atr, hi_t * atr) if tgt_rule[0] not in ("atr", "cap") else td
    return entry - sd, entry + td, sd / atr, td / atr

STOPS = {"ATR 2": ("atr", 2), "ATR 4": ("atr", 4), "3-day low": ("ll", 3), "5-day low": ("ll", 5), "10-day low": ("ll", 10), "20-day low": ("ll", 20)}
TARGETS = {"ATR 1": ("atr", 1), "ATR 2": ("atr", 2), "5-day high": ("hh", 5), "10-day high": ("hh", 10), "20-day high": ("hh", 20), "5-day avg": ("ma", 5), "10-day avg": ("ma", 10), "20-day avg": ("ma", 20)}
STOPS.update({"2 ATR or 20d low": ("hyb", 2, 20), "2 ATR or 10d low": ("hyb", 2, 10), "3 ATR or 20d low": ("hyb", 3, 20)})
TARGETS.update({"2 ATR, capped at 5d high": ("cap", 2, 5), "2 ATR, capped at 10d high": ("cap", 2, 10), "2 ATR, capped at 20d high": ("cap", 2, 20), "3 ATR, capped at 10d high": ("cap", 3, 10)})
if len(sys.argv) > 1 and sys.argv[1] == "hybrid":
    COMBOS = [("ATR 2", "ATR 1"), ("ATR 2", "ATR 2")] + [(st, tg) for st in ("ATR 2", "2 ATR or 20d low", "2 ATR or 10d low", "3 ATR or 20d low") for tg in ("2 ATR, capped at 5d high", "2 ATR, capped at 10d high", "2 ATR, capped at 20d high", "3 ATR, capped at 10d high")]
else:
    COMBOS = [("ATR 2", "ATR 1"), ("ATR 2", "ATR 2"), ("ATR 4", "ATR 1")]
SETS = {
    "Dip entries, market under stress (SPY -1.5% in 5d)": lambda d: (d.d_sma200 > 0) & (d.rsi2 < 10) & (d.spy_r5 <= -0.015),
    "Dip entries, any market": lambda d: (d.d_sma200 > 0) & (d.rsi2 < 10),
    "Any stock-day (every 3rd date)": lambda d: pd.Series(d.date.map(hash) % 3 == 0, index=d.index),
}
rg = np.random.default_rng(4)
for nm, f in SETS.items():
    D = lab[f(lab)].copy().dropna(subset=["ll20", "hh20", "ma20", "c0"])
    print(f"\n=== {nm}: {len(D):,} trades ===")
    print(f"  {'stop / target':36s} {'mean%':>6s} {'vs 2/1':>7s} {'win%':>5s} {'avgL%':>6s} {'w5%':>6s} {'stop%':>5s} {'tgt%':>5s} {'stopATR':>7s} {'tgtATR':>6s} {'R:R med':>7s} {'stop% px':>8s}  halves vs 2/1")
    base = None
    for sk, tk in COMBOS:
        sp, tp, sa, ta = levels(D, STOPS[sk], TARGETS[tk])
        r, kind = sim(D, sp, tp)
        if base is None: base = r
        L = r[r <= 0]; ls = np.sort(r); diff = r - base
        h1 = diff[(D.date < SPLIT).values].mean() * 100; h2 = diff[(D.date >= SPLIT).values].mean() * 100
        stoppx = np.median((D.fo1.values - sp) / D.fo1.values) * 100
        print(f"  {sk + ' / ' + tk:36s} {r.mean() * 100:+6.3f} {diff.mean() * 100:+7.3f} {np.mean(r > 0) * 100:5.0f} {L.mean() * 100:+6.2f} {ls[:max(1, len(ls) // 20)].mean() * 100:+6.2f} {np.mean(kind == 1) * 100:5.1f} {np.mean(kind == 2) * 100:5.1f} {np.median(sa):7.2f} {np.median(ta):6.2f} {np.median(ta / sa):7.2f} {stoppx:8.1f}  {h1:+.3f} / {h2:+.3f}")
