"""IBD / CAN SLIM test (research only): do the price-based parts of the IBD buy checklist, with IBD's own sell rules, beat any stock?

Testable from price data: L (leader: relative-strength rating 80+), N (near a new high), S (volume on the breakout), a proper base and
pivot breakout bought within 5% of the pivot, and M (market direction). Not testable here: C and A (earnings growth) and I (institutional
sponsorship), which need fundamentals data. Sell rules (IBD): stop 7.5% below the buy, take profit near +20%, sell on a close below the
50-day average, and a time limit of 60 trading days. Point-in-time S&P 500 membership, entry at the next open, 0.1% cost per side.
"""
import json
import numpy as np, pandas as pd

COST = 0.001
MAXHOLD = 60
current = json.load(open("bars.json")); former = json.load(open("bars_former.json"))
raw = {**former, **current}
intervals = {}
for line in open("members.csv").read().strip().split("\n")[1:]:
    t, a, b = (line.split(",") + [""])[:3]
    intervals.setdefault(t, []).append((a, b or "9999-12-31"))

def frame(rows): return pd.DataFrame(rows, columns=["date", "o", "h", "l", "c", "v"])
spy = frame(raw["SPY"]).set_index("date")
spy_ok = ((spy.c > spy.c.rolling(50).mean()) & (spy.c > spy.c.rolling(200).mean()) & (spy.c.rolling(50).mean() > spy.c.rolling(50).mean().shift(10)))

per = {}
for sym, rows in raw.items():
    if sym == "SPY" or len(rows) < 300: continue
    d = frame(rows)
    if (d[["o", "h", "l", "c"]] <= 0).any().any(): continue
    c, v, h, l = d.c, d.v, d.h, d.l
    q = lambda a, b: c.shift(a) / c.shift(b) - 1
    d["rs_raw"] = 0.4 * q(0, 63) + 0.2 * q(63, 126) + 0.2 * q(126, 189) + 0.2 * q(189, 252)
    d["sma50"] = c.rolling(50).mean(); d["sma150"] = c.rolling(150).mean(); d["sma200"] = c.rolling(200).mean()
    d["hi252"] = h.rolling(252).max(); d["pvt"] = h.rolling(20).max().shift(1)
    d["base_depth"] = (h.rolling(25).max() - l.rolling(25).min()) / h.rolling(25).max()
    d["volx"] = v / v.rolling(50).mean().shift(1)
    d["bad"] = (c.pct_change().abs() > 0.35).rolling(260, min_periods=1).max() > 0
    d["member"] = [any(a <= x <= b for a, b in intervals.get(sym, [])) for x in d.date]
    d["sym"] = sym
    per[sym] = d
allrows = pd.concat(per.values(), ignore_index=True)
allrows["rs"] = allrows.groupby("date").rs_raw.rank(pct=True) * 99          # IBD-style relative strength rating, 1 to 99 among the universe
rs_by = {k: g.set_index("date").rs for k, g in allrows[allrows.member].groupby("sym")}
for sym, d in per.items():
    d["rs"] = d.date.map(rs_by.get(sym, pd.Series(dtype=float)))
    d["mkt"] = d.date.map(spy_ok).fillna(False)
    stage2 = (d.c > d.sma50) & (d.sma50 > d.sma150) & (d.sma150 > d.sma200) & (d.c >= 0.85 * d.hi252)
    breakout = (d.c > d.pvt) & (d.c <= 1.05 * d.pvt) & (d.volx >= 1.4) & (d.base_depth <= 0.20)
    ok = d.member & ~d.bad & d.rs.notna() & d.sma200.notna()
    d["S_any"] = ok & (np.arange(len(d)) % 5 == 0)
    d["S_rs80"] = ok & (d.rs >= 80)
    d["S_stage2"] = ok & (d.rs >= 80) & stage2
    d["S_breakout"] = ok & (d.rs >= 80) & stage2 & breakout
    d["S_breakout_mkt"] = ok & (d.rs >= 80) & stage2 & breakout & d.mkt
    d["S_stage2_mkt"] = ok & (d.rs >= 80) & stage2 & d.mkt
    d["S_any_mkt"] = ok & d.mkt & (np.arange(len(d)) % 5 == 0)

