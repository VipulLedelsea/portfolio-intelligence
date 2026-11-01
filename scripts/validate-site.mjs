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
assert.match(html, /TradingView 1H/, "The dashboard must offer an embedded TradingView chart");
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
}), { DB: fakeDb }, { waitUntil() {} });
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
}), { DB: mobileDb }, { waitUntil() {} });
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

const revokeResponse = await workerModule.default.fetch(new Request("https://example.test/api/mobile/session/revoke", {
  method: "POST", headers: { authorization: `Bearer ${pairingStatus.token}` }, body: "{}",
}), { DB: mobileDb }, { waitUntil() {} });
assert.equal(revokeResponse.status, 200);


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
    const daily = url.searchParams.get("interval") === "1d";
    const rows = daily ? series(130, 86400, nowSeconds - 2 * 86400, 1.08) : series(300, 3600, nowSeconds - 4 * 3600, 1.08);
    return new Response(JSON.stringify({ chart: { result: [{ timestamp: rows.map(row => row.time), indicators: { quote: [{ open: rows.map(r => r.open), high: rows.map(r => r.high), low: rows.map(r => r.low), close: rows.map(r => r.close), volume: rows.map(r => r.volume) }] } }] } }), { status: 200 });
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
assert.ok(callsAfterFirstScan >= 26, "The first scan must fetch daily and hourly bars for each pair");
for (let index = 0; index < 5; index += 1) await post("/api/discover", { market: "FX" });
assert.equal(fetchLog.length, callsAfterFirstScan, "Repeated requests must be served from storage with no upstream calls");

const inScan = await (await post("/api/discover", { market: "IN" }, { TWELVE_DATA_API_KEY: "test-key" })).json();
assert.equal(inScan.market, "IN");
assert.equal(inScan.universe_size, 30, "The Sensex 30 universe must have 30 symbols");
assert.equal(inScan.successful, 30);
assert.equal([...inScan.candidates, ...inScan.late_candidates][0].currency_symbol, "₹");
assert.ok(fetchLog.includes("api.twelvedata.com"), "A Twelve Data key must route requests to Twelve Data");

const fxAnalysis = await (await post("/api/analyze", { market: "FX", symbol: "EURUSD" })).json();
assert.equal(fxAnalysis.market, "FX");
assert.equal(fxAnalysis.price_decimals, 5);
assert.ok(fxAnalysis.stop_price > 0 && fxAnalysis.chart.levels.target_1 > 0);
assert.equal((await post("/api/analyze", { market: "FX", symbol: "AAPL" })).status, 502, "Forex analysis is limited to the pair list");
assert.equal((await post("/api/discover", { market: "XX" })).status, 400, "Unknown markets must be rejected");
globalThis.fetch = realFetch;

console.log("Artifact is valid ESM; read-only, subscription, persistent-memory, and iPhone pairing gates passed");
