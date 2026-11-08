"""Support-based stop test (research only): find an area of support below the entry, put the stop just under it, exit on a breakdown.

Support candidates, all known at the signal close: the nearest confirmed swing low (a low lower than the 3 bars on each side, confirmed 3 bars
later, within 120 days) that sits at least 1 ATR below the close; a touch cluster (two or more swing lows within half an ATR of each other);
the 50- and 200-day averages when they are 1 ATR or more below. Stop = support minus 0.25 ATR, never closer than 1 ATR to the entry.
Three ways to act on it: the stop triggers on any touch (intraday), a breakdown is a CLOSE under the level and the exit is the next open,
and a filter that skips the trade when the support is more than 3 ATR below (too much risk). Entries: dips, dips under market stress, any
stock-day. Next-open entry, 0.1% cost per side, 10-day limit, 1 ATR profit target.
"""
import json
import numpy as np, pandas as pd
from numpy.lib.stride_tricks import sliding_window_view as swv

COST = 0.001
HOLD = 10
current = json.load(open("bars.json")); former = json.load(open("bars_former.json"))
raw = {**former, **current}
intervals = {}
for line in open("members.csv").read().strip().split("\n")[1:]:
    t, a, b = (line.split(",") + [""])[:3]
    intervals.setdefault(t, []).append((a, b or "9999-12-31"))
spy = pd.DataFrame(raw["SPY"], columns=["date", "o", "h", "l", "c", "v"]).set_index("date")
spy_r5 = spy.c / spy.c.shift(5) - 1

SETS = ("stress", "dip", "any")
store = {k: {n: [] for n in ("O", "H", "L", "C", "entry", "atr", "swing", "cluster", "sma50", "sma200", "date")} for k in SETS}

for sym, rows in raw.items():
    if sym == "SPY" or len(rows) < 300: continue
    d = pd.DataFrame(rows, columns=["date", "o", "h", "l", "c", "v"])
    if (d[["o", "h", "l", "c"]] <= 0).any().any(): continue
    c, o, h, l = d.c, d.o, d.h, d.l
    tr = pd.concat([h - l, (h - c.shift(1)).abs(), (l - c.shift(1)).abs()], axis=1).max(axis=1)
    atr = tr.rolling(14).mean().values
    sma50, sma200 = c.rolling(50).mean().values, c.rolling(200).mean().values
    ch = c.diff(); up, dn = ch.clip(lower=0), (-ch).clip(lower=0)
    rsi2 = 100 - 100 / (1 + up.ewm(alpha=0.5, adjust=False).mean() / (dn.ewm(alpha=0.5, adjust=False).mean() + 1e-12))
    bad = (c.pct_change().abs() > 0.35)
    bad_any = bad.rolling(260, min_periods=1).max().astype(bool) | bad[::-1].rolling(HOLD + 2, min_periods=1).max()[::-1].astype(bool)
    member = np.array([any(a_ <= x <= b_ for a_, b_ in intervals.get(sym, [])) for x in d.date])
    ok = member & ~bad_any.values & ~np.isnan(atr) & ~np.isnan(sma200)
    dip = ok & (c.values > sma200) & (rsi2.values < 10)
    stress = dip & (d.date.map(spy_r5).fillna(0).values <= -0.015)
    anyd = ok & (np.arange(len(d)) % 5 == 0)
    n = len(d); la, ca, oa, ha = l.values, c.values, o.values, h.values
    lows_min = swv(la, 7).min(axis=1)                       # min over i-3..i+3 at position i+3 of the window start
    piv = np.zeros(n, dtype=bool); piv[3:n - 3] = la[3:n - 3] <= lows_min   # swing low: lowest of the 3 bars each side
    piv_idx = np.flatnonzero(piv)
    W = {name: swv(arr, HOLD) for name, arr in (("O", oa), ("H", ha), ("L", la), ("C", ca))}
    for key, flag in (("stress", stress), ("dip", dip), ("any", anyd)):
        t_idx = np.flatnonzero(flag); t_idx = t_idx[t_idx + 1 + HOLD <= n]
        if not len(t_idx): continue
        swing = np.full(len(t_idx), np.nan); cluster = np.full(len(t_idx), np.nan)
        for j, t in enumerate(t_idx):
            lo_i, hi_i = np.searchsorted(piv_idx, max(0, t - 120)), np.searchsorted(piv_idx, t - 3, side="right")
            lv = la[piv_idx[lo_i:hi_i]]
            lv = lv[lv <= ca[t] - 1.0 * atr[t]]
            if not len(lv): continue
            swing[j] = lv.max()
            top = np.sort(lv)[::-1][:25]
            for L in top:                                   # highest level with a second touch within half an ATR
                if np.sum(np.abs(lv - L) <= 0.5 * atr[t]) >= 2: cluster[j] = L; break
        e = t_idx + 1
        for name in "OHLC": store[key][name].append(W[name][e])
        store[key]["entry"].append(oa[e]); store[key]["atr"].append(atr[t_idx]); store[key]["swing"].append(swing); store[key]["cluster"].append(cluster)
        s50 = np.where(sma50[t_idx] <= ca[t_idx] - atr[t_idx], sma50[t_idx], np.nan); s200 = np.where(sma200[t_idx] <= ca[t_idx] - atr[t_idx], sma200[t_idx], np.nan)
        store[key]["sma50"].append(s50); store[key]["sma200"].append(s200); store[key]["date"].append(d.date.values[e])