SETS = {
    "Any stock-day (every 5th day)": "S_any", "Any stock-day, market in uptrend (M)": "S_any_mkt",
    "Leader: RS rating 80+ (L)": "S_rs80", "Leader in a stage-2 uptrend near its high (L, N)": "S_stage2",
    "Stage 2 leader, market in uptrend (L, N, M)": "S_stage2_mkt",
    "Breakout from a base on volume (L, N, S)": "S_breakout", "Breakout, market in uptrend (L, N, S, M)": "S_breakout_mkt",
}
EXITS = {
    "IBD: stop 7.5%, take 20%, sell under 50-day, max 60d": dict(stop=0.075, target=0.20, sma=True, hold=60),
    "IBD without a profit target: stop 7.5%, sell under 50-day, max 60d": dict(stop=0.075, target=None, sma=True, hold=60),
    "Swing: stop 7.5%, take 10%, max 20d": dict(stop=0.075, target=0.10, sma=False, hold=20),
}

def run(d, sig, ex):
    idx = np.flatnonzero(d[sig].values); out = []
    o, h, l, c, s50, dates = d.o.values, d.h.values, d.l.values, d.c.values, d.sma50.values, d.date.values
    free = -1
    for t in idx:
        if t <= free or t + 1 >= len(d): continue
        e = t + 1; entry = o[e]
        if not entry > 0: continue
        stop = entry * (1 - ex["stop"]); tgt = entry * (1 + ex["target"]) if ex["target"] else np.inf
        last = min(len(d) - 1, e + ex["hold"] - 1); exit_, kind, k_end = c[last], "time", last
        if e + ex["hold"] - 1 >= len(d): continue    # trade would run past the data
        for k in range(e, last + 1):
            if k > e and o[k] <= stop: exit_, kind, k_end = o[k], "stop", k; break
            if l[k] <= stop: exit_, kind, k_end = stop, "stop", k; break
            if k > e and o[k] >= tgt: exit_, kind, k_end = o[k], "target", k; break
            if h[k] >= tgt: exit_, kind, k_end = tgt, "target", k; break
            if ex["sma"] and k > e and c[k] < s50[k]: exit_, kind, k_end = c[k], "sma50", k; break
        out.append((dates[e], (exit_ / entry - 1 - 2 * COST) * 100, kind, k_end - e + 1))
        free = k_end
    return out

rg = np.random.default_rng(6)
for en, ex in EXITS.items():
    print(f"\n=== Exit rules: {en} ===")
    print(f"  {'entry rule':58s} {'n':>5s} {'mean%':>7s} {'vs any':>7s} {'CI95':>15s} {'win%':>5s} {'avgW':>6s} {'avgL':>6s} {'days':>5s} {'stop%':>5s} {'tgt%':>5s} {'sma%':>5s}  by year (mean%)")
    base = None
    for nm, sig in SETS.items():
        tr = [x for d in per.values() for x in run(d, sig, ex)]
        T = pd.DataFrame(tr, columns=["date", "ret", "kind", "days"])
        if T.empty: print(f"  {nm:58s}    0"); continue
        if base is None: base = T
        W, L = T[T.ret > 0].ret, T[T.ret <= 0].ret
        gm = base.ret.mean()
        byd = T.groupby("date").ret.agg(["sum", "count"]); boots = []
        for _ in range(300):
            ix = rg.integers(0, len(byd), len(byd)); boots.append(byd["sum"].values[ix].sum() / byd["count"].values[ix].sum() - gm)
        lo, hi = np.percentile(boots, [2.5, 97.5])
        yrs = " ".join(f"{y[2:]}:{T[T.date.str.startswith(y)].ret.mean():+.1f}({(T.date.str.startswith(y)).sum()})" for y in sorted(set(x[:4] for x in T.date)))
        print(f"  {nm:58s} {len(T):5d} {T.ret.mean():+7.2f} {T.ret.mean() - gm:+7.2f} [{lo:+5.2f},{hi:+5.2f}] {np.mean(T.ret > 0) * 100:5.0f} {W.mean():+6.1f} {L.mean():+6.1f} {T.days.mean():5.1f} {np.mean(T.kind == 'stop') * 100:5.1f} {np.mean(T.kind == 'target') * 100:5.1f} {np.mean(T.kind == 'sma50') * 100:5.1f}  {yrs}")
