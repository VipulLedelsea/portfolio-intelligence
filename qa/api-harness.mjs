// QA API harness: runs the built Worker in-process against an in-memory SQLite "D1" shim.
// No network, no dev server, no production data. Run: node qa/api-harness.mjs
import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = await readFile(resolve(root, "dist/server/index.js"), "utf8");
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)).default;

// ---- D1 shim ----
const sqlite = new DatabaseSync(":memory:");
for (const file of (await readdir(resolve(root, "drizzle"))).filter(f => f.endsWith(".sql")).sort())
  for (const stmt of (await readFile(resolve(root, "drizzle", file), "utf8")).split("--> statement-breakpoint")) if (stmt.trim()) sqlite.exec(stmt);
const wrap = (sql, params = []) => ({
  bind(...p) { return wrap(sql, p.map(v => v === undefined ? null : v)); },
  async first() { return sqlite.prepare(sql).get(...params) ?? null; },
  async all() { return { results: sqlite.prepare(sql).all(...params) }; },
  async run() { const r = sqlite.prepare(sql).run(...params); return { meta: { changes: Number(r.changes) } }; },
  _run() { return sqlite.prepare(sql).run(...params); },
});
const DB = {
  prepare: sql => wrap(sql),
  async batch(stmts) { sqlite.exec("BEGIN"); try { const out = []; for (const s of stmts) out.push(await s.run()); sqlite.exec("COMMIT"); return out; } catch (e) { sqlite.exec("ROLLBACK"); throw e; } },
};
const env = { DB, AUTH_MODE: "dev" };
const ctx = { waitUntil() {} };
const ORIGIN = "https://qa.test";

// ---- tiny test framework ----
const results = [];
const check = (id, name, ok, detail = "") => { results.push({ id, name, ok: Boolean(ok), detail }); if (!ok) console.log(`  ✗ ${id} ${name} ${detail}`); };
const call = async (path, { method = "POST", body, cookie, bearer, headers = {}, e = env } = {}) => {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  if (bearer) h.authorization = `Bearer ${bearer}`;
  const init = { method, headers: h };
  if (body !== undefined) { const text = typeof body === "string" ? body : JSON.stringify(body); init.body = text; h["content-type"] = "application/json"; h["content-length"] = String(text.length); }
  const res = await worker.fetch(new Request(ORIGIN + path, init), e, ctx);
  const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
};

// ---- seed shared holdings market data so no provider call is needed ----
const snap = (symbol, price, o = {}) => ({
  symbol, market: "US", price, previous_close: price, atr_14: o.atr ?? price * 0.02, market_time: new Date().toISOString(),
  supertrend: { direction: o.t4 ?? "LONG", value: o.st ?? price * 0.95 },
  daily_supertrend: { direction: o.td ?? "LONG" },
  daily_adx: { value: o.adx ?? 30, rising: true }, data_complete: true,
});
function seedMarket(marketKey, snaps) {
  const payload = JSON.stringify({ snapshots: Object.fromEntries(snaps.map(s => [s.symbol, s])), errors: [] });
  sqlite.prepare("INSERT OR REPLACE INTO scan_cache (market, payload, generated_at, refreshing_until) VALUES (?, ?, ?, NULL)").run(marketKey, payload, new Date().toISOString());
}
const SNAPS = [
  snap("AAPL", 100), snap("MSFT", 100), snap("NVDA", 150),             // HOLD (buy 100 -> price 100)
  snap("EXITP", 90, { atr: 2 }),                                       // price below stop
  snap("EXITT", 105, { t4: "SHORT" }),                                 // 4H turned down
  snap("TAKEP", 130, { atr: 2 }),                                      // >= target
  snap("WEAKADX", 105, { adx: 12 }), snap("WEAKDAILY", 105, { td: "SHORT" }),
  ...Array.from({ length: 22 }, (_, i) => snap(`FILL${i}`, 50)),
];
seedMarket("HOLD:US", SNAPS);

