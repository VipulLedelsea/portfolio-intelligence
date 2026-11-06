"""Adaptive risk/reward test (research only): should the stop and target change with the stock, the market and other factors?

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
print(f"rows {len(lab):,}, symbols {lab.sym.nunique()}, dates {dates[0]} to {dates[-1]} ({len(dates)}), features {len(FEATS)}")

dates = np.array(sorted(lab.date.unique()))
RF = ["atr_pct", "vol5", "vol10", "vol20", "atr5_ratio", "absgap", "max_abs_ret21", "range_pct", "range_atr", "gap", "r1", "r3", "r5", "r21", "rsi2", "d_sma20", "d_sma200", "d_hi252", "vol_ratio", "spy_vol20", "spy_r5", "spy_r21", "spy_above200"]
SGRID, TGRID = [1.5, 2, 3, 4], [0.5, 0.75, 1, 1.5, 2]   # in units of the stock's own daily ATR%
FIRST_TRAIN, BLOCK, EMB = 250, 63, H + 1

def sim(df, s, t):
    """Path-aware 5-day trade. s, t = stop and target as fractions of the entry open (scalars or arrays). Stop is checked first when a bar touches both."""
    n = len(df); entry = df.fo1.values
    stop = entry * (1 - s); tgt = entry * (1 + t)
    exit_ = df.fc5.values.copy(); kind = np.zeros(n, dtype=np.int8)  # 0 time, 1 stop, 2 target
    alive = np.ones(n, dtype=bool)
    for k in range(1, H + 1):
        o_, h_, l_ = df[f"fo{k}"].values, df[f"fh{k}"].values, df[f"fl{k}"].values
        gap_stop = alive & (k > 1) & (o_ <= stop); touch_stop = alive & ~gap_stop & (l_ <= stop)
        gap_tgt = alive & ~gap_stop & ~touch_stop & (k > 1) & (o_ >= tgt); touch_tgt = alive & ~gap_stop & ~touch_stop & ~gap_tgt & (h_ >= tgt)
        exit_ = np.where(gap_stop, o_, np.where(touch_stop, stop, np.where(gap_tgt, o_, np.where(touch_tgt, tgt, exit_))))
        kind = np.where(gap_stop | touch_stop, 1, np.where(gap_tgt | touch_tgt, 2, kind))
        alive = alive & ~(gap_stop | touch_stop | gap_tgt | touch_tgt)
    return exit_ / entry - 1 - 2 * COST, kind

def best_cell(tr, mask=None):
    d = tr if mask is None else tr[mask]
    best = None
    for S in SGRID:
        for T in TGRID:
            r, _ = sim(d, S * d.atr_pct.values, T * d.atr_pct.values); m = r.mean()
            if best is None or m > best[0]: best = (m, S, T)
    return best[1], best[2]

def terciles(tr): return tr.spy_vol20.quantile([1 / 3, 2 / 3]).values, tr.atr_pct.quantile([1 / 3, 2 / 3]).values
def bucket(d, q):
    sv = np.searchsorted(q[0], d.spy_vol20.values); at = np.searchsorted(q[1], d.atr_pct.values)
    return d.spy_above200.values.astype(int) * 9 + sv * 3 + at

SETS = {
    "Dip: RSI2<10 in uptrend": lambda d: (d.d_sma200 > 0) & (d.rsi2 < 10),
    "Sharp dip: RSI2<5, -5% in 3d": lambda d: (d.d_sma200 > 0) & (d.rsi2 < 5) & (d.d_sma5 < 0) & (d.r3 < -0.05),
}
out = {nm: [] for nm in SETS}
dsort = dates
for start in range(FIRST_TRAIN + EMB, len(dsort), BLOCK):
    trd = set(dsort[:start - EMB]); ted = set(dsort[start:start + BLOCK])
    tr_all = lab[lab.date.isin(trd)]; te_all = lab[lab.date.isin(ted)]
    if te_all.empty: continue
    # quantile models trained on all stock-days in the training window (every 2nd row for speed)
    sub = tr_all.iloc[::2]
    qs = HistGradientBoostingRegressor(loss="quantile", quantile=0.9, max_depth=4, learning_rate=0.05, max_iter=150, min_samples_leaf=800, l2_regularization=5.0, random_state=1).fit(sub[RF], sub.mae)
    qt = HistGradientBoostingRegressor(loss="quantile", quantile=0.5, max_depth=4, learning_rate=0.05, max_iter=150, min_samples_leaf=800, l2_regularization=5.0, random_state=1).fit(sub[RF], sub.mfe)
    q = terciles(tr_all)
    for nm, f in SETS.items():
        tr = tr_all[f(tr_all)]; te = te_all[f(te_all)].copy()
        if len(tr) < 400 or te.empty: continue
        a = te.atr_pct.values
        te["r_fix"], te["k_fix"] = sim(te, 3 * a, 1 * a)
        gS, gT = best_cell(tr); te["r_glob"], te["k_glob"] = sim(te, gS * a, gT * a)
        tb, teb = bucket(tr, q), bucket(te, q)
        S_arr, T_arr = np.full(len(te), gS * 1.0), np.full(len(te), gT * 1.0)
        for b in np.unique(teb):
            m = tb == b
            if m.sum() >= 250: S_arr[teb == b], T_arr[teb == b] = best_cell(tr, m)
        te["r_bkt"], te["k_bkt"] = sim(te, S_arr * a, T_arr * a)
        ps = np.clip(qs.predict(te[RF]), 0.005, 0.5); pt = np.clip(qt.predict(te[RF]), 0.003, 0.5)
        te["r_ml"], te["k_ml"] = sim(te, ps, pt)
        # ML stop with the ATR-style target, to separate the two effects
        te["r_mlstop"], te["k_mlstop"] = sim(te, ps, 1 * a)
        out[nm].append(te)

def summ(d, col):
    r = d[f"r_{col}"].values; k = d[f"k_{col}"].values; L = r[r <= 0]; ls = np.sort(r)
    gp = r[r > 0].sum(); gl = -r[r <= 0].sum()
    return f"mean {r.mean() * 100:+.3f}%  win {np.mean(r > 0) * 100:.0f}%  stop {np.mean(k == 1) * 100:4.1f}%  target {np.mean(k == 2) * 100:4.1f}%  avg loss {L.mean() * 100:+.2f}%  worst5% {ls[:max(1, len(ls) // 20)].mean() * 100:+.2f}%  PF {gp / gl:.2f}"
NAMES = {"fix": "Fixed 3 ATR stop / 1 ATR target (today)", "glob": "Best fixed pair, re-fit each fold", "bkt": "By regime bucket (market x vol x stock)", "ml": "ML quantile stop and target", "mlstop": "ML quantile stop, 1 ATR target"}
rg = np.random.default_rng(5)
for nm in SETS:
    D = pd.concat(out[nm]); print(f"\n=== {nm}: {len(D):,} out-of-sample trades, {D.date.min()} to {D.date.max()} ===")
    for c in NAMES: print(f"  {NAMES[c]:42s} {summ(D, c)}")
    byd = D.groupby("date")
    for c in ("glob", "bkt", "ml", "mlstop"):
        diff = (D[f"r_{c}"] - D["r_fix"]); g = diff.groupby(D.date).agg(["sum", "count"])
        boots = []
        for _ in range(500):
            ix = rg.integers(0, len(g), len(g)); boots.append(g["sum"].values[ix].sum() / g["count"].values[ix].sum())
        lo, hi = np.percentile(boots, [2.5, 97.5])
        yrs = " ".join(f"{y}:{diff[D.date.str.startswith(y)].mean() * 100:+.2f}" for y in sorted(set(x[:4] for x in D.date)))
        print(f"    {NAMES[c][:30]:30s} minus fixed: {diff.mean() * 100:+.3f}% per trade, 95% CI [{lo * 100:+.3f}, {hi * 100:+.3f}]  by year {yrs}")

# regime dependence of the best fixed pair, using all data (descriptive only)
print("\n=== Does the best fixed (stop, target) pair differ by market regime? (dip entries, whole sample, mean % per trade) ===")
Dd = pd.concat(out["Dip: RSI2<10 in uptrend"])
Dd["vreg"] = pd.qcut(Dd.spy_vol20, 3, labels=["calm", "mid", "stormy"])
for reg, d in [("SPY below 200d", Dd[Dd.spy_above200 == 0]), ("SPY above 200d", Dd[Dd.spy_above200 == 1])] + [(f"market vol {v}", Dd[Dd.vreg == v]) for v in ["calm", "mid", "stormy"]]:
    cells = {(S, T): sim(d, S * d.atr_pct.values, T * d.atr_pct.values)[0].mean() * 100 for S in SGRID for T in TGRID}
    bS, bT = max(cells, key=cells.get)
    print(f"  {reg:16s} n {len(d):6d}  today's pair (3,1): {cells[(3, 1)]:+.2f}%   best pair (stop {bS} ATR, target {bT} ATR): {cells[(bS, bT)]:+.2f}%   no-stop-ish (4,2): {cells[(4, 2)]:+.2f}%")

# ---- Entry gating by market regime (pre-specified gates; thresholds come only from data before each date) ----
print("\n\n=== Should the market regime decide WHETHER to take dip trades? (today's 3 ATR / 1 ATR exits, out of sample) ===")
sv = spy_feat.spy_vol20
gate_tab = pd.DataFrame({
    "vol_q33": sv.expanding(250).quantile(0.33).shift(1),
    "spy_r5": spy_feat.spy_r5,
    "spy_dd": spy.c / spy.c.rolling(252).max() - 1,
})
bre = lab.groupby("date").apply(lambda g: ((g.d_sma200 > 0) & (g.rsi2 < 10)).mean(), include_groups=False)
gate_tab["breadth"] = bre; gate_tab["bre_q67"] = bre.expanding(250).quantile(0.67).shift(1)
GATES = {
    "No gate (all dips)": lambda g: pd.Series(True, index=g.index),
    "Market vol not in calmest third": lambda g: g.spy_vol20 >= g.vol_q33,
    "Market-wide washout (breadth top third)": lambda g: g.breadth >= g.bre_q67,
    "SPY down 1.5%+ in 5 days": lambda g: g.spy_r5 < -0.015,
    "SPY 5%+ below its 1-year high": lambda g: g.spy_dd < -0.05,
}
for nm in SETS:
    D = pd.concat(out[nm]).merge(gate_tab[["vol_q33", "breadth", "bre_q67", "spy_dd"]], left_on="date", right_index=True, how="left")
    D = D.dropna(subset=["vol_q33", "bre_q67"]); base_mean = D.r_fix.mean()
    print(f"\n {nm}: {len(D):,} trades with gate history")
    for gn, gf in GATES.items():
        m = gf(D); d = D[m]; o2 = D[~m]
        if len(d) < 50: print(f"  {gn:42s} too few trades ({len(d)})"); continue
        r = d.r_fix.values; win = np.mean(r > 0) * 100
        gg = (D.r_fix - base_mean).groupby(D.date).agg(["sum", "count"]); bm = m.groupby(D.date).sum()
        yrs = " ".join(f"{y}:{d[d.date.str.startswith(y)].r_fix.mean() * 100:+.2f}({len(d[d.date.str.startswith(y)])})" for y in sorted(set(x[:4] for x in D.date)) if len(d[d.date.str.startswith(y)]) >= 20)
        print(f"  {gn:42s} n {len(d):6d} mean {r.mean() * 100:+.3f}% win {win:.0f}% | skipped trades: n {len(o2):6d} mean {o2.r_fix.mean() * 100:+.3f}% | by year {yrs}")

print("\n=== How solid are the gated results? Distinct days and weeks, date-clustered 95% intervals, and without the busiest weeks ===")
rg2 = np.random.default_rng(11)
wk = lambda d: int((pd.Timestamp(d) - pd.Timestamp("2020-01-06")).days // 7)
for nm in SETS:
    D = pd.concat(out[nm]).merge(gate_tab[["vol_q33", "breadth", "bre_q67", "spy_dd"]], left_on="date", right_index=True, how="left").dropna(subset=["vol_q33", "bre_q67"])
    D["wk"] = D.date.map(wk)
    for gn in ("Market-wide washout (breadth top third)", "SPY down 1.5%+ in 5 days"):
        m = GATES[gn](D); d = D[m]
        g = d.r_fix.groupby(d.date).agg(["sum", "count"]); boots = []
        for _ in range(1000):
            ix = rg2.integers(0, len(g), len(g)); boots.append(g["sum"].values[ix].sum() / g["count"].values[ix].sum())
        lo, hi = np.percentile(boots, [2.5, 97.5])
        busiest = d.groupby("wk").size().sort_values(ascending=False).index[:3]; rest = d[~d.wk.isin(busiest)]
        wkmeans = d.groupby("wk").r_fix.mean()
        print(f" {nm[:28]:28s} | {gn[:40]:40s} trades {len(d):5d} on {d.date.nunique():3d} days / {d.wk.nunique():3d} weeks; mean {d.r_fix.mean() * 100:+.2f}% (95% CI {lo * 100:+.2f} to {hi * 100:+.2f}); without 3 busiest weeks {rest.r_fix.mean() * 100:+.2f}% (n {len(rest)}); weeks with positive mean {np.mean(wkmeans > 0) * 100:.0f}%")