data = {k: {n: np.concatenate(v) for n, v in s.items()} for k, s in store.items()}

def sim(D, stop_price, tgt_atr, close_basis, keep):
    """Long trade with an absolute stop price. close_basis: the stop is a CLOSE under the level, exit at the next open (the close on the last day)."""
    entry, atr = D["entry"][keep], D["atr"][keep]; stop = stop_price[keep]; tgt = entry + tgt_atr * atr
    O, H, L, C = (D[x][keep] for x in "OHLC")
    n = len(entry); exit_ = C[:, HOLD - 1].copy(); kind = np.zeros(n, dtype=np.int8); alive = np.ones(n, dtype=bool)
    for k in range(HOLD):
        o_, h_, l_, c_ = O[:, k], H[:, k], L[:, k], C[:, k]
        if close_basis:
            # a target hit during the day counts first; a close under the level means exit at the next open
            gt = alive & (k > 0) & (o_ >= tgt); tt = alive & ~gt & (h_ >= tgt)
            exit_ = np.where(gt, o_, np.where(tt, tgt, exit_)); kind = np.where(gt | tt, 2, kind); alive = alive & ~(gt | tt)
            brk = alive & (c_ < stop)
            nxt = O[:, k + 1] if k + 1 < HOLD else c_
            exit_ = np.where(brk, nxt, exit_); kind = np.where(brk, 1, kind); alive = alive & ~brk
        else:
            gs = alive & (k > 0) & (o_ <= stop); ts = alive & ~gs & (l_ <= stop)
            gt = alive & ~gs & ~ts & (k > 0) & (o_ >= tgt); tt = alive & ~gs & ~ts & ~gt & (h_ >= tgt)
            exit_ = np.where(gs, o_, np.where(ts, stop, np.where(gt, o_, np.where(tt, tgt, exit_))))
            kind = np.where(gs | ts, 1, np.where(gt | tt, 2, kind)); alive = alive & ~(gs | ts | gt | tt)
    return exit_ / entry - 1 - 2 * COST, kind

def support_level(D, rule):
    fallback = D["entry"] - 2 * D["atr"]
    sw, cl, s50, s200 = D["swing"], D["cluster"], D["sma50"], D["sma200"]
    if rule == "swing low": lvl = sw
    elif rule == "touch cluster (2+ touches)": lvl = np.where(np.isnan(cl), sw, cl)
    elif rule == "50-day average": lvl = np.where(np.isnan(s50), sw, s50)
    elif rule == "nearest of cluster / 50d / 200d": lvl = np.fmax.reduce([np.where(np.isnan(cl), -np.inf, cl), np.where(np.isnan(s50), -np.inf, s50), np.where(np.isnan(s200), -np.inf, s200)]); lvl = np.where(np.isinf(lvl), sw, lvl)
    found = ~np.isnan(lvl)
    return np.where(found, lvl, fallback), found

RULES = ["swing low", "touch cluster (2+ touches)", "50-day average", "nearest of cluster / 50d / 200d"]
NAMES = {"stress": "Dips, market under stress (SPY -1.5% in 5d)", "dip": "All dips", "any": "Any stock-day (every 5th day)"}
def report(label, r, kind, atr_dist, px_dist, base=None, extra=""):
    L = r[r <= 0]; ls = np.sort(r)
    d = "" if base is None else f"{(r.mean() - base) * 100:+7.3f}"
    print(f"  {label:60s} {len(r):6d} {r.mean() * 100:+7.3f} {d:>7s} {np.mean(r > 0) * 100:5.0f} {np.mean(kind == 1) * 100:6.1f} {np.mean(kind == 2) * 100:5.1f} {L.mean() * 100:+7.2f} {ls[:max(1, len(ls) // 20)].mean() * 100:+7.2f} {np.median(atr_dist):7.2f} {np.median(px_dist):7.1f} {extra}")