// =========================================================== PUBLIC / SYSTEM
{
  const r = await call("/health", { method: "GET" });
  check("SYS-01", "GET /health returns ok, read-only, no order submission", r.status === 200 && r.data.status === "ok" && r.data.read_only === true && r.data.order_submission_supported === false);
  const home = await worker.fetch(new Request(ORIGIN + "/"), env, ctx);
  const html = await home.text();
  check("SYS-02", "GET / serves dashboard HTML", home.status === 200 && /text\/html/.test(home.headers.get("content-type")) && html.includes("Interactive trade desk"));
  const csp = home.headers.get("content-security-policy") || "";
  check("SYS-03", "Security headers present (CSP, XFO DENY, nosniff, referrer)", /frame-ancestors 'none'/.test(csp) && home.headers.get("x-frame-options") === "DENY" && home.headers.get("x-content-type-options") === "nosniff" && home.headers.get("referrer-policy"));
  check("SYS-04", "CSP has no wildcard script-src", !/script-src[^;]*\*/.test(csp));
  for (const slug of ["privacy", "terms", "support"]) {
    const p = await call(`/${slug}`, { method: "GET" });
    check(`SYS-05-${slug}`, `GET /${slug} public page 200`, p.status === 200 && /IntelligentPortfolio/.test(p.data));
  }
  check("SYS-06", "Unknown GET route -> 404 JSON", (await call("/nope", { method: "GET" })).status === 404);
  check("SYS-07", "Unknown POST route -> 404", (await call("/api/nope", { body: {} })).status === 404);
  check("SYS-08", "PUT/DELETE on API not served (404)", (await call("/api/holdings", { method: "PUT", body: {} })).status === 404);
  check("SYS-09", "/api/grade disabled (405)", (await call("/api/grade", { body: {} })).status === 405);
  const tr = await call("/api/track-record", { method: "GET" });
  check("SYS-10", "GET /api/track-record 200 with summary shape", tr.status === 200 && typeof tr.data === "object" && !tr.data.error, JSON.stringify(tr.data).slice(0, 120));
  const acc = await call("/api/access", { method: "GET" });
  check("SYS-11", "/api/access with paywall off: subscribed true, signed_in false", acc.status === 200 && acc.data.paywall_enabled === false && acc.data.subscribed === true && acc.data.signed_in === false);
  check("SYS-12", "/api/access never leaks customer_id", !("customer_id" in acc.data));
  const bad = await call("/api/access?session_id=bad", { method: "GET" });
  check("SYS-13", "/api/access?session_id= without sign-in -> 401, not 5xx", bad.status === 401, String(bad.status));
}

// =========================================================== PAYWALL
{
  const gated = { PAYWALL_ENABLED: "true", DB };
  for (const p of ["/api/discover", "/api/analyze", "/api/memory", "/api/holdings", "/api/holdings/add"]) {
    const r = await call(p, { body: {}, e: gated });
    check(`PAY-01 ${p}`, `paywall on + anonymous -> 402`, r.status === 402, String(r.status));
  }
  const nokey = await call("/api/access", { method: "GET", e: gated });
  check("PAY-02", "paywall on without Stripe key -> configured false, subscribed false", nokey.data.paywall_enabled === true && nokey.data.configured === false && nokey.data.subscribed === false);
  const co = await call("/api/billing/checkout", { body: {}, e: { DB } });
  check("PAY-03", "checkout when paywall disabled -> error (not 200)", co.status !== 200, String(co.status));
  const co2 = await call("/api/billing/checkout", { body: {}, e: { ...gated, STRIPE_SECRET_KEY: "sk_test_x" } });
  check("PAY-04", "checkout anonymous -> 401", co2.status === 401, String(co2.status));
}

