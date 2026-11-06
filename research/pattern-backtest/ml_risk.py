"""Risk-model test (research only): can ML forecast how far a stock will move, to set stops and position sizes?

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
    f["vol5"] = ret1.rolling(5).std(); f["vol10"] = ret1.rolling(10).std()
    f["atr5_ratio"] = tr.rolling(5).mean() / atr; f["absgap"] = f["gap"].abs()
    f["max_abs_ret21"] = ret1.abs().rolling(21).max(); f["range_pct"] = (h - l) / c
    minlow = pd.concat([l.shift(-k) for k in range(1, H + 1)], axis=1).min(axis=1)
    maxhigh = pd.concat([h.shift(-k) for k in range(1, H + 1)], axis=1).max(axis=1)
    f["mae"] = ((o.shift(-1) - minlow) / o.shift(-1)).clip(lower=0)
    f["rng5"] = (maxhigh - minlow) / o.shift(-1)
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
print(f"rows {len(lab):,}, symbols {lab.sym.nunique()}, dates {dates[0]} to {dates[-1]} ({len(dates)}), features {len(FEATS)}")

lab["tgt"] = np.log(lab.rng5.clip(lower=1e-4) / lab.atr_pct)   # forward 5-day range relative to the stock's own ATR
dates = np.array(sorted(lab.date.unique()))
RF = ["atr_pct", "vol5", "vol10", "vol20", "atr5_ratio", "absgap", "max_abs_ret21", "range_pct", "range_atr", "gap", "r1", "r3", "r5", "r21", "rsi2", "d_sma20", "d_sma200", "d_hi252", "vol_ratio", "spy_vol20", "spy_r5", "spy_r21", "spy_above200"]
FIRST_TRAIN, BLOCK, EMB = 250, 63, H + 1
oos = []
for start in range(FIRST_TRAIN + EMB, len(dates), BLOCK):
    tr = lab[lab.date.isin(set(dates[:start - EMB]))]; te = lab[lab.date.isin(set(dates[start:start + BLOCK]))].copy()
    if te.empty: continue
    te["p_atr"] = tr.tgt.mean()
    sc = StandardScaler().fit(tr[RF]); te["p_har"] = Ridge(alpha=10).fit(sc.transform(tr[RF]), tr.tgt).predict(sc.transform(te[RF]))
    te["p_gb"] = HistGradientBoostingRegressor(max_depth=4, learning_rate=0.05, max_iter=200, min_samples_leaf=500, l2_regularization=5.0, random_state=1).fit(tr[RF], tr.tgt).predict(te[RF])
    oos.append(te)
O = pd.concat(oos); print(f"out-of-sample {O.date.min()} to {O.date.max()}, {len(O):,} stock-days")

print("\n== 1) Forecasting the next 5-day range (log of range / ATR). R2 is the gain over using ATR alone ==")
var = O.tgt.var()
for col, nm in (("p_atr", "ATR alone (calibrated)"), ("p_har", "Linear (HAR-style)"), ("p_gb", "Gradient boosting")):
    r2 = 1 - ((O.tgt - O[col]) ** 2).mean() / ((O.tgt - O.tgt.mean()) ** 2).mean()
    print(f"  {nm:26s} R2 {r2:+.3f}  rank corr with actual range {spearmanr(O.atr_pct * np.exp(O[col]), O.rng5)[0]:+.3f}")

K = 3.0  # baseline stop: 3 ATR
O["base_s"] = K * O.atr_pct
def outcome(df, s):
    hit = df.mae >= s
    return np.where(hit, -s - 2 * COST, df.y), hit
O["y_atr"], O["hit_atr"] = outcome(O, O.base_s)
O["risk_gb"] = np.exp(O.p_gb)  # predicted range as a multiple of ATR
O["rdec"] = O.groupby("date").risk_gb.transform(lambda x: pd.qcut(x.rank(method="first"), 10, labels=False))
print("\n== 2) Does a 3 ATR stop get hit equally often for calm and wild stocks? (stop-hit % by predicted-risk decile) ==")
print("  " + "  ".join(f"D{int(k) + 1}:{v * 100:.0f}" for k, v in O.groupby("rdec").hit_atr.mean().items()) + f"   overall {O.hit_atr.mean() * 100:.1f}%")

# ML stop: scale the ATR stop by predicted risk, with the multiplier chosen so overall stop-hit rate matches the ATR stop
target_rate = O.hit_atr.mean()
def hit_rate_for(k): return (O.mae >= k * O.atr_pct * O.risk_gb).mean()
lo_k, hi_k = 0.1, 20.0
for _ in range(40):
    mid = (lo_k + hi_k) / 2
    if hit_rate_for(mid) > target_rate: lo_k = mid
    else: hi_k = mid
kml = (lo_k + hi_k) / 2
O["ml_s"] = kml * O.atr_pct * O.risk_gb
O["y_ml"], O["hit_ml"] = outcome(O, O.ml_s)

def tail(x): x = np.sort(x); return x[: max(1, int(len(x) * 0.05))].mean()
def line(nm, y, hit):
    y = np.asarray(y); L = y[y <= 0]
    return f"  {nm:34s} n {len(y):7d}  mean {y.mean() * 100:+.3f}%  win {np.mean(y > 0) * 100:.0f}%  stopped {np.mean(hit) * 100:4.1f}%  avg loss {L.mean() * 100:+.2f}%  worst 5% avg {tail(y) * 100:+.2f}%  worst {y.min() * 100:+.1f}%"
dip = O[(O.d_sma200 > 0) & (O.rsi2 < 10)]
print(f"\n== 3) ML-scaled stop vs 3 ATR stop at the same stop-out rate (multiplier {kml:.2f} x ATR x predicted risk) ==")
for nm, d in (("All stock-days", O), ("Dip entries (RSI2<10, uptrend)", dip)):
    print(f" {nm}")
    print(line("  3 ATR stop", d.y_atr, d.hit_atr)); print(line("  ML-scaled stop", d.y_ml, d.hit_ml))
    print(line("  No stop", d.y, np.zeros(len(d))))

print("\n== 4) Position sizing on dip entries: weekly portfolios (non-overlapping), weights sum to 100% per week, 3 ATR stop ==")
ds = sorted(O.date.unique())[::H]
def sizing(d, wcol, label):
    d = d[d.date.isin(ds)].copy()
    d["w"] = d[wcol] / d.groupby("date")[wcol].transform("sum")
    per = (d.w * d.y_atr).groupby(d.date).sum().reindex(ds).fillna(0.0)
    eq = (1 + per).cumprod(); dd = (1 - eq / eq.cummax()).max()
    print(f"  {label:30s} mean/week {per.mean() * 100:+.3f}%  std {per.std() * 100:.2f}%  mean/std x sqrt(52) {per.mean() / per.std() * np.sqrt(52):+.2f}  worst week {per.min() * 100:+.1f}%  max DD {dd * 100:.1f}%")
dip = dip.copy(); dip["w_eq"] = 1.0; dip["w_atr"] = 1 / dip.atr_pct; dip["w_gb"] = 1 / (dip.atr_pct * dip.risk_gb)
sizing(dip, "w_eq", "Equal weight"); sizing(dip, "w_atr", "Inverse ATR"); sizing(dip, "w_gb", "Inverse ML predicted range")

print("\n== 5) Skip the riskiest dip trades (by predicted range, within the signal set), 3 ATR stop ==")
dip["rrank"] = dip.risk_gb.rank(pct=True)
for cut in (1.0, 0.9, 0.8, 0.7, 0.5):
    d = dip[dip.rrank <= cut]
    print(line(f"  keep lowest {int(cut * 100)}% of predicted risk", d.y_atr, d.hit_atr))
print("  (dip trades with the highest predicted risk, top 20%)"); d = dip[dip.rrank > 0.8]; print(line("  riskiest 20%", d.y_atr, d.hit_atr))

print("\n== 6) Is the 'skip the riskiest dips' filter real? ML risk vs plain ATR% vs random, with a date-clustered bootstrap, and by year ==")
dip["arank"] = dip.atr_pct.rank(pct=True)
rg = np.random.default_rng(3); dip["rnd"] = rg.random(len(dip))
def kept_edge(d, col): return d[d[col] <= 0.8].y_atr.mean() - d.y_atr.mean()
for col, nm in (("rrank", "ML predicted range"), ("arank", "ATR% alone"), ("rnd", "Random (control)")):
    d0 = dip[["date", "y_atr", col]]; base = kept_edge(d0, col)
    byd = {k: g for k, g in d0.groupby("date")}; ds_ = list(byd)
    boots = []
    for _ in range(300):
        pick = rg.choice(len(ds_), len(ds_)); g = pd.concat([byd[ds_[i]] for i in pick]); boots.append(kept_edge(g, col))
    lo, hi = np.percentile(boots, [2.5, 97.5])
    print(f"  {nm:20s} keep lowest 80%: edge vs keeping all {base * 100:+.3f}% per trade, 95% CI [{lo * 100:+.3f}, {hi * 100:+.3f}]")
print("  By year, ML filter (keep lowest 80%) minus all dip trades:")
for y in sorted(set(d[:4] for d in dip.date)):
    d = dip[dip.date.str.startswith(y)]
    print(f"    {y}: all {d.y_atr.mean() * 100:+.2f}%  kept {d[d.rrank <= 0.8].y_atr.mean() * 100:+.2f}%  skipped-20% {d[d.rrank > 0.8].y_atr.mean() * 100:+.2f}%  n {len(d)}")
sig_n = dip.groupby("date").size()
big = dip[dip.date.isin(sig_n[sig_n >= 40].index)]; small = dip[~dip.date.isin(sig_n[sig_n >= 40].index)]
print(f"  Dips on days with 40+ signals (market-wide selloffs): n {len(big)}, mean {big.y_atr.mean() * 100:+.2f}% | other days: n {len(small)}, mean {small.y_atr.mean() * 100:+.2f}%")