for key in SETS:
    D = data[key]; n = len(D["entry"]); allk = np.ones(n, dtype=bool)
    print(f"\n=== {NAMES[key]}: {n:,} trades; stop = support - 0.25 ATR (never closer than 1 ATR); target 1 ATR; 10-day limit ===")
    print(f"  {'stop rule':60s} {'n':>6s} {'mean%':>7s} {'vs ATR2':>7s} {'win%':>5s} {'stop%':>6s} {'tgt%':>5s} {'avgL%':>7s} {'w5%':>7s} {'stopATR':>7s} {'stop%px':>7s}")
    base_r = None
    for nm, mult in (("ATR 2 stop (today)", 2.0), ("ATR 3 stop", 3.0)):
        sp = D["entry"] - mult * D["atr"]; r, kind = sim(D, sp, 1.0, False, allk)
        if base_r is None: base_r = r.mean()
        report(nm, r, kind, np.full(n, mult), (D["entry"] - sp) / D["entry"] * 100, base_r if nm != "ATR 2 stop (today)" else None)
    for rule in RULES:
        lvl, found = support_level(D, rule)
        sp = lvl - 0.25 * D["atr"]; dist = D["entry"] - sp
        sp = np.where(dist < 1.0 * D["atr"], D["entry"] - 1.0 * D["atr"], sp)          # never closer than 1 ATR
        dist_atr = (D["entry"] - sp) / D["atr"]
        for label, close_basis, keep in (("touch", False, allk), ("close breakdown", True, allk), ("skip if > 3 ATR away", False, dist_atr <= 3.0), ("close breakdown, skip if > 3 ATR", True, dist_atr <= 3.0)):
            r, kind = sim(D, sp, 1.0, close_basis, keep)
            report(f"{rule} / {label}", r, kind, dist_atr[keep], ((D["entry"] - sp) / D["entry"] * 100)[keep], base_r, f"support found {found[keep].mean() * 100:.0f}%")

# ---- controls: is it the support level, or just the close-basis exit and the stop distance? ----
print("\n\n######## CONTROLS ########")
print("A) ATR stops acted on with the same close-breakdown exit (exit at the next open after a close under the stop)")
print("B) PLACEBO: the stop distances the support rule chose, shuffled across trades, so each trade gets a distance that is not tied to its own chart")
for key in SETS:
    D = data[key]; n = len(D["entry"]); allk = np.ones(n, dtype=bool)
    print(f"\n=== {NAMES[key]}: {n:,} trades ===")
    print(f"  {'stop rule':64s} {'n':>6s} {'mean%':>7s} {'vs ATR2':>7s} {'win%':>5s} {'stop%':>6s} {'tgt%':>5s} {'avgL%':>7s} {'w5%':>7s} {'stopATR':>7s} {'stop%px':>7s}")
    base_r = sim(D, D["entry"] - 2 * D["atr"], 1.0, False, allk)[0].mean()
    for mult in (2.0, 2.5, 3.0):
        sp = D["entry"] - mult * D["atr"]
        for label, cb in (("touch", False), ("close breakdown", True)):
            r, kind = sim(D, sp, 1.0, cb, allk); report(f"A) ATR {mult} stop / {label}", r, kind, np.full(n, mult), (D["entry"] - sp) / D["entry"] * 100, base_r)
    for rule in ("swing low", "touch cluster (2+ touches)"):
        lvl, found = support_level(D, rule)
        sp = lvl - 0.25 * D["atr"]; sp = np.where(D["entry"] - sp < 1.0 * D["atr"], D["entry"] - 1.0 * D["atr"], sp)
        dist_atr = np.nan_to_num((D["entry"] - sp) / D["atr"], nan=2.0)
        shuffled = np.random.default_rng(1).permutation(dist_atr)       # same distances, handed to the wrong trades
        plc = D["entry"] - shuffled * D["atr"]
        for label, cb, skip in (("touch", False, False), ("close breakdown", True, False), ("close breakdown, skip if > 3 ATR", True, True)):
            keep = (dist_atr <= 3.0) if skip else allk; keep_p = (shuffled <= 3.0) if skip else allk
            r, kind = sim(D, sp, 1.0, cb, keep); report(f"real support: {rule} / {label}", r, kind, dist_atr[keep], ((D["entry"] - sp) / D["entry"] * 100)[keep], base_r)
            r, kind = sim(D, plc, 1.0, cb, keep_p); report(f"B) placebo (distances shuffled across trades): {rule} / {label}", r, kind, shuffled[keep_p], ((D["entry"] - plc) / D["entry"] * 100)[keep_p], base_r)