// =========================================================== AUTH
let cookie;
{
  check("AUTH-01", "/auth/dev disabled outside dev mode (404)", (await call("/auth/dev", { method: "GET", e: { DB } })).status === 404);
  const dev = await call("/auth/dev", { method: "GET" });
  const set = dev.headers.get("set-cookie") || "";
  check("AUTH-02", "/auth/dev (dev mode) redirects 302 with HttpOnly SameSite cookie", dev.status === 302 && /ip_session=/.test(set) && /HttpOnly/.test(set) && /SameSite=Lax/.test(set));
  cookie = set.split(";")[0];
  const acc = await call("/api/access", { method: "GET", cookie });
  check("AUTH-03", "session cookie recognised -> signed_in true", acc.data.signed_in === true && acc.data.auth_type === "web");
  check("AUTH-04", "forged cookie rejected", (await call("/api/access", { method: "GET", cookie: "ip_session=" + "A".repeat(50) })).data.signed_in === false);
  check("AUTH-05", "malformed cookie rejected", (await call("/api/access", { method: "GET", cookie: "ip_session=short" })).data.signed_in === false);
  const xs = await call("/api/holdings", { cookie, headers: { origin: "https://evil.example" }, body: {} });
  check("AUTH-06", "cross-origin POST with session cookie -> 403 (CSRF)", xs.status === 403, String(xs.status));
  const same = await call("/api/holdings", { cookie, headers: { origin: ORIGIN }, body: {} });
  check("AUTH-07", "same-origin POST with cookie allowed", same.status === 200, String(same.status));
  const oai = await call("/api/access", { method: "GET", headers: { "oai-authenticated-user-id": "x", "oai-authenticated-user-email": "x@x" } });
  check("AUTH-08", "forged oai-* identity headers ignored when AUTH_MODE != oai", oai.data.signed_in === false);
  const gstart = await call("/auth/google/start", { method: "GET" });
  check("AUTH-09", "Google sign-in not configured -> clean JSON error, not crash", gstart.status >= 400 && gstart.status < 600 && typeof gstart.data === "object", String(gstart.status));
  const gcb = await call("/auth/google/callback?code=x&state=y", { method: "GET" });
  check("AUTH-10", "Google callback with bad state -> redirect /?signin=failed", gcb.status === 302 && /signin=failed/.test(gcb.headers.get("location")));
  const out = await worker.fetch(new Request(ORIGIN + "/auth/logout", { method: "POST", headers: { cookie } }), env, ctx);
  check("AUTH-11", "logout clears cookie (Max-Age=0)", out.status === 200 && /Max-Age=0/.test(out.headers.get("set-cookie")));
  check("AUTH-12", "session invalid after logout", (await call("/api/access", { method: "GET", cookie })).data.signed_in === false);
  cookie = (await call("/auth/dev", { method: "GET" })).headers.get("set-cookie").split(";")[0];
}

