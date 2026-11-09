// QA harness for features added after round 2: briefing, learning loop + admin gate, alerts seen, account deletion completeness,
// paywall coverage of new routes, new-route method/auth matrix. In-process Worker, in-memory SQLite D1, no network.
// Run: node scripts/build-site.mjs && node qa/api-harness-new.mjs
import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = await readFile(resolve(root, "dist/server/index.js"), "utf8");
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)).default;
const sqlite = new DatabaseSync(":memory:");
for (const file of (await readdir(resolve(root, "drizzle"))).filter(f => f.endsWith(".sql")).sort())
  for (const stmt of (await readFile(resolve(root, "drizzle", file), "utf8")).split("--> statement-breakpoint")) if (stmt.trim()) sqlite.exec(stmt);
const wrap = (sql, params = []) => ({
  bind(...p) { return wrap(sql, p.map(v => v === undefined ? null : v)); },
  async first() { return sqlite.prepare(sql).get(...params) ?? null; },
  async all() { return { results: sqlite.prepare(sql).all(...params) }; },
  async run() { const r = sqlite.prepare(sql).run(...params); return { meta: { changes: Number(r.changes) } }; },
});
const DB = { prepare: sql => wrap(sql), async batch(stmts) { sqlite.exec("BEGIN"); try { const out = []; for (const s of stmts) out.push(await s.run()); sqlite.exec("COMMIT"); return out; } catch (e) { sqlite.exec("ROLLBACK"); throw e; } } };
const baseEnv = { DB, AUTH_MODE: "dev" };
const pending = [];
const ctx = { waitUntil(p) { pending.push(p); } };
const ORIGIN = "https://qa.test";
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; throw new Error("network disabled in QA harness"); };

const results = [];
const check = (id, name, ok, detail = "") => { results.push({ id, ok: Boolean(ok) }); if (!ok) console.log(`  ✗ ${id} ${name} ${detail}`); };
const call = async (path, { method = "POST", body, cookie, bearer, e = baseEnv } = {}) => {
  const h = {}; if (cookie) h.cookie = cookie; if (bearer) h.authorization = `Bearer ${bearer}`;
  const init = { method, headers: h };
  if (body !== undefined) { const t = typeof body === "string" ? body : JSON.stringify(body); init.body = t; h["content-type"] = "application/json"; h["content-length"] = String(t.length); }
  const res = await worker.fetch(new Request(ORIGIN + path, init), e, ctx);
  const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};
const cookie = (await call("/auth/dev", { method: "GET" }).then(async () => {
  const res = await worker.fetch(new Request(ORIGIN + "/auth/dev"), baseEnv, ctx); return res.headers.get("set-cookie").split(";")[0];
}));

// pair a phone for the dev user
const start = await call("/api/mobile/pair/start", { body: {} });
await call("/api/mobile/pair/approve", { cookie, body: { code: start.data.code } });
const bearer = (await call("/api/mobile/pair/status", { body: { code: start.data.code, pairing_secret: start.data.pairing_secret } })).data.token;

// ---------- NEW-1 briefing ----------
const b0 = await call("/api/briefing", { body: {} });
check("BRF-01", "briefing anonymous returns 200 with 3 markets (paywall off)", b0.status === 200 && b0.data.markets?.length === 3, JSON.stringify(b0.data).slice(0, 200));
check("BRF-02", "briefing makes no provider calls (reads stored scans only)", fetchCalls === 0, `fetch calls: ${fetchCalls}`);
check("BRF-03", "briefing markets are warming/unavailable, not crashing, with empty store", b0.data.markets.every(m => m.warming_up || m.unavailable || Array.isArray(m.top)));
check("BRF-04", "briefing anonymous has no holdings section", b0.data.holdings === null);
check("BRF-05", "briefing includes disclaimer and as_of", Boolean(b0.data.disclaimer) && Boolean(b0.data.as_of));
const b1 = await call("/api/briefing", { cookie, body: {} });
check("BRF-06", "briefing signed-in with no holdings: holdings.count 0", b1.status === 200 && b1.data.holdings?.count === 0, JSON.stringify(b1.data.holdings));
check("BRF-07", "briefing GET -> 404 (POST only)", (await call("/api/briefing", { method: "GET" })).status === 404);
check("BRF-08", "briefing via bearer works", (await call("/api/briefing", { bearer, body: {} })).status === 200);
// seeded scan: the briefing should surface top items and cap at 3
const item = n => ({ rank: n, symbol: "T" + n, tag: "Supertrend", direction: "LONG", score: 90 - n, confidence: "Low", reason: "r", entry: 10, stop: 9, target_1: 12, currency_symbol: "$", price_decimals: 2 });
// ---------- NEW-2 paywall coverage ----------
const paywalled = { ...baseEnv, PAYWALL_ENABLED: "true" };
for (const path of ["/api/briefing", "/api/learning", "/api/learning/decide", "/api/discover", "/api/holdings/alerts/seen"]) {
  const r = await call(path, { body: {}, e: paywalled });
  check(`PAY-${path}`, `${path} anonymous with paywall on -> 401/402/403`, [401, 402, 403].includes(r.status), `status ${r.status}`);
}

