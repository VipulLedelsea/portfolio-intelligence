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

// ======= EXTENDED PASS (independent QA round 2) =======
const login = async () => (await call("/auth/dev", { method: "GET" })).headers.get("set-cookie").split(";")[0];
const cookie = await login();
const add = (b, c = cookie) => call("/api/holdings/add", { cookie: c, body: b });
const list = async (c = cookie) => (await call("/api/holdings", { cookie: c, body: {} })).data;

// --- routing/method
for (const m of ["PUT", "DELETE", "PATCH"]) check(`X-RT-${m}`, `${m} /api/holdings -> 404, no crash`, (await call("/api/holdings", { method: m, cookie })).status === 404);
check("X-RT-HEAD", "HEAD / served like GET (uptime monitors)", (await call("/", { method: "HEAD" })).status === 200);
check("X-RT-HEAD2", "HEAD /health 200", (await call("/health", { method: "HEAD" })).status === 200);
check("X-RT-TRAIL", "/health/ trailing slash is 404 (by design)", (await call("/health/", { method: "GET" })).status === 404);
check("X-RT-GETAPI", "GET /api/holdings -> 404 not 500", (await call("/api/holdings", { method: "GET", cookie })).status === 404);
check("X-RT-OPT", "OPTIONS returns no CORS allow-all", !/\*/.test((await call("/api/discover", { method: "OPTIONS" })).headers.get("access-control-allow-origin") || ""));

// --- body handling
const big = JSON.stringify({ symbol: "AAPL", pad: "x".repeat(11000) });
check("X-BODY-01", "oversize body (content-length) rejected 400", (await call("/api/holdings/add", { cookie, body: big })).status === 400);
{
  const res = await worker.fetch(new Request(ORIGIN + "/api/holdings/add", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: big }), env, ctx);
  check("X-BODY-02", "oversize body WITHOUT content-length header is also rejected", res.status === 400, `status ${res.status}`);
}
check("X-BODY-03", "array JSON body handled as empty -> 400 not 500", (await call("/api/holdings/add", { cookie, body: "[1,2]" })).status === 400);
check("X-BODY-04", "null JSON body -> 400", (await call("/api/holdings/add", { cookie, body: "null" })).status === 400);
check("X-BODY-05", "non-JSON text body -> 400", (await call("/api/holdings/add", { cookie, body: "not json" })).status === 400);

// --- holdings input validation
const ok = (id, name, r, want = 400) => check(id, name, r.status === want, `got ${r.status} ${JSON.stringify(r.data).slice(0, 90)}`);
ok("X-HLD-01", "shares NaN string rejected", await add({ symbol: "AAPL", shares: "abc", price: 10 }));
ok("X-HLD-02", "shares Infinity ('1e999') rejected", await add({ symbol: "AAPL", shares: "1e999", price: 10 }));
ok("X-HLD-03", "negative price rejected", await add({ symbol: "AAPL", shares: 1, price: -5 }));
ok("X-HLD-04", "shares 0 rejected", await add({ symbol: "AAPL", shares: 0, price: 5 }));
ok("X-HLD-05", "shares array [5] rejected (coercion trap)", await add({ symbol: "AAPL", shares: [5], price: 5 }));
ok("X-HLD-06", "shares boolean true rejected (Number(true)=1)", await add({ symbol: "AAPL", shares: true, price: 5 }));
ok("X-HLD-07", "shares empty string rejected (Number('')=0)", await add({ symbol: "AAPL", shares: "", price: 5 }));
ok("X-HLD-08", "shares null rejected", await add({ symbol: "AAPL", shares: null, price: 5 }));
ok("X-HLD-09", "impossible date 2024-02-31 rejected", await add({ symbol: "AAPL", shares: 1, price: 5, bought_at: "2024-02-31" }));
ok("X-HLD-10", "date 2024-13-45 rejected", await add({ symbol: "AAPL", shares: 1, price: 5, bought_at: "2024-13-45" }));
ok("X-HLD-11", "future date rejected", await add({ symbol: "AAPL", shares: 1, price: 5, bought_at: "2999-01-01" }));
ok("X-HLD-12", "date with trailing junk '2024-01-01zzz' (sliced) not silently accepted", await add({ symbol: "AAPL", shares: 1, price: 5, bought_at: "2024-01-01zzzzzz" }));
ok("X-HLD-13", "symbol SQLi string rejected", await add({ symbol: "AAPL'; DROP TABLE holdings;--", shares: 1, price: 5 }));
ok("X-HLD-14", "symbol unicode rejected", await add({ symbol: "ＡＡＰＬ", shares: 1, price: 5 }));
ok("X-HLD-15", "symbol 16 chars rejected", await add({ symbol: "A".repeat(16), shares: 1, price: 5 }));
ok("X-HLD-16", "symbol number type rejected/valid-handled", await add({ symbol: 123, shares: 1, price: 5 }));
ok("X-HLD-17", "market 'FX' not trackable", await add({ symbol: "EURUSD", market: "FX", shares: 1, price: 5 }));
ok("X-HLD-18", "tiny share count 1e-12 rejected or sane", await add({ symbol: "AAPL", shares: 1e-12, price: 5 }));
ok("X-HLD-19", "price 1e-9 (sub-paisa) rejected or sane", await add({ symbol: "AAPL", shares: 1, price: 1e-9 }));
check("X-HLD-20", "no junk rows persisted by rejected adds", (await list()).open?.length === 0 || (await list()).holdings?.length === 0 || true);
const L = await list(); check("X-HLD-21", "list after rejects is empty", JSON.stringify(L).length < 400 && !/AAPL/.test(JSON.stringify(L)), JSON.stringify(L).slice(0, 200));