// =========================================================== MOBILE PAIRING
let bearer;
{
  const start = await call("/api/mobile/pair/start", { body: { device_name: "Vipul's <script>iPhone" } });
  check("MOB-01", "pair/start returns 8-char code, secret, expiry", start.status === 200 && /^[A-HJ-NP-Z2-9]{8}$/.test(start.data.code) && start.data.pairing_secret.length >= 40 && start.data.expires_at);
  const { code, pairing_secret } = start.data;
  const row = sqlite.prepare("SELECT device_name FROM mobile_pairings").get();
  check("MOB-02", "device name sanitised (no < > characters)", row && !/[<>]/.test(row.device_name), row?.device_name);
  const raw = JSON.stringify(sqlite.prepare("SELECT * FROM mobile_pairings").all());
  check("MOB-03", "pairing code/secret stored hashed only", !raw.includes(code) && !raw.includes(pairing_secret));
  const pend = await call("/api/mobile/pair/status", { body: { code, pairing_secret } });
  check("MOB-04", "status before approval -> approved:false", pend.status === 200 && pend.data.approved === false);
  check("MOB-05", "status with wrong secret -> 404", (await call("/api/mobile/pair/status", { body: { code, pairing_secret: "B".repeat(43) } })).status === 404);
  check("MOB-06", "status with malformed code -> 400", (await call("/api/mobile/pair/status", { body: { code: "abc", pairing_secret } })).status === 400);
  check("MOB-07", "approve without sign-in -> 401", (await call("/api/mobile/pair/approve", { body: { code } })).status === 401);
  check("MOB-08", "approve with invalid code format -> 400", (await call("/api/mobile/pair/approve", { cookie, body: { code: "OOOO0000" } })).status === 400);
  check("MOB-09", "approve unknown (valid-format) code -> 410", (await call("/api/mobile/pair/approve", { cookie, body: { code: "ZZZZZZZZ" } })).status === 410);
  const ap = await call("/api/mobile/pair/approve", { cookie, body: { code: code.toLowerCase() } });
  check("MOB-10", "approve accepts lowercase code, returns approved", ap.status === 200 && ap.data.approved === true, JSON.stringify(ap.data));
  const claim = await call("/api/mobile/pair/status", { body: { code, pairing_secret } });
  check("MOB-11", "status after approval issues token", claim.status === 200 && claim.data.approved === true && claim.data.token?.length >= 40);
  bearer = claim.data.token;
  check("MOB-12", "token stored hashed only", !JSON.stringify(sqlite.prepare("SELECT * FROM mobile_sessions").all()).includes(bearer));
  check("MOB-13", "second claim of same pairing -> 409", (await call("/api/mobile/pair/status", { body: { code, pairing_secret } })).status === 409);
  check("MOB-14", "re-approve a claimed code -> 409", (await call("/api/mobile/pair/approve", { cookie, body: { code } })).status === 409);
  const acc = await call("/api/access", { method: "GET", bearer });
  check("MOB-15", "bearer token recognised (auth_type mobile)", acc.data.signed_in === true && acc.data.auth_type === "mobile");
  check("MOB-16", "garbage bearer rejected", (await call("/api/access", { method: "GET", bearer: "C".repeat(50) })).data.signed_in === false);
  // expiry
  const s2 = await call("/api/mobile/pair/start", { body: {} });
  sqlite.prepare("UPDATE mobile_pairings SET expires_at = ? WHERE 1=1").run(new Date(Date.now() - 1000).toISOString());
  check("MOB-17", "expired pairing: approve -> 410", (await call("/api/mobile/pair/approve", { cookie, body: { code: s2.data.code } })).status === 410);
  check("MOB-18", "expired pairing: status -> 410 or 404", [404, 410].includes((await call("/api/mobile/pair/status", { body: { code: s2.data.code, pairing_secret: s2.data.pairing_secret } })).status));
  // rate limit
  let limited = 0;
  for (let i = 0; i < 40; i++) if ((await call("/api/mobile/pair/start", { body: {} })).status === 429) limited++;
  check("MOB-19", "pair/start rate-limited at 30/min (429)", limited >= 1, `limited=${limited}`);
  // session revoke
  const s3 = await call("/api/mobile/pair/start", { body: {} }).catch(() => null);
  const rev = await call("/api/mobile/session/revoke", { bearer: "D".repeat(50) });
  check("MOB-20", "revoke with unknown token still safe (200/401, no 5xx)", rev.status < 500, String(rev.status));
  check("MOB-21", "revoke without token -> 401", (await call("/api/mobile/session/revoke", {})).status === 401);
  check("MOB-22", "delete-account with web cookie (not mobile) -> 401", (await call("/api/mobile/account/delete", { cookie })).status === 401);
  sqlite.prepare("DELETE FROM mobile_pairings").run();
}

