import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const workerPath = resolve(root, "dist/server/index.js");
const manifestPath = resolve(root, "dist/.openai/hosting.json");
const htmlPath = resolve(root, "engine/portfolio_intel/dashboard.html");
const [source, manifest, html] = await Promise.all([readFile(workerPath, "utf8"), readFile(manifestPath, "utf8"), readFile(htmlPath, "utf8")]);
const hosting = JSON.parse(manifest);
assert.equal(hosting.d1, "DB", "Persistent recommendation memory must declare the D1 binding");
for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(match[1]);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const workerModule = await import(moduleUrl);
assert.equal(typeof workerModule.default?.fetch, "function", "Worker must export default.fetch");
for (const slug of ["privacy", "terms", "support"]) {
  const page = await workerModule.default.fetch(new Request(`https://example.test/${slug}`), { SUPPORT_EMAIL: "help@example.test" }, { waitUntil() {} });
  assert.equal(page.status, 200, `${slug} page must be public`);
  const text = await page.text();
  assert.match(text, /IntelligentPortfolio/);
  if (slug === "terms") assert.match(text, /not investment, financial, tax or legal advice/i);
  if (slug === "privacy") assert.match(text, /Delete my account data/);
  if (slug === "support") assert.match(text, /help@example\.test/);
}
const response = await workerModule.default.fetch(new Request("https://example.test/health"), {}, { waitUntil() {} });
assert.equal(response.status, 200);
const health = await response.json();
assert.equal(health.read_only, true);
assert.equal(health.order_submission_supported, false);
assert.match(source, /dailyAligned && regimeEligible && isFresh/, "Daily Supertrend alignment and trend strength must gate fresh entries");
assert.match(source, /DAILY_CONFLICT/, "Daily trend conflicts must have an explicit status");
assert.match(source, /dailyAdx >= 20 && dailyAdxRising/, "Daily ADX must be strong and rising before an entry can qualify");
assert.match(source, /WEAK_TREND_REGIME/, "Weak trend regimes must have an explicit status");
assert.match(source, /const contextWarnings = reports\.filter\(report => !report\.data_complete\)/, "Unavailable news and fundamentals must be disclosed as context warnings");
assert.doesNotMatch(source, /const vetoReasons = reports\.filter\(report => !report\.data_complete\)/, "Unavailable news must not automatically veto a technical setup");
assert.match(source, /rememberRecommendation/, "Research calls must be persisted for later grading");
assert.match(source, /settlePendingRecommendations/, "Pending recommendations must be graded against later closes");
assert.match(source, /recommendation\.current_price/, "Grades must use the price available when the report was generated");
assert.match(source, /mobile_pairings/, "The iPhone client must use expiring one-time pairing records");
assert.match(source, /mobile_sessions/, "The iPhone client must use revocable server-side sessions");
assert.match(source, /await sha256\(token\)/, "Mobile session tokens must be hashed before database lookup");
assert.match(html, /Daily trend filter/, "The dashboard must show the daily filter result");
assert.match(html, /ADX \(14\)/, "The dashboard must explain the ADX regime gate");
assert.match(html, /Interactive trade desk/, "The dashboard must include the interactive analysis desk");
assert.match(html, /ANNOTATED SIGNAL/, "The chart must expose real signal annotations");
assert.match(html, /Analysis only · orders are never placed/, "The analysis desk must remain explicitly read-only");
assert.doesNotMatch(html, /Open Long|Open Short|Auto-execute/i, "The read-only interface must not expose execution controls");
assert.match(html, /TradingView 4H/, "The dashboard must offer an embedded TradingView chart");
assert.match(source, /frame-src https:\/\/www\.tradingview-widget\.com/, "The CSP must allow only the TradingView widget frame");
assert.doesNotMatch(source, /script-src[^;]*\*/, "The CSP must not allow wildcard script sources");
assert.match(html, /Learning memory/, "The dashboard must show persistent recommendation learning");
const accessResponse = await workerModule.default.fetch(new Request("https://example.test/api/access"), {}, { waitUntil() {} });
const access = await accessResponse.json();
assert.equal(access.paywall_enabled, false);
assert.equal(access.subscribed, true);
const gatedResponse = await workerModule.default.fetch(new Request("https://example.test/api/discover", { method: "POST", body: "{}" }), { PAYWALL_ENABLED: "true" }, { waitUntil() {} });
assert.equal(gatedResponse.status, 402);
const emptySummary = { total_calls: 0, pending_calls: 0, settled_calls: 0, scored_setups: 0, average_return_pct: null, win_rate: null, gross_wins: 0, gross_losses: 0 };
const fakeDb = {
  prepare(sql) {
    return {
      bind() { return this; },
      async all() { return { results: [] }; },
      async first() { return sql.includes("COUNT(*) AS total_calls") ? emptySummary : null; },
      async run() { return { success: true }; },
    };
  },
  async batch() { return []; },
};
const memoryResponse = await workerModule.default.fetch(new Request("https://example.test/api/memory", {
  method: "POST",
  headers: { "content-type": "application/json", "oai-authenticated-user-id": "test-user", "oai-authenticated-user-email": "test@example.com" },
  body: "{}",
}), { DB: fakeDb, AUTH_MODE: "oai" }, { waitUntil() {} });
assert.equal(memoryResponse.status, 200);
const memory = await memoryResponse.json();
assert.equal(memory.available, true);
assert.equal(memory.horizon_trading_days, 5);