// ---------- NEW-3 learning admin gate ----------
const seedRule = (key, status = "PROPOSED") => sqlite.prepare("INSERT OR REPLACE INTO learning_rules (rule_key, status, penalty, proposed_at, evidence) VALUES (?,?,10,?,?)").run(key, status, new Date().toISOString(), JSON.stringify({ n_flagged: 40 }));
seedRule("WIDE_STOP|DIP");
const decide = (who, body, e = baseEnv) => call("/api/learning/decide", { ...who, body, e });
check("LRN-01", "decide anonymous -> 401/403", [401, 403].includes((await decide({}, { rule_key: "WIDE_STOP|DIP", decision: "approve" })).status));
check("LRN-02", "decide: web user, allow-list unset -> 403 (fail closed)", (await decide({ cookie }, { rule_key: "WIDE_STOP|DIP", decision: "approve" })).status === 403);
check("LRN-03", "decide: web user not on list -> 403", (await decide({ cookie }, { rule_key: "WIDE_STOP|DIP", decision: "approve" }, { ...baseEnv, LEARNING_ADMIN_EMAILS: "boss@example.com" })).status === 403);
check("LRN-04", "decide: allow-list ',,' or blank -> 403", (await decide({ cookie }, { rule_key: "WIDE_STOP|DIP", decision: "approve" }, { ...baseEnv, LEARNING_ADMIN_EMAILS: " , ," })).status === 403);
check("LRN-05", "decide: mobile bearer (no email) -> 403 even if list has entries", (await decide({ bearer }, { rule_key: "WIDE_STOP|DIP", decision: "approve" }, { ...baseEnv, LEARNING_ADMIN_EMAILS: "dev@example.test" })).status === 403);
check("LRN-06", "status unchanged after refused attempts", sqlite.prepare("SELECT status FROM learning_rules WHERE rule_key='WIDE_STOP|DIP'").get().status === "PROPOSED");
const admin = { ...baseEnv, LEARNING_ADMIN_EMAILS: "Other@x.com, DEV@example.test" };
check("LRN-07", "learning report: can_decide true only for admin", (await call("/api/learning", { cookie, body: {}, e: admin })).data.can_decide === true && (await call("/api/learning", { cookie, body: {} })).data.can_decide === false);
check("LRN-08", "decide: bad decision -> 400", (await decide({ cookie }, { rule_key: "WIDE_STOP|DIP", decision: "nuke" }, admin)).status === 400);
check("LRN-09", "decide: malformed key -> 400", (await decide({ cookie }, { rule_key: "x'; DROP TABLE learning_rules;--", decision: "approve" }, admin)).status === 400);
check("LRN-10", "decide: unknown key -> 409", (await decide({ cookie }, { rule_key: "NOPE|DIP", decision: "approve" }, admin)).status === 409);
check("LRN-11", "retire a PROPOSED rule -> 409", (await decide({ cookie }, { rule_key: "WIDE_STOP|DIP", decision: "retire" }, admin)).status === 409);
const ok = await decide({ cookie }, { rule_key: "WIDE_STOP|DIP", decision: "approve" }, admin);
const row = sqlite.prepare("SELECT status, decided_by, decided_at FROM learning_rules WHERE rule_key='WIDE_STOP|DIP'").get();
check("LRN-12", "approve -> ACTIVE with decided_by/at", ok.status === 200 && row.status === "ACTIVE" && /dev@example.test/i.test(row.decided_by) && row.decided_at, JSON.stringify(row));
check("LRN-13", "approve again (already ACTIVE) -> 409", (await decide({ cookie }, { rule_key: "WIDE_STOP|DIP", decision: "approve" }, admin)).status === 409);
check("LRN-14", "reject an ACTIVE rule -> 409 (must retire)", (await decide({ cookie }, { rule_key: "WIDE_STOP|DIP", decision: "reject" }, admin)).status === 409);
check("LRN-15", "retire ACTIVE -> RETIRED", (await decide({ cookie }, { rule_key: "WIDE_STOP|DIP", decision: "retire" }, admin)).status === 200 && sqlite.prepare("SELECT status FROM learning_rules WHERE rule_key='WIDE_STOP|DIP'").get().status === "RETIRED");
check("LRN-16", "cross-site POST with session cookie -> 403", (await worker.fetch(new Request(ORIGIN + "/api/learning/decide", { method: "POST", headers: { cookie, origin: "https://evil.test", "content-type": "application/json" }, body: JSON.stringify({ rule_key: "WIDE_STOP|DIP", decision: "approve" }) }), admin, ctx)).status === 403);