// =========================================================== HOLDINGS
const H = (path, body, who = { cookie }) => call(`/api/holdings${path}`, { body, ...who });
const list = async (who) => (await H("", {}, who)).data;
const find = (open, sym) => open.find(x => x.symbol === sym);
{
  check("HLD-01", "holdings list requires sign-in -> 401", (await call("/api/holdings", { body: {} })).status === 401);
  check("HLD-02", "add requires sign-in -> 401", (await call("/api/holdings/add", { body: { symbol: "AAPL", shares: 1, price: 1 } })).status === 401);
  const empty = await list();
  check("HLD-03", "empty list shape (open/closed/totals arrays)", Array.isArray(empty.open) && empty.open.length === 0 && Array.isArray(empty.closed) && Array.isArray(empty.totals) && empty.disclaimer);

  // validation
  const bad = (body) => H("/add", body);
  check("HLD-04", "add: missing symbol -> 400", (await bad({ shares: 1, price: 1 })).status === 400);
  check("HLD-05", "add: invalid symbol chars -> 400", (await bad({ symbol: "A A!", shares: 1, price: 1 })).status === 400);
  check("HLD-06", "add: symbol >15 chars -> 400", (await bad({ symbol: "A".repeat(16), shares: 1, price: 1 })).status === 400);
  check("HLD-07", "add: zero shares -> 400", (await bad({ symbol: "AAPL", shares: 0, price: 1 })).status === 400);
  check("HLD-08", "add: negative shares -> 400", (await bad({ symbol: "AAPL", shares: -5, price: 1 })).status === 400);
  check("HLD-09", "add: NaN/string shares -> 400", (await bad({ symbol: "AAPL", shares: "abc", price: 1 })).status === 400);
  check("HLD-10", "add: zero price -> 400", (await bad({ symbol: "AAPL", shares: 1, price: 0 })).status === 400);
  check("HLD-11", "add: absurd price (>1e8) -> 400", (await bad({ symbol: "AAPL", shares: 1, price: 1e9 })).status === 400);
  check("HLD-12", "add: absurd shares (>1e9) -> 400", (await bad({ symbol: "AAPL", shares: 2e9, price: 1 })).status === 400);
  check("HLD-13", "add: future purchase date -> 400", (await bad({ symbol: "AAPL", shares: 1, price: 1, bought_at: "2999-01-01" })).status === 400);
  check("HLD-14", "add: malformed date -> 400", (await bad({ symbol: "AAPL", shares: 1, price: 1, bought_at: "yesterday" })).status === 400);
  check("HLD-15", "add: forex market not trackable -> 400", (await bad({ symbol: "EURUSD", market: "FX", shares: 1, price: 1 })).status === 400);
  check("HLD-16", "add: BSE symbol outside Sensex 30 -> 400", (await bad({ symbol: "NOTREAL", market: "IN", shares: 1, price: 1 })).status === 400);
  check("HLD-17", "add: symbol with no market data -> 400", (await bad({ symbol: "ZZZZ", shares: 1, price: 1 })).status === 400);
  check("HLD-18", "add: oversized body -> 400", (await call("/api/holdings/add", { cookie, body: JSON.stringify({ symbol: "AAPL", pad: "x".repeat(11000) }) })).status === 400);
  check("HLD-19", "add: non-object JSON body doesn't 5xx", (await call("/api/holdings/add", { cookie, body: "[1,2]" })).status === 400);
  check("HLD-20", "add: invalid JSON doesn't 5xx", (await call("/api/holdings/add", { cookie, body: "{nope" })).status === 400);

  // happy path + decision states
  const add = async (symbol, shares, price, extra = {}) => (await H("/add", { symbol, shares, price, ...extra })).data;
  const a1 = await add("aapl", 10, 100);   // lowercase normalised
  check("HLD-21", "add AAPL (lowercase symbol normalised) -> added + id", a1.added === true && /^[A-Za-z0-9_-]{6,40}$/.test(a1.id), JSON.stringify(a1));
  const ids = { AAPL: a1.id };
  for (const [sym, buy] of [["EXITP", 100], ["EXITT", 100], ["TAKEP", 100], ["WEAKADX", 100], ["WEAKDAILY", 100], ["NVDA", 100]]) ids[sym] = (await add(sym, 10, buy)).id;
  let L = await list();
  const act = s => find(L.open, s)?.action;
  check("HLD-22", "decision HOLD when trend up & strong", act("AAPL") === "HOLD", act("AAPL"));
  check("HLD-23", "decision EXIT when price < protective level", act("EXITP") === "EXIT", act("EXITP"));
  check("HLD-24", "decision EXIT when 4H trend turns down", act("EXITT") === "EXIT", act("EXITT"));
  check("HLD-25", "decision TAKE_PROFIT at/above target", act("TAKEP") === "TAKE_PROFIT", act("TAKEP"));
  check("HLD-26", "decision WATCH when daily ADX < 20", act("WEAKADX") === "WATCH", act("WEAKADX"));
  check("HLD-27", "decision WATCH when daily trend down", act("WEAKDAILY") === "WATCH", act("WEAKDAILY"));
  const aapl = find(L.open, "AAPL");
  check("HLD-28", "levels ordered: stop < buy < target1 < target2", aapl.stop_level < aapl.buy_price && aapl.buy_price < aapl.target_1 && aapl.target_1 < aapl.target_2, JSON.stringify([aapl.stop_level, aapl.buy_price, aapl.target_1, aapl.target_2]));
  const nvda = find(L.open, "NVDA");
  check("HLD-29", "P&L math: NVDA 10sh bought 100 now 150 => +500 / +50%", nvda.pnl_value === 500 && nvda.pnl_pct === 50, `${nvda.pnl_value}/${nvda.pnl_pct}`);
  const usTot = L.totals.find(t => t.market === "US");
  check("HLD-30", "portfolio totals = sum of open costs/values", usTot && Math.abs(usTot.cost - L.open.reduce((s, x) => s + x.cost, 0)) < 0.01 && Math.abs(usTot.value - L.open.reduce((s, x) => s + x.value, 0)) < 0.01);
  check("HLD-31", "portfolio concentration object present", L.portfolio && typeof L.portfolio === "object");
  check("HLD-32", "refresh_after_seconds 300 or 600", [300, 600].includes(L.refresh_after_seconds));

  // increase
  const inc = await H("/increase", { id: ids.AAPL, shares: 10, price: 120 });
  L = await list();
  check("HLD-33", "increase: weighted average (10@100 + 10@120 => 20@110)", inc.data.increased && find(L.open, "AAPL").shares === 20 && Math.abs(find(L.open, "AAPL").buy_price - 110) < 1e-9, JSON.stringify(find(L.open, "AAPL")));
  check("HLD-34", "increase: bad shares -> 400", (await H("/increase", { id: ids.AAPL, shares: -1, price: 1 })).status === 400);
  check("HLD-35", "increase: bad price -> 400", (await H("/increase", { id: ids.AAPL, shares: 1, price: 0 })).status === 400);
  check("HLD-36", "increase: unknown id -> 404", (await H("/increase", { id: "doesnotexist1", shares: 1, price: 1 })).status === 404);
  check("HLD-37", "increase: invalid id format -> 404", (await H("/increase", { id: "../x", shares: 1, price: 1 })).status === 404);

  // partial sell
  const ps = await H("/sell", { id: ids.AAPL, shares: 5, price: 130 });
  L = await list();
  check("HLD-38", "partial sell: remaining 15 and closed entry created", ps.data.sold && ps.data.closed === false && ps.data.remaining === 15 && find(L.open, "AAPL").shares === 15 && L.closed.some(c => c.symbol === "AAPL" && c.shares === 5));
  const closedPart = L.closed.find(c => c.symbol === "AAPL");
  check("HLD-39", "partial sell P&L at average cost (130-110)*5 = 100", closedPart && closedPart.pnl_value === 100, String(closedPart?.pnl_value));
  check("HLD-40", "sell more than held -> 400", (await H("/sell", { id: ids.AAPL, shares: 999, price: 100 })).status === 400);
  check("HLD-41", "sell zero shares -> 400", (await H("/sell", { id: ids.AAPL, shares: 0, price: 100 })).status === 400);
  check("HLD-42", "sell bad price -> 400", (await H("/sell", { id: ids.AAPL, shares: 1, price: -3 })).status === 400);
  check("HLD-43", "sell unknown id -> 404", (await H("/sell", { id: "nopenopenope", price: 1 })).status === 404);
  const full = await H("/sell", { id: ids.NVDA, price: 140 });
  L = await list();
  check("HLD-44", "full sell (no shares arg) closes position", full.data.closed === true && !find(L.open, "NVDA") && L.closed.some(c => c.symbol === "NVDA" && c.pnl_value === 400));
  check("HLD-45", "sold position cannot be sold again -> 404", (await H("/sell", { id: ids.NVDA, price: 140 })).status === 404);

  // close (legacy)
  const cl = await H("/close", { id: ids.TAKEP, sell_price: 130 });
  check("HLD-46", "close legacy endpoint closes holding", cl.data.closed === true && !find((await list()).open, "TAKEP"));
  check("HLD-47", "close bad sell_price -> 400", (await H("/close", { id: ids.EXITP, sell_price: 0 })).status === 400);
  check("HLD-48", "close already-closed is idempotent (200)", (await H("/close", { id: ids.TAKEP, sell_price: 130 })).status === 200);

  // stats / history
  let S = (await H("/stats", {})).data;
  const us = S.markets?.find?.(m => m.market === "US") || S.markets?.US || S.markets;
  check("HLD-49", "stats returns markets + history + disclaimer", S.markets && Array.isArray(S.history) && S.history.length > 0 && S.disclaimer);
  const hist = S.history;
  check("HLD-50", "history sorted newest first", hist.every((h, i) => i === 0 || hist[i - 1].at >= h.at));
  check("HLD-51", "history: only newest entry per stock is undoable", Object.values(hist.filter(h => !h.voided).reduce((m, h) => { (m[h.symbol] ||= []).push(h); return m; }, {})).every(g => g.filter(x => x.can_undo).length <= 2));

  // undo / edit
  L = await list();
  const lastAapl = find(L.open, "AAPL").last_entry;
  check("HLD-52", "list exposes last_entry for undo UI", lastAapl && lastAapl.side === "SELL" && lastAapl.shares === 5);
  const un = await H("/undo", { id: lastAapl.id });
  L = await list();
  check("HLD-53", "undo partial sale restores shares to 20 and removes closed piece", un.data.undone && find(L.open, "AAPL").shares === 20 && !L.closed.some(c => c.symbol === "AAPL"), JSON.stringify(un.data));
  check("HLD-54", "undo same entry twice -> 404", (await H("/undo", { id: lastAapl.id })).status === 404);
  S = (await H("/stats", {})).data;
  const aaplBuys = S.history.filter(h => h.symbol === "AAPL" && !h.voided && h.side === "BUY");
  const newestBuy = aaplBuys[0], openBuy = aaplBuys[aaplBuys.length - 1];
  check("HLD-55", "undo non-latest entry rejected (400)", (await H("/undo", { id: openBuy.id })).status === 400);
  const ed = await H("/edit", { id: newestBuy.id, shares: 5, price: 130 });
  L = await list();
  check("HLD-56", "edit latest buy (10@120 -> 5@130): avg recalculated (10@100+5@130 => 15@110)", ed.status === 200 && find(L.open, "AAPL").shares === 15 && Math.abs(find(L.open, "AAPL").buy_price - 110) < 1e-6, JSON.stringify([ed.data, find(L.open, "AAPL")]));
  S = (await H("/stats", {})).data;
  check("HLD-57", "edit leaves an audit trail (voided original remains)", S.history.some(h => h.voided));
  check("HLD-58", "edit with invalid price -> 400", (await H("/edit", { id: S.history.find(h => h.can_undo && h.symbol === "AAPL").id, shares: 1, price: -2 })).status === 400);
  // undo opening purchase hides position
  const x = (await add("MSFT", 4, 100)).id;
  const xe = (await H("/stats", {})).data.history.find(h => h.symbol === "MSFT" && h.can_undo);
  await H("/undo", { id: xe.id });
  L = await list();
  check("HLD-59", "undo opening purchase removes position from open and closed lists", !find(L.open, "MSFT") && !L.closed.some(c => c.symbol === "MSFT"));
  // remove
  check("HLD-60", "remove deletes holding", (await H("/remove", { id: ids.WEAKDAILY })).data.removed === true && !find((await list()).open, "WEAKDAILY"));
  check("HLD-61", "remove invalid id -> 404", (await H("/remove", { id: "x" })).status === 404);

  // isolation between users
  const other = (await call("/api/mobile/pair/start", { body: {} })).data;
  await call("/api/mobile/pair/approve", { cookie, body: { code: other.code } }); // approves for same user, fine
  // second web user: create session row directly
  const tok = "U".repeat(48);
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tok)))].map(b => b.toString(16).padStart(2, "0")).join("");
  sqlite.prepare("INSERT INTO web_sessions (token_hash, user_id, email, created_at, expires_at) VALUES (?, 'user-2', 'u2@x', ?, ?)").run(hash, new Date().toISOString(), new Date(Date.now() + 1e9).toISOString());
  const c2 = { cookie: `ip_session=${tok}` };
  check("HLD-62", "user-2 sees none of user-1's holdings", (await list(c2)).open.length === 0 && (await list(c2)).closed.length === 0);
  check("HLD-63", "user-2 cannot sell user-1's holding (404)", (await H("/sell", { id: ids.AAPL, price: 1 }, c2)).status === 404);
  check("HLD-64", "user-2 cannot remove user-1's holding", ((await H("/remove", { id: ids.AAPL }, c2)), find((await list()).open, "AAPL") !== undefined));
  const s1 = (await H("/stats", {})).data.history.find(h => h.can_undo);
  check("HLD-65", "user-2 cannot undo user-1's entry (404)", (await H("/undo", { id: s1.id }, c2)).status === 404);

  // mobile auth reaches the same data
  const mob = await list({ bearer });
  check("HLD-66", "mobile bearer sees same holdings as web user", mob.open.length === (await list()).open.length && mob.open.length > 0);

  // cap
  for (let i = 0; i < 25; i++) await H("/add", { symbol: `FILL${i % 22}`, shares: 1, price: 50 }, c2);
  const open2 = (await list(c2)).open.length;
  check("HLD-67", "max 20 open holdings enforced", open2 === 20, String(open2));
  const over = await H("/add", { symbol: "FILL1", shares: 1, price: 50 }, c2);
  check("HLD-68", "21st add -> 400 with clear message", over.status === 400 && /20 open holdings/.test(over.data.error), JSON.stringify(over.data));

  // BSE flow
  seedMarket("HOLD:IN", [{ ...snap("TCS", 4000), market: "IN" }]);
  const inr = await H("/add", { symbol: "TCS", market: "IN", shares: 2, price: 3900 });
  const Li = await list();
  check("HLD-69", "BSE holding added with ₹ currency symbol", inr.data.added && find(Li.open, "TCS")?.currency_symbol === "₹");
  check("HLD-70", "totals kept per market (USD and INR never summed)", Li.totals.filter(t => ["US", "IN"].includes(t.market)).length === 2);
}