class MobileFakeDb {
  constructor() { this.pairings = new Map(); this.sessions = new Map(); }
  prepare(sql) {
    const statement = {
      args: [],
      bind: (...args) => { statement.args = args; return statement; },
      run: async () => {
        const a = statement.args;
        if (sql.startsWith("DELETE FROM mobile_pairings")) {
          for (const [key, row] of this.pairings) if (row.expires_at <= a[0]) this.pairings.delete(key);
        } else if (sql.includes("INSERT INTO mobile_pairings")) {
          this.pairings.set(a[0], { code_hash: a[0], secret_hash: a[1], device_name: a[2], created_at: a[3], expires_at: a[4], user_id: null, approved_at: null, claimed_at: null });
        } else if (sql.includes("UPDATE mobile_pairings SET user_id")) {
          const row = this.pairings.get(a[2]); if (row && !row.user_id) Object.assign(row, { user_id: a[0], approved_at: a[1] });
        } else if (sql.includes("INSERT INTO mobile_sessions")) {
          this.sessions.set(a[0], { token_hash: a[0], user_id: a[1], device_name: a[2], created_at: a[3], expires_at: a[4], revoked_at: null });
        } else if (sql.includes("UPDATE mobile_pairings SET claimed_at")) {
          const row = this.pairings.get(a[1]); if (row && !row.claimed_at) row.claimed_at = a[0];
        } else if (sql.includes("UPDATE mobile_sessions SET revoked_at")) {
          const row = this.sessions.get(a[1]); if (row && !row.revoked_at) row.revoked_at = a[0];
        }
        return { success: true };
      },
      first: async () => {
        const a = statement.args;
        if (sql.includes("FROM mobile_pairings")) return this.pairings.get(a[0]) || null;
        if (sql.includes("FROM mobile_sessions")) return this.sessions.get(a[0]) || null;
        return null;
      },
      all: async () => ({ results: [] }),
    };
    return statement;
  }
  async batch(statements) { for (const statement of statements) await statement.run(); return []; }
}

const mobileDb = new MobileFakeDb();
const pairingStartResponse = await workerModule.default.fetch(new Request("https://example.test/api/mobile/pair/start", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device_name: "Test iPhone" }),
}), { DB: mobileDb }, { waitUntil() {} });
assert.equal(pairingStartResponse.status, 200);
const pairingStart = await pairingStartResponse.json();
assert.match(pairingStart.code, /^[A-HJ-NP-Z2-9]{8}$/);
assert.ok(pairingStart.pairing_secret.length >= 40);

const pairingApproveResponse = await workerModule.default.fetch(new Request("https://example.test/api/mobile/pair/approve", {
  method: "POST",
  headers: { "content-type": "application/json", "oai-authenticated-user-id": "mobile-test-user", "oai-authenticated-user-email": "mobile@example.com" },
  body: JSON.stringify({ code: pairingStart.code }),
}), { DB: mobileDb, AUTH_MODE: "oai" }, { waitUntil() {} });
assert.equal(pairingApproveResponse.status, 200);

const pairingStatusResponse = await workerModule.default.fetch(new Request("https://example.test/api/mobile/pair/status", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pairingStart.code, pairing_secret: pairingStart.pairing_secret }),
}), { DB: mobileDb }, { waitUntil() {} });
assert.equal(pairingStatusResponse.status, 200);
const pairingStatus = await pairingStatusResponse.json();
assert.equal(pairingStatus.approved, true);
assert.ok(pairingStatus.token.length >= 40);

const mobileAccessResponse = await workerModule.default.fetch(new Request("https://example.test/api/access", {
  headers: { authorization: `Bearer ${pairingStatus.token}` },
}), { DB: mobileDb }, { waitUntil() {} });
const mobileAccess = await mobileAccessResponse.json();
assert.equal(mobileAccess.signed_in, true);
assert.equal(mobileAccess.subscribed, true);
assert.equal(mobileAccess.auth_type, "mobile");

const anonymousDelete = await workerModule.default.fetch(new Request("https://example.test/api/mobile/account/delete", { method: "POST", body: "{}" }), { DB: mobileDb }, { waitUntil() {} });
assert.equal(anonymousDelete.status, 401, "Deleting account data requires a connected device");
const deleteResponse = await workerModule.default.fetch(new Request("https://example.test/api/mobile/account/delete", {
  method: "POST", headers: { authorization: `Bearer ${pairingStatus.token}` }, body: "{}",
}), { DB: mobileDb }, { waitUntil() {} });
assert.equal(deleteResponse.status, 200);
assert.equal((await deleteResponse.json()).deleted, true);

const revokeResponse = await workerModule.default.fetch(new Request("https://example.test/api/mobile/session/revoke", {
  method: "POST", headers: { authorization: `Bearer ${pairingStatus.token}` }, body: "{}",
}), { DB: mobileDb }, { waitUntil() {} });
assert.equal(revokeResponse.status, 200);