// ---------- NEW-4 learning proposals: noise must not propose; real signal must ----------
const insRec = (i, strategy, ret, features, day) => sqlite.prepare(`INSERT INTO recommendations (id,user_id,symbol,market,action,direction,generated_at,signal_confirmed_at,entry_price,current_price,stop_price,target_1,target_2,confidence,entry_status,daily_adx,horizon_trading_days,status,settled_at,strategy_return_pct,strategy,features)
  VALUES (?, 'system:scanner', ?, 'US','BUY','LONG',?,?,10,10,9,12,13,50,'IN_RANGE',25,5,'SETTLED',?,?,?,?)`).run("r" + i, "S" + i, day, day, day, ret, strategy, JSON.stringify(features));
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const dayOf = i => new Date(Date.UTC(2026, 0, 1 + (i % 60))).toISOString();
for (let i = 0; i < 400; i++) insRec(i, "DIP", (rnd() - 0.5) * 10, { score: 50, stop_pct: rnd() * 14, from_entry_atr: rnd() * 2, alignment: rnd() * 100, age_days: Math.floor(rnd() * 8), direction: "LONG", market_state: "UP", crowded: rnd() < 0.5 }, dayOf(i));
const cronEvent = { cron: "*/15 13-21 * * 1-5", scheduledTime: Date.UTC(2026, 10, 9, 14, 0) };
const runCron = async () => { await worker.scheduled(cronEvent, baseEnv, ctx); await Promise.allSettled(pending.splice(0)); };
sqlite.prepare("DELETE FROM learning_rules").run();
await runCron();
const proposedNoise = sqlite.prepare("SELECT rule_key FROM learning_rules WHERE status='PROPOSED'").all();
check("LRN-20", "pure noise (400 random picks, 6 rules x 3 strategies) proposes nothing", proposedNoise.length === 0, JSON.stringify(proposedNoise));
const rep = (await call("/api/learning", { cookie, body: {} })).data;
check("LRN-21", "learning report available after refresh with calibration + rules", rep.available === true && rep.report.graded_real === 400 && Array.isArray(rep.report.rules), JSON.stringify(rep).slice(0, 200));
// inject a real signal: wide stops lose, consistently across both halves
sqlite.prepare("DELETE FROM recommendations").run();
for (let i = 0; i < 400; i++) { const wide = i % 2 === 0; insRec(i, "DIP", wide ? -3 + (rnd() - 0.5) * 2 : 2 + (rnd() - 0.5) * 2, { score: 50, stop_pct: wide ? 12 : 4, alignment: 80, age_days: 1, from_entry_atr: 0.5, direction: "LONG", market_state: "UP" }, dayOf(i)); }
await runCron();
const proposed = sqlite.prepare("SELECT rule_key, status FROM learning_rules").all();
check("LRN-22", "real signal (wide stops lose) proposes WIDE_STOP|DIP as PROPOSED only", proposed.some(r => r.rule_key === "WIDE_STOP|DIP" && r.status === "PROPOSED") && proposed.every(r => r.status === "PROPOSED"), JSON.stringify(proposed));
check("LRN-23", "refresh never auto-activates a rule", !proposed.some(r => r.status === "ACTIVE"));
await runCron();
check("LRN-24", "rerun is idempotent (no duplicate rows)", sqlite.prepare("SELECT COUNT(*) n FROM learning_rules WHERE rule_key='WIDE_STOP|DIP'").get().n === 1);
sqlite.prepare("UPDATE learning_rules SET status='REJECTED' WHERE rule_key='WIDE_STOP|DIP'").run();
await runCron();
check("LRN-25", "a REJECTED rule is not re-proposed by the next refresh", sqlite.prepare("SELECT status FROM learning_rules WHERE rule_key='WIDE_STOP|DIP'").get().status === "REJECTED");
sqlite.prepare("UPDATE recommendations SET features = NULL WHERE rowid % 7 = 0").run();
await runCron();
check("LRN-26", "rows with NULL features do not break the refresh", (await call("/api/learning", { cookie, body: {} })).data.available === true);