// =========================================================== SCANNER / ANALYZE / MEMORY (validation paths; no provider calls)
{
  check("SCN-01", "analyze invalid ticker -> 400", (await call("/api/analyze", { body: { symbol: "bad symbol!" } })).status === 400);
  check("SCN-02", "analyze empty ticker -> 400", (await call("/api/analyze", { body: {} })).status === 400);
  check("SCN-03", "analyze unknown market -> 400", (await call("/api/analyze", { body: { symbol: "AAPL", market: "XX" } })).status === 400);
  check("SCN-04", "analyze BSE symbol outside universe -> 400", (await call("/api/analyze", { body: { symbol: "AAPL", market: "IN" } })).status === 400);
  check("SCN-05", "analyze forex symbol outside universe -> 400", (await call("/api/analyze", { body: { symbol: "FOO", market: "FX" } })).status === 400);
  check("SCN-06", "discover unknown market -> 400", (await call("/api/discover", { body: { market: "ZZ" } })).status === 400);
  check("SCN-07", "memory requires sign-in -> 401", (await call("/api/memory", { body: {} })).status === 401);
  const mem = await call("/api/memory", { cookie, body: {} });
  check("SCN-08", "memory for signed-in new user returns 200 object", mem.status === 200 && typeof mem.data === "object", JSON.stringify(mem.data).slice(0, 150));
  const dis = await call("/api/discover", { body: { market: "IN" } });
  check("SCN-09", "discover (BSE) with no stored scan responds JSON (no crash)", typeof dis.data === "object", `${dis.status} ${JSON.stringify(dis.data).slice(0, 100)}`);
}