// Identity headers are forgeable outside OpenAI Sites, so they must be ignored unless AUTH_MODE is "oai".
{
  const forged = { "oai-authenticated-user-id": "attacker", "oai-authenticated-user-email": "victim@example.com" };
  const ask = env => workerModule.default.fetch(new Request("https://example.test/api/access", { headers: forged }), env, { waitUntil() {} }).then(response => response.json());
  assert.equal((await ask({})).signed_in, false, "Forged identity headers must not sign anyone in by default");
  assert.equal((await ask({ AUTH_MODE: "oai" })).signed_in, true, "Sites mode must still honor platform identity headers");
  const crossSite = await workerModule.default.fetch(new Request("https://example.test/api/billing/portal", { method: "POST", headers: { origin: "https://evil.example", cookie: "ip_session=" + "a".repeat(48) }, body: "{}" }), {}, { waitUntil() {} });
  assert.equal(crossSite.status, 403, "Cross-site POSTs carrying a session cookie must be rejected");
  const signin = await workerModule.default.fetch(new Request("https://example.test/auth/google/start"), { GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "secret" }, { waitUntil() {} });
  assert.equal(signin.status, 302);
  assert.match(signin.headers.get("location"), /^https:\/\/accounts\.google\.com\//);
  assert.match(signin.headers.get("set-cookie"), /ip_oauth_state=.+HttpOnly/);
  assert.equal((await workerModule.default.fetch(new Request("https://example.test/auth/dev"), { DB: {} }, { waitUntil() {} })).status, 404, "The development sign-in must be off by default");
}

// Multi-market: BSE and forex scans refresh automatically and are served from storage.
const realFetch = globalThis.fetch;
const fetchLog = [];
function series(count, stepSeconds, endSeconds, base) {
  const rows = Array.from({ length: count }, (_, index) => {
    const mid = base * (1 + index * 0.0004 + Math.sin(index / 5) * 0.004);
    return { time: endSeconds - (count - 1 - index) * stepSeconds, open: mid * 0.9995, high: mid * 1.003, low: mid * 0.997, close: mid, volume: base > 50 ? 1000 + index : 0 };
  });
  return rows;
}
const nowSeconds = Math.floor(Date.now() / 1000);
const stamp = (time, daily) => { const iso = new Date(time * 1000).toISOString(); return daily ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`; };
globalThis.fetch = async input => {
  const url = new URL(String(input));
  fetchLog.push(url.hostname);
  if (url.hostname.includes("yahoo")) {
    const rows = series(3000, 3600, nowSeconds - 4 * 3600, 1.08);
    return new Response(JSON.stringify({ chart: { result: [{ timestamp: rows.map(row => row.time), indicators: { quote: [{ open: rows.map(r => r.open), high: rows.map(r => r.high), low: rows.map(r => r.low), close: rows.map(r => r.close), volume: rows.map(r => r.volume) }] } }] } }), { status: 200 });
  }
  if (url.hostname === "raw.githubusercontent.com") {
    return new Response(["Symbol,Security,GICS Sector", ...Array.from({ length: 503 }, (_, index) => `S${String(index).padStart(3, "0")},Company ${index},Technology`)].join("\n"), { status: 200 });
  }
  if (url.hostname === "api.robinhood.com") {
    const symbols = url.searchParams.get("symbols").split(",");
    const isHistory = url.pathname.includes("historicals");
    if (isHistory && symbols.length > 75) return new Response("{}", { status: 400 });
    if (!isHistory) return new Response(JSON.stringify({ results: symbols.map(symbol => ({ symbol, last_trade_price: "100", adjusted_previous_close: "99" })) }), { status: 200 });
    const daily = url.searchParams.get("interval") === "day";
    const rows = daily ? series(130, 86400, nowSeconds - 2 * 86400, 100) : series(300, 3600, nowSeconds - 4 * 3600, 100);
    return new Response(JSON.stringify({ results: symbols.map(symbol => ({ symbol, historicals: rows.map(r => ({ begins_at: new Date(r.time * 1000).toISOString(), open_price: String(r.open), high_price: String(r.high), low_price: String(r.low), close_price: String(r.close), volume: r.volume })) })) }), { status: 200 });
  }
  if (url.hostname.includes("twelvedata")) {
    const daily = url.searchParams.get("interval") === "1day";
    const symbols = url.searchParams.get("symbol").split(",");
    const entry = () => ({ status: "ok", values: (daily ? series(130, 86400, nowSeconds - 2 * 86400, 2500) : series(220, 3600, nowSeconds - 4 * 3600, 2500)).map(r => ({ datetime: stamp(r.time, daily), open: String(r.open), high: String(r.high), low: String(r.low), close: String(r.close), volume: String(r.volume) })) });
    return new Response(JSON.stringify(symbols.length === 1 ? entry() : Object.fromEntries(symbols.map(symbol => [symbol, entry()]))), { status: 200 });
  }
  return new Response("{}", { status: 404 });
};
const post = (path, body, env = {}) => workerModule.default.fetch(new Request(`https://example.test${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), env, { waitUntil() {} });

const fxScan = await (await post("/api/discover", { market: "FX" })).json();
assert.equal(fxScan.market, "FX");
assert.equal(fxScan.auto_refresh, true, "Forex scans must refresh automatically");
assert.equal(fxScan.successful, 13, "All 13 forex pairs must be scanned");
assert.ok(fxScan.refreshed_at && fxScan.next_refresh_at, "Automatic scans must report refresh times");
const fxCandidate = [...fxScan.candidates, ...fxScan.late_candidates][0];
assert.equal(fxCandidate.price_decimals, 5, "Forex prices need five decimals");
assert.equal(fxCandidate.currency_symbol, "");
const callsAfterFirstScan = fetchLog.length;
assert.equal(callsAfterFirstScan, 13, "A forex scan must use one request per pair");
for (let index = 0; index < 5; index += 1) await post("/api/discover", { market: "FX" });
assert.equal(fetchLog.length, callsAfterFirstScan, "Repeated requests must be served from storage with no upstream calls");

fetchLog.length = 0;
const usScan = await (await post("/api/discover", { market: "US" })).json();
assert.equal(usScan.successful, 503, "Every S&P 500 symbol must be scanned");
assert.ok(fetchLog.length <= 30, `A full US scan must stay far below the free plan's 50-request limit (used ${fetchLog.length})`);
const usCalls = fetchLog.length;
await post("/api/discover", { market: "US", refresh: true });
const callsPerUsScan = fetchLog.length - usCalls;
assert.ok(callsPerUsScan > 0 && callsPerUsScan <= usCalls, "A US manual refresh must always rescan, with no cooldown");
await Promise.all([post("/api/discover", { market: "US", refresh: true }), post("/api/discover", { market: "US", refresh: true }), post("/api/discover", { market: "US", refresh: true })]);
assert.ok(fetchLog.length - usCalls - callsPerUsScan <= callsPerUsScan * 2, "Simultaneous manual refreshes must share a scan instead of each making their own");
assert.equal(usScan.auto_refresh, false, "US keeps a manual refresh control");
assert.ok(usScan.market_trend && ["UP", "MIXED", "DOWN"].includes(usScan.market_trend.state), "The US scan must report the market trend");
assert.equal(usScan.market_trend.index_symbol, "SPY");
assert.deepEqual(usScan.market_trends.map(item => item.label), ["S&P 500", "Nasdaq-100", "Dow Jones", "Russell 2000"], "The US scan must report each major index");
assert.ok(usScan.market_trends.slice(1).every(item => item.breadth_daily_pct === null), "Only the S&P 500 carries breadth");
assert.equal(usScan.market_trend.label, "S&P 500");
assert.ok(usScan.market_trend.breadth_daily_pct >= 0 && usScan.market_trend.breadth_daily_pct <= 100 && usScan.market_trend.stocks_counted === 503, "Breadth must come from the scanned stocks, not the index");
assert.ok(![...usScan.candidates, ...usScan.late_candidates].some(item => ["SPY", "QQQ", "DIA", "IWM"].includes(item.symbol)), "The index proxies must never appear as candidates");

const inScan = await (await post("/api/discover", { market: "IN" }, { TWELVE_DATA_API_KEY: "test-key" })).json();
assert.equal(inScan.market, "IN");
assert.equal(inScan.universe_size, 30, "The Sensex 30 universe must have 30 symbols");
assert.equal(inScan.successful, 30);
assert.equal([...inScan.candidates, ...inScan.late_candidates][0].currency_symbol, "₹");
assert.ok(fetchLog.includes("api.twelvedata.com"), "A Twelve Data key must route requests to Twelve Data");
assert.equal(inScan.market_trend, null, "Without a usable index feed the trend is left out rather than guessed");
assert.deepEqual(inScan.market_trends, [], "Without an index feed there are no trends to list");
{
  const yahooModule = await import(`data:text/javascript;base64,${Buffer.from(`${source}\n//index-test`).toString("base64")}`);
  const scan = await (await yahooModule.default.fetch(new Request("https://example.test/api/discover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ market: "IN" }) }), {}, { waitUntil() {} })).json();
  assert.equal(scan.market_trend?.label, "Sensex 30", "The India scan must report the Sensex trend");
  assert.equal(scan.market_trend.index_symbol, "^BSESN");
  assert.equal(scan.successful, 30, "The Sensex index must not count as a stock");
}

const fxAnalysis = await (await post("/api/analyze", { market: "FX", symbol: "EURUSD" })).json();
assert.equal(fxAnalysis.market, "FX");
assert.equal(fxAnalysis.price_decimals, 5);
assert.ok(fxAnalysis.stop_price > 0 && fxAnalysis.chart.levels.target_1 > 0);
assert.equal((await post("/api/analyze", { market: "FX", symbol: "AAPL" })).status, 502, "Forex analysis is limited to the pair list");
assert.equal((await post("/api/discover", { market: "XX" })).status, 400, "Unknown markets must be rejected");

// A rate-limited provider must trigger a backoff, not a retry on every request.
{
  const freshModule = await import(`data:text/javascript;base64,${Buffer.from(`${source}\n//rate-limit-test`).toString("base64")}`);
  const upstream = [];
  globalThis.fetch = async input => { upstream.push(String(input)); return new Response("Too Many Requests", { status: 429 }); };
  const ask = () => freshModule.default.fetch(new Request("https://example.test/api/discover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ market: "FX" }) }), {}, { waitUntil() {} });
  const first = await (await ask()).json();
  assert.equal(first.warming_up, true, "A failed first scan must report that it is warming up");
  const callsAfterFailure = upstream.length;
  assert.ok(callsAfterFailure > 0 && callsAfterFailure <= 26, "A failed scan must make only one bounded round of requests");
  for (let index = 0; index < 5; index += 1) await ask();
  assert.equal(upstream.length, callsAfterFailure, "After a provider rate limit, no further upstream calls may be made until the backoff ends");
}
// Holdings: positions entered by hand are evaluated by the same engine and stay private to their owner.
{
  class HoldingsDb {
    constructor() { this.rows = []; this.trades = []; }
    prepare(sql) {
      const statement = { args: [], bind: (...args) => { statement.args = args; return statement; } };
      statement.run = async () => {
        const a = statement.args;
        if (sql.startsWith("INSERT INTO holding_trades")) this.trades.push({ id: a[0], user_id: a[1], holding_id: a[2], chain_id: a[3], symbol: a[4], market: a[5], side: a[6], shares: a[7], price: a[8], at: a[9], realized_pnl: a[10], voided_at: null, seq: this.trades.length });
        else if (sql.startsWith("UPDATE holding_trades SET voided_at")) { const t = this.trades.find(x => x.id === a[1] && x.user_id === a[2]); if (t) t.voided_at = a[0]; }
        else if (sql.startsWith("UPDATE holdings SET shares = ?, buy_price = ?")) { const r = this.rows.find(x => x.id === a[2] && x.user_id === a[3] && !x.closed_at); if (r) { r.shares = a[0]; r.buy_price = a[1]; } }
        else if (sql.startsWith("UPDATE holdings SET closed_at = NULL")) { const r = this.rows.find(x => x.id === a[0] && x.user_id === a[1]); if (r) { r.closed_at = null; r.sell_price = null; } }
        else if (sql.startsWith("UPDATE holdings SET closed_at = ?, sell_price = NULL")) { const r = this.rows.find(x => x.id === a[1] && x.user_id === a[2]); if (r) { r.closed_at = a[0]; r.sell_price = null; } }
        else if (sql.startsWith("UPDATE holdings SET shares = shares +")) { const r = this.rows.find(x => x.id === a[1] && x.user_id === a[2] && !x.closed_at); if (r) r.shares += a[0]; }
        else if (sql.startsWith("UPDATE holdings SET bought_at = ?")) { const r = this.rows.find(x => x.id === a[3] && x.user_id === a[4] && !x.closed_at); if (r) { r.bought_at = a[0]; r.shares = a[1]; r.buy_price = a[2]; } }
        else if (sql.startsWith("UPDATE holdings SET sell_price = ? WHERE")) { const r = this.rows.find(x => x.id === a[1] && x.user_id === a[2]); if (r) r.sell_price = a[0]; }
        else if (sql.startsWith("UPDATE holdings SET shares = ? WHERE")) { const r = this.rows.find(x => x.id === a[1] && x.user_id === a[2] && !x.closed_at); if (r) r.shares = a[0]; }
        else if (sql.startsWith("UPDATE holdings SET shares = ?, sell_price = ?")) { const r = this.rows.find(x => x.id === a[2] && x.user_id === a[3]); if (r) { r.shares = a[0]; r.sell_price = a[1]; } }
        else if (sql.startsWith("UPDATE holdings SET sell_price = NULL")) { const r = this.rows.find(x => x.id === a[0] && x.user_id === a[1]); if (r) r.sell_price = null; }
        else if (sql.startsWith("DELETE FROM holding_trades WHERE holding_id")) this.trades = this.trades.filter(t => !(t.holding_id === a[0] && t.user_id === a[1]));
        else if (sql.startsWith("INSERT INTO holdings")) this.rows.push({ id: a[0], user_id: a[1], symbol: a[2], market: a[3], shares: a[4], buy_price: a[5], bought_at: a[6], created_at: a[7], closed_at: sql.includes("closed_at, sell_price") ? a[8] : null, sell_price: sql.includes("closed_at, sell_price") ? a[9] : null, last_action: null, last_action_at: null });
        else if (sql.startsWith("UPDATE holdings SET shares = shares -")) { const row = this.rows.find(r => r.id === a[1] && r.user_id === a[2] && !r.closed_at && r.shares > a[3]); if (row) row.shares -= a[0]; }
        else if (sql.startsWith("UPDATE holdings SET last_action")) { const row = this.rows.find(r => r.id === a[2] && r.user_id === a[3]); if (row) { row.last_action = a[0]; row.last_action_at = a[1]; } }
        else if (sql.startsWith("UPDATE holdings SET buy_price")) { const row = this.rows.find(r => r.id === a[4] && r.user_id === a[5] && !r.closed_at); if (row) { row.buy_price = (row.shares * row.buy_price + a[0] * a[1]) / (row.shares + a[2]); row.shares += a[3]; } }
        else if (sql.startsWith("UPDATE holdings SET closed_at")) { const row = this.rows.find(r => r.id === a[2] && r.user_id === a[3] && !r.closed_at); if (row) { row.closed_at = a[0]; row.sell_price = a[1]; } }
        else if (sql.startsWith("DELETE FROM holdings")) this.rows = this.rows.filter(r => !(r.id === a[0] && r.user_id === a[1]));
        return { success: true };
      };
      statement.first = async () => sql.startsWith("SELECT * FROM holding_trades WHERE id") ? (this.trades.find(t => t.id === statement.args[0] && t.user_id === statement.args[1]) || null) : sql.startsWith("SELECT * FROM holdings WHERE id") ? (this.rows.find(r => r.id === statement.args[0] && r.user_id === statement.args[1]) || null) : sql.includes("COUNT(*)") ? { n: this.rows.filter(r => r.user_id === statement.args[0] && !r.closed_at).length } : null;
      statement.all = async () => sql.includes("FROM holding_trades") ? { results: this.trades.filter(t => t.user_id === statement.args[0] && (!sql.includes("chain_id = ?") || t.chain_id === statement.args[1]) && (!sql.includes("voided_at IS NULL") || !t.voided_at)).sort((x, y) => y.at.localeCompare(x.at) || y.seq - x.seq) }
        : sql.includes("closed_at IS NOT NULL") ? { results: this.rows.filter(r => r.user_id === statement.args[0] && r.closed_at) }
        : { results: this.rows.filter(r => r.user_id === statement.args[0]) };
      return statement;
    }
    async batch(list) { for (const item of list) await item.run(); return []; }
  }
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname !== "api.robinhood.com") return new Response("{}", { status: 404 });
    const symbols = url.searchParams.get("symbols").split(",");
    if (!url.pathname.includes("historicals")) return new Response(JSON.stringify({ results: symbols.map(symbol => ({ symbol, last_trade_price: "100", adjusted_previous_close: "99" })) }), { status: 200 });
    const daily = url.searchParams.get("interval") === "day";
    const rows = daily ? series(130, 86400, nowSeconds - 2 * 86400, 100) : series(300, 3600, nowSeconds - 4 * 3600, 100);
    return new Response(JSON.stringify({ results: symbols.map(symbol => ({ symbol, historicals: rows.map(r => ({ begins_at: new Date(r.time * 1000).toISOString(), open_price: String(r.open), high_price: String(r.high), low_price: String(r.low), close_price: String(r.close), volume: r.volume })) })) }), { status: 200 });
  };
  const holdingsModule = await import(`data:text/javascript;base64,${Buffer.from(`${source}\n//holdings-test`).toString("base64")}`);
  const db = new HoldingsDb();
  const as = (user, path, body) => holdingsModule.default.fetch(new Request(`https://example.test${path}`, {
    method: "POST", headers: { "content-type": "application/json", ...(user ? { "oai-authenticated-user-id": user, "oai-authenticated-user-email": `${user}@example.test` } : {}) }, body: JSON.stringify(body || {}),
  }), { DB: db, AUTH_MODE: "oai" }, { waitUntil() {} });
  assert.equal((await as(null, "/api/holdings")).status, 401, "Holdings require an account");
  assert.equal((await as("alice", "/api/holdings/add", { symbol: "AAPL", shares: 0, price: 10 })).status, 400, "Zero shares must be rejected");
  assert.equal((await as("alice", "/api/holdings/add", { symbol: "AAPL", market: "FX", shares: 1, price: 10 })).status, 400, "Forex holdings are not supported");
  for (const [symbol, price] of [["AAPL", 90], ["MSFT", 40], ["NVDA", 1000]]) assert.equal((await as("alice", "/api/holdings/add", { symbol, shares: 10, price })).status, 200);
  const list = await (await as("alice", "/api/holdings")).json();
  assert.equal(list.open.length, 3);
  const bySymbol = Object.fromEntries(list.open.map(item => [item.symbol, item]));
  assert.equal(bySymbol.NVDA.action, "EXIT", "A position far under its protective level must give an exit signal");
  assert.ok(bySymbol.NVDA.pnl_value < 0 && bySymbol.NVDA.reasons.length > 0);
  assert.equal(bySymbol.MSFT.action, "TAKE_PROFIT", "A position past 2R in an uptrend must flag taking profit");
  assert.ok(["HOLD", "WATCH", "TAKE_PROFIT"].includes(bySymbol.AAPL.action));
  assert.ok(bySymbol.AAPL.trailing_level > 0 && bySymbol.AAPL.target_1 > bySymbol.AAPL.buy_price);
  assert.match(list.disclaimer, /not personal financial advice/);
  assert.ok([60, 600].includes(list.refresh_after_seconds), "The response must tell clients how soon to re-check");
  assert.equal(db.rows.find(row => row.symbol === "NVDA").last_action, "EXIT", "The latest decision must be remembered so changes can be shown");
  assert.equal((await (await as("bob", "/api/holdings")).json()).open.length, 0, "Holdings must stay private to their owner");
  const aapl = bySymbol.AAPL.id;
  assert.equal((await as("alice", "/api/holdings/increase", { id: aapl, shares: 0, price: 110 })).status, 400, "Adding zero shares must be rejected");
  assert.equal((await as("alice", "/api/holdings/increase", { id: aapl, shares: 10, price: 110 })).status, 200);
  const grown = db.rows.find(row => row.id === aapl);
  assert.equal(grown.shares, 20, "Buying more must add to the share count");
  assert.equal(grown.buy_price, 100, "Buying more must keep a weighted-average buy price");
  await as("bob", "/api/holdings/increase", { id: aapl, shares: 5, price: 1 });
  assert.equal(db.rows.find(row => row.id === aapl).shares, 20, "Another user must not be able to change someone else's holding");
  // Undo reverses the newest entry, keeps it in History as undone, and must go newest-first.
  const aaplBuys = db.trades.filter(t => t.holding_id === aapl).sort((x, y) => y.at.localeCompare(x.at) || y.seq - x.seq);
  assert.equal((await as("alice", "/api/holdings/undo", { id: aaplBuys[1].id })).status, 400, "An older entry cannot be undone while a newer one is active");
  assert.equal((await as("bob", "/api/holdings/undo", { id: aaplBuys[0].id })).status, 404, "Another user must not be able to undo someone else's entry");
  assert.equal((await as("alice", "/api/holdings/undo", { id: aaplBuys[0].id })).status, 200);
  assert.equal(db.rows.find(row => row.id === aapl).shares, 10, "Undoing a purchase must take the shares back out");
  assert.equal(db.rows.find(row => row.id === aapl).buy_price, 90, "Undoing a purchase must restore the earlier average price");
  assert.ok(db.trades.find(t => t.id === aaplBuys[0].id).voided_at, "An undone entry must stay in the record, marked as undone");
  assert.equal((await as("alice", "/api/holdings/undo", { id: aaplBuys[0].id })).status, 404, "An entry cannot be undone twice");
  assert.equal((await as("alice", "/api/holdings/increase", { id: aapl, shares: 10, price: 110 })).status, 200);
  assert.equal((await as("alice", "/api/holdings/sell", { id: aapl, shares: 25, price: 120 })).status, 400, "Selling more shares than held must be rejected");
  assert.equal((await as("bob", "/api/holdings/sell", { id: aapl, shares: 5, price: 120 })).status, 404, "Another user must not be able to sell someone else's holding");
  assert.equal((await as("alice", "/api/holdings/sell", { id: aapl, shares: 5, price: 120 })).status, 200);
  assert.equal(db.rows.find(row => row.id === aapl).shares, 15, "A partial sale must reduce the open position");
  const partial = db.rows.find(row => row.closed_at && row.symbol === "AAPL");
  assert.ok(partial && partial.shares === 5 && partial.sell_price === 120 && partial.buy_price === 100, "A partial sale must be recorded as its own closed entry");
  // Undo a partial sale: the shares return to the position and the sold piece drops out of the closed list.
  const partialSale = db.trades.find(t => t.side === "SELL" && t.holding_id === partial.id);
  assert.equal(partialSale.chain_id, aapl, "A partial sale must stay in its position's chain");
  assert.equal((await as("alice", "/api/holdings/undo", { id: partialSale.id })).status, 200);
  assert.equal(db.rows.find(row => row.id === aapl).shares, 20, "Undoing a partial sale must return the shares");
  assert.equal(partial.sell_price, null, "The undone sale piece must stop counting as a closed sale");
  assert.equal((await as("alice", "/api/holdings/sell", { id: aapl, shares: 5, price: 120 })).status, 200);
  assert.equal((await as("alice", "/api/holdings/sell", { id: aapl, price: 130 })).status, 200);
  assert.ok(db.rows.find(row => row.id === aapl).closed_at, "Selling without a share count must close the whole position");
  const nvda = bySymbol.NVDA.id;
  await as("bob", "/api/holdings/remove", { id: nvda });
  assert.equal(db.rows.length, 5, "Another user must not be able to remove someone else's holding");
  assert.equal((await as("alice", "/api/holdings/sell", { id: nvda, shares: 10, price: 900 })).status, 200);
  const nvdaSale = db.trades.find(t => t.holding_id === nvda && t.side === "SELL");
  assert.equal((await as("alice", "/api/holdings/undo", { id: nvdaSale.id })).status, 200);
  assert.equal(db.rows.find(row => row.id === nvda).closed_at, null, "Undoing a full sale must reopen the position");
  assert.equal((await as("alice", "/api/holdings/sell", { id: nvda, shares: 10, price: 900 })).status, 200);
  const afterClose = await (await as("alice", "/api/holdings")).json();
  assert.equal(afterClose.open.length, 1);
  assert.equal(afterClose.closed.find(item => item.symbol === "NVDA").pnl_value, -1000, "Closed holdings must show realized profit and loss");
  assert.equal(afterClose.closed.filter(item => item.symbol === "AAPL").length, 2, "A partial sale and the final sale must both appear as closed entries");
  assert.equal((await as("alice", "/api/holdings/close", { id: bySymbol.MSFT.id, sell_price: 120 })).status, 200, "The older close endpoint must keep working");
  const stats = await (await as("alice", "/api/holdings/stats")).json();
  const us = stats.markets.find(item => item.market === "US");
  assert.equal(us.closed_trades, 4);
  assert.equal(us.wins, 3);
  assert.equal(us.realized_pnl, 350, "Realised profit must add up every closed sale");
  assert.equal(us.win_rate, 75);
  assert.equal(us.profit_factor, 1.35);
  assert.equal(us.worst.symbol, "NVDA");
  assert.ok(us.months.length >= 1 && us.months[0].trades === 4);
  assert.equal(stats.history.filter(item => item.side === "BUY" && !item.voided).length, 4, "Every purchase, including buying more, must be in the history");
  assert.equal(stats.history.filter(item => item.side === "SELL" && !item.voided).length, 4, "Every sale must be in the history");
  assert.equal(stats.history.filter(item => item.voided).length, 3, "Undone entries must stay in the history, marked as undone");
  assert.ok(stats.history.filter(item => item.can_undo).length >= 1 && stats.history.every(item => !item.voided || !item.can_undo), "Only the newest active entry of a position can be undone");
  assert.ok(stats.history.filter(item => item.side === "SELL").every(item => typeof item.realized_pnl === "number"));
  assert.equal(stats.markets.find(item => item.market === "US").closed_trades, 4, "Undone sales must not count in Performance");
  // Undoing the opening purchase removes the position without erasing the record.
  assert.equal((await as("alice", "/api/holdings/add", { symbol: "GOOGL", shares: 5, price: 10 })).status, 200);
  const googl = db.rows.find(row => row.symbol === "GOOGL");
  assert.equal((await as("alice", "/api/holdings/undo", { id: db.trades.find(t => t.holding_id === googl.id).id })).status, 200);
  const afterUndo = await (await as("alice", "/api/holdings")).json();
  assert.ok(!afterUndo.open.some(item => item.symbol === "GOOGL") && !afterUndo.closed.some(item => item.symbol === "GOOGL"), "An undone opening purchase must disappear from positions");
  assert.ok(db.trades.some(t => t.holding_id === googl.id && t.voided_at), "...but stay in the record");

  // Portfolio view: weights, concentration, risk to the protective levels.
  assert.equal((await as("alice", "/api/holdings/add", { symbol: "TSLA", shares: 10, price: 50 })).status, 200);
  assert.equal((await as("alice", "/api/holdings/add", { symbol: "META", shares: 10, price: 50 })).status, 200);
  const withPortfolio = await (await as("alice", "/api/holdings")).json();
  const usBook = withPortfolio.portfolio.markets.find(item => item.market === "US");
  assert.equal(withPortfolio.portfolio.limit_pct, 25);
  assert.ok(usBook.positions.length >= 2 && Math.abs(usBook.positions.reduce((sum, item) => sum + item.weight_pct, 0) - 100) < 0.5, "Position weights must add up to about 100%");
  assert.ok(usBook.concentrated.length >= 1, "A position above the concentration limit must be flagged");
  assert.ok(usBook.risk_to_stops_value > 0 && usBook.readings.length >= 1 && usBook.sectors.length >= 1);
  assert.equal(usBook.currency_symbol, "$");

  // Editing the newest entry: shares and price (date only for the opening purchase), older entries are locked.
  const tsla = db.rows.find(row => row.symbol === "TSLA" && !row.closed_at), meta = db.rows.find(row => row.symbol === "META" && !row.closed_at);
  assert.equal((await as("alice", "/api/holdings/increase", { id: tsla.id, shares: 10, price: 70 })).status, 200);
  const tslaTrades = () => db.trades.filter(t => t.holding_id === tsla.id).sort((x, y) => y.at.localeCompare(x.at) || y.seq - x.seq);
  assert.equal((await as("alice", "/api/holdings/edit", { id: tslaTrades().find(t => !t.voided_at && t.at.endsWith("T00:00:00.000Z")).id, shares: 1, price: 1 })).status, 400, "An older entry cannot be edited while a newer one is active");
  assert.equal((await as("bob", "/api/holdings/edit", { id: tslaTrades()[0].id, shares: 5, price: 80 })).status, 404, "Another user must not be able to edit someone else's entry");
  assert.equal((await as("alice", "/api/holdings/edit", { id: tslaTrades()[0].id, shares: 0, price: 80 })).status, 400, "An edit needs valid shares");
  assert.equal((await as("alice", "/api/holdings/edit", { id: tslaTrades()[0].id, shares: 5, price: 80 })).status, 200);
  assert.equal(tsla.shares, 15, "Editing a purchase must change the share count");
  assert.ok(Math.abs(tsla.buy_price - (10 * 50 + 5 * 80) / 15) < 1e-9, "Editing a purchase must recompute the average price");
  assert.equal(tslaTrades().filter(t => t.voided_at).length, 1, "The old version of an edited entry must stay as undone");
  assert.equal(tslaTrades().find(t => !t.voided_at && t.side === "BUY" && t.shares === 5).price, 80);
  const openingMeta = db.trades.find(t => t.holding_id === meta.id);
  assert.equal((await as("alice", "/api/holdings/edit", { id: openingMeta.id, shares: 10, price: 55, bought_at: "2026-10-01" })).status, 200);
  assert.equal(meta.buy_price, 55); assert.equal(meta.bought_at, "2026-10-01", "An opening purchase date can be corrected");
  assert.equal((await as("alice", "/api/holdings/edit", { id: db.trades.find(t => t.holding_id === meta.id && !t.voided_at).id, shares: 10, price: 55, bought_at: "2999-01-01" })).status, 400, "A future purchase date must be rejected");
  assert.equal((await as("alice", "/api/holdings/sell", { id: meta.id, shares: 5, price: 120 })).status, 200);
  const metaPiece = db.rows.find(row => row.symbol === "META" && row.closed_at && row.sell_price === 120);
  const metaSale = () => db.trades.find(t => t.holding_id === metaPiece.id && !t.voided_at);
  assert.equal((await as("alice", "/api/holdings/edit", { id: metaSale().id, shares: 4, price: 130 })).status, 200);
  assert.equal(meta.shares, 6, "Editing a partial sale must return the difference to the position");
  assert.equal(metaPiece.shares, 4); assert.equal(metaPiece.sell_price, 130);
  assert.equal(metaSale().realized_pnl, (130 - 55) * 4, "The edited sale must carry its recomputed profit");
  assert.equal((await as("alice", "/api/holdings/edit", { id: metaSale().id, shares: 10, price: 130 })).status, 400, "An edit may not sell the whole remaining position");
  assert.equal((await as("alice", "/api/holdings/sell", { id: meta.id, price: 140 })).status, 200);
  const finalSale = db.trades.find(t => t.holding_id === meta.id && t.side === "SELL" && !t.voided_at);
  assert.equal((await as("alice", "/api/holdings/edit", { id: finalSale.id, shares: 3, price: 150 })).status, 400, "A full sale keeps its share count");
  assert.equal((await as("alice", "/api/holdings/edit", { id: finalSale.id, price: 150 })).status, 200);
  assert.equal(meta.sell_price, 150, "Editing a full sale must change its price");
  const editFlags = (await (await as("alice", "/api/holdings/stats")).json()).history.filter(item => item.can_undo);
  assert.ok(editFlags.every(item => item.edit && typeof item.edit.shares === "boolean" && typeof item.edit.date === "boolean"), "Entries that can be changed must say what an edit may change");
  assert.equal((await (await as("bob", "/api/holdings/stats")).json()).history.length, 0, "History must stay private to its owner");
}
globalThis.fetch = realFetch;

console.log("Artifact is valid ESM; read-only, subscription, persistent-memory, and iPhone pairing gates passed");