// ---------- NEW-5 alerts seen: isolation + id validation ----------
const t = new Date().toISOString();
const alert = (id, user, key) => sqlite.prepare("INSERT INTO holding_alerts (id,user_id,holding_id,symbol,at,kind,severity,title,detail,dedupe_key) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, user, "h-" + id, "AAA", t, "WATCH", "info", "t", "d", key);
await call("/api/holdings/add", { cookie, body: { symbol: "AAPL", shares: 1, price: 100 } }).catch(() => {});
const me = sqlite.prepare("SELECT user_id FROM web_sessions LIMIT 1").get().user_id;
alert("mine-0001-aaaa", me, "k1"); alert("mine-0002-aaaa", me, "k2"); alert("their-0001-aaa", "other-user", "k3");
const unseen = id => sqlite.prepare("SELECT seen_at FROM holding_alerts WHERE id=?").get(id).seen_at === null;
await call("/api/holdings/alerts/seen", { cookie, body: { ids: ["their-0001-aaa"] } });
check("ALR-01", "marking another user's alert id does nothing to it", unseen("their-0001-aaa"));
await call("/api/holdings/alerts/seen", { cookie, body: { ids: ["mine-0001-aaaa", "bad id!", "x"] } });
check("ALR-02", "named alert marked seen; invalid ids ignored; unnamed stays unseen", !unseen("mine-0001-aaaa") && unseen("mine-0002-aaaa"));
await call("/api/holdings/alerts/seen", { cookie, body: { ids: [] } });
check("ALR-03", "empty ids list marks nothing", unseen("mine-0002-aaaa"));
await call("/api/holdings/alerts/seen", { cookie, body: { ids: "x" } });
check("ALR-04", "non-array ids behaves as legacy 'mark all' for own alerts only", !unseen("mine-0002-aaaa") && unseen("their-0001-aaa"));
check("ALR-05", "alerts/seen anonymous -> 401", (await call("/api/holdings/alerts/seen", { body: {} })).status === 401);
check("ALR-06", "100 ids does not 500", (await call("/api/holdings/alerts/seen", { cookie, body: { ids: Array.from({ length: 100 }, (_, i) => "id-" + String(i).padStart(8, "0")) } })).status === 200);
const dupe = () => { try { alert("dupe-0001-aaaa", me, "k1"); return false; } catch { return true; } };
check("ALR-07", "dedupe_key unique index blocks duplicate alert rows", dupe());

// ---------- NEW-6 account deletion completeness + isolation ----------
const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'").all().map(r => r.name);
const userCol = tables.filter(n => sqlite.prepare(`PRAGMA table_info(${n})`).all().some(c => c.name === "user_id"));
await call("/api/holdings/add", { cookie, body: { symbol: "AAPL", shares: 1, price: 100 } }).catch(() => {});
sqlite.prepare("INSERT INTO holdings (id,user_id,symbol,market,shares,buy_price,bought_at,created_at) VALUES ('oh1','other-user','MSFT','US',1,1,'2024-01-01',?)").run(t);
sqlite.prepare("INSERT INTO holding_level_events (id,holding_id,user_id,symbol,at,kind,reason) VALUES ('lv1','h1',?, 'AAA', ?, 'INITIAL','x')").run(me, t);
sqlite.prepare("INSERT INTO holding_level_events (id,holding_id,user_id,symbol,at,kind,reason) VALUES ('lv2','oh1','other-user','MSFT', ?, 'INITIAL','x')").run(t);
const rulesBefore = sqlite.prepare("SELECT COUNT(*) n FROM learning_rules").get().n;
const del = await call("/api/mobile/account/delete", { bearer, body: {} });
check("DEL-10", "account delete via bearer -> 200", del.status === 200 && del.data.deleted === true, JSON.stringify(del));
const leftovers = userCol.map(n => [n, sqlite.prepare(`SELECT COUNT(*) n FROM ${n} WHERE user_id = ?`).get(me).n]).filter(([, n]) => n > 0);
check("DEL-11", "no row with the deleted user's id remains in ANY user_id table", leftovers.length === 0, `tables checked: ${userCol.join(",")}; leftovers: ${JSON.stringify(leftovers)}`);
check("DEL-12", "other user's holdings, alerts, level events untouched", sqlite.prepare("SELECT COUNT(*) n FROM holdings WHERE user_id='other-user'").get().n === 1 && sqlite.prepare("SELECT COUNT(*) n FROM holding_alerts WHERE user_id='other-user'").get().n === 1 && sqlite.prepare("SELECT COUNT(*) n FROM holding_level_events WHERE user_id='other-user'").get().n === 1);
check("DEL-13", "shared learning rules and scanner picks survive user deletion", sqlite.prepare("SELECT COUNT(*) n FROM learning_rules").get().n === rulesBefore && sqlite.prepare("SELECT COUNT(*) n FROM recommendations WHERE user_id='system:scanner'").get().n > 0);
check("DEL-14", "deleted user's bearer is dead", (await call("/api/holdings", { bearer, body: {} })).status === 401);
const personal = tables.filter(n => !userCol.includes(n));
console.log(`  info: tables without user_id column (not covered by per-user delete): ${personal.join(", ")}`);

// ---------- NEW-7 method/route matrix for new routes ----------
for (const path of ["/api/briefing", "/api/learning", "/api/learning/decide", "/api/holdings/alerts/seen"]) for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
  const r = await call(path, { method, cookie });
  check(`MTH-${method}${path}`, `${method} ${path} -> 404/405`, [404, 405].includes(r.status), `status ${r.status}`);
}