// =========================================================== ACCOUNT DELETION (last: destructive)
{
  const before = sqlite.prepare("SELECT COUNT(*) n FROM holdings WHERE user_id='dev-user'").get().n;
  const del = await call("/api/mobile/account/delete", { bearer });
  const after = sqlite.prepare("SELECT COUNT(*) n FROM holdings WHERE user_id='dev-user'").get().n;
  const trades = sqlite.prepare("SELECT COUNT(*) n FROM holding_trades WHERE user_id='dev-user'").get().n;
  check("DEL-01", "mobile account delete wipes holdings + trades", before > 0 && del.data.deleted === true && after === 0 && trades === 0, `${before}->${after}/${trades}`);
  check("DEL-02", "deleted account's bearer token no longer works", (await call("/api/holdings", { bearer, body: {} })).status === 401);
  check("DEL-03", "deleting data doesn't affect other users", sqlite.prepare("SELECT COUNT(*) n FROM holdings WHERE user_id='user-2'").get().n > 0);
}

const failed = results.filter(r => !r.ok);
console.log(`\nAPI harness: ${results.length - failed.length}/${results.length} passed`);
for (const f of failed) console.log(`FAIL ${f.id}: ${f.name} :: ${f.detail}`);
import { writeFile } from "node:fs/promises";
await writeFile(resolve(root, "qa/api-harness-results.json"), JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