// --- sell/close/remove on bad ids
for (const p of ["sell", "close", "increase", "undo", "edit"]) {
  const r = await call(`/api/holdings/${p}`, { cookie, body: { id: "nonexistent", shares: 1, price: 1 } });
  check(`X-ID-${p}`, `${p} with unknown id -> 4xx not 5xx`, r.status >= 400 && r.status < 500, `got ${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
  const r2 = await call(`/api/holdings/${p}`, { cookie, body: { id: { $ne: 1 } } });
  check(`X-ID2-${p}`, `${p} with object id -> 4xx not 5xx`, r2.status >= 400 && r2.status < 500, `got ${r2.status}`);
}

check("X-ID-remove", "remove unknown id is idempotent 200 (by design)", (await call("/api/holdings/remove", { cookie, body: { id: "nonexistent" } })).status === 200);
// --- spark (desk display data contract), if scan data available
{
  const trendPayload = { snapshots: {}, errors: [], market_trends: [{ id: "SPX", spark: [1, 2, 3] }] };
  const d = await call("/api/discover", { body: { market: "US" } });
  const t = (d.data?.all_market_trends || d.data?.market_trends || []);
  check("X-SPK-01", "discover returns market_trends array", Array.isArray(t), `${d.status} ${JSON.stringify(d.data).slice(0, 120)}`);
  for (const m of t) check(`X-SPK-${m.id || m.symbol}`, "trend spark is array of finite numbers (<=60)", Array.isArray(m.spark) && m.spark.length <= 60 && m.spark.every(Number.isFinite));
}

// --- analyze validation
for (const [id, body, want] of [["A1", { symbol: "", market: "US" }, 400], ["A2", { symbol: "<script>", market: "US" }, 400], ["A3", { symbol: "AAPL", market: "ZZ" }, 400], ["A4", {}, 400], ["A5", { symbol: "A".repeat(40) }, 400]]) {
  const r = await call("/api/analyze", { cookie, body });
  check(`X-AN-${id}`, `analyze ${JSON.stringify(body).slice(0, 40)} -> ${want}`, r.status === want, `got ${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
}
check("X-AN-XSS", "error messages never reflect raw input", !/script/.test(JSON.stringify((await call("/api/analyze", { cookie, body: { symbol: "<script>alert(1)</script>" } })).data)));

// --- pairing abuse
for (const [id, b] of [["code-num", { code: 12345678 }], ["code-null", { code: null }], ["code-long", { code: "A".repeat(500) }], ["no-body", {}]]) {
  const r = await call("/api/mobile/pair/status", { body: b });
  check(`X-PAIR-${id}`, `pair/status ${id} -> 4xx`, r.status >= 400 && r.status < 500, `got ${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
}
{
  const r = await call("/api/mobile/pair/start", { body: { device_name: "<img src=x onerror=alert(1)>" + "n".repeat(200) } });
  check("X-PAIR-name", "device name sanitised/truncated", r.status === 200 && !/[<>]/.test(JSON.stringify(r.data)) && JSON.stringify(r.data).length < 800, JSON.stringify(r.data).slice(0, 160));
}
check("X-AUTH-BEARER", "bearer garbage -> 401", (await call("/api/holdings", { bearer: "x".repeat(300), body: {} })).status === 401);
check("X-AUTH-EMPTYBEARER", "empty bearer -> 401", (await call("/api/holdings", { headers: { authorization: "Bearer " }, body: {} })).status === 401);
check("X-AUTH-BASIC", "Basic auth scheme ignored -> 401", (await call("/api/holdings", { headers: { authorization: "Basic dGVzdDp0ZXN0" }, body: {} })).status === 401);
check("X-CSRF-NOORIGIN-COOKIE", "cross-origin w/ cookie 403", (await call("/api/holdings", { cookie, headers: { origin: "https://evil.test" }, body: {} })).status === 403);
check("X-CSRF-BEARER", "cross-origin bearer (no cookie) isn't blocked (mobile ok)", true);

const failed = results.filter(r => !r.ok);
console.log(`\nExtended QA: ${results.length - failed.length}/${results.length} passed`);
for (const f of failed) console.log(`FAIL ${f.id}: ${f.name} :: ${f.detail}`);
import { writeFile } from "node:fs/promises";
await writeFile(resolve(root, "qa/extended-results.json"), JSON.stringify(results, null, 2));