// ---------- NEW-8 position monitor + alerts (cron path) ----------
sqlite.prepare("DELETE FROM holdings").run(); sqlite.prepare("DELETE FROM holding_alerts").run();
const mkSnap = (symbol, price, o = {}) => ({ symbol, market: "US", price, previous_close: price, atr_14: o.atr ?? price * 0.02, market_time: new Date().toISOString(),
  supertrend: { direction: o.t4 ?? "LONG", value: price * 0.95 }, daily_supertrend: o.noDaily ? undefined : { direction: o.td ?? "LONG", value: o.line ?? price * 0.93 },
  daily_adx: { value: o.adx ?? 30, rising: true }, sma_20: price * 0.98, data_complete: o.complete ?? true });
const seedHold = snaps => sqlite.prepare("INSERT OR REPLACE INTO scan_cache (market, payload, generated_at, refreshing_until) VALUES ('HOLD:US', ?, ?, NULL)").run(JSON.stringify({ snapshots: Object.fromEntries(snaps.map(s => [s.symbol, s])), errors: [] }), new Date().toISOString());
const addH = (id, sym, last) => sqlite.prepare("INSERT INTO holdings (id,user_id,symbol,market,shares,buy_price,bought_at,created_at,last_action,last_action_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, me, sym, "US", 10, 100, "2026-10-01", t, last, t);
const alertsFor = sym => sqlite.prepare("SELECT kind FROM holding_alerts WHERE symbol=?").all(sym).map(r => r.kind);
const usCron = async () => { await worker.scheduled({ cron: "*/15 13-21 * * 1-5", scheduledTime: Date.UTC(2026, 10, 9, 14, 20) }, baseEnv, ctx); await Promise.allSettled(pending.splice(0)); };
addH("m-ok", "OKAY", "HOLD"); addH("m-exit", "FLIP", "HOLD"); addH("m-gone", "GONE", "HOLD"); addH("m-first", "FIRST", null); addH("m-bad", "BADD", "HOLD"); addH("m-nodaily", "NODAILY", "HOLD"); addH("m-incomplete", "INCOMP", "HOLD"); addH("m-zero", "ZEROP", "HOLD");
seedHold([mkSnap("OKAY", 110), mkSnap("FLIP", 110, { td: "SHORT" }), mkSnap("FIRST", 110, { td: "SHORT" }), mkSnap("BADD", NaN), mkSnap("NODAILY", 110, { noDaily: true }), mkSnap("INCOMP", 110, { complete: false, td: "SHORT" }), mkSnap("ZEROP", 0)]);
await usCron();
check("MON-01", "healthy holding generates no alert", alertsFor("OKAY").length === 0, JSON.stringify(alertsFor("OKAY")));
check("MON-02", "HOLD -> EXIT (daily trend down) creates exactly one EXIT alert", alertsFor("FLIP").filter(k => k === "EXIT").length === 1, JSON.stringify(alertsFor("FLIP")));
check("MON-03", "holding with no snapshot is skipped without crash or alert", alertsFor("GONE").length === 0);
check("MON-04", "first-ever read (last_action null) sets state but does not alert", alertsFor("FIRST").length === 0 && sqlite.prepare("SELECT last_action FROM holdings WHERE id='m-first'").get().last_action === "EXIT");
await usCron();
check("MON-05", "second run with same state creates no duplicate alert", alertsFor("FLIP").length === 1);
check("MON-06", "one bad row (NaN price) does not stop others being processed", alertsFor("FLIP").length === 1);
check("MON-07", "NaN/zero price snapshot does not raise a false EXIT alert", !alertsFor("BADD").includes("EXIT") && !alertsFor("ZEROP").includes("EXIT"), `BADD ${JSON.stringify(alertsFor("BADD"))} ZEROP ${JSON.stringify(alertsFor("ZEROP"))}`);
console.log(`  observation (hardening, not counted): snapshot missing daily Supertrend -> alerts ${JSON.stringify(alertsFor("NODAILY"))}; data_complete=false -> alerts ${JSON.stringify(alertsFor("INCOMP"))}. snapshotFromPayload throws on thin history, so live data cannot hit this today.`);
const stopOf = id => sqlite.prepare("SELECT stop_level FROM holdings WHERE id=?").get(id).stop_level;
const s1 = stopOf("m-ok");
seedHold([mkSnap("OKAY", 108, { line: 80 })]); await usCron();
check("MON-10", "protective level never moves down when the line falls", stopOf("m-ok") >= s1, `${s1} -> ${stopOf("m-ok")}`);
const before = alertsFor("OKAY").filter(k => k === "STOP_RAISED").length;
seedHold([mkSnap("OKAY", 150, { line: 140 })]); await usCron();
check("MON-11", "raised line creates a STOP_RAISED alert and raises the stop", alertsFor("OKAY").filter(k => k === "STOP_RAISED").length === before + 1 && stopOf("m-ok") >= 140, `${alertsFor("OKAY")} stop ${stopOf("m-ok")}`);
sqlite.prepare("UPDATE holdings SET closed_at=? WHERE id='m-exit'").run(t);
const n0 = sqlite.prepare("SELECT COUNT(*) n FROM holding_alerts").get().n;
seedHold([mkSnap("FLIP", 110, { td: "LONG" })]); await usCron();
check("MON-12", "closed holding is no longer monitored (no new alert)", sqlite.prepare("SELECT COUNT(*) n FROM holding_alerts WHERE symbol='FLIP'").get().n === 1);
const lv = sqlite.prepare("SELECT COUNT(*) n FROM holding_level_events WHERE holding_id='m-ok'").get().n;
check("MON-13", "level events recorded for the monitored holding", lv >= 1, `events ${lv}`);
const cookie2 = (await worker.fetch(new Request(ORIGIN + "/auth/dev"), baseEnv, ctx)).headers.get("set-cookie").split(";")[0];
const hl = await call("/api/holdings", { cookie: cookie2, body: {} });
check("MON-14", "/api/holdings exposes alerts block", hl.status === 200 && hl.data.alerts && typeof hl.data.alerts.unseen === "number", JSON.stringify(hl.data.alerts)?.slice(0, 150));

// ---------- NEW-9 dashboard chart scale must ignore non-numeric level fields (live bug: levels.exit_kind is a string -> NaN axis, blank chart) ----------
const dash = await readFile(resolve(root, "engine/portfolio_intel/dashboard.html"), "utf8");
check("UI-01", "renderChart filters non-finite values out of chart.levels before computing the price scale", /Object\.values\(levels\)\.map\(Number\)\.filter\(Number\.isFinite\)/.test(dash));
const built = await readFile(resolve(root, "dist/server/index.js"), "utf8");
check("UI-02", "built worker bundle contains the same fix", /Object\.values\(levels\)\.map\(Number\)\.filter\(Number\.isFinite\)/.test(built.replace(/\\\\/g, "\\")), "run build-site.mjs first");

const failed = results.filter(r => !r.ok);
console.log(`New-feature harness: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
