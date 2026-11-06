"""Dynamic-level test (research only): do rules that move the stop and target after entry (breakeven, trailing, market-aware) beat fixed levels?

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

def sim(df, policy, S0=4.0, T0=2.0):
    """5-day long trade with levels that a policy may move after each close. Levels only move in the safe direction for the stop (up).
    Stop is checked first when a bar touches both. Gaps through a level fill at the open."""
    n = len(df); entry = df.fo1.values; atr = df.atr_pct.values * entry
    stop = entry - S0 * atr; tgt = entry + T0 * atr
    exit_ = df.fc5.values.copy(); kind = np.zeros(n, dtype=np.int8); alive = np.ones(n, dtype=bool)
    hi_close = entry.copy(); hi_high = entry.copy(); moved = np.zeros(n, dtype=bool)
    for k in range(1, H + 1):
        o_, h_, l_, c_ = (df[f"f{x}{k}"].values for x in "ohlc")
        gs = alive & (k > 1) & (o_ <= stop); ts = alive & ~gs & (l_ <= stop)
        gt = alive & ~gs & ~ts & (k > 1) & (o_ >= tgt); tt = alive & ~gs & ~ts & ~gt & (h_ >= tgt)
        exit_ = np.where(gs, o_, np.where(ts, stop, np.where(gt, o_, np.where(tt, tgt, exit_))))
        kind = np.where(gs | ts, 1, np.where(gt | tt, 2, kind)); alive = alive & ~(gs | ts | gt | tt)
        hi_close = np.maximum(hi_close, c_); hi_high = np.maximum(hi_high, h_)
        if k < H:
            ns, nt = policy(k, c_, h_, entry, atr, stop.copy(), tgt.copy(), hi_close, hi_high, df[f"spy_d{k}"].values)
            moved |= alive & ((ns > stop) | (nt != tgt))
            stop = np.where(alive, np.maximum(stop, ns), stop); tgt = np.where(alive, nt, tgt)
    return exit_ / entry - 1 - 2 * COST, kind, moved

static = lambda k, c, h, e, a, s, t, hc, hh, sp: (s, t)
def breakeven(after):  # once the high has reached +after ATR, never lose money on the stop: move it to entry
    return lambda k, c, h, e, a, s, t, hc, hh, sp: (np.where(hh >= e + after * a, np.maximum(s, e), s), t)
def trail(mult, start=0.0):  # stop follows the highest close by mult ATR, but only once the trade is up start ATR
    return lambda k, c, h, e, a, s, t, hc, hh, sp: (np.where(hc >= e + start * a, np.maximum(s, hc - mult * a), s), t)
def market_tighten(drop, dist):  # when SPY falls drop in a day, pull the stop up to dist ATR under the close
    return lambda k, c, h, e, a, s, t, hc, hh, sp: (np.where(sp <= drop, np.maximum(s, c - dist * a), s), t)
def let_run(after, new_t):  # once +after ATR is reached, move the stop to breakeven and push the target out
    return lambda k, c, h, e, a, s, t, hc, hh, sp: (np.where(hh >= e + after * a, np.maximum(s, e), s), np.where(hh >= e + after * a, e + new_t * a, t))
def time_tighten(day, dist):  # after a given day, stop no more than dist ATR below the close
    return lambda k, c, h, e, a, s, t, hc, hh, sp: (np.where(k >= day, np.maximum(s, c - dist * a), s), t)
def combo(*ps):
    def f(k, c, h, e, a, s, t, hc, hh, sp):
        for p in ps: s, t = p(k, c, h, e, a, s, t, hc, hh, sp)
        return s, t
    return f

POLICIES = {
    "Static 4 ATR stop / 2 ATR target (dip levels)": (static, 4, 2),
    "Static 3 / 1 (levels in the app today)": (static, 3, 1),
    "Static 4 / 2, no target (time exit only)": (static, 4, 99),
    "Breakeven stop after +1 ATR": (breakeven(1.0), 4, 2),
    "Breakeven stop after +1.5 ATR": (breakeven(1.5), 4, 99),
    "Trail 3 ATR behind high close": (trail(3), 4, 2),
    "Trail 2 ATR behind high close": (trail(2), 4, 2),
    "Trail 2 ATR once up 1 ATR, no target": (trail(2, 1.0), 4, 99),
    "Let winners run: at +1 ATR, stop to entry, target to 3 ATR": (let_run(1.0, 3.0), 4, 2),
    "Tighten stop to 1.5 ATR if SPY falls 1.5% in a day": (market_tighten(-0.015, 1.5), 4, 2),
    "Tighten stop to 1 ATR if SPY falls 2% in a day": (market_tighten(-0.02, 1.0), 4, 2),
    "Time tighten: from day 3, stop 2 ATR under the close": (time_tighten(3, 2.0), 4, 2),
    "Combo: breakeven after +1 ATR + market tighten + let run": (combo(breakeven(1.0), market_tighten(-0.015, 1.5), let_run(1.0, 3.0)), 4, 2),
}

if len(sys.argv) > 1 and sys.argv[1] == "conservative":
    POLICIES = {f"Stop {st} ATR / target {tg} ATR": (static, st, tg) for st in (1.5, 2, 2.5, 3, 4) for tg in (1, 1.5, 2)}
if len(sys.argv) > 1 and sys.argv[1] == "targets":
    POLICIES = {f"Static stop {st} ATR / target {tg} ATR": (static, st, tg) for st in (3, 4) for tg in (0.75, 1, 1.5, 2, 3)}
sv = spy_feat.spy_vol20
SETS = {
    "Dip entries, market under stress (SPY -1.5% in 5d)": lambda d: (d.d_sma200 > 0) & (d.rsi2 < 10) & (d.spy_r5 <= -0.015),
    "Dip entries, any market": lambda d: (d.d_sma200 > 0) & (d.rsi2 < 10),
    "Any stock-day (every 3rd date; like a holding bought at random)": lambda d: pd.Series(d.date.map(hash) % 3 == 0, index=d.index),
}
rg = np.random.default_rng(2)
for nm, f in SETS.items():
    D = lab[f(lab)].copy().dropna(subset=[f"spy_d{k}" for k in range(1, H)])
    print(f"\n=== {nm}: {len(D):,} trades, {D.date.min()} to {D.date.max()} ===")
    print(f"  {'policy':60s} {'mean%':>7s} {'vs base':>8s} {'CI95':>16s} {'win%':>5s} {'avgL%':>6s} {'w5%':>6s} {'stop%':>5s} {'tgt%':>5s} {'moved%':>6s}  1st/2nd half vs base")
    base = None
    for pn, (pol, S0, T0) in POLICIES.items():
        r, kind, moved = sim(D, pol, S0, T0)
        if base is None: base = r
        diff = r - base; g = pd.Series(diff).groupby(D.date.values).agg(["sum", "count"]); boots = []
        for _ in range(300):
            ix = rg.integers(0, len(g), len(g)); boots.append(g["sum"].values[ix].sum() / g["count"].values[ix].sum())
        lo, hi = np.percentile(boots, [2.5, 97.5]); L = r[r <= 0]; ls = np.sort(r)
        h1 = diff[(D.date < SPLIT).values].mean() * 100; h2 = diff[(D.date >= SPLIT).values].mean() * 100
        print(f"  {pn[:60]:60s} {r.mean() * 100:+7.3f} {diff.mean() * 100:+8.3f} [{lo * 100:+.3f},{hi * 100:+.3f}] {np.mean(r > 0) * 100:5.0f} {L.mean() * 100:+6.2f} {ls[:max(1, len(ls) // 20)].mean() * 100:+6.2f} {np.mean(kind == 1) * 100:5.1f} {np.mean(kind == 2) * 100:5.1f} {np.mean(moved) * 100:6.0f}  {h1:+.3f} / {h2:+.3f}")
