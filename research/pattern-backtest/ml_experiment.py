"""Walk-forward machine-learning test (research only, not shipped).

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

# ---- walk-forward ----
FIRST_TRAIN = 250; BLOCK = 63; EMB = H + 1
oos = []
def make_gb(): return HistGradientBoostingRegressor(max_depth=4, learning_rate=0.05, max_iter=150, min_samples_leaf=800, l2_regularization=5.0, random_state=1)
last = None
for start in range(FIRST_TRAIN + EMB, len(dates), BLOCK):
    tr_d = set(dates[:start - EMB]); te_d = set(dates[start:start + BLOCK])
    tr = lab[lab.date.isin(tr_d)]; te = lab[lab.date.isin(te_d)].copy()
    if te.empty: continue
    gb = make_gb().fit(tr[FEATS], tr.y_tr)
    te["p_gb"] = gb.predict(te[FEATS])
    sc = StandardScaler().fit(tr[FEATS]); rd = Ridge(alpha=1000).fit(sc.transform(tr[FEATS]), tr.y_tr)
    te["p_ridge"] = rd.predict(sc.transform(te[FEATS]))
    sh = make_gb().fit(tr[FEATS], rng.permutation(tr.y_tr.values))  # shuffled-label control
    te["p_shuf"] = sh.predict(te[FEATS])
    oos.append(te); last = (gb, te)
    print(f"fold {dates[start]} .. {dates[min(start + BLOCK, len(dates)) - 1]}: train {len(tr):,}, test {len(te):,}")
O = pd.concat(oos)
print(f"\nOut-of-sample: {O.date.min()} to {O.date.max()}, {O.date.nunique()} dates, {len(O):,} rows")

def ic_by_date(col):
    return O.groupby("date").apply(lambda g: spearmanr(g[col], g.y)[0], include_groups=False)
print("\n== Rank information coefficient (prediction vs actual 5-day return), non-overlapping every 5th date ==")
for col in ("p_gb", "p_ridge", "p_shuf"):
    ic = ic_by_date(col); s = ic.iloc[::H]
    print(f"  {col:8s} mean IC {ic.mean():+.4f} (all dates), {s.mean():+.4f} (every 5th), t {s.mean() / (s.std() / np.sqrt(len(s))):+.2f}, positive on {np.mean(ic > 0) * 100:.0f}% of dates")

print("\n== Return by predicted decile (daily deciles, mean net 5-day return %), gradient boosting ==")
O["dec"] = O.groupby("date").p_gb.transform(lambda x: pd.qcut(x.rank(method="first"), 10, labels=False))
print("  " + "  ".join(f"D{int(k) + 1}:{v * 100:+.2f}" for k, v in O.groupby("dec").y.mean().items()))
print(f"  universe mean {O.y.mean() * 100:+.2f}%, top minus bottom decile {(O[O.dec == 9].y.mean() - O[O.dec == 0].y.mean()) * 100:+.2f}%")

# ---- trading rules ----
spy_c = spy.c
def period_stats(sel, label):
    # every 5th date, equal weight, hold 5 days -> non-overlapping periods
    ds = sorted(O.date.unique())[::H]
    sel = sel[sel.date.isin(ds)]
    per = sel.groupby("date").y.mean().reindex(ds).fillna(0.0)  # no picks -> cash
    eq = (1 + per).cumprod(); dd = (1 - eq / eq.cummax()).max()
    yrs = (pd.Timestamp(ds[-1]) - pd.Timestamp(ds[0])).days / 365.25
    n = sel.groupby("date").size()
    print(f"  {label:34s} per-trade {sel.y.mean() * 100:+.2f}%  win {np.mean(sel.y > 0) * 100:.0f}%  trades {len(sel):5d}  equity {eq.iloc[-1]:.2f}x ({(eq.iloc[-1] ** (1 / yrs) - 1) * 100:+.1f}%/yr)  max DD {dd * 100:.1f}%")
    return per
print("\n== Weekly portfolios (non-overlapping 5-day holds, equal weight, cash if no picks) ==")
allw = period_stats(O, "Whole universe, equal weight")
for col, nm in (("p_gb", "GB"), ("p_ridge", "Ridge"), ("p_shuf", "Shuffled control")):
    for n in (10, 30):
        sel = O.sort_values(["date", col], ascending=[True, False]).groupby("date").head(n)
        period_stats(sel, f"{nm} top {n}")
dipsel = O[(O.d_sma200 > 0) & (O.rsi2 < 5) & (O.d_sma5 < 0) & (O.r3 < -0.05)]
period_stats(dipsel, "Rule: dip (RSI2<5, -5% 3d)")
# combine: dip rule candidates ranked by model
dipsel2 = dipsel.sort_values(["date", "p_gb"], ascending=[True, False]).groupby("date").head(10)
period_stats(dipsel2, "Rule: dip, best 10 by GB score")
sdates = sorted(O.date.unique())[::H]
sp = spy_c.reindex(sdates); yrs = (pd.Timestamp(sdates[-1]) - pd.Timestamp(sdates[0])).days / 365.25
print(f"  {'SPY buy and hold, same dates':34s} {sp.iloc[-1] / sp.iloc[0]:.2f}x ({((sp.iloc[-1] / sp.iloc[0]) ** (1 / yrs) - 1) * 100:+.1f}%/yr)")

print("\n== Top-30 GB edge over universe by year (mean per trade, %) ==")
top = O.sort_values(["date", "p_gb"], ascending=[True, False]).groupby("date").head(30)
for y in sorted(set(d[:4] for d in O.date)):
    a = top[top.date.str.startswith(y)].y.mean(); b = O[O.date.str.startswith(y)].y.mean()
    print(f"  {y}: top30 {a * 100:+.2f}%  universe {b * 100:+.2f}%  edge {(a - b) * 100:+.2f}%")

print("\n== Permutation importance on the last fold (drop in R2 when a feature is shuffled) ==")
gb, te = last
pi = permutation_importance(gb, te[FEATS], te.y_tr, n_repeats=3, random_state=0, n_jobs=-1)
for i in np.argsort(-pi.importances_mean)[:10]: print(f"  {FEATS[i]:14s} {pi.importances_mean[i]:+.5f}")

# ---- meta-labeling: can a model pick the better dip trades out of the rule's own signals? ----
print("\n\n== Meta-labeling the dip rule (RSI2<10 above the 200-day average), walk-forward, 6-month blocks ==")
sig = lab[(lab.d_sma200 > 0) & (lab.rsi2 < 10)].copy()
MF = ["rsi2", "r3", "r5", "r21", "atr_pct", "d_sma200", "d_sma5", "vol_ratio", "spy_r21", "spy_above200", "d_hi252", "mom12_1", "range_atr", "close_loc"]
sd = np.array(sorted(sig.date.unique())); print(f"signals {len(sig):,} on {len(sd)} dates")
res = []
for start in range(250, len(sd), 126):
    trd = set(sd[:max(0, start - EMB)]); ted = set(sd[start:start + 126])
    tr = sig[sig.date.isin(trd)]; te = sig[sig.date.isin(ted)].copy()
    if len(tr) < 800 or te.empty: continue
    gbm = HistGradientBoostingRegressor(max_depth=2, learning_rate=0.05, max_iter=100, min_samples_leaf=150, l2_regularization=10.0, random_state=1).fit(tr[MF], tr.y.clip(*tr.y.quantile([0.01, 0.99])))
    te["s_gb"] = gbm.predict(te[MF])
    scm = StandardScaler().fit(tr[MF]); rdm = Ridge(alpha=300).fit(scm.transform(tr[MF]), tr.y.clip(*tr.y.quantile([0.01, 0.99])))
    te["s_ridge"] = rdm.predict(scm.transform(te[MF]))
    te["s_shuf"] = rng.normal(size=len(te))
    res.append(te)
M = pd.concat(res); print(f"out-of-sample signals {len(M):,} from {M.date.min()} to {M.date.max()}; unfiltered mean {M.y.mean() * 100:+.2f}%, win {np.mean(M.y > 0) * 100:.0f}%")
for col in ("s_gb", "s_ridge", "s_shuf"):
    ranks = M[col].rank(pct=True); top, bot = M[ranks > 2 / 3], M[ranks <= 1 / 3]
    rho = spearmanr(M[col], M.y)[0]
    print(f"  {col:8s} rank corr with outcome {rho:+.3f} | top third {top.y.mean() * 100:+.2f}% (win {np.mean(top.y > 0) * 100:.0f}%) | bottom third {bot.y.mean() * 100:+.2f}% | top-bottom {(top.y.mean() - bot.y.mean()) * 100:+.2f}%")
