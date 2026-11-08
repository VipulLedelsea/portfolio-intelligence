const ROBINHOOD_HISTORICALS = "https://api.robinhood.com/quotes/historicals/";
const ROBINHOOD_QUOTES = "https://api.robinhood.com/quotes/";
const ROBINHOOD_FUNDAMENTALS = "https://api.robinhood.com/fundamentals/";
const ROBINHOOD_EARNINGS = "https://api.robinhood.com/marketdata/earnings/";
const SP500_SOURCE = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv";
const STRIPE_API = "https://api.stripe.com/v1";
const SUBSCRIPTION_PRICE_CENTS = 1499;
const SCAN_CACHE_SECONDS = 300;
const ANALYSIS_CACHE_SECONDS = 90;
// A setup stays on the main list while the price is still close to its buy point, however many days old it is. It moves to Recent setups when the
// price runs away (EXTENDED), falls back through the buy point (WEAKENING), or the daily trend or its strength fails. Age alone no longer removes it:
// before this a setup was dropped after about a day. Tests on Supertrend entries (research/pattern-backtest/README.md, ml_st_age.py) found setups up
// to 30 days old that were still within half an ATR of the original buy point earned about +0.9% to +1.5% per trade, close to fresh flips, while
// setups that had already run past it earned about +0.6% to +0.7%. This limit (4-hour bars, about 2 per day, so about 20 trading days) only stops
// ancient signals from being listed.
const MAX_ENTRY_AGE_BARS = 40;
const MAX_ENTRY_EXTENSION_ATR = 0.5;
const MAX_ADVERSE_EXTENSION_ATR = 0.75;
const MOBILE_PAIRING_MINUTES = 10;
const MOBILE_SESSION_DAYS = 90;
const WEB_SESSION_DAYS = 30;
const SESSION_COOKIE = "ip_session";
const OAUTH_STATE_COOKIE = "ip_oauth_state";
// Refresh schedule for the whole system. Nothing is refreshed by hand: every scan is produced by the cron jobs (wrangler.toml), and a
// request only reads the stored result. A US scan takes about 15 to 45 seconds and about 25 outgoing requests (the free plan allows
// 50 per run), so US is scanned every 15 minutes while the market is open, at most once an hour for BSE and forex, and rarely when closed.
// The scan lock lasts 4 minutes, longer than any scan, so two scans never overlap. Holdings are re-checked on the same 15-minute beat
// and the AI ranking at most every 30 minutes, in its own hourly job so it can never delay a scan.
const AUTO_REFRESH_OPEN_SECONDS = 55 * 60;
const US_REFRESH_OPEN_SECONDS = 15 * 60;
const AUTO_REFRESH_CLOSED_SECONDS = 6 * 60 * 60;
const AUTO_REFRESH_LOCK_SECONDS = 4 * 60;
const AUTO_REFRESH_BACKOFF_SECONDS = 15 * 60;
const AI_RANKING_MIN_GAP_SECONDS = 30 * 60;
const MEMORY_SETTLE_MIN_GAP_SECONDS = 30 * 60;
const EXTERNAL_ANALYSIS_CACHE_SECONDS = 15 * 60;
const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/";
const TWELVE_DATA = "https://api.twelvedata.com/time_series";

const SENSEX_30 = [
  ["ADANIPORTS", "Adani Ports & SEZ", "Industrials"], ["ASIANPAINT", "Asian Paints", "Materials"],
  ["AXISBANK", "Axis Bank", "Financials"], ["BAJAJ-AUTO", "Bajaj Auto", "Consumer Discretionary"],
  ["BAJFINANCE", "Bajaj Finance", "Financials"], ["BAJAJFINSV", "Bajaj Finserv", "Financials"],
  ["BHARTIARTL", "Bharti Airtel", "Communication Services"], ["ETERNAL", "Eternal", "Consumer Discretionary"],
  ["HCLTECH", "HCL Technologies", "Information Technology"], ["HDFCBANK", "HDFC Bank", "Financials"],
  ["HINDUNILVR", "Hindustan Unilever", "Consumer Staples"], ["ICICIBANK", "ICICI Bank", "Financials"],
  ["INFY", "Infosys", "Information Technology"], ["ITC", "ITC", "Consumer Staples"],
  ["KOTAKBANK", "Kotak Mahindra Bank", "Financials"], ["LT", "Larsen & Toubro", "Industrials"],
  ["M&M", "Mahindra & Mahindra", "Consumer Discretionary"], ["MARUTI", "Maruti Suzuki", "Consumer Discretionary"],
  ["NESTLEIND", "Nestle India", "Consumer Staples"], ["NTPC", "NTPC", "Utilities"],
  ["ONGC", "Oil & Natural Gas Corp", "Energy"], ["POWERGRID", "Power Grid Corp", "Utilities"],
  ["RELIANCE", "Reliance Industries", "Energy"], ["SBIN", "State Bank of India", "Financials"],
  ["SUNPHARMA", "Sun Pharmaceutical", "Health Care"], ["TMPV", "Tata Motors Passenger Vehicles", "Consumer Discretionary"],
  ["TATASTEEL", "Tata Steel", "Materials"], ["TCS", "Tata Consultancy Services", "Information Technology"],
  ["TECHM", "Tech Mahindra", "Information Technology"], ["TITAN", "Titan Company", "Consumer Discretionary"],
].map(([symbol, company, sector]) => ({ symbol, company, sector }));

const FOREX_PAIRS = [
  ...["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD"].map(symbol => ({ symbol, company: `${symbol.slice(0, 3)}/${symbol.slice(3)}`, sector: "Forex major" })),
  ...["EURGBP", "EURJPY", "GBPJPY", "AUDJPY", "EURCHF", "EURAUD"].map(symbol => ({ symbol, company: `${symbol.slice(0, 3)}/${symbol.slice(3)}`, sector: "Forex cross" })),
];

const MARKETS = {
  US: { id: "US", name: "S&P 500", label: "US stocks", provider: "robinhood", auto: true, tz: "America/New_York", dailyCloseMinutes: 16 * 60, currency: "USD", symbolPrefix: "$", decimals: () => 2 },
  IN: { id: "IN", name: "Sensex 30", label: "India (BSE)", provider: "external", auto: true, tz: "Asia/Kolkata", dailyCloseMinutes: 15 * 60 + 35, currency: "INR", symbolPrefix: "₹", decimals: () => 2, universe: SENSEX_30, yahoo: symbol => symbol.startsWith("^") ? symbol : `${symbol}.BO`, twelve: symbol => symbol, twelveExchange: "BSE", tradingView: symbol => `BSE:${symbol.replace(/[^A-Z0-9_-]/g, "_")}` },
  FX: { id: "FX", name: "Major forex pairs", label: "Forex", provider: "external", auto: true, tz: "UTC", dailyCloseMinutes: Infinity, currency: "", symbolPrefix: "", decimals: value => value >= 20 ? 3 : 5, universe: FOREX_PAIRS, yahoo: symbol => symbol.includes("-") ? symbol : `${symbol}=X`, twelve: symbol => `${symbol.slice(0, 3)}/${symbol.slice(3)}`, tradingView: symbol => `FX:${symbol}` },
};

function marketFrom(body) {
  const id = String(body?.market || "US").toUpperCase();
  const market = MARKETS[id];
  if (!market) throw Object.assign(new Error("Unknown market"), { status: 400 });
  return market;
}

function fmtPrice(value, market = MARKETS.US) {
  const number = Number(value);
  return `${market.symbolPrefix}${(Number.isFinite(number) ? number : 0).toFixed(market.decimals(number))}`;
}

const openFormatters = new Map();
function marketIsOpen(market, now = new Date()) {
  const openTz = market.tz === "UTC" ? "America/New_York" : market.tz;
  let openFormat = openFormatters.get(openTz);
  if (!openFormat) { openFormat = new Intl.DateTimeFormat("en-US", { timeZone: openTz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); openFormatters.set(openTz, openFormat); }
  const parts = Object.fromEntries(openFormat.formatToParts(now).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = parts.weekday;
  if (market.id === "FX") {
    if (weekday === "Sat") return false;
    if (weekday === "Sun") return minutes >= 17 * 60;
    if (weekday === "Fri") return minutes < 17 * 60;
    return true;
  }
  if (weekday === "Sat" || weekday === "Sun") return false;
  return minutes >= 9 * 60 && minutes <= 16 * 60 + 30;
}

let discoveryInFlight = null;
const analysisInFlight = new Map();
const memoryCache = new Map();
const accessCache = new Map();

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const round = (value, digits = 3) => Number(Number(value).toFixed(digits));
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const numeric = value => Number.isFinite(Number(value)) ? Number(value) : 0;

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

function cleanError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/[^\s]+/g, "market-data service").slice(0, 300);
}

function parseCookies(request) {
  const cookies = new Map();
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return cookies;
}

function cookieHeader(request, name, value, { path = "/", maxAge } = {}) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax${secure}${maxAge === undefined ? "" : `; Max-Age=${maxAge}`}`;
}

// Browser identity. Behind OpenAI Sites the platform injects trusted headers; anywhere else
// those headers can be forged by any client, so they are only honored when AUTH_MODE is "oai".
async function authenticatedUser(request, env) {
  if (env?.AUTH_MODE === "oai") {
    const id = request.headers.get("oai-authenticated-user-id");
    const email = request.headers.get("oai-authenticated-user-email");
    return id && email ? { id, email } : null;
  }
  const token = parseCookies(request).get(SESSION_COOKIE);
  if (!token || !env?.DB || !/^[A-Za-z0-9_-]{40,}$/.test(token)) return null;
  const row = await env.DB.prepare("SELECT user_id, email, expires_at FROM web_sessions WHERE token_hash = ? LIMIT 1").bind(await sha256(token)).first();
  if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
  return { id: row.user_id, email: row.email };
}

function redirect(location, headers = []) {
  const response = new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });
  for (const value of headers) response.headers.append("set-cookie", value);
  return response;
}

async function createWebSession(request, env, user) {
  const token = randomBase64Url(36);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + WEB_SESSION_DAYS * 24 * 60 * 60 * 1000);
  await env.DB.prepare("DELETE FROM web_sessions WHERE expires_at <= ?").bind(now.toISOString()).run();
  await env.DB.prepare("INSERT INTO web_sessions (token_hash, user_id, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256(token), user.id, user.email, now.toISOString(), expiresAt.toISOString()).run();
  return cookieHeader(request, SESSION_COOKIE, token, { maxAge: WEB_SESSION_DAYS * 24 * 60 * 60 });
}

function googleRedirectUri(request) { return `${new URL(request.url).origin}/auth/google/callback`; }

async function startGoogleSignIn(request, env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw Object.assign(new Error("Sign-in is not configured yet"), { status: 503 });
  const state = randomBase64Url(24);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: googleRedirectUri(request), response_type: "code",
    scope: "openid email", state, prompt: "select_account",
  });
  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, [cookieHeader(request, OAUTH_STATE_COOKIE, state, { path: "/auth", maxAge: 600 })]);
}

async function finishGoogleSignIn(request, env) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const expected = parseCookies(request).get(OAUTH_STATE_COOKIE) || "";
  const clearState = cookieHeader(request, OAUTH_STATE_COOKIE, "", { path: "/auth", maxAge: 0 });
  if (!state || state !== expected) return redirect("/?signin=failed", [clearState]);
  const code = url.searchParams.get("code");
  if (!code) return redirect("/?signin=cancelled", [clearState]);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: googleRedirectUri(request), grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(15000),
  });
  const tokens = await response.json().catch(() => ({}));
  if (!response.ok || !tokens.id_token) return redirect("/?signin=failed", [clearState]);
  // The ID token came straight from Google's token endpoint over TLS, so its claims are trusted after these checks.
  const claims = JSON.parse(atob(tokens.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  const issuerOk = ["https://accounts.google.com", "accounts.google.com"].includes(claims.iss);
  if (!issuerOk || claims.aud !== env.GOOGLE_CLIENT_ID || Number(claims.exp) * 1000 <= Date.now() || !claims.sub || !claims.email || claims.email_verified !== true) {
    return redirect("/?signin=failed", [clearState]);
  }
  const sessionCookie = await createWebSession(request, env, { id: `google:${claims.sub}`, email: String(claims.email).toLowerCase() });
  return redirect("/", [clearState, sessionCookie]);
}

async function devSignIn(request, env) {
  if (env.AUTH_MODE !== "dev" || !env.DB) return json({ error: "Not found" }, 404);
  const sessionCookie = await createWebSession(request, env, { id: "dev-user", email: "dev@example.test" });
  return redirect("/", [sessionCookie]);
}

async function signOut(request, env) {
  const token = parseCookies(request).get(SESSION_COOKIE);
  if (token && env.DB) await env.DB.prepare("DELETE FROM web_sessions WHERE token_hash = ?").bind(await sha256(token)).run().catch(() => {});
  return json({ signed_out: true }, 200, { "set-cookie": cookieHeader(request, SESSION_COOKIE, "", { maxAge: 0 }) });
}

function randomBase64Url(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomPairingCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map(byte => alphabet[byte % alphabet.length]).join("");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function mobileBearer(request) {
  const match = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{40,})$/);
  return match?.[1] || null;
}

async function requestUser(request, env) {
  const browserUser = await authenticatedUser(request, env);
  if (browserUser) return { ...browserUser, auth_type: "web" };
  const token = mobileBearer(request);
  if (!token || !env.DB) return null;
  const tokenHash = await sha256(token);
  const session = await env.DB.prepare(`SELECT user_id, expires_at FROM mobile_sessions
    WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1`).bind(tokenHash).first();
  if (!session || Date.parse(session.expires_at) <= Date.now()) return null;
  return { id: session.user_id, email: null, auth_type: "mobile" };
}

async function stripeRequest(env, path, { method = "GET", params = null } = {}) {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe billing is not configured yet");
  const response = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(params ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: params ? new URLSearchParams(params) : null,
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Stripe returned HTTP ${response.status}`);
  return payload;
}

async function findStripeCustomer(env, userId) {
  const safeUserId = userId.replace(/[\\']/g, "");
  const query = encodeURIComponent(`metadata['site_user_id']:'${safeUserId}'`);
  const payload = await stripeRequest(env, `/customers/search?query=${query}&limit=1`);
  return payload.data?.[0] || null;
}

async function findStripeCustomerForUser(env, user) {
  const byId = await findStripeCustomer(env, user.id);
  if (byId || !user.email) return byId;
  // Subscriptions created under a previous sign-in provider are matched by verified email.
  const safeEmail = user.email.replace(/[\\']/g, "");
  const payload = await stripeRequest(env, `/customers/search?query=${encodeURIComponent(`email:'${safeEmail}'`)}&limit=1`);
  return payload.data?.[0] || null;
}

async function createStripeCustomer(env, user) {
  return stripeRequest(env, "/customers", {
    method: "POST",
    params: { email: user.email, "metadata[site_user_id]": user.id, description: "IntelligentPortfolio subscriber" },
  });
}

async function activeStripeSubscription(env, customerId) {
  const payload = await stripeRequest(env, `/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=20`);
  return (payload.data || []).find(subscription => ["active", "trialing"].includes(subscription.status)) || null;
}

async function subscriptionAccess(request, env, { force = false } = {}) {
  const enabled = env.PAYWALL_ENABLED === "true";
  const user = await requestUser(request, env);
  if (!enabled) return { paywall_enabled: false, configured: Boolean(env.STRIPE_SECRET_KEY), signed_in: Boolean(user), subscribed: true, auth_type: user?.auth_type || null };
  if (!env.STRIPE_SECRET_KEY) return { paywall_enabled: true, configured: false, signed_in: Boolean(user), subscribed: false, auth_type: user?.auth_type || null };
  if (!user) return { paywall_enabled: true, configured: true, signed_in: false, subscribed: false };
  const accessCacheKey = `${user.id}:${user.auth_type}`;
  const cached = accessCache.get(accessCacheKey);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value;
  const customer = await findStripeCustomerForUser(env, user);
  const subscription = customer ? await activeStripeSubscription(env, customer.id) : null;
  const value = {
    paywall_enabled: true,
    configured: true,
    signed_in: true,
    subscribed: Boolean(subscription),
    email: user.email,
    customer_id: customer?.id || null,
    subscription_status: subscription?.status || null,
    renews_at: subscription?.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
    auth_type: user.auth_type,
  };
  accessCache.set(accessCacheKey, { value, expiresAt: Date.now() + 2 * 60 * 1000 });
  return value;
}

async function subscriptionAccessFromCheckout(request, env, sessionId) {
  const user = await authenticatedUser(request, env);
  if (!user) throw Object.assign(new Error("Sign in to verify checkout"), { status: 401 });
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) throw Object.assign(new Error("Invalid Stripe checkout session"), { status: 400 });
  const session = await stripeRequest(env, `/checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (session.client_reference_id !== user.id) throw Object.assign(new Error("This checkout belongs to another account"), { status: 403 });
  if (session.status !== "complete" || !session.subscription) throw Object.assign(new Error("Stripe checkout is not complete"), { status: 402 });
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  const subscription = await stripeRequest(env, `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  const subscribed = ["active", "trialing"].includes(subscription.status);
  const value = {
    paywall_enabled: true,
    configured: true,
    signed_in: true,
    subscribed,
    email: user.email,
    customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id,
    subscription_status: subscription.status,
    renews_at: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
    auth_type: "web",
  };
  accessCache.set(`${user.id}:web`, { value, expiresAt: Date.now() + 2 * 60 * 1000 });
  return value;
}

async function requireSubscription(request, env) {
  const access = await subscriptionAccess(request, env);
  if (!access.paywall_enabled || access.subscribed) return access;
  const message = access.signed_in ? "An active IntelligentPortfolio subscription is required" : "Sign in to continue";
  throw Object.assign(new Error(message), { status: 402 });
}

async function createCheckout(request, env) {
  if (env.PAYWALL_ENABLED !== "true") throw new Error("The subscription paywall is not enabled yet");
  const user = await authenticatedUser(request, env);
  if (!user) throw Object.assign(new Error("Sign in before subscribing"), { status: 401 });
  const current = await subscriptionAccess(request, env, { force: true });
  if (current.subscribed) throw new Error("This account already has an active subscription");
  const customer = await findStripeCustomerForUser(env, user) || await createStripeCustomer(env, user);
  const origin = new URL(request.url).origin;
  return stripeRequest(env, "/checkout/sessions", {
    method: "POST",
    params: {
      mode: "subscription",
      customer: customer.id,
      client_reference_id: user.id,
      success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=cancelled`,
      allow_promotion_codes: "true",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(SUBSCRIPTION_PRICE_CENTS),
      "line_items[0][price_data][recurring][interval]": "month",
      "line_items[0][price_data][product_data][name]": "IntelligentPortfolio Pro",
      "subscription_data[metadata][site_user_id]": user.id,
    },
  });
}

async function createBillingPortal(request, env) {
  const access = await subscriptionAccess(request, env, { force: true });
  if (!access.subscribed || !access.customer_id) throw Object.assign(new Error("An active subscription is required"), { status: 402 });
  return stripeRequest(env, "/billing_portal/sessions", {
    method: "POST",
    params: { customer: access.customer_id, return_url: new URL(request.url).origin },
  });
}

function cleanDeviceName(value) {
  return String(value || "iPhone").replace(/[^A-Za-z0-9 ._'-]/g, "").trim().slice(0, 60) || "iPhone";
}

const MAX_PAIRINGS_PER_MINUTE = 30;

async function startMobilePairing(env, body) {
  if (!env.DB) throw new Error("Mobile pairing is not configured yet");
  const code = randomPairingCode();
  const pairingSecret = randomBase64Url();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MOBILE_PAIRING_MINUTES * 60 * 1000);
  await env.DB.prepare("DELETE FROM mobile_pairings WHERE expires_at <= ?").bind(now.toISOString()).run();
  // A shared ceiling on new pairing codes, so the open endpoint cannot be used to flood the database.
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM mobile_pairings WHERE created_at > ?").bind(new Date(now.getTime() - 60000).toISOString()).first();
  if (Number(recent?.n || 0) >= MAX_PAIRINGS_PER_MINUTE) throw Object.assign(new Error("Too many pairing requests right now. Try again in a minute."), { status: 429 });
  await env.DB.prepare(`INSERT INTO mobile_pairings
    (code_hash, secret_hash, device_name, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)`).bind(
    await sha256(code), await sha256(pairingSecret), cleanDeviceName(body.device_name), now.toISOString(), expiresAt.toISOString(),
  ).run();
  return { code, pairing_secret: pairingSecret, expires_at: expiresAt.toISOString(), poll_after_seconds: 2 };
}

async function approveMobilePairing(request, env, body) {
  const user = await authenticatedUser(request, env);
  if (!user) throw Object.assign(new Error("Sign in to pair an iPhone"), { status: 401 });
  await requireSubscription(request, env);
  const code = String(body.code || "").trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) throw Object.assign(new Error("Enter the 8-character code shown on the iPhone"), { status: 400 });
  const now = new Date().toISOString();
  const codeHash = await sha256(code);
  const pairing = await env.DB.prepare(`SELECT expires_at, user_id, claimed_at FROM mobile_pairings
    WHERE code_hash = ? LIMIT 1`).bind(codeHash).first();
  if (!pairing || Date.parse(pairing.expires_at) <= Date.now()) throw Object.assign(new Error("That pairing code expired. Start again from the iPhone app."), { status: 410 });
  if (pairing.claimed_at) throw Object.assign(new Error("That pairing code has already been used"), { status: 409 });
  if (pairing.user_id && pairing.user_id !== user.id) throw Object.assign(new Error("That pairing code belongs to another account"), { status: 409 });
  await env.DB.prepare(`UPDATE mobile_pairings SET user_id = ?, approved_at = ?
    WHERE code_hash = ? AND user_id IS NULL`).bind(user.id, now, codeHash).run();
  return { approved: true, expires_at: pairing.expires_at };
}

async function mobilePairingStatus(env, body) {
  if (!env.DB) throw new Error("Mobile pairing is not configured yet");
  const code = String(body.code || "").trim().toUpperCase();
  const pairingSecret = String(body.pairing_secret || "");
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code) || !/^[A-Za-z0-9_-]{40,}$/.test(pairingSecret)) {
    throw Object.assign(new Error("Invalid pairing request"), { status: 400 });
  }
  const codeHash = await sha256(code);
  const pairing = await env.DB.prepare(`SELECT secret_hash, device_name, expires_at, user_id, approved_at, claimed_at
    FROM mobile_pairings WHERE code_hash = ? LIMIT 1`).bind(codeHash).first();
  if (!pairing || pairing.secret_hash !== await sha256(pairingSecret)) throw Object.assign(new Error("Pairing request not found"), { status: 404 });
  if (Date.parse(pairing.expires_at) <= Date.now()) throw Object.assign(new Error("Pairing code expired"), { status: 410 });
  if (!pairing.user_id || !pairing.approved_at) return { approved: false, expires_at: pairing.expires_at };
  if (pairing.claimed_at) throw Object.assign(new Error("Pairing code has already been claimed"), { status: 409 });
  const token = randomBase64Url(36);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MOBILE_SESSION_DAYS * 24 * 60 * 60 * 1000);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO mobile_sessions
      (token_hash, user_id, device_name, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`).bind(
      await sha256(token), pairing.user_id, pairing.device_name, now.toISOString(), expiresAt.toISOString(),
    ),
    env.DB.prepare("UPDATE mobile_pairings SET claimed_at = ? WHERE code_hash = ? AND claimed_at IS NULL").bind(now.toISOString(), codeHash),
  ]);
  return { approved: true, token, expires_at: expiresAt.toISOString() };
}

async function revokeMobileSession(request, env) {
  const token = mobileBearer(request);
  if (!token || !env.DB) throw Object.assign(new Error("Mobile session not found"), { status: 401 });
  await env.DB.prepare("UPDATE mobile_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), await sha256(token)).run();
  return { revoked: true };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "PortfolioIntelligence/1.0" },
    signal: AbortSignal.timeout(28000),
  });
  if (!response.ok) throw new Error(`Market data returned HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload || typeof payload !== "object") throw new Error("Market data returned an unexpected response");
  return payload;
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field); field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some(value => value.length)) rows.push(row);
      row = [];
    } else field += character;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map(value => value.replace(/^\uFEFF/, "").trim());
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

async function loadUniverse() {
  const response = await fetch(SP500_SOURCE, {
    headers: { accept: "text/csv", "user-agent": "PortfolioIntelligence/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`S&P 500 list returned HTTP ${response.status}`);
  const records = parseCsv(await response.text()).map(row => ({
    symbol: String(row.Symbol || "").trim().toUpperCase(),
    company: String(row.Security || row.Symbol || "").trim(),
    sector: String(row["GICS Sector"] || "Unknown").trim(),
  })).filter(row => row.symbol);
  if (records.length < 450) throw new Error(`S&P 500 list returned only ${records.length} securities`);
  return records;
}

// Building an Intl.DateTimeFormat is one of the most expensive things a request can do (the first one in a fresh
// Worker loads the locale data), so each kind is built once per time zone and reused.
const clockFormatters = new Map(), dayFormatters = new Map();
function marketClock(tz, instant) {
  let formatter = clockFormatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    clockFormatters.set(tz, formatter);
  }
  return Object.fromEntries(formatter.formatToParts(instant).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
}
function marketDayFormatter(tz) {
  let formatter = dayFormatters.get(tz);
  if (!formatter) { formatter = new Intl.DateTimeFormat("en-CA", { timeZone: tz }); dayFormatters.set(tz, formatter); }
  return formatter;
}

function normalizeBars(item, timeframe, market = MARKETS.US) {
  const now = Date.now();
  const nowParts = marketClock(market.tz, new Date(now));
  const currentMarketDate = `${nowParts.year}-${nowParts.month}-${nowParts.day}`;
  const marketMinutes = Number(nowParts.hour) * 60 + Number(nowParts.minute);
  return (item?.historicals || []).filter(bar => bar && !bar.interpolated).map(bar => {
    const close = numeric(bar.close_price);
    return {
      date: String(bar.begins_at || ""),
      open: round(numeric(bar.open_price) || close, 4),
      close: round(close, 4),
      high: round(numeric(bar.high_price) || close, 4),
      low: round(numeric(bar.low_price) || close, 4),
      volume: Math.round(numeric(bar.volume)),
      bar_status: "confirmed_close",
    };
  }).filter(bar => {
    if (!bar.close || !bar.date) return false;
    if (timeframe === "day") {
      const barDate = bar.date.slice(0, 10);
      return barDate < currentMarketDate || (barDate === currentMarketDate && marketMinutes >= market.dailyCloseMinutes);
    }
    if (timeframe !== "hour") return true;
    const begins = Date.parse(bar.date);
    return !Number.isFinite(begins) || begins <= now - 60 * 60 * 1000;
  });
}

function calculateSupertrend(rows, period = 10, multiplier = 3, timeframe = "4h") {
  const trueRanges = [];
  const atrValues = new Array(rows.length).fill(null);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const previousClose = index ? rows[index - 1].close : null;
    trueRanges.push(previousClose == null ? row.high - row.low : Math.max(row.high - row.low, Math.abs(row.high - previousClose), Math.abs(row.low - previousClose)));
    if (index === period - 1) atrValues[index] = mean(trueRanges.slice(0, period));
    else if (index >= period && atrValues[index - 1] != null) atrValues[index] = ((atrValues[index - 1] * (period - 1)) + trueRanges[index]) / period;
  }
  const finalUpper = new Array(rows.length).fill(null);
  const finalLower = new Array(rows.length).fill(null);
  const directions = new Array(rows.length).fill(null);
  const values = new Array(rows.length).fill(null);
  for (let index = 0; index < rows.length; index += 1) {
    const atr = atrValues[index];
    if (atr == null) continue;
    const row = rows[index];
    row.atr = round(atr, 4);
    const midpoint = (row.high + row.low) / 2;
    const basicUpper = midpoint + multiplier * atr;
    const basicLower = midpoint - multiplier * atr;
    const previousUpper = index ? finalUpper[index - 1] : null;
    const previousLower = index ? finalLower[index - 1] : null;
    const previousClose = index ? rows[index - 1].close : row.close;
    finalUpper[index] = previousUpper == null || basicUpper < previousUpper || previousClose > previousUpper ? basicUpper : previousUpper;
    finalLower[index] = previousLower == null || basicLower > previousLower || previousClose < previousLower ? basicLower : previousLower;
    const previousDirection = index ? directions[index - 1] : null;
    let direction = previousDirection || "SHORT";
    if (previousDirection === "SHORT" && row.close > finalUpper[index]) direction = "LONG";
    else if (previousDirection === "LONG" && row.close < finalLower[index]) direction = "SHORT";
    directions[index] = direction;
    values[index] = direction === "LONG" ? finalLower[index] : finalUpper[index];
    row.supertrend = round(values[index], 4);
    row.supertrend_direction = direction;
  }
  const lastIndex = directions.reduce((last, direction, index) => direction ? index : last, -1);
  if (lastIndex < 0) throw new Error(`Insufficient ${timeframe} history to calculate Supertrend`);
  const direction = directions[lastIndex];
  let priorDirection = direction;
  for (let index = lastIndex - 1; index >= 0; index -= 1) if (directions[index]) { priorDirection = directions[index]; break; }
  let barsSinceFlip = 0;
  for (let index = lastIndex - 1; index >= 0; index -= 1) {
    if (directions[index] && directions[index] !== direction) break;
    if (directions[index]) barsSinceFlip += 1;
  }
  const flipIndex = Math.max(0, lastIndex - barsSinceFlip);
  const signalBar = rows[flipIndex];
  const nextBar = rows[flipIndex + 1] || null;
  const signalStartedAt = Date.parse(signalBar.date);
  const intervalMinutes = timeframe === "1d" ? 1440 : timeframe === "4h" ? 240 : 60;
  const signalConfirmedAt = signalBar.ends_at || (Number.isFinite(signalStartedAt) ? new Date(signalStartedAt + intervalMinutes * 60 * 1000).toISOString() : signalBar.date);
  return {
    period,
    multiplier,
    direction,
    value: round(values[lastIndex], 4),
    distance_pct: round((rows[lastIndex].close / values[lastIndex] - 1) * 100, 3),
    flipped_today: priorDirection !== direction,
    bars_since_flip: barsSinceFlip,
    signal_bar_started_at: signalBar.date,
    signal_confirmed_at: signalConfirmedAt,
    signal_entry_price: round(nextBar?.open || signalBar.close, 4),
    signal_entry_source: nextBar ? "next_bar_open" : "signal_bar_close",
    expected_strategy_fill_at: signalConfirmedAt,
    signal_atr: round(signalBar.atr || atrValues[flipIndex], 4),
    is_confirmed: true,
    bar_status: "confirmed_close",
    as_of: rows[lastIndex].date,
    confirmed_direction: direction,
    confirmed_value: round(values[lastIndex], 4),
    confirmed_as_of: rows[lastIndex].date,
    timeframe,
    interval_minutes: intervalMinutes,
  };
}

function calculateAdx(rows, period = 14) {
  const values = new Array(rows.length).fill(null);
  if (rows.length < period * 2) return { value: 0, prior_value: 0, rising: false, period };
  const trueRange = new Array(rows.length).fill(0);
  const plusDm = new Array(rows.length).fill(0);
  const minusDm = new Array(rows.length).fill(0);
  for (let index = 1; index < rows.length; index += 1) {
    const upMove = rows[index].high - rows[index - 1].high;
    const downMove = rows[index - 1].low - rows[index].low;
    plusDm[index] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[index] = downMove > upMove && downMove > 0 ? downMove : 0;
    trueRange[index] = Math.max(rows[index].high - rows[index].low, Math.abs(rows[index].high - rows[index - 1].close), Math.abs(rows[index].low - rows[index - 1].close));
  }
  let smoothRange = trueRange.slice(1, period + 1).reduce((sum, value) => sum + value, 0);
  let smoothPlus = plusDm.slice(1, period + 1).reduce((sum, value) => sum + value, 0);
  let smoothMinus = minusDm.slice(1, period + 1).reduce((sum, value) => sum + value, 0);
  const dx = new Array(rows.length).fill(null);
  for (let index = period; index < rows.length; index += 1) {
    if (index > period) {
      smoothRange = smoothRange - smoothRange / period + trueRange[index];
      smoothPlus = smoothPlus - smoothPlus / period + plusDm[index];
      smoothMinus = smoothMinus - smoothMinus / period + minusDm[index];
    }
    const plusDi = smoothRange ? 100 * smoothPlus / smoothRange : 0;
    const minusDi = smoothRange ? 100 * smoothMinus / smoothRange : 0;
    dx[index] = plusDi + minusDi ? 100 * Math.abs(plusDi - minusDi) / (plusDi + minusDi) : 0;
  }
  const seedIndex = period * 2 - 1;
  values[seedIndex] = mean(dx.slice(period, seedIndex + 1));
  for (let index = seedIndex + 1; index < rows.length; index += 1) values[index] = ((values[index - 1] * (period - 1)) + dx[index]) / period;
  const value = numeric(values.at(-1));
  const priorValue = numeric(values.at(-6));
  return { value: round(value, 3), prior_value: round(priorValue, 3), rising: value > priorValue, period };
}

function periodReturn(closes, periods) {
  return closes.length > periods ? (closes.at(-1) / closes.at(-periods - 1) - 1) * 100 : 0;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map(value => (value - average) ** 2)));
}

// Entry timing uses 4-hour bars built from completed hourly bars: backtests on 41 liquid stocks showed 4h
// Supertrend (10, 3) with the best profit factor and stable results across halves, while 30m and below lost money.
// Each market day splits into chunks of four hourly bars (US: 09:30-13:30 and 13:30-16:00).
function aggregateEntryBars(hourly, size, market) {
  const parts = marketClock(market.tz, new Date());
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const dayClosed = Number(parts.hour) * 60 + Number(parts.minute) >= market.dailyCloseMinutes;
  const dayFormat = marketDayFormatter(market.tz);
  const days = new Map();
  for (const bar of hourly) {
    const begins = Date.parse(bar.date);
    if (!Number.isFinite(begins)) continue;
    const key = dayFormat.format(new Date(begins));
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(bar);
  }
  const out = [];
  for (const [key, bars] of days) {
    for (let index = 0; index < bars.length; index += size) {
      const group = bars.slice(index, index + size);
      const complete = group.length === size || key < today || (key === today && dayClosed);
      if (!complete) continue;
      out.push({
        date: group[0].date,
        ends_at: new Date(Date.parse(group.at(-1).date) + 60 * 60 * 1000).toISOString(),
        open: group[0].open,
        close: group.at(-1).close,
        high: round(Math.max(...group.map(bar => bar.high)), 4),
        low: round(Math.min(...group.map(bar => bar.low)), 4),
        volume: group.reduce((sum, bar) => sum + bar.volume, 0),
        bar_status: "confirmed_close",
      });
    }
  }
  return out;
}

// Inputs for the dip scan, from completed daily bars only: the latest close, its 5- and 200-day averages, RSI(2) and the
// 3-day change. Needs 201 bars, so it is null where fewer daily bars exist.
function rsiWilder(closes, period) {
  const alpha = 1 / period;
  let gain = null, loss = null;
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1], up = Math.max(change, 0), down = Math.max(-change, 0);
    gain = gain === null ? up : alpha * up + (1 - alpha) * gain;
    loss = loss === null ? down : alpha * down + (1 - alpha) * loss;
  }
  if (gain === null) return null;
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}
function dipInputs(closes, daily) {
  if (closes.length < 201) return null;
  const close = closes.at(-1);
  return {
    close: round(close, 4), sma_5: round(mean(closes.slice(-5)), 4), sma_200: round(mean(closes.slice(-200)), 4),
    rsi2: round(rsiWilder(closes.slice(-60), 2), 2), return_3d_pct: round((close / closes.at(-4) - 1) * 100, 3), as_of: daily.at(-1).date,
  };
}

// Candlestick patterns at a breakout or breakdown, from completed daily bars. A pattern only counts when it forms on the day the close
// breaks the prior 20-day high (or low) on volume at least 1.4x the 50-day average, on the right side of the 200-day average. This is the
// "BRK" setting of research/pattern-backtest/backtest9.mjs. Backtests found no edge for the long side and only a weak, unstable one for
// the short side, so the scan is experimental and every pick is logged under its own strategy to be judged on live results.
const PATTERN_VOLUME_RATIO = 1.4, PATTERN_STOP_PAD_ATR = 0.25, PATTERN_STOP_MIN_ATR = 1, PATTERN_STOP_MAX_ATR = 3;
const PATTERN_SPANS = { "Bullish engulfing": 2, "Hammer": 1, "Morning star": 3, "Three white soldiers": 3, "Bearish engulfing": 2, "Shooting star": 1, "Evening star": 3, "Three black crows": 3 };
function candlePatternInputs(daily) {
  if (daily.length < 201) return null;
  const o = daily.map(bar => bar.open), h = daily.map(bar => bar.high), l = daily.map(bar => bar.low), c = daily.map(bar => bar.close), v = daily.map(bar => bar.volume);
  const t = daily.length - 1, close = c[t];
  const ranges = h.map((high, i) => i === 0 ? high - l[i] : Math.max(high - l[i], Math.abs(high - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  const atr = mean(ranges.slice(-14));
  const volumeAverage = mean(v.slice(-51, -1));
  if (!(atr > 0) || !(volumeAverage > 0)) return null;
  const volumeRatio = v[t] / volumeAverage;
  const high20 = Math.max(...h.slice(-21, -1)), low20 = Math.min(...l.slice(-21, -1)), sma200 = mean(c.slice(-200));
  const side = close > high20 && close > sma200 ? "LONG" : close < low20 && close < sma200 ? "SHORT" : null;
  if (!side || volumeRatio < PATTERN_VOLUME_RATIO) return null;
  const body = i => Math.abs(c[i] - o[i]), green = i => c[i] > o[i], red = i => c[i] < o[i];
  const upper = i => h[i] - Math.max(o[i], c[i]), lower = i => Math.min(o[i], c[i]) - l[i];
  const found = [];
  if (side === "LONG") {
    if (red(t - 1) && green(t) && o[t] <= c[t - 1] && c[t] >= o[t - 1] && body(t) > body(t - 1) && body(t) >= 0.5 * atr) found.push("Bullish engulfing");
    if (h[t] - l[t] >= 0.8 * atr && body(t) > 0 && lower(t) >= 2 * body(t) && upper(t) <= 0.3 * body(t) + 0.05 * (h[t] - l[t])) found.push("Hammer");
    if (red(t - 2) && body(t - 2) >= 0.6 * atr && body(t - 1) <= 0.3 * body(t - 2) && Math.max(o[t - 1], c[t - 1]) < c[t - 2] && green(t) && c[t] > (o[t - 2] + c[t - 2]) / 2) found.push("Morning star");
    if ([t - 2, t - 1, t].every(i => green(i) && body(i) >= 0.5 * atr && upper(i) <= 0.3 * body(i)) && c[t - 1] > c[t - 2] && c[t] > c[t - 1] && o[t - 1] > o[t - 2] && o[t - 1] < c[t - 2] && o[t] > o[t - 1] && o[t] < c[t - 1]) found.push("Three white soldiers");
  } else {
    if (green(t - 1) && red(t) && o[t] >= c[t - 1] && c[t] <= o[t - 1] && body(t) > body(t - 1) && body(t) >= 0.5 * atr) found.push("Bearish engulfing");
    if (h[t] - l[t] >= 0.8 * atr && body(t) > 0 && upper(t) >= 2 * body(t) && lower(t) <= 0.3 * body(t) + 0.05 * (h[t] - l[t])) found.push("Shooting star");
    if (green(t - 2) && body(t - 2) >= 0.6 * atr && body(t - 1) <= 0.3 * body(t - 2) && Math.min(o[t - 1], c[t - 1]) > c[t - 2] && red(t) && c[t] < (o[t - 2] + c[t - 2]) / 2) found.push("Evening star");
    if ([t - 2, t - 1, t].every(i => red(i) && body(i) >= 0.5 * atr && lower(i) <= 0.3 * body(i)) && c[t - 1] < c[t - 2] && c[t] < c[t - 1] && o[t - 1] < o[t - 2] && o[t - 1] > c[t - 2] && o[t] < o[t - 1] && o[t] > c[t - 1]) found.push("Three black crows");
  }
  if (!found.length) return null;
  const span = Math.max(...found.map(name => PATTERN_SPANS[name]));
  return {
    direction: side, patterns: found, close: round(close, 4), as_of: daily.at(-1).date, atr: round(atr, 4), volume_ratio: round(volumeRatio, 2),
    breakout_level: round(side === "LONG" ? high20 : low20, 4), above_sma200_pct: round((close / sma200 - 1) * 100, 2),
    pattern_extreme: round(side === "LONG" ? Math.min(...l.slice(-span)) : Math.max(...h.slice(-span)), 4),
  };
}

// Chart reference lines, shown beside the stop and targets so a position can be read against the chart. They do not set any
// level: backtests (research/pattern-backtest, ml_chart.py) found swing-low stops and prior-high targets did worse than ATR levels.
function chartRefs(closes, daily) {
  const lows = daily.map(bar => bar.low), highs = daily.map(bar => bar.high);
  const lowest = n => daily.length >= n ? Math.min(...lows.slice(-n)) : null;
  const highest = n => daily.length >= n ? Math.max(...highs.slice(-n)) : null;
  const average = n => closes.length >= n ? mean(closes.slice(-n)) : null;
  return { low_20: round(lowest(20), 4), high_10: round(highest(10), 4), high_20: round(highest(20), 4), sma_20: round(average(20), 4), sma_50: round(average(50), 4), sma_200: round(average(200), 4) };
}
const REFERENCE_LABELS = { low_20: "20-day low", high_10: "10-day high", high_20: "20-day high", sma_20: "20-day average", sma_50: "50-day average", sma_200: "200-day average" };
function referenceLines(refs) {
  return Object.entries(REFERENCE_LABELS).map(([key, label]) => ({ key, label, value: refs?.[key] })).filter(line => Number.isFinite(line.value) && line.value > 0);
}

function snapshotFromPayload(symbol, dailyItem, signalItem, quote, market = MARKETS.US) {
  const daily = normalizeBars(dailyItem, "day", market);
  const signal = aggregateEntryBars(normalizeBars(signalItem, "hour", market), 4, market);
  if (daily.length < 35) throw new Error(`Insufficient daily history for ${symbol}`);
  if (signal.length < 22) throw new Error(`Insufficient confirmed 4-hour history for ${symbol}`);
  const closes = daily.map(row => row.close);
  const highs = daily.map(row => row.high);
  const lows = daily.map(row => row.low);
  const volumes = daily.map(row => row.volume);
  const supertrend = calculateSupertrend(signal, 10, 3, "4h");
  const dailySupertrend = calculateSupertrend(daily, 10, 3, "1d");
  const dailyAdx = calculateAdx(daily, 14);
  const price = numeric(quote?.last_trade_price) || closes.at(-1);
  const logReturns = closes.slice(1).map((close, index) => Math.log(close / closes[index])).filter(Number.isFinite);
  const trueRanges = highs.map((high, index) => index === 0 ? high - lows[index] : Math.max(high - lows[index], Math.abs(high - closes[index - 1]), Math.abs(lows[index] - closes[index - 1])));
  const signalRanges = signal.map((row, index) => index === 0 ? row.high - row.low : Math.max(row.high - row.low, Math.abs(row.high - signal[index - 1].close), Math.abs(row.low - signal[index - 1].close)));
  const atr14 = mean(trueRanges.slice(-14)) || price * 0.03;
  const signalAtr14 = mean(signalRanges.slice(-14)) || atr14;
  const recentVolume = mean(volumes.slice(-5));
  const hasVolume = volumes.some(value => value > 0);
  const baseVolume = mean(volumes.slice(-25, -5)) || recentVolume || 1;
  return {
    symbol,
    market: market.id,
    currency: market.currency,
    currency_symbol: market.symbolPrefix,
    price_decimals: market.decimals(price),
    exchange: market.label,
    price: round(price, 4),
    previous_close: round(numeric(quote?.adjusted_previous_close) || closes.at(-2), 4),
    return_1d_pct: round(periodReturn(closes, 1), 3),
    return_5d_pct: round(periodReturn(closes, 5), 3),
    return_20d_pct: round(periodReturn(closes, 20), 3),
    return_60d_pct: round(periodReturn(closes, 60), 3),
    sma_20: round(mean(closes.slice(-20)), 4),
    sma_50: closes.length >= 50 ? round(mean(closes.slice(-50)), 4) : null,
    annualized_volatility_pct: round(standardDeviation(logReturns.slice(-60)) * Math.sqrt(252) * 100, 3),
    atr_14: round(atr14, 4),
    atr_14_pct: round(atr14 / price * 100, 3),
    dip: dipInputs(closes, daily),
    pattern: candlePatternInputs(daily),
    recent_daily: daily.slice(-12).map(bar => ({ d: String(bar.date).slice(0, 10), h: bar.high, l: bar.low, c: bar.close })),
    chart_refs: chartRefs(closes, daily),
    chart_daily: daily.slice(-60).map(bar => ({ d: String(bar.date).slice(0, 10), o: bar.open, h: bar.high, l: bar.low, c: bar.close })),
    signal_atr_14: round(signalAtr14, 4),
    signal_atr_14_pct: round(signalAtr14 / price * 100, 3),
    volume_ratio_5d_to_20d: hasVolume ? round(recentVolume / baseVolume, 3) : 1,
    market_time: quote?.venue_last_trade_time || signal.at(-1)?.date || daily.at(-1)?.date,
    fetched_at: new Date().toISOString(),
    data_source: market.provider === "robinhood" ? "Robinhood" : "Market data provider",
    data_source_detail: market.provider === "robinhood" ? "Robinhood confirmed daily trend with regular-hours 4-hour entry candles; only completed bars are used" : `${market.label} confirmed daily trend with 4-hour entry candles from the market-data provider; only completed bars are used`,
    supertrend,
    daily_supertrend: dailySupertrend,
    daily_adx: dailyAdx,
    data_complete: true,
    history: signal.slice(-120),
  };
}

const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, (index + 1) * size));
const bySymbol = payload => new Map((payload?.results || []).filter(Boolean).map(item => [String(item.symbol || "").toUpperCase(), item]));

// Robinhood accepts 75 symbols per history call and more per quote call. Large batches keep a full
// S&P 500 scan near 20 outgoing requests, inside Cloudflare's 50-per-invocation free-plan limit.
async function fetchRobinhoodSnapshots(symbols) {
  const daily = new Map(), signal = new Map(), quotes = new Map(), failed = new Map();
  const jobs = [
    ...chunk(symbols, 75).flatMap(batch => {
      const encoded = encodeURIComponent(batch.join(",")).replaceAll("%2C", ",");
      return [
        { batch, run: async () => bySymbol(await fetchJson(`${ROBINHOOD_HISTORICALS}?symbols=${encoded}&bounds=regular&interval=day&span=year`)).forEach((value, key) => daily.set(key, value)) },
        { batch, run: async () => bySymbol(await fetchJson(`${ROBINHOOD_HISTORICALS}?symbols=${encoded}&bounds=regular&interval=hour&span=month`)).forEach((value, key) => signal.set(key, value)) },
      ];
    }),
    ...chunk(symbols, 150).map(batch => ({ batch, run: async () => bySymbol(await fetchJson(`${ROBINHOOD_QUOTES}?symbols=${encodeURIComponent(batch.join(",")).replaceAll("%2C", ",")}`)).forEach((value, key) => quotes.set(key, value)) })),
  ];
  for (let index = 0; index < jobs.length; index += 6) {
    const group = jobs.slice(index, index + 6);
    const results = await Promise.allSettled(group.map(job => job.run()));
    results.forEach((result, position) => {
      if (result.status === "rejected") group[position].batch.forEach(symbol => failed.set(symbol, cleanError(result.reason)));
    });
  }
  const snapshots = new Map(), errors = [];
  for (const symbol of symbols) {
    try {
      if (failed.has(symbol)) throw new Error(failed.get(symbol));
      if (!daily.has(symbol) || !signal.has(symbol)) throw new Error("Robinhood returned no history");
      snapshots.set(symbol, snapshotFromPayload(symbol, daily.get(symbol), signal.get(symbol), quotes.get(symbol)));
    } catch (error) { errors.push({ symbol, error: cleanError(error) }); }
  }
  return { snapshots, errors };
}

// Building an Intl.DateTimeFormat is expensive and this runs once per hourly bar, so one formatter is kept per time zone.
const localDateFormatters = new Map();
function localDate(epochSeconds, timeZone) {
  let formatter = localDateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    localDateFormatters.set(timeZone, formatter);
  }
  return formatter.format(new Date(epochSeconds * 1000));
}

async function yahooChart(market, symbol, interval, range) {
  const url = `${YAHOO_CHART}${encodeURIComponent(market.yahoo(symbol))}?interval=${interval}&range=${range}&includePrePost=false`;
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; PortfolioIntelligence/1.0)" },
    signal: AbortSignal.timeout(20000),
  });
  if (response.status === 429) throw new Error("The market-data provider is rate limiting requests; the next automatic refresh will retry");
  if (!response.ok) throw new Error(`Market data returned HTTP ${response.status}`);
  const result = (await response.json())?.chart?.result?.[0];
  if (!result?.timestamp?.length) throw new Error("Market data returned no history");
  const quote = result.indicators?.quote?.[0] || {};
  return result.timestamp.map((time, index) => ({
    time, begins_at: new Date(time * 1000).toISOString(),
    open_price: quote.open?.[index], high_price: quote.high?.[index], low_price: quote.low?.[index],
    close_price: quote.close?.[index], volume: quote.volume?.[index],
  })).filter(bar => bar.close_price != null);
}

// Yahoo's own daily history is truncated for many BSE tickers, so daily bars are built from the
// hourly bars. One request per symbol also keeps a scan inside the free plan's request limit.
function aggregateDaily(hourly, market) {
  const days = new Map();
  for (const bar of hourly) {
    const date = localDate(bar.time, market.tz);
    const open = numeric(bar.open_price) || numeric(bar.close_price);
    const day = days.get(date);
    if (!day) days.set(date, { begins_at: `${date}T00:00:00Z`, open_price: open, high_price: numeric(bar.high_price), low_price: numeric(bar.low_price), close_price: numeric(bar.close_price), volume: numeric(bar.volume) });
    else {
      day.high_price = Math.max(day.high_price, numeric(bar.high_price));
      day.low_price = Math.min(day.low_price, numeric(bar.low_price));
      day.close_price = numeric(bar.close_price);
      day.volume += numeric(bar.volume);
    }
  }
  return [...days.values()];
}

async function loadYahooSeries(symbols, market) {
  const series = new Map(), errors = [];
  for (let index = 0; index < symbols.length; index += 3) {
    if (index) await new Promise(resolve => setTimeout(resolve, 300));
    await Promise.all(symbols.slice(index, index + 3).map(async symbol => {
      try {
        // Forex trades 24 hours, so three months already holds about as many hourly bars as India's six; longer overruns the CPU limit.
        const hourly = await yahooChart(market, symbol, "60m", market.id === "FX" ? "3mo" : "6mo");
        series.set(symbol, { daily: { symbol, historicals: aggregateDaily(hourly, market) }, signal: { symbol, historicals: hourly } });
      } catch (error) { errors.push({ symbol, error: cleanError(error) }); }
    }));
  }
  return { series, errors };
}

function twelveBars(values, daily) {
  return (values || []).map(row => ({
    begins_at: daily ? `${String(row.datetime).slice(0, 10)}T00:00:00Z` : `${String(row.datetime).replace(" ", "T")}Z`,
    open_price: row.open, high_price: row.high, low_price: row.low, close_price: row.close, volume: row.volume,
  }));
}

async function twelveSeries(market, symbols, interval, outputsize, apiKey) {
  const params = new URLSearchParams({
    symbol: symbols.map(market.twelve).join(","), interval, outputsize: String(outputsize),
    order: "ASC", timezone: "UTC", apikey: apiKey,
    ...(market.twelveExchange ? { exchange: market.twelveExchange } : {}),
  });
  const response = await fetch(`${TWELVE_DATA}?${params}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(25000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.status === "error") throw new Error(payload.message ? String(payload.message).replace(apiKey, "***") : `Market data returned HTTP ${response.status}`);
  const keyed = symbols.length === 1 ? { [market.twelve(symbols[0])]: payload } : payload;
  const result = new Map();
  for (const symbol of symbols) {
    const entry = keyed[market.twelve(symbol)];
    if (entry?.values?.length) result.set(symbol, { symbol, historicals: twelveBars(entry.values, interval === "1day") });
  }
  return result;
}

async function loadTwelveSeries(symbols, market, apiKey) {
  const series = new Map(), errors = [];
  for (let index = 0; index < symbols.length; index += 15) {
    const batch = symbols.slice(index, index + 15);
    try {
      const [daily, signal] = await Promise.all([twelveSeries(market, batch, "1day", 160, apiKey), twelveSeries(market, batch, "1h", 220, apiKey)]);
      for (const symbol of batch) {
        if (daily.has(symbol) && signal.has(symbol)) series.set(symbol, { daily: daily.get(symbol), signal: signal.get(symbol) });
        else errors.push({ symbol, error: "Market data returned no history" });
      }
    } catch (error) { batch.forEach(symbol => errors.push({ symbol, error: cleanError(error) })); }
  }
  return { series, errors };
}

async function fetchExternalSnapshots(symbols, market, env) {
  const { series, errors } = env?.TWELVE_DATA_API_KEY ? await loadTwelveSeries(symbols, market, env.TWELVE_DATA_API_KEY) : await loadYahooSeries(symbols, market);
  const snapshots = new Map();
  for (const [symbol, item] of series) {
    try {
      const closes = normalizeBars(item.daily, "day", market).map(bar => bar.close);
      const hourly = item.signal.historicals;
      const quote = { last_trade_price: hourly.at(-1)?.close_price, adjusted_previous_close: closes.at(-2), venue_last_trade_time: hourly.at(-1)?.begins_at };
      snapshots.set(symbol, snapshotFromPayload(symbol, item.daily, item.signal, quote, market));
    } catch (error) { errors.push({ symbol, error: cleanError(error) }); }
  }
  return { snapshots, errors };
}

function scoreCandidate(snapshot, metadata = {}) {
  const { price } = snapshot;
  const sma20 = snapshot.sma_20;
  const sma50 = snapshot.sma_50 || sma20;
  const r20 = snapshot.return_20d_pct;
  const r60 = snapshot.return_60d_pct;
  const volumeRatio = snapshot.volume_ratio_5d_to_20d;
  const volatility = snapshot.annualized_volatility_pct;
  const supertrend = snapshot.supertrend || {};
  const dailySupertrend = snapshot.daily_supertrend || {};
  const direction = supertrend.direction || (price >= sma20 ? "LONG" : "SHORT");
  const dailyDirection = dailySupertrend.direction || (sma20 >= sma50 ? "LONG" : "SHORT");
  const dailyAligned = dailyDirection === direction;
  const dailyAdx = numeric(snapshot.daily_adx?.value);
  const dailyAdxPrior = numeric(snapshot.daily_adx?.prior_value);
  const dailyAdxRising = Boolean(snapshot.daily_adx?.rising);
  const regimeEligible = dailyAdx >= 20 && dailyAdxRising;
  let longScore = 50, shortScore = 50;
  const reasons = [], cautions = [];
  if (price > sma20) { longScore += 8; shortScore -= 8; } else { longScore -= 8; shortScore += 8; }
  if (sma20 > sma50) { longScore += 8; shortScore -= 8; } else { longScore -= 8; shortScore += 8; }
  longScore += clamp(r20 / 3, -10, 10) + clamp(r60 / 6, -8, 8);
  shortScore += clamp(-r20 / 3, -10, 10) + clamp(-r60 / 6, -8, 8);
  const participation = clamp((volumeRatio - 1) * 6, -3, 3);
  longScore += participation; shortScore += participation;
  if (direction === "LONG") { longScore += 12; shortScore -= 12; } else { longScore -= 12; shortScore += 12; }
  const volatilityPenalty = clamp((volatility - 35) * 0.25, 0, 20);
  longScore -= volatilityPenalty; shortScore -= volatilityPenalty;
  const age = Number(supertrend.bars_since_flip || 0);
  const entryReference = numeric(supertrend.signal_entry_price) || price;
  const signalAtr = numeric(supertrend.signal_atr) || snapshot.signal_atr_14 || price * 0.01;
  const favorableMove = direction === "LONG" ? price - entryReference : entryReference - price;
  const extensionAtr = signalAtr ? favorableMove / signalAtr : 0;
  const extensionPct = entryReference ? favorableMove / entryReference * 100 : 0;
  const isFresh = age <= MAX_ENTRY_AGE_BARS;
  const isExtended = extensionAtr > MAX_ENTRY_EXTENSION_ATR;
  const isFailing = extensionAtr < -MAX_ADVERSE_EXTENSION_ATR;
  const dailyAtr = numeric(snapshot.atr_14);
  const { target1 } = scenarioLevels(direction, entryReference, signalAtr, snapshot.market, dailyAtr);
  const signalStartedAt = Date.parse(supertrend.signal_bar_started_at);
  const postSignalBars = snapshot.history.filter(row => !Number.isFinite(signalStartedAt) || Date.parse(row.date) > signalStartedAt);
  const target1Reached = direction === "SHORT"
    ? [price, ...postSignalBars.map(row => row.low)].some(value => numeric(value) <= target1)
    : [price, ...postSignalBars.map(row => row.high)].some(value => numeric(value) >= target1);
  const entryEligible = dailyAligned && regimeEligible && isFresh && !isExtended && !isFailing && !target1Reached;
  const entryStatus = !dailyAligned ? "DAILY_CONFLICT" : !regimeEligible ? "WEAK_TREND_REGIME" : !isFresh ? "LATE_TREND" : target1Reached ? "TARGET_REACHED" : isExtended ? "EXTENDED_DO_NOT_CHASE" : isFailing ? "SIGNAL_WEAKENING" : "ENTRY_WINDOW";
  const freshness = age === 0 ? 12 : age === 1 ? 8 : -20;
  if (direction === "LONG") longScore += freshness; else shortScore += freshness;
  longScore = round(clamp(longScore, 0, 100), 1); shortScore = round(clamp(shortScore, 0, 100), 1);
  const score = direction === "LONG" ? longScore : shortScore;
  (dailyAligned ? reasons : cautions).push(dailyAligned
    ? `Confirmed daily Supertrend agrees: ${dailyDirection} at ${fmtPrice(dailySupertrend.value, MARKETS[snapshot.market] || MARKETS.US)}`
    : `Daily Supertrend is ${dailyDirection} while the 4H trigger is ${direction} — countertrend entry rejected`);
  (regimeEligible ? reasons : cautions).push(regimeEligible
    ? `Daily ADX (14) is ${dailyAdx.toFixed(1)} and rising from ${dailyAdxPrior.toFixed(1)} five sessions ago`
    : `Trend-strength veto: daily ADX (14) is ${dailyAdx.toFixed(1)} and must be at least 20 and rising versus five sessions ago`);
  reasons.push(`Confirmed 4H Supertrend (10, 3) is ${direction} at ${fmtPrice(supertrend.value, MARKETS[snapshot.market] || MARKETS.US)}`);
  if (entryEligible) reasons.push(`Entry window is open: signal is ${age + 1} completed 4-hour bar${age ? "s" : ""} old and price is ${Math.abs(extensionAtr).toFixed(2)} ATR from the signal entry`);
  else if (!isFresh) cautions.push(`Late trend: the signal is ${age + 1} completed 4-hour bars old`);
  else if (target1Reached) cautions.push("Scenario target 1 was already reached — the original entry window is closed");
  else if (isExtended) cautions.push(`Extended ${extensionAtr.toFixed(2)} ATR beyond the signal entry — do not chase`);
  else cautions.push(`Price moved ${Math.abs(extensionAtr).toFixed(2)} ATR against the signal — wait for a new confirmation`);
  if (direction === "LONG") {
    (price > sma20 ? reasons : cautions).push(price > sma20 ? "Price is above its 20-day average" : "Price is below its 20-day average");
    (sma20 > sma50 ? reasons : cautions).push(sma20 > sma50 ? "20-day trend is above the 50-day trend" : "20-day trend is below the 50-day trend");
    (r20 > 0 ? reasons : cautions).push(`20-day momentum is ${r20 >= 0 ? "+" : ""}${r20.toFixed(1)}%`);
  } else {
    (price < sma20 ? reasons : cautions).push(price < sma20 ? "Price is below its 20-day average" : "Price remains above its 20-day average");
    (sma20 < sma50 ? reasons : cautions).push(sma20 < sma50 ? "20-day trend is below the 50-day trend" : "20-day trend remains above the 50-day trend");
    (r20 < 0 ? reasons : cautions).push(`20-day momentum is ${r20 >= 0 ? "+" : ""}${r20.toFixed(1)}%`);
  }
  if (volumeRatio >= 1.15) reasons.push(`Recent volume is ${volumeRatio.toFixed(2)}× baseline`);
  if (volatility > 55) cautions.push(`Elevated annualized volatility of ${volatility.toFixed(1)}%`);
  const strength = score >= 70 ? "Strong" : score >= 60 ? "Developing" : "Weak";
  const statusLabel = entryStatus === "ENTRY_WINDOW" ? `Fresh ${direction.toLowerCase()} entry` : entryStatus === "DAILY_CONFLICT" ? "Daily trend conflict" : entryStatus === "WEAK_TREND_REGIME" ? "Weak or fading daily trend" : entryStatus === "TARGET_REACHED" ? "Target reached — entry closed" : entryStatus === "EXTENDED_DO_NOT_CHASE" ? "Extended — do not chase" : entryStatus === "SIGNAL_WEAKENING" ? "Signal weakening" : "Active trend — entry passed";
  return {
    symbol: snapshot.symbol,
    market: snapshot.market || "US",
    currency_symbol: snapshot.currency_symbol ?? "$",
    price_decimals: snapshot.price_decimals ?? 2,
    company: metadata.company || snapshot.symbol,
    sector: metadata.sector || "Unknown",
    score,
    long_score: longScore,
    short_score: shortScore,
    direction,
    label: entryEligible ? `${strength} ${statusLabel.toLowerCase()}` : statusLabel,
    price,
    return_1d_pct: snapshot.return_1d_pct,
    return_20d_pct: r20,
    return_60d_pct: r60,
    annualized_volatility_pct: volatility,
    supertrend_value: supertrend.value,
    supertrend_direction: direction,
    supertrend_confirmed_direction: direction,
    supertrend_is_confirmed: true,
    supertrend_flipped_today: Boolean(supertrend.flipped_today),
    daily_supertrend_direction: dailyDirection,
    daily_supertrend_value: dailySupertrend.value,
    daily_supertrend_as_of: dailySupertrend.confirmed_as_of,
    daily_aligned: dailyAligned,
    daily_adx: round(dailyAdx, 3),
    daily_adx_prior: round(dailyAdxPrior, 3),
    daily_adx_rising: dailyAdxRising,
    regime_eligible: regimeEligible,
    signal_age_bars: age,
    signal_confirmed_at: supertrend.signal_confirmed_at,
    expected_strategy_fill_at: supertrend.expected_strategy_fill_at,
    signal_entry_price: round(entryReference, 4),
    signal_atr: round(signalAtr, 4),
    daily_atr: round(dailyAtr, 4),
    extension_atr: round(extensionAtr, 3),
    extension_pct: round(extensionPct, 3),
    buy_range: buyRange(direction, entryReference, signalAtr, price),
    entry_status: entryStatus,
    entry_eligible: entryEligible,
    target_1_reached: target1Reached,
    reasons: reasons.slice(0, 4),
    cautions: cautions.slice(0, 3),
    market_time: snapshot.market_time,
  };
}

function fetchSnapshots(symbols, market = MARKETS.US, env = {}) {
  return market.provider === "robinhood" ? fetchRobinhoodSnapshots(symbols) : fetchExternalSnapshots(symbols, market, env);
}

// The index each market's trend banner reads. It is fetched in the same batches as the stocks (no extra requests for
// the S&P 500) and removed before ranking so it never appears as a candidate.
// The first index of each market also carries breadth (the share of the scanned stocks trending up); the US
// extras are ETF proxies read from the same batches, so they cost no additional requests.
const MARKET_INDEXES = {
  US: [{ symbol: "SPY", label: "S&P 500" }, { symbol: "QQQ", label: "Nasdaq-100" }, { symbol: "DIA", label: "Dow Jones" }, { symbol: "IWM", label: "Russell 2000" }],
  IN: [{ symbol: "^BSESN", label: "Sensex 30" }],
  FX: [{ symbol: "DX-Y.NYB", label: "US Dollar Index" }],
};

// Share of scanned stocks in a daily uptrend at or above this reads as a strong majority, at or below the lower bound as a weak one.
const BREADTH_STRONG_PCT = 60, BREADTH_WEAK_PCT = 40;

function marketTrend(info, index, snapshots, withBreadth = true, marketId = null) {
  if (!info || !index) return null;
  const daily = index.daily_supertrend?.direction === "LONG" ? "UP" : "DOWN";
  const fourHour = index.supertrend?.direction === "LONG" ? "UP" : "DOWN";
  const all = [...snapshots.values()];
  const share = pick => all.length ? round(all.filter(snapshot => pick(snapshot) === "LONG").length / all.length * 100, 0) : null;
  // Forex pairs are not stocks, so "share of pairs trending up" says nothing about the market and is left out there.
  const showBreadth = withBreadth && marketId !== "FX";
  const breadthDaily = showBreadth ? share(snapshot => snapshot.daily_supertrend?.direction) : null;
  const indexState = daily === "UP" && fourHour === "UP" ? "UP" : daily === "DOWN" && fourHour === "DOWN" ? "DOWN" : "MIXED";
  let state = indexState;
  let headline = indexState === "UP" ? "Market is in an uptrend" : indexState === "DOWN" ? "Market is in a downtrend"
    : daily === "UP" ? "Choppy: daily up, 4H down" : "Choppy: daily down, 4H up";
  let note = indexState === "UP" ? "Fresh long entries are moving with the market."
    : indexState === "DOWN" ? "Long entries are going against the market. Watch protective levels closely."
    : daily === "UP" ? "A pullback inside an uptrend. Fresh entries are less reliable until the 4H turns up."
    : "A bounce inside a downtrend. Treat long entries with extra care.";
  // The index trend line lags and can disagree with the stocks underneath it, so a strong split reads as mixed.
  if (breadthDaily != null && indexState === "DOWN" && breadthDaily >= BREADTH_STRONG_PCT) {
    state = "MIXED";
    headline = "Mixed: index trend down, most stocks still up";
    note = `The index trend line is down, but ${breadthDaily}% of stocks are in daily uptrends. The index tends to lag, so treat the market as mixed until it confirms.`;
  } else if (breadthDaily != null && indexState === "UP" && breadthDaily <= BREADTH_WEAK_PCT) {
    state = "MIXED";
    headline = "Mixed: index trend up, few stocks up";
    note = `The index trend line is up, but only ${breadthDaily}% of stocks are in daily uptrends. A narrow rally is less reliable.`;
  }
  return {
    state, index_state: indexState, headline, note,
    market: marketId, index_symbol: info.symbol, label: info.label,
    daily, four_hour: fourHour,
    adx: round(numeric(index.daily_adx?.value), 0),
    day_change_pct: Number.isFinite(Number(index.return_1d_pct)) ? round(Number(index.return_1d_pct), 2) : null,
    breadth_daily_pct: breadthDaily,
    breadth_4h_pct: showBreadth ? share(snapshot => snapshot.supertrend?.direction) : null,
    stocks_counted: showBreadth ? all.length : null,
    as_of: index.market_time || null,
    // The last 60 four-hour closes of the index, for a small line chart. About sixty numbers, so the scan stays small.
    spark: (index.history || []).slice(-60).map(bar => round(numeric(bar.close), 4)).filter(Number.isFinite),
  };
}

// ---- Entry window timing: when does each setup stop being a fresh entry, and what happened to the ones that did ----
const RECENT_SETUP_HOURS = 24;
const DROP_REASONS = {
  LATE_TREND: () => "Signal is too old to list",
  EXTENDED_DO_NOT_CHASE: c => `Price ran ${Math.abs(c.extension_atr).toFixed(1)} ATR past the signal`,
  SIGNAL_WEAKENING: c => `Price fell ${Math.abs(c.extension_atr).toFixed(1)} ATR below the signal`,
  DAILY_CONFLICT: () => "Daily trend turned against it",
  WEAK_TREND_REGIME: () => "Daily trend strength faded",
  TARGET_REACHED: () => "Target 1 was reached",
};

function localParts(instant, tz) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(instant).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
}

// The wall-clock minute (since local midnight) at which each 4-hour bar of a typical recent session ends.
function sessionBarEnds(bars, market) {
  const byDay = new Map();
  for (const bar of bars || []) {
    const end = Date.parse(bar.ends_at);
    if (!Number.isFinite(end)) continue;
    const parts = localParts(new Date(end), market.tz);
    const key = `${parts.year}-${parts.month}-${parts.day}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(Number(parts.hour) * 60 + Number(parts.minute));
  }
  const days = [...byDay.values()].slice(0, -1).slice(-6);
  if (!days.length) return [];
  const fullest = days.reduce((best, day) => day.length >= best.length ? day : best, days[0]);
  return [...fullest].sort((a, b) => a - b);
}

function zonedInstant(year, month, day, minutes, tz) {
  const base = Date.UTC(year, month - 1, day) + minutes * 60000;
  let stamp = base;
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = localParts(new Date(stamp), tz);
    const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    stamp += base - wall;
  }
  return new Date(stamp);
}

// The next completed-bar times from now, following the session pattern and skipping weekends.
function nextBarEnds(pattern, market, from = new Date(), count = 3) {
  if (!pattern.length) return [];
  const out = [];
  const start = localParts(from, market.tz);
  for (let offset = 0; offset < 12 && out.length < count; offset += 1) {
    const day = new Date(Date.UTC(Number(start.year), Number(start.month) - 1, Number(start.day) + offset));
    if ([0, 6].includes(day.getUTCDay())) continue;
    for (const minutes of pattern) {
      const instant = zonedInstant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), minutes, market.tz);
      if (instant > from && out.length < count) out.push(instant);
    }
  }
  return out;
}

// Setups that were fresh entries in an earlier scan but no longer are, kept for a day with the reason, so they do
// not simply vanish. Each also shows how the price has moved since the signal.
function recentSetups(previous, allCandidates, freshSymbols, nowIso) {
  const known = new Map();
  for (const item of [...(previous?.candidates || []), ...(previous?.recent_setups || [])]) if (!known.has(item.symbol)) known.set(item.symbol, item);
  const current = new Map(allCandidates.map(candidate => [candidate.symbol, candidate]));
  const cutoff = Date.parse(nowIso) - RECENT_SETUP_HOURS * 3600 * 1000;
  const out = [];
  for (const [symbol, old] of known) {
    if (freshSymbols.has(symbol)) continue;
    const droppedAt = old.dropped_at || nowIso;
    if (Date.parse(droppedAt) < cutoff) continue;
    const now = current.get(symbol) || old;
    const entry = Number(now.signal_entry_price) || Number(old.signal_entry_price) || 0;
    const sign = now.direction === "SHORT" ? -1 : 1;
    const reasonFor = DROP_REASONS[now.entry_status];
    out.push({
      ...now,
      first_seen_at: old.first_seen_at || previous?.generated_at || nowIso,
      dropped_at: droppedAt,
      drop_reason: reasonFor ? reasonFor(now) : "No longer a fresh entry",
      since_signal_pct: entry ? round(sign * (now.price / entry - 1) * 100, 2) : null,
    });
  }
  return out.sort((a, b) => Date.parse(b.dropped_at) - Date.parse(a.dropped_at)).slice(0, 30);
}

// The buy range around a signal, in units of the signal bar's 4-hour range (ATR). Measured as the favourable move
// from the signal price. Edges come from the entry-timing backtest: entries from 1 range below to 0.5 above
// matched the current entry rules; entries up to 2 ranges above still worked; beyond that, or 3 ranges below, they
// weakened. It is guidance only and does not change which setups count as fresh.
const BUY_RANGE_ZONES = [
  { key: "FAILING", label: "Failing", from: -Infinity, to: -3 },
  { key: "DEEP_DIP", label: "Deep dip", from: -3, to: -1 },
  { key: "IN_BUY_RANGE", label: "In buy range", from: -1, to: 0.5 },
  { key: "EXTENDED", label: "Extended", from: 0.5, to: 2 },
  { key: "CHASING", label: "Chasing", from: 2, to: Infinity },
];

function buyRange(direction, entry, atr, price) {
  if (!(entry > 0) || !(atr > 0) || !(price > 0)) return null;
  const sign = direction === "SHORT" ? -1 : 1;
  const favourable = sign * (price - entry) / atr;
  const zone = BUY_RANGE_ZONES.find(item => favourable >= item.from && favourable < item.to) || BUY_RANGE_ZONES[BUY_RANGE_ZONES.length - 1];
  const at = move => Number.isFinite(move) ? round(entry + sign * move * atr, 4) : null;
  const zones = BUY_RANGE_ZONES.map(item => sign === 1
    ? { key: item.key, label: item.label, lo: at(item.from), hi: at(item.to) }
    : { key: item.key, label: item.label, lo: at(item.to), hi: at(item.from) });
  if (sign === -1) zones.reverse();
  const edges = zones.flatMap(item => [item.lo, item.hi]).filter(value => value !== null);
  return {
    state: zone.key, label: zone.label,
    price: round(price, 4), entry: round(entry, 4), atr: round(atr, 4),
    zones,
    scale_min: round(Math.min(...edges) - 0.7 * atr, 4), scale_max: round(Math.max(...edges) + 0.7 * atr, 4),
  };
}

// ---- Dip scan: a second scanner mode ----
// Buys short, sharp drops in stocks that are still in a long-term uptrend, and only while the market itself is under
// stress. Rules and evidence: research/pattern-backtest/README.md (backtest6 to 8, ml_adaptive.py). Backtested on the
// point-in-time S&P 500 from late 2023: dips taken while SPY had fallen 1.5% or more over 5 days averaged +0.66%
// per 5-day trade (+1.14% for the sharper dips), against +0.09% and +0.46% without the gate. Calm-market dips lost money.
// Long side only; shorts were not tested. The gate was chosen after seeing that dips cluster in selloffs, so every pick
// is logged under its own strategy to confirm it on live results.
const DIP_RSI_MAX = 10, DIP_SHARP_RSI = 5, DIP_SHARP_DROP_PCT = -5;
const DIP_STOP_ATR = 2, DIP_TARGET_1_ATR = 1, DIP_TARGET_2_ATR = 2; // the same stock levels as STOP_ATR, TARGET_1_ATR and TARGET_2_ATR
const DIP_GATE_SPY_5D_PCT = -1.5, DIP_GATE_BREADTH = 0.06;

function scoreDip(snapshot, metadata = {}) {
  const dip = snapshot.dip;
  if (!dip || !(dip.close > dip.sma_200) || !(dip.rsi2 < DIP_RSI_MAX)) return null;
  const sharp = dip.rsi2 < DIP_SHARP_RSI && dip.close < dip.sma_5 && dip.return_3d_pct <= DIP_SHARP_DROP_PCT;
  const atr = numeric(snapshot.atr_14) || dip.close * 0.03;
  const stopDistance = Math.max(DIP_STOP_ATR * atr, dip.close * 0.01);
  const score = round(clamp(55 + (DIP_RSI_MAX - dip.rsi2) * 2.5 + clamp(-dip.return_3d_pct, 0, 10) * 1.5 + (sharp ? 10 : 0), 0, 100), 1);
  return {
    symbol: snapshot.symbol, company: metadata.company || snapshot.symbol, sector: metadata.sector || "Unknown",
    currency_symbol: snapshot.currency_symbol, price_decimals: snapshot.price_decimals ?? 2,
    price: snapshot.price, signal_close: dip.close, signal_as_of: dip.as_of, rsi2: dip.rsi2, return_3d_pct: dip.return_3d_pct,
    above_sma200_pct: round((dip.close / dip.sma_200 - 1) * 100, 2), sharp, score,
    label: sharp ? "Sharp dip in an uptrend" : "Dip in an uptrend",
    atr_14: round(atr, 4), atr_14_pct: round(atr / dip.close * 100, 2),
    stop_price: round(Math.max(0.01, dip.close - stopDistance), 4),
    target_1: round(dip.close + DIP_TARGET_1_ATR * atr, 4), target_2: round(dip.close + DIP_TARGET_2_ATR * atr, 4),
    horizon_trading_days: 10,
    reference_lines: referenceLines(snapshot.chart_refs),
    bars: snapshot.chart_daily || [],
  };
}

function buildDipScan(snapshots, spy, metadata) {
  const ready = [...snapshots.values()].filter(snapshot => snapshot.dip);
  if (ready.length < 50) return { available: false, reason: "Not enough daily history was returned to check the 200-day average." };
  const dips = ready.map(snapshot => scoreDip(snapshot, metadata.get(snapshot.symbol))).filter(Boolean)
    .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  const breadth = dips.length / ready.length;
  const spy5d = Number.isFinite(Number(spy?.return_5d_pct)) ? Number(spy.return_5d_pct) : null;
  const marketDrop = spy5d !== null && spy5d <= DIP_GATE_SPY_5D_PCT, washout = breadth >= DIP_GATE_BREADTH;
  const open = marketDrop || washout;
  const reasons = [];
  if (marketDrop) reasons.push(`The S&P 500 (SPY) is down ${Math.abs(spy5d).toFixed(1)}% over 5 days.`);
  if (washout) reasons.push(`${(breadth * 100).toFixed(1)}% of stocks are in a dip inside an uptrend (the gate opens at ${(DIP_GATE_BREADTH * 100).toFixed(0)}%).`);
  return {
    available: true,
    gate: {
      open, spy_5d_pct: spy5d, breadth_pct: round(breadth * 100, 1), breadth_threshold_pct: DIP_GATE_BREADTH * 100, spy_threshold_pct: DIP_GATE_SPY_5D_PCT,
      headline: open ? "Market stress: dip ideas are active" : "Calm market: no dip ideas",
      note: open ? reasons.join(" ") : `Dips only paid off in backtests while the market was under stress. It opens when SPY falls ${Math.abs(DIP_GATE_SPY_5D_PCT)}% or more in 5 days, or when ${(DIP_GATE_BREADTH * 100).toFixed(0)}% or more of stocks are in a dip. Today SPY is ${spy5d === null ? "unavailable" : `${spy5d >= 0 ? "+" : ""}${spy5d.toFixed(1)}%`} over 5 days and ${(breadth * 100).toFixed(1)}% of stocks are in a dip.`,
    },
    scanned: ready.length, dip_count: dips.length,
    candidates: open ? dips.slice(0, 20) : [],
    waiting: open ? [] : dips.slice(0, 20),
    method: "Dip scan: the close is above the 200-day average and RSI(2) is under 10; sharper dips (RSI(2) under 5, below the 5-day average, down 5% or more in 3 days) rank higher. Ideas appear only while the market is under stress. Entry is the next open, stop 2 daily ATRs below, targets 1 and 2 ATRs above, exit when the stop or a target is hit, or by the close of day 10 (most trades finish in 2 to 5 days).",
  };
}

// ---- Pattern scan: a third scanner mode (experimental) ----
// Candlestick patterns on a breakout (long) or breakdown (short) day. Levels: the stop sits just past the pattern's own extreme, kept between
// 1 and 3 daily ATRs from the signal close; targets 1 and 2 are 1R and 2R; the idea is also dead when a day closes back through the breakout
// level; and the time limit is the close of day 10. Backtests (research/pattern-backtest/README.md, backtest9.mjs) found no edge on the long
// side (-0.2% to -0.5% against breakouts without a pattern) and a weak short-side edge that was concentrated in the first half and still lost
// money on absolute terms, so these are not recommendations. Each is logged under the PATTERN strategy to be judged on live results.
function scorePattern(snapshot, metadata = {}) {
  const p = snapshot.pattern;
  if (!p) return null;
  const long = p.direction === "LONG", atr = p.atr;
  const raw = long ? p.close - p.pattern_extreme + PATTERN_STOP_PAD_ATR * atr : p.pattern_extreme + PATTERN_STOP_PAD_ATR * atr - p.close;
  const risk = clamp(raw, PATTERN_STOP_MIN_ATR * atr, PATTERN_STOP_MAX_ATR * atr);
  const step = long ? 1 : -1;
  const score = round(clamp(45 + clamp((p.volume_ratio - PATTERN_VOLUME_RATIO) * 12, 0, 25) + (p.patterns.length - 1) * 10 + clamp(p.above_sma200_pct * (long ? 1 : -1), 0, 20) * 0.5, 0, 100), 1);
  return {
    symbol: snapshot.symbol, company: metadata.company || snapshot.symbol, sector: metadata.sector || "Unknown",
    currency_symbol: snapshot.currency_symbol, price_decimals: snapshot.price_decimals ?? 2,
    direction: p.direction, patterns: p.patterns, label: `${p.patterns.join(" + ")} on a ${long ? "breakout" : "breakdown"}`,
    price: snapshot.price, signal_close: p.close, signal_as_of: p.as_of, volume_ratio: p.volume_ratio, above_sma200_pct: p.above_sma200_pct,
    breakout_level: p.breakout_level, pattern_extreme: p.pattern_extreme, score,
    atr_14: p.atr, atr_14_pct: round(p.atr / p.close * 100, 2), risk_atr: round(risk / atr, 2),
    stop_price: round(Math.max(0.01, p.close - step * risk), 4),
    target_1: round(Math.max(0.01, p.close + step * risk), 4), target_2: round(Math.max(0.01, p.close + step * 2 * risk), 4),
    failure_level: p.breakout_level, horizon_trading_days: 10,
    reference_lines: referenceLines(snapshot.chart_refs),
    bars: snapshot.chart_daily || [],
  };
}

function buildPatternScan(snapshots, metadata) {
  const ready = [...snapshots.values()].filter(snapshot => snapshot.dip);
  if (ready.length < 50) return { available: false, reason: "Not enough daily history was returned to check the 200-day average." };
  const picks = ready.map(snapshot => scorePattern(snapshot, metadata.get(snapshot.symbol))).filter(Boolean)
    .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  const breakouts = picks.filter(pick => pick.direction === "LONG"), breakdowns = picks.filter(pick => pick.direction === "SHORT");
  return {
    available: true, experimental: true, scanned: ready.length, breakout_count: breakouts.length, breakdown_count: breakdowns.length,
    breakouts: breakouts.slice(0, 15), breakdowns: breakdowns.slice(0, 15),
    notice: "Experimental. In backtests on the S&P 500 these patterns did not beat a breakout without a pattern on the long side, and only weakly and unreliably on the short side. They are logged to the track record so live results can confirm or reject them. Research, not advice.",
    method: "Pattern scan: the day's candles form a bullish pattern (engulfing, hammer, morning star, three white soldiers) while the close breaks the prior 20-day high on volume at least 1.4x the 50-day average and above the 200-day average, or the bearish mirror (engulfing, shooting star, evening star, three black crows) on a close under the prior 20-day low below the 200-day average. Entry is the next open. The stop sits just past the pattern's extreme (between 1 and 3 daily ATRs away), targets are 1R and 2R, the idea fails if a day closes back through the breakout level, and any trade still open is closed at the close of day 10.",
  };
}

// ---- SEC filing check (US stocks) ----
// Free and keyless: SEC EDGAR lists every filing by company. It has no earnings calendar, but a company's earnings releases (8-K item 2.02)
// are quarterly and seasonal, so the next one is estimated from the same quarter a year ago. It is an estimate, labelled as such. EDGAR also
// shows serious events (non-reliance on financials, bankruptcy, delisting notice, late filings) which skip an idea outright.
const EDGAR_STALE_MS = 20 * 3600 * 1000, EDGAR_EARNINGS_WINDOW_DAYS = 14, EDGAR_EARNINGS_SKIP_DAYS = 3;
const EDGAR_SEVERE_ITEMS = { "4.02": "the company said past financial statements can no longer be relied on", "1.03": "bankruptcy or receivership", "3.01": "a stock-exchange delisting notice", "2.04": "a debt acceleration event" };
const EDGAR_CAUTION_ITEMS = { "4.01": "an auditor change", "5.02": "an executive or director change", "2.05": "a restructuring" };

function edgarHeaders(env) {
  return { accept: "application/json", "user-agent": env?.SEC_CONTACT ? `IntelligentPortfolio/1.0 ${env.SEC_CONTACT}` : "IntelligentPortfolio/1.0 research tool" };
}

async function edgarCacheRead(env, id) {
  if (!env?.DB) return scanMemory.get(id) || null;
  try {
    const row = await env.DB.prepare("SELECT payload FROM scan_cache WHERE market = ? LIMIT 1").bind(id).first();
    return row?.payload ? JSON.parse(row.payload) : null;
  } catch { return null; }
}
async function edgarCacheWrite(env, id, value) {
  if (!env?.DB) { scanMemory.set(id, value); return; }
  try {
    await env.DB.prepare("INSERT OR IGNORE INTO scan_cache (market, payload, generated_at, refreshing_until) VALUES (?, NULL, ?, NULL)").bind(id, new Date(0).toISOString()).run();
    await env.DB.prepare("UPDATE scan_cache SET payload = ?, generated_at = ? WHERE market = ?").bind(JSON.stringify(value), new Date().toISOString(), id).run();
  } catch { /* the next scan retries */ }
}

async function edgarCikMap(env) {
  const cached = await edgarCacheRead(env, "EDGAR:CIK");
  if (cached?.at && Date.now() - cached.at < 7 * 86400000 && cached.map) return cached.map;
  try {
    const response = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: edgarHeaders(env), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = Object.values(await response.json());
    const map = {};
    for (const row of rows) if (row?.ticker && row.cik_str) map[String(row.ticker).toUpperCase()] = Number(row.cik_str);
    await edgarCacheWrite(env, "EDGAR:CIK", { at: Date.now(), map });
    return map;
  } catch { return cached?.map || null; }
}

const dayNumber = iso => Math.floor(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) / 86400000);

// Pure: turns a submissions "recent" block into the flags the ranking uses. todayDay is a day number so it can be tested.
function edgarFlagsFrom(recent, todayDay) {
  const forms = recent?.form || [], dates = recent?.filingDate || [], items = recent?.items || [];
  const earnings = [], severe = [], cautions = [];
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i], date = dates[i], codes = String(items[i] || "").split(",").map(code => code.trim()).filter(Boolean);
    const age = todayDay - dayNumber(date);
    if (form === "8-K" && codes.includes("2.02")) earnings.push(dayNumber(date));
    if (age <= 30 && form.startsWith("8-K")) for (const code of codes) {
      if (EDGAR_SEVERE_ITEMS[code]) severe.push(`${EDGAR_SEVERE_ITEMS[code]} (8-K ${String(date).slice(0, 10)})`);
      else if (EDGAR_CAUTION_ITEMS[code]) cautions.push(`${EDGAR_CAUTION_ITEMS[code]} (8-K ${String(date).slice(0, 10)})`);
    }
    if (age <= 90 && (form === "NT 10-Q" || form === "NT 10-K")) severe.push(`a late-filing notice (${form}, ${String(date).slice(0, 10)})`);
  }
  earnings.sort((a, b) => b - a);
  let estimate = null;
  if (earnings.length) {
    const quarterly = earnings[0] + 91;
    const seasonal = earnings.length >= 4 ? earnings[3] + 364 : null; // the release four quarters back, plus a year
    estimate = seasonal !== null && Math.abs(seasonal - quarterly) <= 21 ? seasonal : quarterly;
  }
  const inDays = estimate === null ? null : estimate - todayDay;
  return {
    earnings_in_days: inDays !== null && inDays >= -7 ? inDays : null,
    earnings_estimate: inDays !== null && inDays >= -7 ? new Date(estimate * 86400000).toISOString().slice(0, 10) : null,
    last_reported_days_ago: earnings.length ? todayDay - earnings[0] : null,
    severe: [...new Set(severe)].slice(0, 3), cautions: [...new Set(cautions)].slice(0, 3),
  };
}

// The next report date from Robinhood's earnings feed: an exact date, with a flag for whether the company has confirmed it and whether it reports
// before the open ("am") or after the close ("pm"). Null when the feed has nothing for the symbol.
async function robinhoodNextEarnings(symbol, todayDay) {
  const payload = await fetchJson(`${ROBINHOOD_EARNINGS}?symbol=${encodeURIComponent(symbol)}`);
  const rows = (payload?.results || []).filter(row => row?.report?.date).map(row => ({ day: dayNumber(row.report.date), date: String(row.report.date).slice(0, 10), confirmed: row.report.verified === true, timing: row.report.timing || null }));
  return rows.filter(row => row.day >= todayDay).sort((a, b) => a.day - b.day)[0] || null;
}

// Returns Map(symbol -> flags) for the US symbols asked about. Cached per symbol for 20 hours; never throws.
// maxFetch caps the symbols looked up in one run (each costs up to two outgoing requests, and a scheduled run may make 50 in all); cached ones are free.
async function loadFilingFlags(env, symbols, maxFetch = 6) {
  const out = new Map();
  try {
    const cache = (await edgarCacheRead(env, "EDGAR:FLAGS")) || {};
    const now = Date.now(), todayDay = Math.floor(now / 86400000), due = [];
    for (const symbol of symbols) {
      const hit = cache[symbol];
      if (hit && now - hit.at < EDGAR_STALE_MS) out.set(symbol, { ...hit.flags, source: "SEC EDGAR", checked_at: new Date(hit.at).toISOString() });
      else due.push(symbol);
    }
    if (due.length) {
      const ciks = await edgarCikMap(env);
      let changed = false;
      for (const symbol of due.slice(0, maxFetch)) {
        const cik = ciks?.[symbol.toUpperCase().replace(/\./g, "-")];
        let flags = null;
        if (cik) {
          try {
            const response = await fetch(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, { headers: edgarHeaders(env), signal: AbortSignal.timeout(15000) });
            if (response.ok) flags = edgarFlagsFrom((await response.json())?.filings?.recent, todayDay);
          } catch { /* fall through to the earnings feed alone */ }
        }
        let next = null;
        try { next = await robinhoodNextEarnings(symbol, todayDay); } catch { /* the SEC estimate stands */ }
        if (flags) flags.earnings_confirmed = false;
        if (next) {
          flags = flags || { severe: [], cautions: [], last_reported_days_ago: null };
          Object.assign(flags, { earnings_in_days: next.day - todayDay, earnings_estimate: next.date, earnings_confirmed: next.confirmed, earnings_timing: next.timing, earnings_source: next.confirmed ? "company-confirmed date" : "projected date" });
        } else if (flags && flags.earnings_estimate) flags.earnings_source = "estimate from past SEC filings";
        if (!flags) { if (cache[symbol]) out.set(symbol, { ...cache[symbol].flags, source: "SEC EDGAR", checked_at: new Date(cache[symbol].at).toISOString(), stale: true }); continue; }
        cache[symbol] = { at: now, flags };
        out.set(symbol, { ...flags, source: "SEC EDGAR and Robinhood earnings", checked_at: new Date(now).toISOString() });
        changed = true;
        await new Promise(resolve => setTimeout(resolve, 120)); // stay well under the SEC's 10 requests per second
      }
      if (changed) await edgarCacheWrite(env, "EDGAR:FLAGS", cache);
    }
  } catch (error) { console.error(`SEC filing check failed: ${cleanError(error)}`); }
  return out;
}

// ---- Unified ranking: one list for every idea from every scanner ----
// The scanners (Supertrend, dip, pattern) feed one ranked "Top ideas" list, each row tagged with the scanner that found it. Code does the
// arithmetic (levels, risk, distance, hard filters, a rules score); when an Anthropic key is configured, a Claude model then ranks the
// survivors and writes the reasoning, and the app takes every price from the scanner's own numbers, never from the model.
// Backtest evidence per scanner comes from research/pattern-backtest/README.md. n is the number of backtested trades.
const RANK_EVIDENCE = {
  SUPERTREND: { label: "Supertrend", n: 503, win_rate_pct: 45, avg_win_pct: 11.3, avg_loss_pct: -6.2, ev_pct: 1.61, experimental: false,
    note: "Daily Supertrend flip with the ADX gate, held until a daily close under the Supertrend line (about 34 days on average); no target. About 500 trades over four years in a mostly rising market; the edge was larger in the first half." },
  DIP: { label: "Dip", n: 4754, win_rate_pct: 69, avg_win_pct: null, avg_loss_pct: null, ev_pct: 0.66, experimental: false,
    note: "Dip above the 200-day average while SPY was down 1.5% or more over 5 days, 5-day hold. The gate was chosen after seeing the data, and the trades cluster in a few selloff weeks; calm-market dips lost money." },
  DIP_SHARP: { label: "Dip", n: 1010, win_rate_pct: 72, avg_win_pct: null, avg_loss_pct: null, ev_pct: 1.14, experimental: false,
    note: "Sharper dip (RSI(2) under 5, down 5% or more in 3 days) while SPY was down 1.5% or more over 5 days. Fewer trades, more clustered in a few selloff weeks." },
  PATTERN_LONG: { label: "Pattern", n: 347, win_rate_pct: 55, avg_win_pct: null, avg_loss_pct: null, ev_pct: -0.37, experimental: true,
    note: "Bullish candlestick pattern on a 20-day-high breakout with volume 1.4x average, 5-day hold with 2 ATR stop and 1 ATR target. It did worse than breakouts without a pattern (-0.2% to -0.5% per trade) and lost money in absolute terms." },
  PATTERN_SHORT: { label: "Pattern", n: 379, win_rate_pct: 57, avg_win_pct: null, avg_loss_pct: null, ev_pct: -0.61, experimental: true,
    note: "Bearish candlestick pattern on a 20-day-low breakdown with volume 1.4x average, 5-day hold. Beat breakdowns without a pattern by about +0.6% but still lost money in absolute terms, and the edge sat mostly in the first half." },
};
// Supertrend on the Sensex 30 and on forex pairs has not been backtested, so there is no figure to score: the evidence is marked unknown,
// confidence stays Low, and the scores lean on reward to risk, alignment and entry quality only.
RANK_EVIDENCE.SUPERTREND_IN = { label: "Supertrend", n: 0, win_rate_pct: null, avg_win_pct: null, avg_loss_pct: null, ev_pct: null, experimental: false,
  note: "Not backtested on the Sensex 30. The US result does not carry over automatically: this market, its hours and its costs differ. Ideas exit at the first of the stop, target 1 or the tenth daily close." };
RANK_EVIDENCE.SUPERTREND_FX = { label: "Supertrend", n: 0, win_rate_pct: null, avg_win_pct: null, avg_loss_pct: null, ev_pct: null, experimental: false,
  note: "Not backtested on forex pairs. The only forex test (chart patterns) found nothing that beat random entries. Ideas exit at the first of the stop, target 1 or the tenth daily close." };
const RANK_MAX_STOP_PCT = 12, RANK_MAX_CHASE_ATR = 1.5, RANK_STALE_DAYS = 6, RANK_MIN_PROVEN_TRADES = 100, RANK_MAX_ITEMS = 30;

const rankDaysOld = date => { const t = Date.parse(String(date).slice(0, 10)); return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 86400000)) : null; };

function rankItem(base) {
  const { direction, entry, stop, target_1: t1, target_2: t2, price } = base;
  const long = direction === "LONG", risk = Math.abs(entry - stop);
  const reward = t => Number.isFinite(t) ? Math.abs(t - entry) : null;
  return {
    ...base,
    stop_pct: entry > 0 ? round(risk / entry * 100, 2) : null,
    stop_atr: base.atr > 0 ? round(risk / base.atr, 2) : null,
    rr_t1: risk > 0 && reward(t1) !== null ? round(reward(t1) / risk, 2) : null,
    rr_t2: risk > 0 && reward(t2) !== null ? round(reward(t2) / risk, 2) : null,
    from_entry_atr: base.atr > 0 ? round((long ? price - entry : entry - price) / base.atr, 2) : null,
    stop_hit: long ? price <= stop : price >= stop,
  };
}

function rankHardFilter(item) {
  if (item.stop_hit) return "The stop is already hit.";
  if (item.stop_pct !== null && item.stop_pct > RANK_MAX_STOP_PCT) return `The stop is ${item.stop_pct}% from entry, wider than the ${RANK_MAX_STOP_PCT}% limit.`;
  if (item.strategy !== "SUPERTREND" && item.from_entry_atr !== null && item.from_entry_atr > RANK_MAX_CHASE_ATR) return `Price has already run ${item.from_entry_atr} ATR past the signal close (limit ${RANK_MAX_CHASE_ATR}).`;
  if (item.age_days !== null && item.age_days > RANK_STALE_DAYS && item.strategy !== "SUPERTREND") return `The signal is ${item.age_days} days old.`;
  const f = item.filing;
  if (f?.severe?.length) return `SEC filing red flag: ${f.severe[0]}.`;
  if (f && item.strategy !== "SUPERTREND" && f.earnings_in_days != null && f.earnings_in_days >= 0 && f.earnings_in_days <= EDGAR_EARNINGS_SKIP_DAYS)
    return `Earnings ${f.earnings_confirmed ? "are confirmed for" : "are expected around"} ${f.earnings_estimate}${f.earnings_confirmed ? "" : " (estimate)"}, inside this idea's 10-day hold.`;
  return null;
}

// Rules score, 0-100, with the weights of the ranking brief: expected value 35, reward to risk 20, trend and market alignment 15,
// entry quality 15, liquidity 10, freshness 5. Used to order the list when no AI key is set, and handed to the model as a reference.
function rankRulesScore(item) {
  const ev = item.evidence.ev_pct, known = ev !== null;
  const evPart = known ? clamp((ev + 1) / 3 * 100, 0, 100) : 40; // no backtest in this market: a below-average, not a negative, score
  const rrRef = item.strategy === "SUPERTREND" && item.rr_t2 === null ? 1.8 : (item.rr_t2 ?? item.rr_t1 ?? 1);
  const rrPart = clamp(rrRef / 3 * 100, 0, 100);
  const alignPart = item.alignment_score;
  const entryPart = clamp(100 - 40 * clamp(Math.max(0, item.from_entry_atr ?? 0) / RANK_MAX_CHASE_ATR, 0, 1) - (item.stop_atr > 3 ? 25 : 0) - (item.stop_atr < 1 ? 15 : 0), 0, 100);
  const liquidityPart = item.volume_ratio >= 1.4 ? 75 : 55; // dollar volume is not in the feed, so liquidity is judged from the volume ratio only
  const age = item.age_days ?? 0;
  const freshPart = age <= 1 ? 100 : age <= 3 ? 65 : age <= 5 ? 35 : 10;
  let score = 0.35 * evPart + 0.2 * rrPart + 0.15 * alignPart + 0.15 * entryPart + 0.1 * liquidityPart + 0.05 * freshPart;
  if (item.evidence.experimental) score -= 12;
  if (item.evidence.n < RANK_MIN_PROVEN_TRADES) score -= 10;
  if (known && ev <= 0) score = Math.min(score, 40);
  if (item.filing?.earnings_in_days != null && item.filing.earnings_in_days >= 0 && item.filing.earnings_in_days <= EDGAR_EARNINGS_WINDOW_DAYS) score -= 10; // earnings inside the next two weeks
  if (item.filing?.cautions?.length) score -= 3;
  return round(clamp(score, 0, 100), 1);
}

function rankConfidence(item) {
  const e = item.evidence;
  if (e.ev_pct === null) return "Low";
  if (e.ev_pct > 0.5 && e.n >= 500 && item.alignment_score >= 70) return "High";
  if (e.ev_pct > 0) return "Med";
  return "Low";
}

function rankRulesReason(item) {
  const e = item.evidence, signed = value => `${value >= 0 ? "+" : ""}${value}`;
  const parts = [e.ev_pct === null ? `${e.label}: not backtested in this market` : `${e.label}: backtest ${signed(e.ev_pct)}% per trade, ${e.win_rate_pct}% wins (${e.n.toLocaleString("en-US")} trades)`];
  if (item.rr_t1 !== null) parts.push(`R:R ${item.rr_t1} to target 1`);
  else parts.push("exits on the daily trend line");
  if (item.from_entry_atr !== null) parts.push(`${item.from_entry_atr} ATR from the entry`);
  if (e.experimental) parts.push("experimental, not recommended");
  const f = item.filing;
  if (f?.earnings_in_days != null && f.earnings_in_days >= 0 && f.earnings_in_days <= EDGAR_EARNINGS_WINDOW_DAYS) parts.push(f.earnings_confirmed ? `earnings ${f.earnings_estimate}${f.earnings_timing === "pm" ? " after close" : f.earnings_timing === "am" ? " before open" : ""}` : `earnings expected about ${f.earnings_estimate} (estimate)`);
  if (f?.cautions?.length) parts.push(`recent filing: ${f.cautions[0]}`);
  return parts.join(" · ");
}

function buildRanking({ candidates, dipScan, patternScan, snapshots, trend, marketId = "US", filings = new Map() }) {
  const marketState = trend?.state || "UNKNOWN";
  const agrees = direction => marketState === "UP" ? (direction === "LONG" ? 100 : 25) : marketState === "DOWN" ? (direction === "SHORT" ? 100 : 25) : 55;
  const raw = [];
  for (const c of candidates || []) {
    const entry = numeric(c.signal_entry_price), atr = numeric(c.daily_atr) || numeric(c.signal_atr);
    if (!(entry > 0) || !["LONG", "SHORT"].includes(c.direction)) continue;
    // US stocks exit on the daily Supertrend line with no target (backtested). India and forex have no such test and keep the scanner's own
    // ATR stop, two targets and ten-day limit.
    const us = marketId === "US";
    const levels = pickLevels(c.direction, entry, numeric(c.signal_atr), marketId, numeric(c.daily_atr), c.daily_supertrend_value);
    raw.push({
      strategy: "SUPERTREND", evidence_key: us ? "SUPERTREND" : marketId === "FX" ? "SUPERTREND_FX" : "SUPERTREND_IN", symbol: c.symbol, company: c.company, sector: c.sector, direction: c.direction, price: c.price,
      entry: round(entry, 4), stop: round(levels.stop, 4), target_1: us ? null : round(levels.target1, 6), target_2: us ? null : round(levels.target2, 6), atr, atr_pct: atr > 0 ? round(atr / entry * 100, 2) : null,
      volume_ratio: null, age_days: rankDaysOld(c.signal_confirmed_at), scanner_score: c.score, tag: "Supertrend", detail: c.label,
      exit_rule: us ? "Leave when a day closes " + (c.direction === "SHORT" ? "over" : "under") + " the daily Supertrend line, at the next open. No fixed target and no time limit."
        : "Leave at the stop, at target 1 or 2, or at the close of day 10, whichever comes first.",
      alignment_score: Math.round((agrees(c.direction) + (c.daily_aligned && c.daily_adx >= 20 ? 100 : 40)) / 2),
      alignment_note: `Daily Supertrend ${c.daily_supertrend_direction}, daily ADX ${c.daily_adx}${c.daily_adx_rising ? " and rising" : ""}; market ${marketState.toLowerCase()}.`,
      currency_symbol: c.currency_symbol, price_decimals: c.price_decimals,
    });
  }
  if (dipScan?.available && dipScan.gate?.open) {
    for (const d of dipScan.candidates || []) {
      raw.push({
        strategy: "DIP", evidence_key: d.sharp ? "DIP_SHARP" : "DIP", symbol: d.symbol, company: d.company, sector: d.sector, direction: "LONG", price: d.price,
        entry: d.signal_close, stop: d.stop_price, target_1: d.target_1, target_2: d.target_2, atr: d.atr_14, atr_pct: d.atr_14_pct,
        volume_ratio: null, age_days: rankDaysOld(d.signal_as_of), scanner_score: d.score, tag: d.sharp ? "Sharp dip" : "Dip", detail: d.label,
        exit_rule: "Leave at the stop, at target 1, or at the close of day 10, whichever comes first.",
        alignment_score: 70, alignment_note: `Stock above its 200-day average; the market-stress gate is open (SPY ${dipScan.gate.spy_5d_pct ?? "n/a"}% over 5 days).`,
        currency_symbol: d.currency_symbol, price_decimals: d.price_decimals,
      });
    }
  }
  if (patternScan?.available) {
    for (const p of [...(patternScan.breakouts || []), ...(patternScan.breakdowns || [])]) {
      raw.push({
        strategy: "PATTERN", evidence_key: p.direction === "LONG" ? "PATTERN_LONG" : "PATTERN_SHORT", symbol: p.symbol, company: p.company, sector: p.sector, direction: p.direction, price: p.price,
        entry: p.signal_close, stop: p.stop_price, target_1: p.target_1, target_2: p.target_2, atr: p.atr_14, atr_pct: p.atr_14_pct,
        volume_ratio: p.volume_ratio, age_days: rankDaysOld(p.signal_as_of), scanner_score: p.score, tag: "Pattern", detail: p.label,
        exit_rule: `Leave at the stop, at target 1 or 2, when a day closes back ${p.direction === "LONG" ? "under" : "over"} ${p.failure_level}, or at the close of day 10.`,
        alignment_score: agrees(p.direction), alignment_note: `Close beyond the 20-day ${p.direction === "LONG" ? "high" : "low"} on ${p.volume_ratio}x volume; market ${marketState.toLowerCase()}.`,
        currency_symbol: p.currency_symbol, price_decimals: p.price_decimals,
      });
    }
  }
  const byListPosition = new Map();
  for (const strategy of ["SUPERTREND", "DIP", "PATTERN"]) raw.filter(r => r.strategy === strategy).sort((a, b) => b.scanner_score - a.scanner_score).forEach((r, i) => byListPosition.set(r, i + 1));
  const items = [], rejected = [];
  for (const r of raw) {
    const item = rankItem({ ...r, id: `${r.strategy}:${r.symbol}:${r.direction}`, evidence: RANK_EVIDENCE[r.evidence_key], scanner_rank_in_list: byListPosition.get(r), filing: filings.get(r.symbol) || null });
    const reason = rankHardFilter(item);
    if (reason) rejected.push({ id: item.id, symbol: item.symbol, strategy: item.strategy, tag: item.tag, reason });
    else items.push(item);
  }
  for (const item of items) item.rules_score = rankRulesScore(item);
  items.sort((a, b) => b.rules_score - a.rules_score || a.symbol.localeCompare(b.symbol));
  // Same sector and direction: the third and later setups are the same bet, so they lose ground.
  const seen = new Map();
  for (const item of items) {
    const key = `${item.sector}|${item.direction}`, count = seen.get(key) || 0;
    seen.set(key, count + 1);
    if (count >= 2) item.rules_score = round(Math.max(0, item.rules_score - 8 * (count - 1)), 1);
    item.crowded = count >= 2;
  }
  items.sort((a, b) => b.rules_score - a.rules_score || a.symbol.localeCompare(b.symbol));
  const kept = items.slice(0, RANK_MAX_ITEMS);
  kept.forEach((item, index) => {
    item.rank = index + 1;
    item.score = item.rules_score;
    item.confidence = rankConfidence(item);
    item.reason = rankRulesReason(item);
    item.sources = ["rules"];
    if (index < 12) item.bars = snapshots.get(item.symbol)?.chart_daily || [];
    delete item.evidence_key;
  });
  const positive = kept.filter(item => item.evidence.ev_pct > 0), unknown = kept.filter(item => item.evidence.ev_pct === null);
  const headline = positive.length ? `${positive.length} idea${positive.length === 1 ? "" : "s"} with a positive backtest edge today`
    : unknown.length ? `${unknown.length} Supertrend idea${unknown.length === 1 ? "" : "s"}; this market has no backtest, so none can be called proven`
    : (kept.length ? "Nothing here has a positive backtest edge today" : "No scanner ideas today");
  return {
    available: true, source: "rules", model: null,
    headline,
    nothing_compelling: !positive.length && !unknown.length,
    market_state: marketState,
    items: kept, rejected: rejected.slice(0, 40),
    data_gaps: [
      marketId === "US" ? "Earnings dates come from Robinhood's earnings feed (exact when the company has confirmed, otherwise projected, with an SEC-filing estimate as backup), and no news feed is connected, so news and events inside the holding window are not checked." : "No earnings calendar or news feed is connected for this market, so earnings or events inside the holding window are not checked.",
      marketId === "FX" ? "Forex has no volume data, so liquidity is not assessed." : "Dollar volume is not in the data feed; liquidity is judged from the volume ratio only.",
      marketId === "US" ? "Backtest figures are per strategy, not per stock, and most were tested on the S&P 500 in a mostly rising market." : "Supertrend has not been backtested in this market, so expected value is unknown and scores rest on reward to risk, alignment and entry quality. The dip and pattern scanners are US-only.",
    ],
    ordering_notes: null, deep_dives: [],
    method: "Rules: expected value from each scanner's backtest 35%, reward to risk 20%, trend and market alignment 15%, entry quality 15%, liquidity 10%, freshness 5%. Experimental and unproven scanners are penalised, negative-edge scanners are capped, and a third setup in the same sector and direction loses ground. Hard filters drop setups with a stop already hit, a stop wider than 12%, a chase of more than 1.5 ATR, or a stale signal.",
  };
}

const RANKING_SYSTEM_PROMPT = `ROLE
You are a disciplined swing-trading analyst reviewing every setup currently produced by our scanner. Rank them from best to worst by risk-adjusted expected value, and say clearly which to skip. You are not giving personalized financial advice; you are scoring rule-based setups for a research tool.

INPUT
You receive one JSON object: market context, the strategy evidence (backtest win rate, average win and loss where known, expected value per trade, sample size), the setups that passed the code's hard filters (each with entry, stop, targets, risk, reward to risk, distance from entry in ATR, age, alignment, a rules_score and rules rank), and the setups the code already rejected. Use ONLY this data. If a field is missing, say so and lower confidence. Never invent prices, statistics or news. Do not output any price: the app takes all prices from the input.

HOW TO SCORE (0-100)
- 35% expected value: use the strategy's own backtest figures (ev_pct per trade, win rate, sample size). Dips and Pattern ideas are graded on their own stop and first target within 10 days; Supertrend ideas have no target and exit on a daily close under the trend line, so judge them by their average win versus average loss, not by reward to the first target. Do not apply a single reward-to-risk cutoff across strategies: dips use a 2 ATR stop with a 1 ATR first target by design.
- 20% reward to risk of this specific trade.
- 15% trend and market alignment.
- 15% entry quality: closeness to the entry and stop size relative to ATR.
- 10% liquidity and slippage risk (dollar volume is not available: say so).
- 5% freshness.
Penalize experimental strategies, small backtest samples, strategies whose backtest expected value is zero or negative (they cannot be High confidence and should not sit in the top tier), crowding in one sector, and setups that are really the same bet. Make sure the top 10 is not all one strategy or one direction unless the evidence strongly justifies it. You may reject additional setups with a one-line reason.

RULES
- Prefer fewer, higher-conviction picks over a long list. Be explicit when the honest answer is "nothing here is compelling today".
- Do not recommend position sizes or say "buy"; present ranked research.
- Show numbers from the input in your reasons (for example "backtest +1.6% per trade, 45% wins, 503 trades").
- Write plain, short sentences. No markdown.

OUTPUT
Reply with ONE JSON object and nothing else, with exactly these keys:
{
 "headline": string, at most 140 characters, the one-line takeaway for today,
 "nothing_compelling": boolean,
 "ranked": [ { "id": string copied from the input, "score": integer 0-100, "confidence": "High" | "Med" | "Low", "reason": one sentence, at most 170 characters } ] best to worst, including only setups worth listing,
 "deep_dives": [ { "id": string, "bull": one or two sentences, "bear": one or two sentences, "invalidation": one sentence } ] for the top 5 ranked setups,
 "rejected": [ { "id": string, "reason": one short sentence } ] for setups you drop beyond the code's own rejections,
 "data_gaps": [ strings ] anything missing or uncertain,
 "ordering_notes": string, where your order disagrees with the scanners' own ordering or the rules_score, and why (empty string if none)
}`;

function rankInputHash(items) {
  let h = 2166136261;
  for (const text of items.map(item => `${item.id}|${item.stop}|${item.target_1}`).sort().join(";")) { h ^= text.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}

function rankModelInput(ranking, market) {
  const slim = item => ({ id: item.id, symbol: item.symbol, company: item.company, sector: item.sector, strategy: item.strategy, tag: item.tag, detail: item.detail, direction: item.direction,
    price: item.price, entry: item.entry, stop: item.stop, target_1: item.target_1, target_2: item.target_2, exit_rule: item.exit_rule, stop_pct: item.stop_pct, stop_atr: item.stop_atr,
    rr_to_target_1: item.rr_t1, rr_to_target_2: item.rr_t2, from_entry_atr: item.from_entry_atr, age_days: item.age_days, atr_pct: item.atr_pct, volume_ratio: item.volume_ratio,
    alignment: item.alignment_note, scanner_rank_within_its_list: item.scanner_rank_in_list, scanner_score: item.scanner_score, rules_score: item.rules_score, rules_rank: item.rank,
    same_sector_crowded: item.crowded, sec_filings: item.filing ? { earnings_in_days: item.filing.earnings_in_days, earnings_date: item.filing.earnings_estimate, earnings_date_is_confirmed: item.filing.earnings_confirmed === true, earnings_timing: item.filing.earnings_timing, caution_filings_last_30_days: item.filing.cautions } : undefined, evidence: Object.keys(RANK_EVIDENCE).find(key => RANK_EVIDENCE[key] === item.evidence) });
  const setups = ranking.items.map(slim);
  const used = new Set(setups.map(setup => setup.evidence));
  return {
    as_of: new Date().toISOString().slice(0, 10), market: market || "US", market_trend: ranking.market_state,
    market_note: market === "FX" ? "Forex pairs: no volume data, no backtest for Supertrend here, ideas exit at the stop, a target or day 10. Where evidence is unknown, say so and keep confidence Low; do not borrow the US figures."
      : market === "IN" ? "Sensex 30 (BSE) stocks in rupees: no backtest for Supertrend here, ideas exit at the stop, a target or day 10. Where evidence is unknown, say so and keep confidence Low; do not borrow the US figures." : undefined,
    strategy_evidence: Object.fromEntries(Object.entries(RANK_EVIDENCE).filter(([key]) => used.has(key))),
    hard_filters_applied_by_code: { sec_red_flag_filings: true, dip_and_pattern_with_earnings_within_days: EDGAR_EARNINGS_SKIP_DAYS, stop_wider_than_pct: RANK_MAX_STOP_PCT, chase_beyond_atr: RANK_MAX_CHASE_ATR, stale_after_days: RANK_STALE_DAYS, stop_already_hit: true },
    setups,
    rejected_by_code: ranking.rejected.map(({ id, reason }) => ({ id, reason })),
  };
}

const RANKING_JSON_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" }, nothing_compelling: { type: "boolean" },
    ranked: { type: "array", items: { type: "object", properties: { id: { type: "string" }, score: { type: "integer" }, confidence: { type: "string", enum: ["High", "Med", "Low"] }, reason: { type: "string" } }, required: ["id", "score", "confidence", "reason"] } },
    deep_dives: { type: "array", items: { type: "object", properties: { id: { type: "string" }, bull: { type: "string" }, bear: { type: "string" }, invalidation: { type: "string" } }, required: ["id", "bull", "bear", "invalidation"] } },
    rejected: { type: "array", items: { type: "object", properties: { id: { type: "string" }, reason: { type: "string" } }, required: ["id", "reason"] } },
    data_gaps: { type: "array", items: { type: "string" } }, ordering_notes: { type: "string" },
  },
  required: ["headline", "nothing_compelling", "ranked", "deep_dives", "rejected", "data_gaps", "ordering_notes"],
};
const WORKERS_AI_RANKING_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

function parseModelJson(text) {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return JSON");
  return JSON.parse(text.slice(start, end + 1));
}

// Workers AI: an open model that runs on Cloudflare itself, through the AI binding. No API key and no outside account.
async function callWorkersAiRanking(env, input) {
  const model = env.RANKING_MODEL || WORKERS_AI_RANKING_MODEL;
  const body = { messages: [{ role: "system", content: RANKING_SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(input) }], max_tokens: 5000, temperature: 0.2 };
  // A model call that hangs is abandoned after 100 seconds, so it can never hold the run open.
  const run = params => Promise.race([env.AI.run(model, params), new Promise((_, reject) => setTimeout(() => reject(new Error("The AI model took too long")), 100000))]);
  let result;
  try { result = await run({ ...body, response_format: { type: "json_schema", json_schema: RANKING_JSON_SCHEMA } }); }
  catch (error) {
    if (/too long/.test(cleanError(error))) throw error;
    console.error(`Workers AI json mode failed, retrying plain: ${cleanError(error)}`);
    result = await run(body);
  }
  const out = result?.response ?? result;
  return { parsed: typeof out === "string" ? parseModelJson(out) : out, model };
}

async function callRankingModel(env, input) {
  if (env.AI && env.RANKING_PROVIDER !== "anthropic") return callWorkersAiRanking(env, input);
  const request = withFallback => ({
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2026-10-21", ...(withFallback ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}) },
    body: JSON.stringify({
      model: env.RANKING_MODEL || "claude-opus-5-5", max_tokens: 12000, output_config: { effort: "high" }, ...(withFallback ? { fallbacks: "default" } : {}),
      system: RANKING_SYSTEM_PROMPT, messages: [{ role: "user", content: JSON.stringify(input) }],
    }),
    signal: AbortSignal.timeout(240000),
  });
  let response = await fetch("https://api.anthropic.com/v1/messages", request(true));
  if (response.status === 400) response = await fetch("https://api.anthropic.com/v1/messages", request(false));
  if (!response.ok) throw new Error(`Anthropic API returned HTTP ${response.status}`);
  const data = await response.json();
  if (data.stop_reason === "refusal") throw new Error("The model declined the request");
  if (data.stop_reason === "max_tokens") throw new Error("The model's answer was cut off");
  const text = (data.content || []).filter(block => block.type === "text").map(block => block.text).join("");
  return { parsed: parseModelJson(text), model: data.model || env.RANKING_MODEL || "claude-opus-5-5" };
}

// Keeps only what can be trusted: known ids, bounded scores, short text. Anything else is dropped rather than shown.
function validateAiRanking(parsed, validIds) {
  const str = (value, max) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
  const seen = new Set(), ranked = [];
  for (const row of Array.isArray(parsed?.ranked) ? parsed.ranked : []) {
    const id = str(row?.id, 80), score = Number(row?.score);
    if (!validIds.has(id) || seen.has(id) || !Number.isFinite(score)) continue;
    seen.add(id);
    ranked.push({ id, score: Math.round(clamp(score, 0, 100)), confidence: ["High", "Med", "Low"].includes(row.confidence) ? row.confidence : "Low", reason: str(row.reason, 200) });
  }
  const deep = [], deepSeen = new Set();
  for (const row of Array.isArray(parsed?.deep_dives) ? parsed.deep_dives : []) {
    const id = str(row?.id, 80);
    if (!validIds.has(id) || deepSeen.has(id)) continue;
    deepSeen.add(id);
    deep.push({ id, bull: str(row.bull, 420), bear: str(row.bear, 420), invalidation: str(row.invalidation, 260) });
  }
  const rejected = [];
  for (const row of Array.isArray(parsed?.rejected) ? parsed.rejected : []) {
    const id = str(row?.id, 80);
    if (validIds.has(id) && !seen.has(id)) rejected.push({ id, reason: str(row.reason, 200) });
  }
  if (!ranked.length && !rejected.length) return null;
  return {
    headline: str(parsed.headline, 160), nothing_compelling: Boolean(parsed.nothing_compelling), ranked, deep_dives: deep.slice(0, 5), rejected,
    data_gaps: (Array.isArray(parsed.data_gaps) ? parsed.data_gaps : []).map(g => str(g, 220)).filter(Boolean).slice(0, 8), ordering_notes: str(parsed.ordering_notes, 600),
  };
}

// One stored AI ranking per market, in the same table as the scans (RANK:US, RANK:IN, RANK:FX).
const rankRowId = marketId => `RANK:${marketId || "US"}`;
async function readAiRanking(env, marketId = "US") {
  if (!env.DB) return scanMemory.get(rankRowId(marketId)) || null;
  try {
    const row = await env.DB.prepare("SELECT payload, generated_at, refreshing_until FROM scan_cache WHERE market = ? LIMIT 1").bind(rankRowId(marketId)).first();
    if (row?.payload) return { ...JSON.parse(row.payload), generated_at: row.generated_at, refreshing_until: row.refreshing_until };
  } catch { /* table or row missing */ }
  return null;
}

// Starts a model ranking when the set of ideas changed (or the last one is over three hours old), at most once every 20 minutes. Never blocks a scan.
async function ensureAiRanking(env, payload, ctx) {
  const ranking = payload?.ranking;
  if (!(env.AI || env.ANTHROPIC_API_KEY) || !env.DB || !ranking?.items?.length) return;
  const hash = rankInputHash(ranking.items);
  const rowId = rankRowId(payload.market);
  const stored = await readAiRanking(env, payload.market);
  const age = stored ? (Date.now() - Date.parse(stored.generated_at)) / 1000 : Infinity;
  if (stored && stored.input_hash === hash && age < 3 * 3600) return;
  if (age < AI_RANKING_MIN_GAP_SECONDS) return;
  try {
    await env.DB.prepare("INSERT OR IGNORE INTO scan_cache (market, payload, generated_at, refreshing_until) VALUES (?, NULL, ?, NULL)").bind(rowId, new Date(0).toISOString()).run();
    const now = new Date();
    const claimed = await env.DB.prepare("UPDATE scan_cache SET refreshing_until = ? WHERE market = ? AND (refreshing_until IS NULL OR refreshing_until <= ?)")
      .bind(new Date(now.getTime() + 6 * 60 * 1000).toISOString(), rowId, now.toISOString()).run();
    if (!(Number(claimed?.meta?.changes ?? 0) > 0)) return;
  } catch { return; }
  const work = (async () => {
    const validIds = new Set(ranking.items.map(item => item.id));
    let record = { input_hash: hash, error: null, result: null, model: null };
    try {
      const { parsed, model } = await callRankingModel(env, rankModelInput(ranking, payload.market));
      record.result = validateAiRanking(parsed, validIds);
      record.model = model;
      if (!record.result) record.error = "The model's answer had no usable ranking";
    } catch (error) { record.error = cleanError(error); console.error(`AI ranking failed: ${record.error}`); }
    try {
      await env.DB.prepare("UPDATE scan_cache SET payload = ?, generated_at = ?, refreshing_until = NULL WHERE market = ?").bind(JSON.stringify(record), new Date().toISOString(), rowId).run();
    } catch { /* the rules ranking still serves */ }
  })();
  if (ctx?.waitUntil) ctx.waitUntil(work); else await work;
}

// Lays the model's order, scores and reasons over the rules ranking. Setups the model did not mention keep their rules order at the end.
function mergeAiRanking(ranking, stored) {
  const ai = stored?.result;
  if (!ranking?.items?.length || !ai) return ranking;
  const byId = new Map(ranking.items.map(item => [item.id, item]));
  const ordered = [];
  for (const row of ai.ranked) {
    const item = byId.get(row.id);
    if (!item) continue;
    ordered.push({ ...item, score: row.score, confidence: row.confidence, reason: row.reason || item.reason, sources: ["ai"] });
    byId.delete(row.id);
  }
  const rejectedIds = new Map(ai.rejected.map(row => [row.id, row.reason]));
  const extraRejected = [];
  for (const [id, item] of byId) {
    if (rejectedIds.has(id)) extraRejected.push({ id, symbol: item.symbol, strategy: item.strategy, tag: item.tag, reason: rejectedIds.get(id) });
  }
  const unranked = [...byId.values()].filter(item => !rejectedIds.has(item.id)).map(item => ({ ...item, sources: ["rules"], reason: `${item.reason} · not scored by the model` }));
  const items = [...ordered, ...unranked].map((item, index) => ({ ...item, rank: index + 1 }));
  const dives = new Map(ai.deep_dives.map(row => [row.id, row]));
  return {
    ...ranking, source: "ai", model: stored.model, ai_generated_at: stored.generated_at,
    headline: ai.headline || ranking.headline, nothing_compelling: ai.nothing_compelling,
    items: items.map(item => dives.has(item.id) ? { ...item, bull: dives.get(item.id).bull, bear: dives.get(item.id).bear, invalidation: dives.get(item.id).invalidation } : item),
    rejected: [...ranking.rejected, ...extraRejected],
    data_gaps: [...new Set([...ranking.data_gaps, ...ai.data_gaps])].slice(0, 10), ordering_notes: ai.ordering_notes || null,
    method: `${ranking.method} An AI model (${stored.model}) then ranked the setups and wrote the reasons; every price comes from the scanners, not the model.`,
  };
}

async function discover(market = MARKETS.US, env = {}, previous = null) {
  const records = market.universe || await loadUniverse();
  const metadata = new Map(records.map(record => [record.symbol, record]));
  const symbols = [...metadata.keys()];
  const indexes = (market.provider !== "robinhood" && env?.TWELVE_DATA_API_KEY) ? [] : (MARKET_INDEXES[market.id] || []);
  const indexSymbols = new Set(indexes.map(info => info.symbol));
  const fetched = await fetchSnapshots(indexes.length ? [...symbols, ...indexSymbols] : symbols, market, env);
  const errors = fetched.errors.filter(error => !indexSymbols.has(error.symbol));
  const snapshots = new Map(fetched.snapshots);
  const indexSnapshots = new Map(indexes.map(info => [info.symbol, snapshots.get(info.symbol)]));
  for (const symbol of indexSymbols) snapshots.delete(symbol);
  const trends = indexes.map((info, position) => marketTrend(info, indexSnapshots.get(info.symbol), snapshots, position === 0, market.id)).filter(Boolean);
  const allCandidates = [...snapshots.entries()].map(([symbol, snapshot]) => scoreCandidate(snapshot, metadata.get(symbol))).sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  const dipScan = market.id === "US" ? buildDipScan(snapshots, indexSnapshots.get("SPY"), metadata) : null;
  const patternScan = market.id === "US" ? buildPatternScan(snapshots, metadata) : null;
  const candidates = allCandidates.filter(candidate => candidate.entry_eligible);
  let ranking = buildRanking({ candidates, dipScan, patternScan, snapshots, trend: trends[0], marketId: market.id });
  if (market.id === "US" && ranking.items.length) {
    // Second pass with the SEC filing flags for the ideas that survived the first one.
    const filings = await loadFilingFlags(env, [...new Set(ranking.items.map(item => item.symbol))]);
    if (filings.size) ranking = buildRanking({ candidates, dipScan, patternScan, snapshots, trend: trends[0], marketId: market.id, filings });
  }
  const lateCandidates = allCandidates.filter(candidate => !candidate.entry_eligible);
  // When each fresh setup was first seen. There is no closing time: a setup leaves the list when its price runs away or the trend fails, not when time runs out.
  const nowIso = new Date().toISOString();
  const previousFirstSeen = new Map((previous?.candidates || []).map(item => [item.symbol, item.first_seen_at || previous.generated_at]));
  for (const candidate of candidates) {
    candidate.first_seen_at = previousFirstSeen.get(candidate.symbol) || nowIso;
  }
  const recent = recentSetups(previous, allCandidates, new Set(candidates.map(candidate => candidate.symbol)), nowIso);
  const longCandidates = candidates.filter(candidate => candidate.direction === "LONG").sort((a, b) => b.long_score - a.long_score || a.symbol.localeCompare(b.symbol));
  const shortCandidates = candidates.filter(candidate => candidate.direction === "SHORT").sort((a, b) => b.short_score - a.short_score || a.symbol.localeCompare(b.symbol));
  return {
    generated_at: new Date().toISOString(),
    market_trend: trends[0] || null,
    market_trends: trends,
    market: market.id,
    market_label: market.label,
    currency: market.currency,
    currency_symbol: market.symbolPrefix,
    universe_name: market.name,
    universe_source: market.universe ? "Built-in constituent list" : SP500_SOURCE,
    market_data_source: market.provider === "robinhood" ? "Robinhood" : "Market data provider",
    auto_refresh: market.auto,
    universe_size: symbols.length,
    successful: allCandidates.length,
    candidates: candidates.slice(0, 20),
    long_candidates: longCandidates.slice(0, 20),
    short_candidates: shortCandidates.slice(0, 20),
    late_candidates: lateCandidates.slice(0, 20),
    recent_setups: recent,
    dip_scan: dipScan,
    pattern_scan: patternScan,
    ranking,
    direction_counts: { LONG: longCandidates.length, SHORT: shortCandidates.length },
    fresh_entry_count: candidates.length,
    late_or_extended_count: lateCandidates.length,
    daily_conflict_count: lateCandidates.filter(candidate => candidate.entry_status === "DAILY_CONFLICT").length,
    regime_filtered_count: lateCandidates.filter(candidate => candidate.entry_status === "WEAK_TREND_REGIME").length,
    errors,
    method: "Regime-aware hybrid screen: confirmed daily Supertrend (10, 3) sets direction, daily ADX (14) must be at least 20 and rising versus five sessions ago, then confirmed 4-hour Supertrend finds the entry.",
    next_step: "Countertrend, weak-regime, late, extended, and weakening setups cannot rank as new entries. In TradingView, confirm the daily direction and trend strength first, then use the 4H chart with ATR length 10 and factor 3 for timing.",
    read_only: true,
    order_submission_supported: false,
  };
}

async function fetchFundamentals(symbol) {
  try {
    const payload = await fetchJson(`${ROBINHOOD_FUNDAMENTALS}${encodeURIComponent(symbol)}/`);
    return payload && !payload.detail ? payload : null;
  } catch { return null; }
}

function makeReport(role, symbol, score, confidence, thesis, evidence, risks, complete) {
  return { role, symbol, score: round(clamp(score, 0, 100), 1), confidence, thesis, evidence, risks, sources: complete ? ["Robinhood"] : [], as_of: new Date().toISOString(), data_complete: complete };
}

async function analyze(symbol, market = MARKETS.US, env = {}) {
  const [{ snapshots }, fundamentals] = await Promise.all([fetchSnapshots([symbol], market, env), market.provider === "robinhood" ? fetchFundamentals(symbol) : Promise.resolve(null)]);
  const snapshot = snapshots.get(symbol);
  if (!snapshot) throw new Error(`Could not fetch market data for ${symbol}${symbol === "APPL" ? ". Did you mean AAPL?" : ""}`);
  const candidate = scoreCandidate(snapshot);
  const direction = candidate.direction;
  const technicalScore = candidate.score;
  const fundamentalEvidence = fundamentals ? [
    fundamentals.market_cap ? `Market cap: $${Math.round(numeric(fundamentals.market_cap)).toLocaleString("en-US")}` : null,
    fundamentals.pe_ratio ? `Reported P/E ratio: ${numeric(fundamentals.pe_ratio).toFixed(1)}` : null,
    fundamentals.description ? String(fundamentals.description).slice(0, 180) : null,
  ].filter(Boolean) : [];
  const reports = [
    makeReport("fundamentals", symbol, fundamentalEvidence.length ? 58 : 50, fundamentalEvidence.length ? 0.6 : 0.25, fundamentalEvidence.length ? "Robinhood company fundamentals are available, but this technical scan does not model earnings quality or intrinsic value." : "Fundamental data was unavailable from the public market-data feed.", fundamentalEvidence, ["Financial statements and analyst estimates are not independently verified here."], Boolean(fundamentalEvidence.length)),
    makeReport("news", symbol, 50, 0.2, "No verified breaking-news feed is connected to this public deployment.", [], ["A fresh filing, earnings release, or headline could invalidate the setup."], false),
    makeReport("sentiment", symbol, 50 + clamp((snapshot.volume_ratio_5d_to_20d - 1) * 12, -12, 12), 0.55, `Price/volume behavior is being used as a sentiment proxy; recent volume is ${snapshot.volume_ratio_5d_to_20d.toFixed(2)}× its baseline.`, [`20-day return is ${snapshot.return_20d_pct >= 0 ? "+" : ""}${snapshot.return_20d_pct.toFixed(1)}%.`], ["This is not direct social-platform sentiment."], true),
    makeReport("price_action", symbol, technicalScore, 0.78, `${direction} on confirmed 4-hour Supertrend, with a ${candidate.label.toLowerCase()}.`, candidate.reasons, candidate.cautions, true),
  ];
  const averageScore = mean(reports.map(report => report.score));
  const coreComplete = reports.filter(report => report.role === "price_action").every(report => report.data_complete);
  const contextWarnings = reports.filter(report => !report.data_complete).map(report => report.role === "news"
    ? "No live news feed is connected; check earnings, filings, and breaking headlines before acting."
    : `${report.role.replaceAll("_", " ")} context is incomplete and should be verified independently.`);
  const synthesis = makeReport("synthesis", symbol, averageScore, coreComplete ? 0.68 : 0.48, `${direction} technical setup on completed 4-hour candles. Core price data is complete; unavailable news or fundamental context is a caution, not an automatic veto.`, candidate.reasons, [...reports.flatMap(report => report.risks).slice(0, 4), ...contextWarnings].slice(0, 6), coreComplete);
  const bull = makeReport("bull", symbol, direction === "LONG" ? technicalScore : 100 - technicalScore, 0.62, direction === "LONG" ? "Trend, momentum, and Supertrend are aligned for the bullish case." : "A reversal back above the Supertrend line is the main bullish counter-case.", candidate.reasons, candidate.cautions, true);
  const bear = makeReport("bear", symbol, direction === "SHORT" ? technicalScore : 100 - technicalScore, 0.7, direction === "SHORT" ? "Trend, momentum, and Supertrend are aligned for the bearish case." : "Headline risk, volatility, and a close below Supertrend are the main reasons the long setup could fail.", candidate.cautions.length ? candidate.cautions : ["No setup is certain."], ["Risk is defined by the invalidation level."], true);
  const price = snapshot.price;
  const entryReference = candidate.signal_entry_price || price;
  const { stop, target1, target2, stop_kind } = pickLevels(direction, entryReference, candidate.signal_atr, market.id, candidate.daily_atr, candidate.daily_supertrend_value);
  const signalStartedAt = Date.parse(snapshot.supertrend.signal_bar_started_at);
  const postSignalBars = snapshot.history.filter(row => !Number.isFinite(signalStartedAt) || Date.parse(row.date) > signalStartedAt);
  const target1Reached = direction === "SHORT"
    ? [price, ...postSignalBars.map(row => row.low)].some(value => numeric(value) <= target1)
    : [price, ...postSignalBars.map(row => row.high)].some(value => numeric(value) >= target1);
  const vetoReasons = [];
  if (snapshot.annualized_volatility_pct > 85) vetoReasons.push(`Annualized volatility ${snapshot.annualized_volatility_pct.toFixed(1)}% exceeds the 85% review limit`);
  if (!candidate.entry_eligible) vetoReasons.push(candidate.entry_status === "DAILY_CONFLICT" ? `Daily Supertrend is ${candidate.daily_supertrend_direction}; it does not confirm the ${direction} 4-hour trigger` : candidate.entry_status === "WEAK_TREND_REGIME" ? `Daily ADX is ${candidate.daily_adx.toFixed(1)}; qualifying setups require ADX of at least 20 and rising versus five sessions ago` : candidate.entry_status === "TARGET_REACHED" ? "Scenario target 1 was already reached; the original entry window is closed" : candidate.entry_status === "EXTENDED_DO_NOT_CHASE" ? `Entry is extended ${candidate.extension_atr.toFixed(2)} ATR beyond the original signal price` : candidate.entry_status === "LATE_TREND" ? `Entry window passed ${candidate.signal_age_bars + 1} completed 4-hour bars ago` : `Signal weakened ${Math.abs(candidate.extension_atr).toFixed(2)} ATR against the intended direction`);
  if (target1Reached) vetoReasons.push("Scenario target 1 was already reached after the signal; this entry is no longer actionable");
  const approved = vetoReasons.length === 0 && technicalScore >= 65 && candidate.entry_eligible && !target1Reached;
  const action = approved ? "IDEA" : candidate.entry_eligible && !target1Reached && technicalScore >= 55 ? "WATCH" : "PASS";
  const levels = { reference: round(entryReference, 4), current: round(price, 4), risk: round(stop, 4), target_1: round(target1, 4), target_2: round(target2, 4), exit_kind: stop_kind };
  const chartExplanation = [
    `Confirmed daily Supertrend is ${candidate.daily_supertrend_direction}; ${candidate.daily_aligned ? "it agrees with" : "it conflicts with"} the ${direction} 4-hour trigger.`,
    `Daily ADX (14) is ${candidate.daily_adx.toFixed(1)} versus ${candidate.daily_adx_prior.toFixed(1)} five sessions ago; regime gate: ${candidate.regime_eligible ? "PASS" : "VETO"}.`,
    `4H Supertrend (10, 3) flipped ${direction} at ${snapshot.supertrend.signal_confirmed_at}; the anchored signal entry is ${fmtPrice(entryReference, market)}.`,
    `Current price is ${candidate.extension_atr >= 0 ? "+" : ""}${candidate.extension_atr.toFixed(2)} ATR from that entry; status: ${candidate.entry_status.replaceAll("_", " ")}.`,
    stop_kind === "SUPERTREND_LINE"
      ? `Exit rule: leave when a day closes ${direction === "SHORT" ? "over" : "under"} the daily Supertrend line (${fmtPrice(stop, market)}), at the next open. There is no time limit and no fixed target; the profit zones are for reference only. Exits on early warnings (a moving average, fading ADX, a weak market) lowered returns in tests.`
      : `Protective level ${fmtPrice(stop, market)}.`,
    ...candidate.reasons.slice(1, 3),
    ...vetoReasons,
    ...contextWarnings,
  ];
  return {
    market: market.id,
    currency: market.currency,
    currency_symbol: market.symbolPrefix,
    price_decimals: market.decimals(price),
    run_id: crypto.randomUUID(),
    decision_id: crypto.randomUUID().slice(0, 8),
    symbol,
    action,
    direction,
    approved,
    entry_price: round(entryReference, 4),
    current_price: round(price, 4),
    entry_status: candidate.entry_status,
    entry_eligible: candidate.entry_eligible,
    daily_supertrend_direction: candidate.daily_supertrend_direction,
    daily_supertrend_value: candidate.daily_supertrend_value,
    daily_aligned: candidate.daily_aligned,
    daily_adx: candidate.daily_adx,
    daily_adx_prior: candidate.daily_adx_prior,
    daily_adx_rising: candidate.daily_adx_rising,
    regime_eligible: candidate.regime_eligible,
    signal_confirmed_at: snapshot.supertrend.signal_confirmed_at,
    expected_strategy_fill_at: snapshot.supertrend.expected_strategy_fill_at,
    signal_age_bars: candidate.signal_age_bars,
    extension_atr: candidate.extension_atr,
    target_1_reached: target1Reached,
    stop_price: round(stop, 4),
    target_position_pct: 0,
    confidence: synthesis.confidence,
    thesis: synthesis.thesis,
    veto_reasons: vetoReasons,
    context_warnings: contextWarnings,
    market_snapshot: snapshot,
    analyst_reports: reports,
    debate: { bull, bear, synthesis },
    trade_plan: { action, direction, entry_price: round(entryReference, 4), current_price: round(price, 4), entry_status: candidate.entry_status, stop_price: round(stop, 4), target_position_pct: 0, target_1: levels.target_1, target_2: levels.target_2 },
    risk_review: { approved, veto_reasons: vetoReasons, context_warnings: contextWarnings, reviewed_position_pct: 0, authority: "Risk owns the final veto; no downstream agent may override it. Missing news is disclosed as context risk but does not override complete market-data gates." },
    portfolio_review: { approved, reasons: approved ? [] : ["Risk veto is active"], final_position_pct: 0, portfolio_note: approved ? "Cleared as a research idea." : "Not cleared as a research idea." },
    chart: {
      series: snapshot.history,
      source: snapshot.data_source,
      source_detail: snapshot.data_source_detail,
      supertrend: snapshot.supertrend,
      daily_supertrend: snapshot.daily_supertrend,
      daily_adx: snapshot.daily_adx,
      levels,
      reference_lines: referenceLines(snapshot.chart_refs),
      target_return_pct: { target_1: round((target1 / entryReference - 1) * 100, 2), target_2: round((target2 / entryReference - 1) * 100, 2) },
      direction,
      stance: action,
      explanation: chartExplanation,
      method: `${direction} scenario: confirmed daily Supertrend must agree and daily ADX (14) must be at least 20 and rising before the 4H trigger can qualify. Entry, risk, and targets (1 and 2 daily ATRs for stocks, 2R and 3R for forex) stay anchored to the original 4-hour signal price. Late, extended, or already-targeted signals are rejected. Levels are research scenarios, not orders.`,
    },
    read_only: true,
    order_submission_supported: false,
  };
}

async function readBody(request) {
  const size = Number(request.headers.get("content-length") || 0);
  if (size > 10000) throw new Error("Request body is too large");
  const payload = await request.json().catch(() => ({}));
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
}

async function fromCache(request, cacheName, maxAge, producer, ctx) {
  const now = Date.now();
  const memoryHit = memoryCache.get(cacheName);
  if (memoryHit && memoryHit.expiresAt > now) return memoryHit.payload;
  if (memoryHit) memoryCache.delete(cacheName);
  const cacheUrl = new URL(request.url);
  cacheUrl.pathname = `/__cache/${cacheName}`;
  cacheUrl.search = "";
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  let cache = null;
  try {
    cache = globalThis.caches?.default || null;
    const existing = cache ? await cache.match(cacheKey) : null;
    if (existing) {
      const payload = await existing.json();
      memoryCache.set(cacheName, { payload, expiresAt: now + maxAge * 1000 });
      return payload;
    }
  } catch {
    cache = null;
  }
  const payload = await producer();
  memoryCache.set(cacheName, { payload, expiresAt: Date.now() + maxAge * 1000 });
  if (cache) {
    const stored = json(payload, 200, { "cache-control": `public, max-age=${maxAge}` });
    ctx.waitUntil(cache.put(cacheKey, stored.clone()).catch(() => {}));
  }
  return payload;
}

const SCANNER_USER_ID = "system:scanner";
// Supertrend picks are graded on a trend break; a pick whose window is at least this many days is graded that way, and this is also its safety limit.
const TREND_EXIT_DAYS = 120;

// Smallest protective distance as a share of price. 1.25% suits stocks; a forex pair's typical 2 ATR is only
// about 0.3% to 0.6%, so the stock floor made forex stops far too wide and first targets almost unreachable.
function riskFloorFraction(marketId) { return marketId === "FX" ? 0.0025 : 0.0125; }

// Levels for a Supertrend pick. For US stocks the exit is the daily Supertrend line itself: the pick is closed when a day CLOSES under it
// (for a short, over it), filled at the next open, with no time limit. Backtests (research/pattern-backtest, ml_st_support.py and
// ml_st_exits.py) found short targets and short hold limits have no edge on Supertrend entries, that this exit earned +1.6% per trade
// against -0.07% for the 2 ATR stop and 1 ATR target, and that every early-warning exit added on top (close under a moving average, ADX
// fading, the market under its 50-day average, a tighter trail) lowered the average. The targets stay as optional profit zones only.
function pickLevels(direction, entry, atr, marketId = "US", dailyAtr = 0, dailyLine = 0) {
  const levels = scenarioLevels(direction, entry, atr, marketId, dailyAtr);
  const short = direction === "SHORT", line = numeric(dailyLine);
  if (marketId === "US" && line > 0 && (short ? line > entry : line < entry)) return { ...levels, stop: line, stop_kind: "SUPERTREND_LINE" };
  return { ...levels, stop_kind: "ATR" };
}

// Protective level and the two scenario targets, shared by full reports and logged scanner picks.
// Stocks use daily-ATR levels from the backtests in research/pattern-backtest (backtest8.mjs, ml_monitor.py): a 2 ATR protective
// level, a first target 1 ATR away that is reached about half the time, and a second target 2 ATR away reached about one time
// in five, so reward equals risk at target 2. A wider 4 ATR stop averaged about 0.06% to 0.07% more per trade and was hit by only
// 2% of trades (against 12% to 17% at 2 ATR), but it put the stop four times farther than target 1, which is too much risk per
// share to show as a recommendation; 2 ATR also cuts the average of the worst 5% of trades from about -9.2% to -8.0%. Targets
// farther out were rarely reached in 5 days. Forex was not tested and keeps the earlier 2 x 4H-ATR "R" levels at 2R and 3R.
const STOP_ATR = 2, TARGET_1_ATR = 1, TARGET_2_ATR = 2;
function scenarioLevels(direction, entry, atr, marketId = "US", dailyAtr = 0) {
  const short = direction === "SHORT";
  if (marketId !== "FX" && dailyAtr > 0) {
    const stopDistance = Math.max(STOP_ATR * dailyAtr, entry * 0.01);
    return {
      stop: short ? entry + stopDistance : Math.max(0.01, entry - stopDistance),
      target1: short ? Math.max(0.01, entry - TARGET_1_ATR * dailyAtr) : entry + TARGET_1_ATR * dailyAtr,
      target2: short ? Math.max(0.01, entry - TARGET_2_ATR * dailyAtr) : entry + TARGET_2_ATR * dailyAtr,
    };
  }
  const riskDistance = Math.max(2 * atr, entry * riskFloorFraction(marketId));
  return {
    stop: short ? entry + riskDistance : Math.max(0.01, entry - riskDistance),
    target1: short ? Math.max(0.01, entry - 2 * riskDistance) : entry + 2 * riskDistance,
    target2: short ? Math.max(0.01, entry - 3 * riskDistance) : entry + 3 * riskDistance,
  };
}

// Every fresh entry the scanner surfaces is logged once, under a system account, so the public track record
// covers all picks the app showed rather than only the tickers users chose to analyze.
async function recordScannerPicks(env, payload) {
  if (!env.DB || payload?.market !== "US") return 0;
  const statements = [];
  for (const candidate of payload.candidates || []) {
    const entry = numeric(candidate.signal_entry_price);
    const atr = numeric(candidate.signal_atr);
    if (!candidate.symbol || !(entry > 0) || !(atr > 0) || !candidate.signal_confirmed_at || !["LONG", "SHORT"].includes(candidate.direction)) continue;
    const { stop, target1, target2 } = pickLevels(candidate.direction, entry, atr, "US", numeric(candidate.daily_atr), candidate.daily_supertrend_value);
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO recommendations (id, user_id, symbol, action, direction, generated_at,
      signal_confirmed_at, entry_price, current_price, stop_price, target_1, target_2, confidence, entry_status, daily_adx,
      horizon_trading_days, status) VALUES (?, ?, ?, 'IDEA', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${TREND_EXIT_DAYS}, 'PENDING')`).bind(
      crypto.randomUUID(), SCANNER_USER_ID, candidate.symbol, candidate.direction, payload.generated_at,
      candidate.signal_confirmed_at, round(entry, 4), round(numeric(candidate.price), 4), round(stop, 4), round(target1, 4), round(target2, 4),
      round(clamp(numeric(candidate.score) / 100, 0, 1), 3), candidate.entry_status, numeric(candidate.daily_adx),
    ));
  }
  // Dip scan picks, each under its own strategy so the two scanners can be compared on live results. Dips seen while the
  // market gate was closed are logged as DIP_WAIT (action WATCH) to test the gate; they are never shown as ideas.
  const dip = payload.dip_scan;
  if (dip?.available) {
    for (const [list, strategy, action] of [[dip.candidates, "DIP", "IDEA"], [dip.waiting, "DIP_WAIT", "WATCH"]]) {
      for (const pick of list || []) {
        if (!pick.symbol || !(pick.signal_close > 0) || !pick.signal_as_of) continue;
        statements.push(env.DB.prepare(`INSERT OR IGNORE INTO recommendations (id, user_id, symbol, action, direction, generated_at,
          signal_confirmed_at, entry_price, current_price, stop_price, target_1, target_2, confidence, entry_status, daily_adx,
          horizon_trading_days, status, strategy) VALUES (?, ?, ?, ?, 'LONG', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 10, 'PENDING', ?)`).bind(
          crypto.randomUUID(), SCANNER_USER_ID, pick.symbol, action, payload.generated_at, pick.signal_as_of,
          round(pick.signal_close, 4), round(numeric(pick.price), 4), pick.stop_price, pick.target_1, pick.target_2,
          round(clamp(numeric(pick.score) / 100, 0, 1), 3), strategy === "DIP" ? "DIP_GATE_OPEN" : "DIP_GATE_CLOSED", strategy,
        ));
      }
    }
  }
  // Pattern scan picks (long breakouts and short breakdowns), logged under their own PATTERN strategy and graded on their own stop, first target or day 10.
  const pattern = payload.pattern_scan;
  if (pattern?.available) {
    for (const pick of [...(pattern.breakouts || []), ...(pattern.breakdowns || [])]) {
      if (!pick.symbol || !(pick.signal_close > 0) || !pick.signal_as_of || !["LONG", "SHORT"].includes(pick.direction)) continue;
      statements.push(env.DB.prepare(`INSERT OR IGNORE INTO recommendations (id, user_id, symbol, action, direction, generated_at,
        signal_confirmed_at, entry_price, current_price, stop_price, target_1, target_2, confidence, entry_status, daily_adx,
        horizon_trading_days, status, strategy) VALUES (?, ?, ?, 'IDEA', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PATTERN_BREAKOUT', 0, 10, 'PENDING', 'PATTERN')`).bind(
        crypto.randomUUID(), SCANNER_USER_ID, pick.symbol, pick.direction, payload.generated_at, pick.signal_as_of,
        round(pick.signal_close, 4), round(numeric(pick.price), 4), pick.stop_price, pick.target_1, pick.target_2,
        round(clamp(numeric(pick.score) / 100, 0, 1), 3),
      ));
    }
  }
  if (statements.length) await env.DB.batch(statements);
  return statements.length;
}

// Public aggregate over settled scanner picks. Losses, stop-outs and open calls are all counted; nothing is filtered.
function summarizeTrackRecord(rows, pendingCount) {
  const settled = rows.filter(row => row.status === "SETTLED");
  const returns = settled.map(row => numeric(row.strategy_return_pct));
  const wins = returns.filter(value => value > 0);
  const losses = returns.filter(value => value < 0);
  const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const grossWins = wins.reduce((sum, value) => sum + value, 0);
  const grossLosses = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const share = predicate => settled.length ? round(settled.filter(predicate).length / settled.length * 100, 1) : null;
  const byDirection = direction => {
    const group = settled.filter(row => row.direction === direction);
    const values = group.map(row => numeric(row.strategy_return_pct));
    return { samples: group.length, average_return_pct: values.length ? round(mean(values), 3) : null, win_rate_pct: values.length ? round(values.filter(value => value > 0).length / values.length * 100, 1) : null };
  };
  return {
    settled_picks: settled.length,
    pending_picks: pendingCount,
    win_rate_pct: share(row => numeric(row.strategy_return_pct) > 0),
    average_return_pct: returns.length ? round(mean(returns), 3) : null,
    average_win_pct: wins.length ? round(mean(wins), 3) : null,
    average_loss_pct: losses.length ? round(mean(losses), 3) : null,
    worst_loss_pct: returns.length ? round(Math.min(...returns), 3) : null,
    profit_factor: grossLosses > 0 ? round(grossWins / grossLosses, 3) : null,
    stop_hit_rate_pct: share(row => Boolean(row.stop_hit)),
    target_hit_rate_pct: share(row => Boolean(row.target_hit)),
    long: byDirection("LONG"),
    short: byDirection("SHORT"),
  };
}

const TRACK_STRATEGIES = {
  SUPERTREND: "Supertrend scanner",
  DIP: "Dip scan (market gate open)",
  DIP_WAIT: "Dips while the market gate was closed (not recommended; logged to test the gate)",
  PATTERN: "Pattern scan: candlestick breakouts and breakdowns (experimental; logged to test it)",
};
async function publicTrackRecord(db) {
  if (!db) return { available: false, reason: "Track record storage is not configured." };
  const settledResult = await db.prepare(`SELECT direction, status, strategy_return_pct, stop_hit, target_hit, generated_at, strategy
    FROM recommendations WHERE user_id = ? AND status = 'SETTLED' AND action != 'PASS' ORDER BY generated_at ASC LIMIT 5000`).bind(SCANNER_USER_ID).all();
  const rows = (settledResult?.results || []).map(row => ({ ...row, strategy: row.strategy || "SUPERTREND" }));
  const pendingFor = async strategy => Number((await db.prepare("SELECT COUNT(*) AS n FROM recommendations WHERE user_id = ? AND status = 'PENDING' AND strategy = ?").bind(SCANNER_USER_ID, strategy).first())?.n || 0);
  // An array (not an object keyed by strategy) so clients that rewrite snake_case keys cannot mangle the ids.
  const strategies = [];
  for (const [id, label] of Object.entries(TRACK_STRATEGIES)) {
    const own = rows.filter(row => row.strategy === id);
    strategies.push({ id, label, since: own[0]?.generated_at || null, summary: summarizeTrackRecord(own, await pendingFor(id)) });
  }
  const supertrend = rows.filter(row => row.strategy === "SUPERTREND");
  return {
    available: true,
    since: supertrend[0]?.generated_at || null,
    horizon_trading_days: 10,
    summary: strategies[0].summary,
    strategies,
    methodology: "Every fresh US entry a scanner surfaces is recorded once per ticker and signal close, at the price available when it first appeared, under the scanner that produced it. Supertrend picks are followed until a daily bar closes under the daily Supertrend line (over it for a short), and are graded at the next open; there is no target and no time limit beyond a 120-day safety limit. Dip picks exit at the first of their own stop, first target, or the close of the tenth trading day, and are graded as soon as a level is hit. Pattern picks (candlestick breakouts and breakdowns) use the same rule as dips: their own stop, first target (1R), or the close of day 10. Open picks, stopped picks and losers are all counted. Backtests are hypothetical; only these live results are a record."
  };
}

async function rememberRecommendation(db, userId, report) {
  if (!db || !userId || !report?.symbol) return false;
  const generatedAt = report.market_snapshot?.fetched_at || new Date().toISOString();
  const plan = report.trade_plan || {};
  const values = [
    crypto.randomUUID(), userId, report.symbol, report.action, report.direction, generatedAt,
    report.signal_confirmed_at, numeric(report.entry_price), numeric(report.current_price),
    numeric(report.stop_price), numeric(plan.target_1), numeric(plan.target_2),
    numeric(report.confidence), report.entry_status, numeric(report.daily_adx),
  ];
  const columns = `id, user_id, symbol, action, direction, generated_at, signal_confirmed_at,
    entry_price, current_price, stop_price, target_1, target_2, confidence,
    entry_status, daily_adx, horizon_trading_days, status`;
  // US Supertrend ideas and watches are followed until the trend breaks (TREND_EXIT_DAYS is only a safety limit); PASS calls and other markets keep a 10-day window.
  const horizon = (report.market || "US") === "US" && report.action !== "PASS" ? TREND_EXIT_DAYS : 10;
  let result;
  try {
    result = await db.prepare(`INSERT OR IGNORE INTO recommendations (${columns}, market)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`).bind(...values, horizon, report.market || "US").run();
  } catch (error) {
    if ((report.market || "US") !== "US") throw error;
    result = await db.prepare(`INSERT OR IGNORE INTO recommendations (${columns})
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`).bind(...values, horizon).run();
  }
  return Boolean(result?.success);
}

async function fetchExternalDailyBars(symbols, market, env) {
  const bars = new Map();
  const { series } = env?.TWELVE_DATA_API_KEY ? await loadTwelveSeries(symbols, market, env.TWELVE_DATA_API_KEY) : await loadYahooSeries(symbols, market);
  for (const [symbol, item] of series) bars.set(symbol, normalizeBars(item.daily, "day", market));
  return bars;
}

async function fetchDailySettlementBars(symbols) {
  const bars = new Map();
  for (let index = 0; index < symbols.length; index += 20) {
    const batch = symbols.slice(index, index + 20);
    const encoded = encodeURIComponent(batch.join(",")).replaceAll("%2C", ",");
    const payload = await fetchJson(`${ROBINHOOD_HISTORICALS}?symbols=${encoded}&bounds=regular&interval=day&span=year`);
    for (const item of payload.results || []) {
      if (!item?.symbol) continue;
      bars.set(String(item.symbol).toUpperCase(), normalizeBars(item, "day"));
    }
  }
  return bars;
}

// A graded pick leaves at the first of: its protective level, "near target" (this share of the way to target 1; 1.0 now
// that target 1 is a short 1 ATR move),
// or the close of the last bar in the window. When a bar touches both levels the stop is assumed to come first.
const NEAR_TARGET_FRACTION = 1.0;

// Grades a Supertrend pick by the rule tested best: hold until a daily bar CLOSES under the Supertrend line (over it for a short), then fill at the
// next open. There is no target. A pick still open after its safety limit is graded at that day's close. Returns null while the pick is still running.
function gradeTrendExit(recommendation, bars) {
  const rows = bars.map(bar => ({ ...bar }));
  try { calculateSupertrend(rows, 10, 3, "1d"); } catch { return null; }
  const short = recommendation.direction === "SHORT", sign = short ? -1 : 1;
  const entry = numeric(recommendation.current_price);
  const generatedDate = String(recommendation.generated_at).slice(0, 10);
  const horizon = Math.max(1, Number(recommendation.horizon_trading_days) || TREND_EXIT_DAYS);
  const path = rows.filter(row => row.date.slice(0, 10) > generatedDate);
  if (!path.length || !entry) return null;
  const against = short ? "LONG" : "SHORT";
  const breakIndex = path.findIndex(row => row.supertrend_direction === against);
  let exitBar, exitPrice, grade, used;
  if (breakIndex >= 0 && breakIndex + 1 < path.length && breakIndex + 1 < horizon) {
    exitBar = path[breakIndex + 1]; exitPrice = numeric(exitBar.open) || numeric(exitBar.close); grade = "TREND_BREAK"; used = path.slice(0, breakIndex + 2);
  } else if (path.length >= horizon) {
    exitBar = path[horizon - 1]; exitPrice = numeric(exitBar.close); grade = "TIME_LIMIT"; used = path.slice(0, horizon);
  } else return null;   // still running, or the break happened on the latest bar and the next open is not known yet
  const highs = used.map(bar => numeric(bar.high)), lows = used.map(bar => numeric(bar.low));
  const strategyReturnPct = sign * (exitPrice / entry - 1) * 100;
  return {
    settledAt: exitBar.date, exitPrice: round(exitPrice, 4), rawReturnPct: round(strategyReturnPct, 3), strategyReturnPct: round(strategyReturnPct, 3),
    maxFavorablePct: round((short ? (entry - Math.min(...lows)) / entry : (Math.max(...highs) - entry) / entry) * 100, 3),
    maxAdversePct: round((short ? (Math.max(...highs) - entry) / entry : (entry - Math.min(...lows)) / entry) * 100, 3),
    grade, targetHit: false, stopHit: grade === "TREND_BREAK",
  };
}

// True when any bar in the path reaches the stop or target 1, so the exit is already decided.
function touchesLevel(recommendation, path) {
  const short = recommendation.direction === "SHORT";
  const entry = numeric(recommendation.current_price), stop = numeric(recommendation.stop_price), target = entry + NEAR_TARGET_FRACTION * (numeric(recommendation.target_1) - entry);
  return path.some(bar => short
    ? numeric(bar.high) >= stop || numeric(bar.low) <= target || numeric(bar.open) >= stop || numeric(bar.open) <= target
    : numeric(bar.low) <= stop || numeric(bar.high) >= target || numeric(bar.open) <= stop || numeric(bar.open) >= target);
}

function gradeRecommendation(recommendation, path) {
  const entry = numeric(recommendation.current_price);
  const direction = recommendation.direction;
  const short = direction === "SHORT";
  const sign = short ? -1 : 1;
  const stop = numeric(recommendation.stop_price);
  const target1 = numeric(recommendation.target_1);
  const nearTarget = entry + NEAR_TARGET_FRACTION * (target1 - entry);
  const lastBar = path.at(-1);
  const windowClose = numeric(lastBar.close);
  const rawReturnPct = entry ? (windowClose / entry - 1) * 100 : 0;
  const maximumHigh = Math.max(...path.map(bar => numeric(bar.high)));
  const minimumLow = Math.min(...path.map(bar => numeric(bar.low)));
  const maxFavorablePct = entry ? (short ? (entry - minimumLow) / entry : (maximumHigh - entry) / entry) * 100 : 0;
  const maxAdversePct = entry ? (short ? (maximumHigh - entry) / entry : (entry - minimumLow) / entry) * 100 : 0;
  let firstEvent = null, exitPrice = windowClose, exitBar = lastBar;
  let targetHit = false, stopHit = false;
  for (const bar of path) {
    const open = numeric(bar.open) || numeric(bar.close), high = numeric(bar.high), low = numeric(bar.low);
    targetHit ||= short ? low <= target1 : high >= target1;
    stopHit ||= short ? high >= stop : low <= stop;
    if (firstEvent) continue;
    const gapStop = short ? open >= stop : open <= stop;
    const gapTarget = short ? open <= nearTarget : open >= nearTarget;
    const touchStop = short ? high >= stop : low <= stop;
    const touchTarget = short ? low <= nearTarget : high >= nearTarget;
    if (gapStop) { firstEvent = "STOP"; exitPrice = open; }
    else if (gapTarget) { firstEvent = "TARGET"; exitPrice = open; }
    else if (touchStop && touchTarget) { firstEvent = "AMBIGUOUS"; exitPrice = stop; }
    else if (touchStop) { firstEvent = "STOP"; exitPrice = stop; }
    else if (touchTarget) { firstEvent = "TARGET"; exitPrice = nearTarget; }
    if (firstEvent) exitBar = bar;
  }
  const isPass = recommendation.action === "PASS";
  // PASS calls were never traded, so they are measured to the window close; traded picks are measured to their exit.
  const settledPrice = isPass ? windowClose : exitPrice;
  const strategyReturnPct = entry ? sign * (settledPrice / entry - 1) * 100 : 0;
  let grade;
  if (isPass) grade = strategyReturnPct > 0.5 ? "MISSED_MOVE" : strategyReturnPct < -0.5 ? "CORRECT_PASS" : "FLAT_PASS";
  else grade = firstEvent || (strategyReturnPct > 0.1 ? "WIN" : strategyReturnPct < -0.1 ? "LOSS" : "FLAT");
  return {
    settledAt: isPass ? lastBar.date : exitBar.date,
    exitPrice: round(settledPrice, 4),
    rawReturnPct: round(rawReturnPct, 3),
    strategyReturnPct: round(strategyReturnPct, 3),
    maxFavorablePct: round(maxFavorablePct, 3),
    maxAdversePct: round(maxAdversePct, 3),
    grade,
    targetHit,
    stopHit,
  };
}

async function settlePendingRecommendations(db, userId, env = {}) {
  const pendingResult = await db.prepare(`SELECT id, symbol, market, action, direction, generated_at, current_price, stop_price, target_1, horizon_trading_days
    FROM recommendations WHERE user_id = ? AND status = 'PENDING' ORDER BY generated_at ASC LIMIT 60`).bind(userId).all();
  const pending = pendingResult?.results || [];
  if (!pending.length) return 0;
  const histories = new Map();
  for (const market of Object.values(MARKETS)) {
    const symbols = [...new Set(pending.filter(row => (row.market || "US") === market.id).map(row => row.symbol))];
    if (!symbols.length) continue;
    const bars = market.provider === "robinhood" ? await fetchDailySettlementBars(symbols) : await fetchExternalDailyBars(symbols, market, env);
    bars.forEach((value, key) => histories.set(`${market.id}:${key}`, value));
  }
  const updates = [];
  for (const recommendation of pending) {
    const generatedDate = String(recommendation.generated_at).slice(0, 10);
    const horizon = Math.max(1, Number(recommendation.horizon_trading_days) || 5);
    if (horizon >= 60 && recommendation.action !== "PASS") {
      const full = histories.get(`${recommendation.market || "US"}:${recommendation.symbol}`) || [];
      const trend = gradeTrendExit(recommendation, full);
      if (trend) updates.push(db.prepare(`UPDATE recommendations SET status = 'SETTLED', settled_at = ?, exit_price = ?, raw_return_pct = ?,
        strategy_return_pct = ?, max_favorable_pct = ?, max_adverse_pct = ?, grade = ?, target_hit = ?, stop_hit = ?
        WHERE id = ? AND user_id = ? AND status = 'PENDING'`).bind(trend.settledAt, trend.exitPrice, trend.rawReturnPct, trend.strategyReturnPct,
        trend.maxFavorablePct, trend.maxAdversePct, trend.grade, 0, trend.stopHit ? 1 : 0, recommendation.id, userId));
      continue;
    }
    const path = (histories.get(`${recommendation.market || "US"}:${recommendation.symbol}`) || []).filter(bar => bar.date.slice(0, 10) > generatedDate).slice(0, horizon);
    // A pick is graded as soon as a level is hit instead of waiting out the whole window; otherwise it waits for the window to close.
    if (!path.length || (path.length < horizon && !touchesLevel(recommendation, path))) continue;
    const grade = gradeRecommendation(recommendation, path);
    updates.push(db.prepare(`UPDATE recommendations SET status = 'SETTLED', settled_at = ?, exit_price = ?, raw_return_pct = ?,
      strategy_return_pct = ?, max_favorable_pct = ?, max_adverse_pct = ?, grade = ?, target_hit = ?, stop_hit = ?
      WHERE id = ? AND user_id = ? AND status = 'PENDING'`).bind(
      grade.settledAt, grade.exitPrice, grade.rawReturnPct, grade.strategyReturnPct,
      grade.maxFavorablePct, grade.maxAdversePct, grade.grade, grade.targetHit ? 1 : 0,
      grade.stopHit ? 1 : 0, recommendation.id, userId,
    ));
  }
  if (updates.length) await db.batch(updates);
  return updates.length;
}

const memorySettledAt = new Map();
async function recommendationMemory(db, userId, env = {}) {
  if (!db) return { available: false, reason: "Persistent memory is not configured." };
  let newlySettled = 0;
  let settlementWarning = null;
  // Grading fetches market data, so it runs at most every 30 minutes per user however often the app or page asks.
  const lastSettle = memorySettledAt.get(userId) || 0;
  if (Date.now() - lastSettle >= MEMORY_SETTLE_MIN_GAP_SECONDS * 1000) {
    memorySettledAt.set(userId, Date.now());
    try { newlySettled = await settlePendingRecommendations(db, userId, env); }
    catch (error) { settlementWarning = `Existing grades are available, but new settlement was delayed: ${cleanError(error)}`; }
  }
  const summary = await db.prepare(`SELECT
      COUNT(*) AS total_calls,
      SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending_calls,
      SUM(CASE WHEN status = 'SETTLED' THEN 1 ELSE 0 END) AS settled_calls,
      SUM(CASE WHEN status = 'SETTLED' AND action != 'PASS' THEN 1 ELSE 0 END) AS scored_setups,
      AVG(CASE WHEN status = 'SETTLED' AND action != 'PASS' THEN strategy_return_pct END) AS average_return_pct,
      AVG(CASE WHEN status = 'SETTLED' AND action != 'PASS' THEN CASE WHEN strategy_return_pct > 0 THEN 1.0 ELSE 0.0 END END) AS win_rate,
      SUM(CASE WHEN status = 'SETTLED' AND action != 'PASS' AND strategy_return_pct > 0 THEN strategy_return_pct ELSE 0 END) AS gross_wins,
      ABS(SUM(CASE WHEN status = 'SETTLED' AND action != 'PASS' AND strategy_return_pct < 0 THEN strategy_return_pct ELSE 0 END)) AS gross_losses
    FROM recommendations WHERE user_id = ?`).bind(userId).first();
  const recentResult = await db.prepare(`SELECT symbol, action, direction, generated_at, status, settled_at, strategy_return_pct,
      max_favorable_pct, max_adverse_pct, grade, entry_status
    FROM recommendations WHERE user_id = ? ORDER BY generated_at DESC LIMIT 12`).bind(userId).all();
  const directionResult = await db.prepare(`SELECT direction, COUNT(*) AS samples, AVG(strategy_return_pct) AS average_return_pct
    FROM recommendations WHERE user_id = ? AND status = 'SETTLED' AND action != 'PASS'
    GROUP BY direction ORDER BY average_return_pct DESC`).bind(userId).all();
  const grossWins = numeric(summary?.gross_wins);
  const grossLosses = numeric(summary?.gross_losses);
  const scored = Number(summary?.scored_setups || 0);
  const bestDirection = directionResult?.results?.[0] || null;
  const learningNote = scored < 10
    ? `Collecting evidence: ${scored}/10 settled IDEA or WATCH setups before drawing an early conclusion.`
    : bestDirection
      ? `${bestDirection.direction} setups currently lead with an average directional return of ${numeric(bestDirection.average_return_pct).toFixed(2)}% across ${bestDirection.samples} samples.`
      : "No directional conclusion is available yet.";
  return {
    available: true,
    newly_settled: newlySettled,
    settlement_warning: settlementWarning,
    horizon_trading_days: 10,
    summary: {
      total_calls: Number(summary?.total_calls || 0),
      pending_calls: Number(summary?.pending_calls || 0),
      settled_calls: Number(summary?.settled_calls || 0),
      scored_setups: scored,
      average_return_pct: round(numeric(summary?.average_return_pct), 3),
      win_rate_pct: round(numeric(summary?.win_rate) * 100, 1),
      profit_factor: grossLosses > 0 ? round(grossWins / grossLosses, 3) : grossWins > 0 ? null : 0,
    },
    learning_note: learningNote,
    recent: recentResult?.results || [],
    methodology: "Each call is stored once per user, ticker, signal close, and action. IDEA and WATCH results are graded from the actual price available when the report was generated, and a US idea or watch is followed until a daily bar closes under the daily Supertrend line (over it for a short) and graded at the next open, with a 120-day safety limit. Ideas in other markets exit at the first of the protective level, target 1, or the tenth subsequent completed daily close. PASS calls are measured to the tenth close and retained to measure missed moves. No orders or portfolio holdings are stored.",
  };
}

const scanMemory = new Map();

function refreshInterval(market, now = new Date()) {
  if (!marketIsOpen(market, now)) return AUTO_REFRESH_CLOSED_SECONDS;
  return market.id === "US" ? US_REFRESH_OPEN_SECONDS : AUTO_REFRESH_OPEN_SECONDS;
}

function withRefreshInfo(payload, generatedAt, market) {
  const nextAt = new Date(Date.parse(generatedAt) + refreshInterval(market) * 1000).toISOString();
  return { ...payload, refreshed_at: generatedAt, next_refresh_at: nextAt, auto_refresh: market.auto, refresh_interval_seconds: refreshInterval(market) };
}

async function readStoredScan(env, market) {
  if (env.DB) {
    try {
      const row = await env.DB.prepare("SELECT payload, generated_at FROM scan_cache WHERE market = ? LIMIT 1").bind(market.id).first();
      if (row?.payload) return { payload: JSON.parse(row.payload), generatedAt: row.generated_at };
    } catch { /* table may not be migrated yet; fall back to memory */ }
  }
  return scanMemory.get(market.id) || null;
}

async function claimScanRefresh(env, market) {
  const now = new Date();
  if (env.DB) {
    try {
      await env.DB.prepare("INSERT OR IGNORE INTO scan_cache (market, payload, generated_at, refreshing_until) VALUES (?, NULL, ?, NULL)").bind(market.id, new Date(0).toISOString()).run();
      const claimed = await env.DB.prepare("UPDATE scan_cache SET refreshing_until = ? WHERE market = ? AND (refreshing_until IS NULL OR refreshing_until <= ?)")
        .bind(new Date(now.getTime() + AUTO_REFRESH_LOCK_SECONDS * 1000).toISOString(), market.id, now.toISOString()).run();
      return Number(claimed?.meta?.changes ?? 0) > 0;
    } catch { /* fall through to in-memory lock */ }
  }
  const lock = scanMemory.get(`${market.id}:lock`);
  if (lock && lock > now.getTime()) return false;
  scanMemory.set(`${market.id}:lock`, now.getTime() + AUTO_REFRESH_LOCK_SECONDS * 1000);
  return true;
}

async function refreshScan(env, market, ctx) {
  const previous = (await readStoredScan(env, market))?.payload || null;
  const payload = await discover(market, env, previous);
  const generatedAt = new Date().toISOString();
  if (payload.successful === 0) throw new Error(payload.errors?.[0]?.error || "No market data was returned");
  scanMemory.set(market.id, { payload, generatedAt });
  scanMemory.delete(`${market.id}:lock`);
  if (env.DB) {
    try {
      await env.DB.prepare("UPDATE scan_cache SET payload = ?, generated_at = ?, refreshing_until = NULL WHERE market = ?").bind(JSON.stringify(payload), generatedAt, market.id).run();
    } catch { /* memory copy still serves this instance */ }
    try { await recordScannerPicks(env, payload); } catch { /* logging must never break a scan */ }
  }
}

// The AI ranking runs in its own scheduled job (the hourly forex trigger), never inside a scan or a visitor's request: a model call can take
// a minute or two, and work started by a request is cut off shortly after the response. It reads the stored US scan and does nothing when
// the ideas have not changed since the last ranking.
// ---- Bull vs bear debate on the top ideas ----
// Two agents get different evidence packs: the bull one holds the facts that support the idea, the bear one the facts that argue against it
// (earnings, crowding, a short or experimental record, distance from the entry). Round 1 is each side's case, round 2 is each side answering
// the other, and a judge weighs what is left. Every claim cites facts by key, and CODE checks each cited value and each number in the text
// against the idea's real figures; a claim that does not check out is dropped and counted. The verdict is shown and logged but never changes
// the score: there is no evidence yet that a model's lean predicts returns.
const DEBATE_TOP_N = 5, DEBATE_MIN_GAP_SECONDS = 50 * 60, DEBATE_MAX_AGE_SECONDS = 24 * 3600;
const DEBATE_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const FACT_DEFS = {
  backtest_ev_pct: { label: "Backtest average return per trade", unit: "%", signed: true },
  backtest_win_rate_pct: { label: "Backtest win rate", unit: "%" },
  backtest_trades: { label: "Backtest trades", unit: "" },
  strategy_experimental: { label: "Experimental scanner", bool: true },
  trend_alignment_score: { label: "Trend and market alignment", unit: "/100" },
  market_trend: { label: "Market trend", str: true },
  stop_pct: { label: "Stop distance from entry", unit: "%" },
  rr_to_target_1: { label: "Reward to risk, target 1", unit: " to 1" },
  from_entry_atr: { label: "Price versus entry", unit: " ATR", signed: true },
  age_days: { label: "Signal age", unit: " days" },
  volume_ratio: { label: "Volume versus average", unit: "x" },
  atr_pct: { label: "Typical daily range", unit: "%" },
  sector_crowded: { label: "Same sector and direction already ranked higher", bool: true },
  earnings_in_days: { label: "Days to earnings", unit: " days" },
  earnings_confirmed: { label: "Earnings date confirmed", bool: true },
  filing_cautions: { label: "Recent cautionary SEC filings", unit: "" },
};
const BULL_KEYS = ["backtest_ev_pct", "backtest_win_rate_pct", "backtest_trades", "trend_alignment_score", "market_trend", "stop_pct", "rr_to_target_1", "volume_ratio", "age_days", "from_entry_atr"];
const BEAR_KEYS = ["backtest_ev_pct", "backtest_trades", "strategy_experimental", "trend_alignment_score", "market_trend", "stop_pct", "from_entry_atr", "atr_pct", "sector_crowded", "earnings_in_days", "earnings_confirmed", "filing_cautions", "age_days"];

function debateFacts(item, marketState) {
  const f = item.filing, e = item.evidence || {};
  const facts = {
    backtest_ev_pct: e.ev_pct, backtest_win_rate_pct: e.win_rate_pct, backtest_trades: e.n, strategy_experimental: e.experimental === true,
    trend_alignment_score: item.alignment_score, market_trend: marketState || undefined, stop_pct: item.stop_pct, rr_to_target_1: item.rr_t1, from_entry_atr: item.from_entry_atr,
    age_days: item.age_days, volume_ratio: item.volume_ratio, atr_pct: item.atr_pct, sector_crowded: item.crowded === true,
    earnings_in_days: f?.earnings_in_days != null && f.earnings_in_days >= 0 ? f.earnings_in_days : undefined,
    earnings_confirmed: f?.earnings_in_days != null && f.earnings_in_days >= 0 ? f.earnings_confirmed === true : undefined,
    filing_cautions: f ? (f.cautions || []).length : undefined,
  };
  for (const key of Object.keys(facts)) if (facts[key] === undefined || facts[key] === null || (typeof facts[key] === "number" && !Number.isFinite(facts[key]))) delete facts[key];
  return facts;
}

function debateFactDisplay(key, value) {
  const d = FACT_DEFS[key];
  if (!d) return String(value);
  if (d.bool) return value ? "yes" : "no";
  if (d.str) return String(value).toLowerCase();
  const n = Number(value), text = Math.abs(n) >= 100 ? String(Math.round(n)) : String(round(n, 2));
  return `${d.signed && n > 0 ? "+" : ""}${text}${d.unit || ""}`;
}

const DEBATE_FORBIDDEN = /\b(buy now|you should (buy|sell)|guarantee[sd]?|will (rise|fall|rally|crash)|can't lose|sure thing|risk[- ]free)\b/i;
const DEBATE_FREE_NUMBERS = new Set([1, 2, 3, 5, 10, 14, 20, 50, 100, 200]); // window lengths people write without a fact (10-day hold, 200-day average)

// Code-side check. A claim survives only if every cited key is allowed for that side and its value matches the real figure, at least one fact is cited,
// the text has no banned wording, and every number written in the text equals a real figure of this idea (or a common window length).
function verifyDebateClaims(rawClaims, allFacts, allowedKeys, max = 3) {
  const kept = []; let dropped = 0;
  const numbers = Object.values(allFacts).filter(v => typeof v === "number").map(Math.abs);
  const near = (a, b) => Math.abs(a - b) <= Math.max(0.051, Math.abs(b) * 0.01);
  for (const raw of Array.isArray(rawClaims) ? rawClaims : []) {
    if (kept.length >= max) { dropped++; continue; }
    const text = typeof raw?.text === "string" ? raw.text.replace(/\s+/g, " ").trim().slice(0, 220) : "";
    const cited = (Array.isArray(raw?.facts) ? raw.facts : []).slice(0, 3);
    let ok = text.length >= 12 && cited.length >= 1 && !DEBATE_FORBIDDEN.test(text);
    const facts = [];
    for (const fact of ok ? cited : []) {
      const key = String(fact?.key ?? ""), real = allFacts[key], said = fact?.value;
      if (!allowedKeys.includes(key) || real === undefined) { ok = false; break; }
      const match = typeof real === "number" ? near(Number(said), real) : typeof real === "boolean" ? (said === real || String(said).toLowerCase() === String(real)) : String(said).toLowerCase() === String(real).toLowerCase();
      if (!match) { ok = false; break; }
      facts.push({ key, label: FACT_DEFS[key]?.label || key, display: debateFactDisplay(key, real) });
    }
    if (ok) for (const match of text.matchAll(/\d+(?:\.\d+)?/g)) {
      const n = Number(match[0]);
      if (!DEBATE_FREE_NUMBERS.has(n) && !numbers.some(real => near(n, real))) { ok = false; break; }
    }
    if (ok) kept.push({ text, facts }); else dropped++;
  }
  return { kept, dropped };
}

async function debateCall(env, model, system, user, maxTokens = 700) {
  const run = params => Promise.race([env.AI.run(model, params), new Promise((_, reject) => setTimeout(() => reject(new Error("The AI model took too long")), 60000))]);
  const result = await run({ messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: maxTokens, temperature: 0.3 });
  const out = result?.response ?? result;
  return typeof out === "string" ? parseModelJson(out) : out;
}

const DEBATE_RULES = `Use ONLY the facts listed. Each claim is ONE sentence of at most 160 characters and cites 1 to 3 facts by key, with the exact value from the list. Do not write any number that is not one of the cited facts. Do not say buy or sell and do not predict prices. Reply with one JSON object and nothing else.`;
const BULL_SYSTEM = `You are the BULL analyst in a research tool. Make the strongest honest case FOR this trade idea, in at most 3 claims. ${DEBATE_RULES} Format: {"claims":[{"text":"...","facts":[{"key":"...","value":0}]}]}`;
const BEAR_SYSTEM = `You are the BEAR analyst in a research tool. Make the strongest honest case AGAINST this trade idea, or for caution, in at most 3 claims. ${DEBATE_RULES} Format: {"claims":[{"text":"...","facts":[{"key":"...","value":0}]}]}`;
const REBUT_SYSTEM = `You answer the opposing side of a trade-idea debate. You are given the opposing claims with ids and your own side's claims. Write at most 2 rebuttals, each aimed at one opposing claim id. ${DEBATE_RULES} Format: {"rebuttals":[{"to":"B1","text":"...","facts":[{"key":"...","value":0}]}]}`;
const JUDGE_SYSTEM = `You are the judge of a bull versus bear debate on one trade idea in a research tool. You see only claims that were checked against the data, with ids. Weigh them. Do not say buy or sell, do not predict prices, and do not write numbers that are not in the claims. Reply with one JSON object and nothing else: {"leaning":"bull"|"bear"|"even","verdict":"one or two sentences, at most 220 characters","strongest_bull":"id","strongest_bear":"id","would_change_my_mind":"one sentence, at most 160 characters"}`;

function debatePack(item, marketState, keys, allFacts) {
  return { symbol: item.symbol, direction: item.direction, scanner: item.tag, facts: Object.fromEntries(keys.filter(k => allFacts[k] !== undefined).map(k => [k, { label: FACT_DEFS[k].label, value: allFacts[k] }])) };
}

async function runDebate(env, item, marketState) {
  const facts = debateFacts(item, marketState), model = env.DEBATE_MODEL || DEBATE_MODEL, judgeModel = env.RANKING_MODEL || WORKERS_AI_RANKING_MODEL;
  const bullKeys = BULL_KEYS.filter(k => facts[k] !== undefined), bearKeys = BEAR_KEYS.filter(k => facts[k] !== undefined);
  const ask = (system, payload, tokens) => debateCall(env, model, system, JSON.stringify(payload), tokens).catch(() => debateCall(env, judgeModel, system, JSON.stringify(payload), tokens));
  const [bullRaw, bearRaw] = await Promise.all([ask(BULL_SYSTEM, debatePack(item, marketState, bullKeys, facts)), ask(BEAR_SYSTEM, debatePack(item, marketState, bearKeys, facts))]);
  const bull = verifyDebateClaims(bullRaw?.claims, facts, bullKeys), bear = verifyDebateClaims(bearRaw?.claims, facts, bearKeys);
  const tag = (side, list) => list.map((claim, i) => ({ id: `${side}${i + 1}`, ...claim }));
  const bullClaims = tag("B", bull.kept), bearClaims = tag("R", bear.kept);
  let dropped = bull.dropped + bear.dropped;
  const result = { bull: bullClaims, bear: bearClaims, rebuttals: { bull: [], bear: [] }, judge: null, dropped_claims: 0, model, judge_model: judgeModel };
  if (bullClaims.length && bearClaims.length) {
    // Round 2: each side answers the other's claims.
    const rebut = (system, own, other, keys) => ask(system, { ...debatePack(item, marketState, keys, facts), your_claims: own.map(c => ({ id: c.id, text: c.text })), opposing_claims: other.map(c => ({ id: c.id, text: c.text, facts: c.facts.map(f => `${f.label}: ${f.display}`) })) }, 500);
    const [bullRe, bearRe] = await Promise.all([rebut(REBUT_SYSTEM, bullClaims, bearClaims, bullKeys), rebut(REBUT_SYSTEM, bearClaims, bullClaims, bearKeys)]);
    const clean = (raw, validTargets, keys) => {
      const rows = (Array.isArray(raw?.rebuttals) ? raw.rebuttals : []).filter(r => validTargets.has(String(r?.to)));
      const { kept, dropped: d } = verifyDebateClaims(rows, facts, keys, 2);
      dropped += d + (Array.isArray(raw?.rebuttals) ? raw.rebuttals.length : 0) - rows.length;
      return kept.map((claim, i) => ({ to: String(rows[i]?.to), ...claim }));
    };
    result.rebuttals.bull = clean(bullRe, new Set(bearClaims.map(c => c.id)), bullKeys);
    result.rebuttals.bear = clean(bearRe, new Set(bullClaims.map(c => c.id)), bearKeys);
    // Judge: sees only verified text.
    try {
      const view = list => list.map(c => ({ id: c.id, text: c.text, facts: c.facts.map(f => `${f.label}: ${f.display}`) }));
      const judged = await debateCall(env, judgeModel, JUDGE_SYSTEM, JSON.stringify({ symbol: item.symbol, direction: item.direction, bull_claims: view(bullClaims), bear_claims: view(bearClaims),
        bull_rebuttals: result.rebuttals.bull.map(r => ({ to: r.to, text: r.text })), bear_rebuttals: result.rebuttals.bear.map(r => ({ to: r.to, text: r.text })) }), 500);
      const str = (v, max) => typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
      const verdict = str(judged?.verdict, 240), change = str(judged?.would_change_my_mind, 180);
      const numberOk = text => [...text.matchAll(/\d+(?:\.\d+)?/g)].every(m => DEBATE_FREE_NUMBERS.has(Number(m[0])) || Object.values(facts).some(v => typeof v === "number" && Math.abs(Math.abs(v) - Number(m[0])) <= Math.max(0.051, Math.abs(v) * 0.01)));
      if (["bull", "bear", "even"].includes(judged?.leaning) && verdict && !DEBATE_FORBIDDEN.test(verdict + " " + change) && numberOk(verdict + " " + change)) {
        result.judge = { leaning: judged.leaning, verdict, would_change_my_mind: change || null,
          strongest_bull: bullClaims.some(c => c.id === judged.strongest_bull) ? judged.strongest_bull : null, strongest_bear: bearClaims.some(c => c.id === judged.strongest_bear) ? judged.strongest_bear : null };
      } else dropped++;
    } catch { /* the claims still show without a verdict */ }
  }
  result.dropped_claims = dropped;
  return result;
}

const debateRowId = marketId => `DEBATE:${marketId || "US"}`;
const debateKey = item => `${item.stop}|${item.target_1}|${item.filing?.earnings_in_days ?? ""}`;

// Runs in the hourly ranking job, never in a visitor's request. Reuses a stored debate while the idea's levels have not changed.
async function ensureDebate(env, payload) {
  if (!env.AI || !env.DB || !payload?.ranking?.items?.length) return;
  const marketId = payload.market || "US";
  const stored = (await edgarCacheRead(env, debateRowId(marketId))) || { items: {}, at: 0 };
  if (Date.now() - (stored.at || 0) < DEBATE_MIN_GAP_SECONDS * 1000) return;
  let ranking = payload.ranking;
  try { ranking = mergeAiRanking(ranking, await readAiRanking(env, marketId)); } catch { /* the rules order serves */ }
  const top = ranking.items.slice(0, DEBATE_TOP_N), items = {};
  for (const item of top) {
    const key = debateKey(item), old = stored.items?.[item.id];
    if (old && old.key === key && Date.now() - old.at < DEBATE_MAX_AGE_SECONDS * 1000) { items[item.id] = old; continue; }
    try { items[item.id] = { key, at: Date.now(), result: await runDebate(env, item, ranking.market_state) }; }
    catch (error) { console.error(`Debate failed for ${item.id}: ${cleanError(error)}`); if (old) items[item.id] = old; }
  }
  await edgarCacheWrite(env, debateRowId(marketId), { at: Date.now(), items });
}

// Lays stored debates over the ranking items they were made for.
function mergeDebate(ranking, stored) {
  if (!ranking?.items?.length || !stored?.items) return ranking;
  return { ...ranking, items: ranking.items.map(item => { const d = stored.items[item.id]; return d && d.key === debateKey(item) ? { ...item, debate: d.result } : item; }) };
}

async function rankStoredScan(env, market) {
  const stored = await readStoredScan(env, market);
  if (stored?.payload?.ranking?.items?.length) await ensureAiRanking(env, stored.payload, null);
  if (stored?.payload?.ranking?.items?.length) await ensureDebate(env, stored.payload).catch(error => console.error(`Debate job failed for ${market.id}: ${cleanError(error)}`));
}

async function backOffScan(env, market, seconds = AUTO_REFRESH_BACKOFF_SECONDS) {
  // A failed refresh (for example a provider rate limit) pauses further attempts instead of retrying on the next request.
  const until = Date.now() + seconds * 1000;
  scanMemory.set(`${market.id}:lock`, until);
  if (env.DB) {
    await env.DB.prepare("UPDATE scan_cache SET refreshing_until = ? WHERE market = ?").bind(new Date(until).toISOString(), market.id).run().catch(() => {});
  }
}

async function refreshScanIfDue(env, market, ctx, { wait = false } = {}) {
  const stored = await readStoredScan(env, market);
  const age = stored ? (Date.now() - Date.parse(stored.generatedAt)) / 1000 : Infinity;
  // A stored US scan from before the ranking existed is rebuilt once (and at most every 5 minutes), even while the market is closed.
  const outdated = stored && !stored.payload?.ranking && age > 5 * 60;
  if (!outdated && age < refreshInterval(market)) return stored;
  if (!outdated && !marketIsOpen(market) && stored && age < AUTO_REFRESH_CLOSED_SECONDS) return stored;
  if (await claimScanRefresh(env, market)) {
    const work = refreshScan(env, market, ctx).catch(error => { console.error(`scan refresh failed for ${market.id}: ${cleanError(error)}`); return backOffScan(env, market); });
    ctx.waitUntil(work);
    if (!stored || wait) await work;
  }
  return await readStoredScan(env, market);
}

async function autoScanResponse(env, market, ctx, { wait = false } = {}) {
  const stored = await refreshScanIfDue(env, market, ctx, { wait });
  if (!stored) {
    return { market: market.id, market_label: market.label, auto_refresh: market.auto, warming_up: true, candidates: [], long_candidates: [], short_candidates: [], late_candidates: [], direction_counts: { LONG: 0, SHORT: 0 }, errors: [], successful: 0, universe_size: market.universe?.length ?? 0, fresh_entry_count: 0, method: "", next_step: "", message: "The first scan for this market is being prepared automatically. It will appear shortly.", read_only: true, order_submission_supported: false };
  }
  let payload = stored.payload;
  if (payload?.ranking?.items?.length) {
    // Reading only: the AI ranking is produced by its own scheduled job, never by a visitor's request.
    try { payload = { ...payload, ranking: mergeAiRanking(payload.ranking, await readAiRanking(env, market.id)) }; } catch { /* the rules ranking still serves */ }
    try { payload = { ...payload, ranking: mergeDebate(payload.ranking, await edgarCacheRead(env, debateRowId(market.id))) }; } catch { /* no debate shown */ }
  }
  return withRefreshInfo(payload, stored.generatedAt, market);
}

const LEGAL_UPDATED = "November 2, 2026";
const esc = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

function legalPage(env, slug) {
  const contact = env.SUPPORT_EMAIL
    ? `<a href="mailto:${esc(env.SUPPORT_EMAIL)}">${esc(env.SUPPORT_EMAIL)}</a>`
    : "the developer through the TestFlight invitation or the App Store listing";
  const pages = {
    privacy: ["Privacy Policy", `
<p>IntelligentPortfolio is a read-only stock, India (BSE) and forex research tool with a website and an iPhone app. It never connects to a brokerage and never places orders. This page explains what information it handles.</p>
<h2>What we collect</h2>
<ul>
<li><strong>Sign-in details.</strong> If you sign in on the website with Google, we receive your Google account ID and email address. We use them only to recognise your account.</li>
<li><strong>Research history.</strong> When you are signed in, the research calls the app generates for you are stored against your account so their results can be graded later (the "learning memory").</li>
<li><strong>Holdings you enter.</strong> If you use "My holdings", the stocks, share counts, purchase prices and dates you type in are stored against your account so they can be checked against market data. They are never shared with a broker or anyone else.</li>
<li><strong>Device pairing.</strong> To connect the iPhone app to your account we store your device name, a one-time pairing code and a hashed session token. The token on the phone is kept in the iOS Keychain.</li>
<li><strong>Browsing without an account.</strong> The app and website can be used without signing in while the service is free. No personal data is stored for that.</li>
</ul>
<h2>What we do not collect</h2>
<p>No brokerage credentials, bank or card details, contacts, location, photos or advertising identifiers. We do not track you across other apps or websites, show advertising or sell data.</p>
<h2>Services involved</h2>
<ul>
<li><strong>Cloudflare</strong> hosts the service and its database.</li>
<li><strong>Google</strong> handles sign-in on the website.</li>
<li><strong>TradingView</strong> provides the embedded charts. The chart is loaded from TradingView, which may process data such as your IP address under its own privacy policy.</li>
<li><strong>Market-data providers</strong> supply prices. No information about you is sent to them.</li>
<li><strong>Stripe</strong> will process payments if paid subscriptions are switched on later. We never see card numbers.</li>
</ul>
<h2>Keeping and deleting your data</h2>
<p>In the iPhone app, open Account and choose "Delete my account data" to erase your research history, saved holdings, paired-device sessions and website sessions from our database. You can also email ${contact} to ask for deletion. Disconnecting a device in the app ends its session immediately. Sessions also expire on their own.</p>
<h2>Children</h2>
<p>The service is not directed at children under 13.</p>
<h2>Changes and contact</h2>
<p>We will update this page when anything material changes. Questions: ${contact}.</p>`],
    terms: ["Terms of Use and Disclaimer", `
<p>By using IntelligentPortfolio you agree to these terms.</p>
<h2>Research only, not advice</h2>
<p>IntelligentPortfolio provides general market research and educational information. It is <strong>not investment, financial, tax or legal advice</strong>, and it is not a recommendation to buy or sell any security, currency or other instrument. We are not a registered investment adviser or broker-dealer. You make your own decisions and are responsible for them.</p>
<h2>Holdings and "hold / exit" readings</h2>
<p>The holdings tracker only records what you tell it. Its hold, watch, take-profit and exit readings are automatic outputs of a technical-analysis rule set applied to public prices and your stated buy price. They do not know your goals, finances, taxes, other investments or risk tolerance, so they are <strong>not personalised advice</strong>. They can be late or wrong. You decide whether to buy or sell, and you place any order yourself with your own broker.</p>
<h2>No trading</h2>
<p>The service is read-only. It cannot access brokerage accounts, positions or orders, and it never places trades.</p>
<h2>Accuracy and risk</h2>
<p>Prices and indicators come from third-party sources and may be delayed, incomplete or wrong. Signals, targets, stops and historical test results are research scenarios. Past or simulated performance does not guarantee future results, and trading can lose money, including all of what you invest.</p>
<h2>Beta software</h2>
<p>During testing the service is free, may change or be interrupted, and is provided "as is" without warranties. To the extent the law allows, we are not liable for losses arising from its use.</p>
<h2>Charts and data</h2>
<p>Charts are provided by TradingView. Market data belongs to its respective providers.</p>
<p>Privacy: see the <a href="/privacy">Privacy Policy</a>. Last updated ${LEGAL_UPDATED}.</p>`],
    support: ["Support", `
<p>Need help with IntelligentPortfolio? Contact ${contact}.</p>
<h2>Common questions</h2>
<ul>
<li><strong>How do I connect the iPhone app to my account?</strong> In the app choose "Connect existing account", then open the website, sign in and enter the code under Pair iPhone. Or tap "Browse without an account" to try it first.</li>
<li><strong>How do I delete my data?</strong> In the app open Account and choose "Delete my account data".</li>
<li><strong>Does it place trades?</strong> No. It is read-only research.</li>
</ul>
<p><a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms and Disclaimer</a></p>`],
  };
  const [title, body] = pages[slug];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · IntelligentPortfolio</title><style>body{margin:0;background:#0b0f0d;color:#e8ece9;font:16px/1.6 -apple-system,system-ui,sans-serif}main{max-width:720px;margin:0 auto;padding:32px 20px 64px}h1{font:500 34px/1.2 Georgia,serif}h2{margin-top:28px;font-size:18px;color:#ffb85c}a{color:#ffb85c}li{margin:6px 0}</style></head><body><main><p><a href="/">← IntelligentPortfolio</a></p><h1>${esc(title)}</h1>${body}</main></body></html>`;
  return new Response(html, { headers: {
    "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-frame-options": "DENY",
  } });
}

async function deleteMobileAccountData(request, env) {
  const user = await requestUser(request, env);
  if (!user || user.auth_type !== "mobile" || !env.DB) throw Object.assign(new Error("Connect your account before deleting its data"), { status: 401 });
  await env.DB.batch([
    env.DB.prepare("DELETE FROM recommendations WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM holdings WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM holding_trades WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM mobile_pairings WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM mobile_sessions WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM web_sessions WHERE user_id = ?").bind(user.id),
  ]);
  accessCache.delete(`${user.id}:mobile`);
  return { deleted: true };
}

// ---- Holdings: positions the user entered by hand (read-only; nothing is ever sent to a broker) ----
const HOLDING_MARKETS = ["US", "IN"];
const MAX_OPEN_HOLDINGS = 20;
const HOLDING_ACTIONS = { HOLD: "Hold", WATCH: "Watch closely", TAKE_PROFIT: "Consider taking profit", EXIT: "Exit signal", NO_DATA: "No data" };
const holdingSnapshotCache = new Map();
const HOLDING_REFRESH_OPEN_SECONDS = 15 * 60;
const HOLDING_REFRESH_CLOSED_SECONDS = 30 * 60;
const HOLDING_SHARED_SYMBOLS = 150;
const holdKey = market => ({ id: `HOLD:${market.id}` });

// Everyone's open positions in a market are read in one shared batch and stored in the database, so prices and
// signals are identical for every user and the number of provider requests no longer depends on the number of
// users. A cron job keeps it fresh every five minutes while the market is open; a request only refreshes it when
// it is overdue, and the lock lets one refresh run at a time. There is no manual refresh.
async function refreshSharedHoldings(env, market, extra = []) {
  if (!env.DB || !(await claimScanRefresh(env, holdKey(market)))) return false;
  try {
    const rows = (await env.DB.prepare("SELECT symbol FROM holdings WHERE market = ? AND closed_at IS NULL GROUP BY symbol ORDER BY COUNT(*) DESC LIMIT ?").bind(market.id, HOLDING_SHARED_SYMBOLS).all()).results || [];
    const symbols = [...new Set([...extra, ...rows.map(row => row.symbol)])].slice(0, HOLDING_SHARED_SYMBOLS);
    if (!symbols.length) { await backOffScan(env, holdKey(market), 0); return false; }
    const fetched = await fetchSnapshots(symbols, market, env);
    if (!fetched.snapshots.size) throw new Error(fetched.errors?.[0]?.error || "No market data was returned");
    const snapshots = {};
    for (const [symbol, { history, chart_daily, ...slim }] of fetched.snapshots) snapshots[symbol] = slim;
    const payload = { snapshots, errors: (fetched.errors || []).slice(0, 50) };
    const generatedAt = new Date().toISOString();
    scanMemory.set(holdKey(market).id, { payload, generatedAt });
    scanMemory.delete(`${holdKey(market).id}:lock`);
    await env.DB.prepare("UPDATE scan_cache SET payload = ?, generated_at = ?, refreshing_until = NULL WHERE market = ?").bind(JSON.stringify(payload), generatedAt, holdKey(market).id).run();
    return true;
  } catch { await backOffScan(env, holdKey(market), 2 * 60); return false; }
}

async function refreshHoldingsIfDue(env, market) {
  if (!env.DB || !HOLDING_MARKETS.includes(market.id)) return;
  const stored = await readStoredScan(env, holdKey(market));
  const age = stored ? (Date.now() - Date.parse(stored.generatedAt)) / 1000 : Infinity;
  const fresh = marketIsOpen(market) ? HOLDING_REFRESH_OPEN_SECONDS : HOLDING_REFRESH_CLOSED_SECONDS;
  if (age < fresh - 30) return;
  await refreshSharedHoldings(env, market);
}

async function holdingSnapshotsFor(env, market, symbols) {
  const wanted = [...new Set(symbols)];
  const read = async () => {
    const stored = await readStoredScan(env, holdKey(market));
    if (!stored) return null;
    const snapshots = new Map(Object.entries(stored.payload.snapshots || {}));
    const errors = stored.payload.errors || [];
    const missing = wanted.filter(symbol => !snapshots.has(symbol) && !errors.some(entry => entry.symbol === symbol));
    return { snapshots, errors, missing, age: (Date.now() - Date.parse(stored.generatedAt)) / 1000 };
  };
  let shared = await read();
  const fresh = marketIsOpen(market) ? HOLDING_REFRESH_OPEN_SECONDS : HOLDING_REFRESH_CLOSED_SECONDS;
  if (!shared || shared.missing.length || shared.age > fresh) {
    if (await refreshSharedHoldings(env, market, wanted)) shared = await read();
  }
  if (shared && !shared.missing.length) return { snapshots: shared.snapshots, errors: shared.errors };
  // Nothing stored yet or another refresh is running: fetch only the symbols that are missing, shared for a short while.
  const need = shared ? shared.missing : wanted;
  const key = `${market.id}:${[...need].sort().join(",")}`;
  const hit = holdingSnapshotCache.get(key);
  let direct = hit && Date.now() - hit.fetchedAt <= 55000 ? hit.value : null;
  if (!direct) {
    direct = await fetchSnapshots(need, market, env).catch(error => ({ snapshots: new Map(), errors: need.map(symbol => ({ symbol, error: cleanError(error) })) }));
    if (holdingSnapshotCache.size > 40) holdingSnapshotCache.delete(holdingSnapshotCache.keys().next().value);
    holdingSnapshotCache.set(key, { value: direct, fetchedAt: Date.now() });
  }
  return { snapshots: new Map([...(shared?.snapshots || []), ...direct.snapshots]), errors: [...(shared?.errors || []), ...(direct.errors || [])] };
}

// ---- Position monitor (US positions): the protective level follows the daily Supertrend line ----
// Each pass recomputes a position's levels from its buy price, the ATR when monitoring began, the highest price seen since entry and the daily
// Supertrend line. Levels only move in the safe direction (the protective level up, never down), so a pass can be repeated at any time.
//   Protective level: the daily Supertrend line while the daily trend is up, and it rises as the trend continues. Before the line exists (or if it
//                     is unavailable) it is 2 ATR under the buy price.
//   Exit:             when a daily bar CLOSES under the line (the daily trend turns down). The exit is not a price touch, and no time limit applies.
//   Profit zones:     +1 and +2 ATR over the buy price, for reference only; reaching them does not mean sell.
// Tested on Supertrend entries (ml_st_exits.py): exiting on the line earned +1.8% per trade; adding an early-warning exit (close under a moving
// average, ADX fading, the market under its 50-day average, a tighter trail) lowered the average each time, so those are shown as warnings only.
const MONITOR_LINE_STEP_ATR = 0.5;   // a rise in the protective level smaller than this is applied silently, not logged as an event

function monitorLevels(row, snapshot) {
  const market = MARKETS[row.market] || MARKETS.US;
  const fmt = value => fmtPrice(value, market);
  const buy = Number(row.buy_price);
  const atr = numeric(row.monitor_atr) || numeric(snapshot.atr_14) || buy * 0.02;
  const boughtDate = String(row.bought_at || "").slice(0, 10);
  const bars = (snapshot.recent_daily || []).filter(bar => bar.d > boughtDate);
  const price = numeric(snapshot.price);
  const peak = Math.max(numeric(row.peak_high), buy, price, ...bars.map(bar => numeric(bar.h)));
  const trendUp = snapshot.daily_supertrend?.direction === "LONG";
  const line = trendUp ? numeric(snapshot.daily_supertrend?.value) : 0;
  const fallbackStop = Math.max(0.01, buy - Math.max(2 * atr, buy * 0.01));
  const persisted = numeric(row.stop_level);
  const firstRun = row.stop_level == null;
  let stop = Math.max(persisted, line > 0 && line < price ? line : 0, firstRun ? fallbackStop : 0);
  stop = Math.max(stop, persisted);
  const target1 = Math.max(numeric(row.target_1), buy + TARGET_1_ATR * atr), target2 = Math.max(numeric(row.target_2), buy + TARGET_2_ATR * atr);
  const events = [];
  if (firstRun) events.push({ kind: "INITIAL", reason: `Protective level set at ${fmt(stop)} (${line > 0 && stop === line ? "the daily Supertrend line" : "two daily ranges under your buy price, because the daily Supertrend line is not available"}). It rises with the trend and you exit if a day closes under it.` });
  else if (stop - persisted >= MONITOR_LINE_STEP_ATR * atr) events.push({ kind: "LINE_RAISED", reason: `The daily Supertrend line moved up to ${fmt(stop)}, so your protective level moved up with it.` });
  const basis = line > 0 && stop >= line - 1e-9 ? "LINE" : stop > buy + 1e-9 ? "RAISED" : "INITIAL";
  const stopText = basis === "LINE" ? "the daily Supertrend line, which rises as the trend continues; exit if a day closes under it" : basis === "RAISED" ? "raised with the daily Supertrend line" : "two daily ranges under your buy price until the daily Supertrend line is available";
  return { stop, target1, target2, atr, peak, basis, stopText, events, line };
}

// Writes only what changed. MAX() in SQL keeps a stale read from ever lowering a level that another pass has already raised.
function monitorStatements(env, row, levels, price, now) {
  const statements = [];
  const changed = levels.events.length > 0 || row.monitor_atr == null || levels.peak > numeric(row.peak_high) * 1.0005 || levels.stop > numeric(row.stop_level) + 1e-9;
  if (!changed) return statements;
  statements.push(env.DB.prepare(`UPDATE holdings SET monitor_atr = COALESCE(monitor_atr, ?), stop_level = MAX(COALESCE(stop_level, 0), ?),
    target_1 = MAX(COALESCE(target_1, 0), ?), target_2 = MAX(COALESCE(target_2, 0), ?), peak_high = MAX(COALESCE(peak_high, 0), ?), monitor_at = ?
    WHERE id = ? AND closed_at IS NULL`).bind(round(levels.atr, 6), round(levels.stop, 6), round(levels.target1, 6), round(levels.target2, 6), round(levels.peak, 6), now, row.id));
  for (const event of levels.events) {
    statements.push(env.DB.prepare(`INSERT INTO holding_level_events (id, holding_id, user_id, symbol, at, kind, reason, price, stop_level, target_1, target_2)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), row.id, row.user_id, row.symbol, now, event.kind, event.reason, round(price, 4),
      round(levels.stop, 4), round(levels.target1, 4), round(levels.target2, 4)));
  }
  return statements;
}

// Cron pass: watches every open US position against the shared, freshly refreshed snapshots and ratchets levels without anyone opening the app.
const ALERT_ACTIONS = { EXIT: ["high", "Exit signal"], TAKE_PROFIT: ["high", "Profit target reached"], WATCH: ["info", "Weakening: watch it"] };

function alertStatement(env, row, now, { kind, severity, title, detail, key }) {
  return env.DB.prepare(`INSERT OR IGNORE INTO holding_alerts (id, user_id, holding_id, symbol, at, kind, severity, title, detail, dedupe_key, seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).bind(crypto.randomUUID(), row.user_id, row.id, row.symbol, now, kind, severity, title, String(detail).slice(0, 400), key);
}

async function monitorHoldings(env, market) {
  if (!env.DB || market.id !== "US") return 0;
  const stored = await readStoredScan(env, holdKey(market));
  const snapshots = stored?.payload?.snapshots;
  if (!snapshots) return 0;
  const rows = (await env.DB.prepare("SELECT * FROM holdings WHERE market = ? AND closed_at IS NULL LIMIT 1000").bind(market.id).all()).results || [];
  const now = new Date().toISOString(), day = now.slice(0, 10), statements = [];
  for (const row of rows) {
    const snapshot = snapshots[row.symbol];
    if (!snapshot) continue;
    try {
      const levels = monitorLevels(row, snapshot);
      statements.push(...monitorStatements(env, row, levels, numeric(snapshot.price), now));
      // Alerts: a change of read (recorded here so it is not lost when nobody has the app open) and a raised protective level.
      const evaluation = evaluateHolding(row, snapshot, levels);
      if (evaluation.action !== "NO_DATA" && evaluation.action !== row.last_action) {
        statements.push(env.DB.prepare("UPDATE holdings SET last_action = ?, last_action_at = ? WHERE id = ? AND user_id = ?").bind(evaluation.action, now, row.id, row.user_id));
        const meta = ALERT_ACTIONS[evaluation.action];
        if (row.last_action && meta) statements.push(alertStatement(env, row, now, { kind: evaluation.action, severity: meta[0], title: `${row.symbol}: ${meta[1]}`, detail: `${evaluation.headline}. ${evaluation.reasons[0] || ""}`, key: `${row.id}:${evaluation.action}:${day}` }));
      }
      for (const event of levels.events) if (event.kind === "LINE_RAISED") statements.push(alertStatement(env, row, now, { kind: "STOP_RAISED", severity: "info", title: `${row.symbol}: protective level raised`, detail: event.reason, key: `${row.id}:STOP:${day}` }));
    } catch { /* one bad row must not stop the rest */ }
  }
  // Upcoming earnings and serious filings on held stocks, from the same cached lookups as the ranking.
  try {
    const held = [...new Set(rows.filter(row => snapshots[row.symbol]).map(row => row.symbol))];
    const filings = held.length ? await loadFilingFlags(env, held, 3) : new Map();
    for (const row of rows) {
      const f = filings.get(row.symbol);
      if (!f) continue;
      if (f.earnings_in_days != null && f.earnings_in_days >= 0 && f.earnings_in_days <= 7) {
        const when = f.earnings_in_days === 0 ? "today" : f.earnings_in_days === 1 ? "tomorrow" : `in ${f.earnings_in_days} days`;
        const timing = f.earnings_timing === "pm" ? " after the close" : f.earnings_timing === "am" ? " before the open" : "";
        statements.push(alertStatement(env, row, now, { kind: "EARNINGS_SOON", severity: "info", title: `${row.symbol}: earnings ${when}`,
          detail: `${f.earnings_confirmed ? "Confirmed" : "Expected"} ${f.earnings_estimate}${timing}${f.earnings_confirmed ? "" : " (not yet confirmed by the company)"}. Reports can move a stock sharply either way.`, key: `${row.id}:EARN:${f.earnings_estimate}` }));
      }
      for (const text of f.severe || []) statements.push(alertStatement(env, row, now, { kind: "FILING_RED_FLAG", severity: "high", title: `${row.symbol}: serious SEC filing`, detail: `Recent filing shows ${text}.`, key: `${row.id}:RED:${text}` }));
    }
  } catch { /* alerts for filings are best effort */ }
  for (let index = 0; index < statements.length; index += 50) await env.DB.batch(statements.slice(index, index + 50));
  return statements.length;
}

// A hold / watch / take-profit / exit read on a long position, from the same engine that ranks the scanner.
// The protective level sits 2 daily ATRs (at least 1%) below the buy price; target 1 is 1 daily ATR above it and
// target 2 is 2 daily ATRs above (see STOP_ATR). US positions pass `levels` from the position monitor, which ratchets the stop up
// and the targets out as the trade and the market develop; other markets use the fixed levels.
function evaluateHolding(holding, snapshot, levels = null) {
  const market = MARKETS[holding.market] || MARKETS.US;
  const fmt = value => fmtPrice(value, market);
  const price = numeric(snapshot.price);
  const buy = Number(holding.buy_price), shares = Number(holding.shares);
  const trend4h = snapshot.supertrend?.direction || "SHORT";
  const dailyTrend = snapshot.daily_supertrend?.direction || "SHORT";
  const adx = numeric(snapshot.daily_adx?.value);
  const atr = numeric(snapshot.atr_14) || buy * 0.02;
  const stopLevel = levels ? levels.stop : Math.max(0.01, buy - Math.max(STOP_ATR * atr, buy * 0.01));
  const trailing = trend4h === "LONG" ? Math.max(stopLevel, numeric(snapshot.supertrend?.value)) : stopLevel;
  const target1 = levels ? levels.target1 : buy + TARGET_1_ATR * atr, target2 = levels ? levels.target2 : buy + TARGET_2_ATR * atr;
  const stopText = levels ? levels.stopText : "two daily ranges below your buy price";
  const pnlPct = (price / buy - 1) * 100;
  const reasons = [];
  let action, headline;
  const sma20 = numeric(snapshot.sma_20);
  if (levels) {
    // US positions: exit only when the daily Supertrend turns down (a completed daily close under the line). Anything else that suggests the
    // trend may fade is a warning, because exits on those signals lowered returns in tests (ml_st_exits.py).
    const warnings = [];
    if (trend4h === "SHORT") warnings.push("The 4-hour Supertrend has turned down. This is an early warning, not the exit.");
    if (adx < 20) warnings.push(`Daily ADX is ${adx.toFixed(1)}, below 20, so the trend is losing strength.`);
    if (sma20 && price < sma20) warnings.push(`Price is under its 20-day average (${fmt(sma20)}).`);
    if (price <= stopLevel && dailyTrend !== "SHORT") warnings.push(`Price is at or under the protective level ${fmt(stopLevel)}. The exit is a day CLOSING under it, so a close under it today means exit at the next open.`);
    if (dailyTrend === "SHORT") {
      action = "EXIT";
      headline = "The daily trend has turned down";
      reasons.push("A completed daily close is under the daily Supertrend line, which is the exit that tested best for Supertrend trades. Exit at the next open.");
      reasons.push(...warnings.filter(text => !text.startsWith("Price is at or under")));
    } else if (warnings.length) {
      action = "WATCH";
      headline = price <= stopLevel ? "Under the exit line: it only counts if the day closes there" : "The trend may be weakening";
      reasons.push(...warnings);
      reasons.push("These are warnings only. Exiting on them lowered returns in tests; the exit is the daily Supertrend line.");
    } else {
      action = "HOLD";
      headline = price >= target1 ? "Trend is intact (profit zone reached, stay with the trend)" : "Trend is intact";
      reasons.push(`The daily trend is up and the exit line is ${fmt(stopLevel)}. There is no time limit: stay in while the daily Supertrend holds.`);
      if (price >= target1) reasons.push(`The first profit zone ${fmt(target1)} has been reached. Reaching it does not mean sell; selling early lowered returns in tests.`);
    }
  } else if (price <= stopLevel) {
    action = "EXIT";
    headline = "Price is below the protective level for this position";
    reasons.push(`Price ${fmt(price)} is under the protective level ${fmt(stopLevel)} (${stopText}).`);
  } else if (trend4h === "SHORT") {
    action = "EXIT";
    headline = "The 4-hour trend has turned down";
    reasons.push("The confirmed 4H Supertrend (10, 3) is now pointing down, which is how the strategy leaves a long trade.");
    if (dailyTrend === "SHORT") reasons.push("The daily trend is down as well, so both timeframes agree.");
  } else if (price >= target1) {
    action = "TAKE_PROFIT";
    headline = price >= target2 ? "Target 2 has been reached" : "Target 1 has been reached";
    reasons.push(`Price ${fmt(price)} is above ${price >= target2 ? `target 2 at ${fmt(target2)}` : `target 1 at ${fmt(target1)}`}.`);
    reasons.push(`The 4H trend is still up. Securing part of the gain and trailing the rest under ${fmt(trailing)} follows the trend.`);
  } else if (dailyTrend === "SHORT" || adx < 20 || (price - trailing) < 0.5 * atr) {
    action = "WATCH";
    headline = "Trend is intact but weakening";
    if (dailyTrend === "SHORT") reasons.push("The daily trend is down while the 4H trend is still up, so the move is against the bigger direction.");
    if (adx < 20) reasons.push(`Daily ADX is ${adx.toFixed(1)}, below 20, which means weak trend strength.`);
    if ((price - trailing) < 0.5 * atr) reasons.push(`Price is within half a daily range of the trailing level ${fmt(trailing)}.`);
  } else {
    action = "HOLD";
    headline = "Trend is intact";
    reasons.push(`The 4H trend is up and daily trend is up. The trailing level is ${fmt(trailing)}.`);
    reasons.push(`Daily ADX is ${adx.toFixed(1)}${snapshot.daily_adx?.rising ? " and rising" : ""}.`);
  }
  return {
    action,
    action_label: HOLDING_ACTIONS[action],
    headline,
    reasons,
    current_price: round(price, 4),
    cost: round(buy * shares, 2),
    value: round(price * shares, 2),
    pnl_value: round((price - buy) * shares, 2),
    pnl_pct: round(pnlPct, 2),
    stop_level: round(stopLevel, 4),
    reference_lines: referenceLines(snapshot.chart_refs),
    stop_basis: levels ? levels.basis : "INITIAL",
    stop_note: levels ? levels.stopText : stopText,
    trailing_level: round(trailing, 4),
    target_1: round(target1, 4),
    target_2: round(target2, 4),
    trend_4h: trend4h,
    daily_trend: dailyTrend,
    daily_adx: round(adx, 1),
    market_time: snapshot.market_time || null,
  };
}

function noDataEvaluation() {
  return { action: "NO_DATA", action_label: HOLDING_ACTIONS.NO_DATA, headline: "Market data is unavailable right now", reasons: ["The data provider did not return enough history for this symbol. It will be checked again on the next refresh."] };
}

// Every entry belongs to a "chain": the original holding it came from. A partial sale is recorded against the
// closed piece (holding_id) but stays in the chain of the position it was sold from, so undo can find its parent.
const TRADE_SQL = "INSERT INTO holding_trades (id, user_id, holding_id, chain_id, symbol, market, side, shares, price, at, realized_pnl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
const tradeStatement = (env, userId, holdingId, row, side, shares, price, at, pnl = null, chainId = holdingId) =>
  env.DB.prepare(TRADE_SQL).bind(randomBase64Url(9), userId, holdingId, chainId, row.symbol, row.market, side, shares, price, at, pnl);

const PORTFOLIO_CONCENTRATION_LIMIT = 25;
const sectorCache = new Map();

async function sectorsFor(marketId) {
  const market = MARKETS[marketId];
  if (market?.universe) return new Map(market.universe.map(entry => [entry.symbol, entry.sector || "Other"]));
  const hit = sectorCache.get(marketId);
  if (hit && Date.now() - hit.at < 12 * 3600 * 1000) return hit.map;
  try {
    const map = new Map((await loadUniverse()).map(record => [record.symbol, record.sector]));
    sectorCache.set(marketId, { at: Date.now(), map });
    return map;
  } catch { return new Map(); }
}

// How the open holdings fit together, per market (rupees and dollars are never added): weights, sectors,
// concentration, how much is at risk down to the protective levels, and how the readings split.
async function buildPortfolio(items) {
  const markets = [];
  for (const marketId of HOLDING_MARKETS) {
    const group = items.filter(item => item.market === marketId && item.action !== "NO_DATA");
    if (!group.length) continue;
    const sectors = await sectorsFor(marketId);
    const value = group.reduce((sum, item) => sum + item.value, 0), cost = group.reduce((sum, item) => sum + item.cost, 0);
    const bySymbol = new Map(), bySector = new Map(), byAction = new Map();
    let riskToStops = 0;
    for (const item of group) {
      const sector = sectors.get(item.symbol) || "Unknown";
      const position = bySymbol.get(item.symbol) || { symbol: item.symbol, sector, value: 0, cost: 0, action: item.action };
      position.value += item.value; position.cost += item.cost;
      bySymbol.set(item.symbol, position);
      const sectorEntry = bySector.get(sector) || { sector, value: 0 };
      sectorEntry.value += item.value; bySector.set(sector, sectorEntry);
      const actionEntry = byAction.get(item.action) || { action: item.action, label: HOLDING_ACTIONS[item.action], count: 0, value: 0 };
      actionEntry.count += 1; actionEntry.value += item.value; byAction.set(item.action, actionEntry);
      riskToStops += Math.max(0, (item.current_price - item.stop_level) * item.shares);
    }
    const weight = amount => value ? round(amount / value * 100, 1) : 0;
    const positions = [...bySymbol.values()].sort((a, b) => b.value - a.value).map(position => ({
      symbol: position.symbol, sector: position.sector, action: position.action, value: round(position.value, 2), weight_pct: weight(position.value),
      pnl_pct: position.cost ? round((position.value / position.cost - 1) * 100, 2) : 0,
    }));
    markets.push({
      market: marketId,
      label: MARKETS[marketId].label,
      currency_symbol: MARKETS[marketId].symbolPrefix,
      value: round(value, 2),
      cost: round(cost, 2),
      pnl_value: round(value - cost, 2),
      pnl_pct: cost ? round((value / cost - 1) * 100, 2) : 0,
      risk_to_stops_value: round(riskToStops, 2),
      risk_to_stops_pct: value ? round(riskToStops / value * 100, 1) : 0,
      positions,
      sectors: [...bySector.values()].sort((a, b) => b.value - a.value).map(entry => ({ sector: entry.sector, value: round(entry.value, 2), weight_pct: weight(entry.value) })),
      readings: [...byAction.values()].sort((a, b) => b.value - a.value).map(entry => ({ ...entry, value: round(entry.value, 2), weight_pct: weight(entry.value) })),
      single_position: positions.length === 1,
      concentrated: positions.length > 1 ? positions.filter(position => position.weight_pct > PORTFOLIO_CONCENTRATION_LIMIT).map(position => ({ symbol: position.symbol, weight_pct: position.weight_pct })) : [],
    });
  }
  return { limit_pct: PORTFOLIO_CONCENTRATION_LIMIT, markets };
}

async function holdingsUser(request, env) {
  await requireSubscription(request, env);
  const user = await requestUser(request, env);
  if (!user || !env.DB) throw Object.assign(new Error("Sign in or connect your account to track holdings"), { status: 401 });
  return user;
}

// Numbers from request bodies must be real numbers or numeric strings; Number([5]) or Number(true) must not slip through.
function toAmount(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return NaN;
}
// A strict YYYY-MM-DD calendar day that exists and is not in the future.
function validPastDay(text, today) {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text) || text > today) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}
const MIN_AMOUNT = 1e-4;

async function addHolding(request, env) {
  const user = await holdingsUser(request, env);
  const body = await readBody(request);
  const symbol = String(body.symbol || "").trim().toUpperCase();
  const marketId = String(body.market || "US").toUpperCase();
  if (!HOLDING_MARKETS.includes(marketId)) throw Object.assign(new Error("Holdings can be tracked for US and BSE stocks"), { status: 400 });
  const market = MARKETS[marketId];
  if (!/^[A-Z0-9.\-^&]{1,15}$/.test(symbol)) throw Object.assign(new Error("Enter a valid ticker symbol"), { status: 400 });
  if (market.universe && !market.universe.some(entry => entry.symbol === symbol)) throw Object.assign(new Error(`Choose one of the ${market.name} symbols`), { status: 400 });
  const shares = toAmount(body.shares), price = toAmount(body.price);
  if (!Number.isFinite(shares) || shares < MIN_AMOUNT || shares > 1e9) throw Object.assign(new Error("Enter how many shares you bought"), { status: 400 });
  if (!Number.isFinite(price) || price < MIN_AMOUNT || price > 1e8) throw Object.assign(new Error("Enter the price you paid per share"), { status: 400 });
  const today = new Date().toISOString().slice(0, 10);
  const boughtAt = body.bought_at === undefined || body.bought_at === null || body.bought_at === "" ? today : body.bought_at;
  if (!validPastDay(boughtAt, today)) throw Object.assign(new Error("Enter a valid purchase date that is not in the future"), { status: 400 });
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM holdings WHERE user_id = ? AND closed_at IS NULL").bind(user.id).first();
  if (Number(open?.n || 0) >= MAX_OPEN_HOLDINGS) throw Object.assign(new Error(`You can track up to ${MAX_OPEN_HOLDINGS} open holdings. Remove or close one first.`), { status: 400 });
  const { snapshots, errors } = await holdingSnapshotsFor(env, market, [symbol]);
  if (!snapshots.get(symbol)) throw Object.assign(new Error(`No market data found for ${symbol}${errors?.[0]?.error ? ` (${errors[0].error})` : ""}`), { status: 400 });
  const id = randomBase64Url(12);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO holdings (id, user_id, symbol, market, shares, buy_price, bought_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, user.id, symbol, marketId, shares, price, boughtAt, new Date().toISOString()),
    tradeStatement(env, user.id, id, { symbol, market: marketId }, "BUY", shares, price, `${boughtAt}T00:00:00.000Z`),
  ]);
  return { added: true, id };
}

async function listHoldings(request, env) {
  const user = await holdingsUser(request, env);
  await readBody(request); // a "refresh" flag from an older app is ignored: holdings refresh on the shared schedule only
  const rows = (await env.DB.prepare("SELECT * FROM holdings WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").bind(user.id).all()).results || [];
  // A closed row without a sale price is an undone entry, so it is hidden.
  const open = rows.filter(row => !row.closed_at), closed = rows.filter(row => row.closed_at && row.sell_price != null);
  const lastByChain = new Map();
  for (const trade of (await env.DB.prepare("SELECT * FROM holding_trades WHERE user_id = ? AND voided_at IS NULL ORDER BY at DESC, rowid DESC LIMIT 300").bind(user.id).all()).results || []) {
    const chain = trade.chain_id || trade.holding_id;
    if (!lastByChain.has(chain)) lastByChain.set(chain, trade);
  }
  const symbolsByMarket = new Map();
  for (const row of open) {
    if (!symbolsByMarket.has(row.market)) symbolsByMarket.set(row.market, new Set());
    symbolsByMarket.get(row.market).add(row.symbol);
  }
  const loaded = new Map();
  for (const [marketId, symbols] of symbolsByMarket) if (MARKETS[marketId]) loaded.set(marketId, await holdingSnapshotsFor(env, MARKETS[marketId], [...symbols]));
  const now = new Date().toISOString();
  const updates = [];
  const eventsByHolding = new Map();
  for (const event of (await env.DB.prepare("SELECT holding_id, at, kind, reason FROM holding_level_events WHERE user_id = ? ORDER BY at DESC LIMIT 200").bind(user.id).all().catch(() => ({ results: [] }))).results || []) {
    const list = eventsByHolding.get(event.holding_id) || [];
    if (list.length < 5) list.push({ at: event.at, kind: event.kind, reason: event.reason });
    eventsByHolding.set(event.holding_id, list);
  }
  const base = row => ({ id: row.id, symbol: row.symbol, market: row.market, currency_symbol: MARKETS[row.market]?.symbolPrefix || "$", price_decimals: MARKETS[row.market]?.decimals(row.buy_price) ?? 2, shares: row.shares, buy_price: row.buy_price, bought_at: row.bought_at });
  const openOut = open.map(row => {
    let evaluation;
    try {
      const snapshot = loaded.get(row.market)?.snapshots.get(row.symbol);
      let levels = null;
      if (snapshot && row.market === "US") {
        levels = monitorLevels(row, snapshot);
        const fresh = monitorStatements(env, row, levels, numeric(snapshot.price), now);
        updates.push(...fresh);
        if (levels.events.length) eventsByHolding.set(row.id, [...levels.events.map(event => ({ at: now, kind: event.kind, reason: event.reason })).reverse(), ...(eventsByHolding.get(row.id) || [])].slice(0, 5));
      }
      evaluation = snapshot ? evaluateHolding(row, snapshot, levels) : noDataEvaluation();
    } catch { evaluation = noDataEvaluation(); }
    let since = row.last_action_at || now;
    if (evaluation.action !== "NO_DATA" && evaluation.action !== row.last_action) {
      since = now;
      updates.push(env.DB.prepare("UPDATE holdings SET last_action = ?, last_action_at = ? WHERE id = ? AND user_id = ?").bind(evaluation.action, now, row.id, user.id));
      const meta = ALERT_ACTIONS[evaluation.action];
      if (row.last_action && meta) updates.push(alertStatement(env, row, now, { kind: evaluation.action, severity: meta[0], title: `${row.symbol}: ${meta[1]}`, detail: `${evaluation.headline}. ${evaluation.reasons[0] || ""}`, key: `${row.id}:${evaluation.action}:${now.slice(0, 10)}` }));
    }
    const last = lastByChain.get(row.id);
    return {
      ...base(row), ...evaluation, previous_action: row.last_action || null, action_since: since, level_events: eventsByHolding.get(row.id) || [],
      last_entry: last ? { id: last.id, side: last.side, shares: last.shares, price: last.price, at: last.at } : null,
    };
  });
  if (updates.length) await env.DB.batch(updates).catch(() => {});
  const alertRows = (await env.DB.prepare("SELECT id, holding_id, symbol, at, kind, severity, title, detail, seen_at FROM holding_alerts WHERE user_id = ? ORDER BY at DESC LIMIT 30").bind(user.id).all().catch(() => ({ results: [] }))).results || [];
  const totals = new Map();
  for (const item of openOut) {
    if (item.action === "NO_DATA") continue;
    const total = totals.get(item.market) || { market: item.market, currency_symbol: item.currency_symbol, cost: 0, value: 0 };
    total.cost += item.cost; total.value += item.value;
    totals.set(item.market, total);
  }
  const anyOpen = [...symbolsByMarket.keys()].some(marketId => MARKETS[marketId] && marketIsOpen(MARKETS[marketId]));
  return {
    updated_at: now,
    refresh_after_seconds: anyOpen ? HOLDING_REFRESH_OPEN_SECONDS : HOLDING_REFRESH_CLOSED_SECONDS,
    open: openOut,
    alerts: { unseen: alertRows.filter(row => !row.seen_at).length, items: alertRows },
    portfolio: await buildPortfolio(openOut),
    market_trends: Object.fromEntries(await Promise.all([...symbolsByMarket.keys()].filter(id => MARKETS[id]).map(async id => [id, (await readStoredScan(env, MARKETS[id]))?.payload?.market_trend || null]))),
    closed: closed.slice(0, 20).map(row => ({ ...base(row), sell_price: row.sell_price, closed_at: row.closed_at, pnl_value: round((row.sell_price - row.buy_price) * row.shares, 2), pnl_pct: round((row.sell_price / row.buy_price - 1) * 100, 2) })),
    totals: [...totals.values()].map(total => ({ ...total, cost: round(total.cost, 2), value: round(total.value, 2), pnl_value: round(total.value - total.cost, 2), pnl_pct: total.cost ? round((total.value / total.cost - 1) * 100, 2) : 0 })),
    disclaimer: "Automated research scenarios from public price data, not personal financial advice. You decide what to do; nothing is ever sent to a broker.",
  };
}

// Buying more of a stock you already hold: shares add up and the buy price becomes the weighted average.
// One UPDATE does both so two quick taps can never overwrite each other.
async function increaseHolding(request, env) {
  const user = await holdingsUser(request, env);
  const body = await readBody(request);
  const id = String(body.id || ""), shares = toAmount(body.shares), price = toAmount(body.price);
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) throw Object.assign(new Error("Holding not found"), { status: 404 });
  if (!Number.isFinite(shares) || shares < MIN_AMOUNT || shares > 1e9) throw Object.assign(new Error("Enter how many more shares you bought"), { status: 400 });
  if (!Number.isFinite(price) || price < MIN_AMOUNT || price > 1e8) throw Object.assign(new Error("Enter the price you paid per share"), { status: 400 });
  const row = await env.DB.prepare("SELECT * FROM holdings WHERE id = ? AND user_id = ?").bind(id, user.id).first();
  if (!row || row.closed_at) throw Object.assign(new Error("Holding not found"), { status: 404 });
  await env.DB.batch([
    env.DB.prepare("UPDATE holdings SET buy_price = (shares * buy_price + ? * ?) / (shares + ?), shares = shares + ? WHERE id = ? AND user_id = ? AND closed_at IS NULL")
      .bind(shares, price, shares, shares, id, user.id),
    tradeStatement(env, user.id, id, row, "BUY", shares, price, new Date().toISOString()),
  ]);
  return { increased: true };
}

// Selling some or all shares. A full sale closes the holding; a partial sale reduces it and records the sold
// part as its own closed entry at the same average buy price, so realised profit and loss stay accurate.
async function sellHolding(request, env) {
  const user = await holdingsUser(request, env);
  const body = await readBody(request);
  const id = String(body.id || ""), price = toAmount(body.price);
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) throw Object.assign(new Error("Holding not found"), { status: 404 });
  if (!Number.isFinite(price) || price <= 0 || price > 1e8) throw Object.assign(new Error("Enter the price you sold at"), { status: 400 });
  const row = await env.DB.prepare("SELECT * FROM holdings WHERE id = ? AND user_id = ?").bind(id, user.id).first();
  if (!row || row.closed_at) throw Object.assign(new Error("Holding not found"), { status: 404 });
  const sold = body.shares === undefined || body.shares === null || body.shares === "" ? Number(row.shares) : toAmount(body.shares);
  if (!Number.isFinite(sold) || sold <= 0) throw Object.assign(new Error("Enter how many shares you sold"), { status: 400 });
  if (sold > Number(row.shares) + 1e-9) throw Object.assign(new Error(`You only hold ${Number(row.shares)} shares`), { status: 400 });
  const now = new Date().toISOString();
  if (sold >= Number(row.shares) - 1e-9) {
    await env.DB.batch([
      env.DB.prepare("UPDATE holdings SET closed_at = ?, sell_price = ? WHERE id = ? AND user_id = ? AND closed_at IS NULL").bind(now, price, id, user.id),
      tradeStatement(env, user.id, id, row, "SELL", Number(row.shares), price, now, (price - Number(row.buy_price)) * Number(row.shares)),
    ]);
    return { sold: true, closed: true, remaining: 0 };
  }
  const closedId = randomBase64Url(12);
  await env.DB.batch([
    env.DB.prepare("UPDATE holdings SET shares = shares - ? WHERE id = ? AND user_id = ? AND closed_at IS NULL AND shares > ?").bind(sold, id, user.id, sold),
    env.DB.prepare("INSERT INTO holdings (id, user_id, symbol, market, shares, buy_price, bought_at, created_at, closed_at, sell_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(closedId, user.id, row.symbol, row.market, sold, row.buy_price, row.bought_at, now, now, price),
    tradeStatement(env, user.id, closedId, row, "SELL", sold, price, now, (price - Number(row.buy_price)) * sold, id),
  ]);
  return { sold: true, closed: false, remaining: round(Number(row.shares) - sold, 6) };
}

async function closeHolding(request, env) {
  const user = await holdingsUser(request, env);
  const body = await readBody(request);
  const id = String(body.id || ""), sellPrice = Number(body.sell_price);
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) throw Object.assign(new Error("Holding not found"), { status: 404 });
  if (!Number.isFinite(sellPrice) || sellPrice <= 0) throw Object.assign(new Error("Enter the price you sold at"), { status: 400 });
  const row = await env.DB.prepare("SELECT * FROM holdings WHERE id = ? AND user_id = ?").bind(id, user.id).first();
  if (!row || row.closed_at) return { closed: true };
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE holdings SET closed_at = ?, sell_price = ? WHERE id = ? AND user_id = ? AND closed_at IS NULL").bind(now, sellPrice, id, user.id),
    tradeStatement(env, user.id, id, row, "SELL", Number(row.shares), sellPrice, now, (sellPrice - Number(row.buy_price)) * Number(row.shares)),
  ]);
  return { closed: true };
}

// Performance from the user's closed sales (each partial sale is its own closed entry), kept per market
// because rupees and dollars cannot be added together.
function computeHoldingStats(closed) {
  const byMarket = new Map();
  for (const row of closed) {
    const shares = Number(row.shares), buy = Number(row.buy_price), sell = Number(row.sell_price);
    if (!(shares > 0 && buy > 0 && sell > 0)) continue;
    const entry = { symbol: row.symbol, pnl: (sell - buy) * shares, pct: (sell / buy - 1) * 100, closed_at: row.closed_at,
      days: Math.max(0, (Date.parse(row.closed_at) - Date.parse(`${row.bought_at}T00:00:00Z`)) / 86400000) };
    if (!byMarket.has(row.market)) byMarket.set(row.market, []);
    byMarket.get(row.market).push(entry);
  }
  const mean = list => list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0;
  return [...byMarket.entries()].filter(([id]) => MARKETS[id]).map(([id, trades]) => {
    const wins = trades.filter(trade => trade.pnl > 0), losses = trades.filter(trade => trade.pnl <= 0);
    const grossWin = wins.reduce((sum, trade) => sum + trade.pnl, 0), grossLoss = -losses.reduce((sum, trade) => sum + trade.pnl, 0);
    const best = trades.reduce((top, trade) => trade.pct > top.pct ? trade : top), worst = trades.reduce((low, trade) => trade.pct < low.pct ? trade : low);
    const months = new Map();
    for (const trade of trades) {
      const key = String(trade.closed_at).slice(0, 7);
      const month = months.get(key) || { month: key, pnl: 0, trades: 0, wins: 0 };
      month.pnl += trade.pnl; month.trades += 1; if (trade.pnl > 0) month.wins += 1;
      months.set(key, month);
    }
    return {
      market: id,
      currency_symbol: MARKETS[id].symbolPrefix,
      closed_trades: trades.length,
      wins: wins.length,
      losses: losses.length,
      win_rate: round(wins.length / trades.length * 100, 1),
      realized_pnl: round(trades.reduce((sum, trade) => sum + trade.pnl, 0), 2),
      avg_return_pct: round(mean(trades.map(trade => trade.pct)), 2),
      avg_win_pct: round(mean(wins.map(trade => trade.pct)), 2),
      avg_loss_pct: round(mean(losses.map(trade => trade.pct)), 2),
      profit_factor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : null,
      best: { symbol: best.symbol, pct: round(best.pct, 2), pnl: round(best.pnl, 2) },
      worst: { symbol: worst.symbol, pct: round(worst.pct, 2), pnl: round(worst.pnl, 2) },
      avg_hold_days: round(mean(trades.map(trade => trade.days)), 1),
      months: [...months.values()].sort((a, b) => b.month.localeCompare(a.month)).slice(0, 12).map(month => ({ ...month, pnl: round(month.pnl, 2) })),
    };
  });
}

// One read of everything worth seeing first: each market's trend and best ideas, and (when signed in) how the holdings stand and what changed.
// It reads the stored scans the same way the scanner does (a scan that is due is refreshed on the shared schedule, never by hand) and never marks alerts as seen.
async function buildBriefing(request, env, ctx) {
  await requireSubscription(request, env);
  const markets = [];
  for (const id of ["US", "IN", "FX"]) {
    const market = MARKETS[id];
    try {
      const scan = await autoScanResponse(env, market, ctx);
      if (scan.warming_up) { markets.push({ id, label: market.label, warming_up: true, top: [] }); continue; }
      const ranking = scan.ranking, trend = scan.market_trend;
      markets.push({
        id, label: market.label, generated_at: scan.generated_at,
        trend: trend ? { state: trend.state, headline: trend.headline, note: trend.note } : null,
        headline: ranking?.headline || null, ranking_source: ranking?.source || null, nothing_compelling: ranking?.nothing_compelling ?? null,
        top: (ranking?.items || []).slice(0, 3).map(item => ({
          rank: item.rank, symbol: item.symbol, tag: item.tag, direction: item.direction, score: item.score, confidence: item.confidence, reason: item.reason,
          entry: item.entry, stop: item.stop, target_1: item.target_1, currency_symbol: item.currency_symbol, price_decimals: item.price_decimals,
          earnings: item.filing?.earnings_in_days != null && item.filing.earnings_in_days >= 0 && item.filing.earnings_in_days <= 14
            ? { date: item.filing.earnings_estimate, in_days: item.filing.earnings_in_days, confirmed: item.filing.earnings_confirmed === true, timing: item.filing.earnings_timing || null } : null,
        })),
      });
    } catch { markets.push({ id, label: market.label, unavailable: true, top: [] }); }
  }
  let holdings = null;
  try {
    const data = await listHoldings(request, env);
    const counts = {};
    for (const item of data.open) counts[item.action] = (counts[item.action] || 0) + 1;
    holdings = {
      count: data.open.length, counts,
      totals: data.totals,
      attention: data.open.filter(item => ["EXIT", "TAKE_PROFIT", "WATCH"].includes(item.action)).slice(0, 5)
        .map(item => ({ symbol: item.symbol, market: item.market, action: item.action, action_label: item.action_label, headline: item.headline, pnl_pct: item.pnl_pct })),
      alerts: { unseen: data.alerts?.unseen || 0, items: (data.alerts?.items || []).slice(0, 4) },
    };
  } catch { /* not signed in, or no holdings service: the markets part still serves */ }
  return { as_of: new Date().toISOString(), markets, holdings,
    disclaimer: "Automated research from public price data, not personal financial advice. Nothing is ever sent to a broker." };
}

// Marks every alert as seen (the user opened the list). Only this user's rows.
async function markAlertsSeen(request, env) {
  const user = await holdingsUser(request, env);
  await readBody(request);
  await env.DB.prepare("UPDATE holding_alerts SET seen_at = ? WHERE user_id = ? AND seen_at IS NULL").bind(new Date().toISOString(), user.id).run();
  return { seen: true };
}

async function holdingStats(request, env) {
  const user = await holdingsUser(request, env);
  const closed = (await env.DB.prepare("SELECT * FROM holdings WHERE user_id = ? AND closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 500").bind(user.id).all()).results || [];
  const trades = (await env.DB.prepare("SELECT * FROM holding_trades WHERE user_id = ? ORDER BY at DESC, rowid DESC LIMIT 200").bind(user.id).all()).results || [];
  const latest = new Set();
  const seenChains = new Set();
  const activeCount = new Map();
  for (const trade of trades) {
    if (trade.voided_at) continue;
    const chain = trade.chain_id || trade.holding_id;
    activeCount.set(chain, (activeCount.get(chain) || 0) + 1);
    if (!seenChains.has(chain)) { seenChains.add(chain); latest.add(trade.id); }
  }
  // What an edit may change on the newest entry: the share count (not for a full sale) and the date (opening purchase only).
  const editable = trade => {
    const chain = trade.chain_id || trade.holding_id;
    if (trade.side === "BUY") return { shares: true, date: activeCount.get(chain) === 1 };
    return { shares: trade.holding_id !== chain, date: false };
  };
  return {
    updated_at: new Date().toISOString(),
    markets: computeHoldingStats(closed),
    history: trades.map(trade => ({
      id: trade.id, at: trade.at, symbol: trade.symbol, market: trade.market, side: trade.side, shares: trade.shares, price: trade.price,
      currency_symbol: MARKETS[trade.market]?.symbolPrefix || "$", price_decimals: MARKETS[trade.market]?.decimals(trade.price) ?? 2,
      realized_pnl: trade.realized_pnl == null ? null : round(trade.realized_pnl, 2),
      voided: Boolean(trade.voided_at),
      can_undo: latest.has(trade.id),
      edit: latest.has(trade.id) ? editable(trade) : null,
    })),
    disclaimer: "Your own record of trades you entered. Past results do not predict future ones, and this is not personal financial advice.",
  };
}

// Undo reverses the most recent entry of a position without deleting it: the entry stays in History marked as
// undone and no longer counts in Performance. Older entries must be undone newest-first so averages stay exact.
// The entry an undo or edit may touch: the newest active one for its position, so averages stay exact.
async function latestEntryContext(env, user, id) {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) throw Object.assign(new Error("Entry not found"), { status: 404 });
  const trade = await env.DB.prepare("SELECT * FROM holding_trades WHERE id = ? AND user_id = ?").bind(id, user.id).first();
  if (!trade || trade.voided_at) throw Object.assign(new Error("That entry was not found or is already undone"), { status: 404 });
  const chain = trade.chain_id || trade.holding_id;
  const active = ((await env.DB.prepare("SELECT * FROM holding_trades WHERE user_id = ? AND chain_id = ? ORDER BY at DESC, rowid DESC").bind(user.id, chain).all()).results || []).filter(entry => !entry.voided_at);
  if (!active.length || active[0].id !== trade.id) throw Object.assign(new Error("Only the most recent entry for this stock can be changed. Undo the newer one first."), { status: 400 });
  const holding = await env.DB.prepare("SELECT * FROM holdings WHERE id = ? AND user_id = ?").bind(trade.holding_id, user.id).first();
  if (!holding) throw Object.assign(new Error("Holding not found"), { status: 404 });
  return { trade, chain, active, holding };
}

async function undoEntry(request, env) {
  const user = await holdingsUser(request, env);
  const { trade, chain, active, holding } = await latestEntryContext(env, user, String((await readBody(request)).id || ""));
  const now = new Date().toISOString();
  const voidTrade = env.DB.prepare("UPDATE holding_trades SET voided_at = ? WHERE id = ? AND user_id = ?").bind(now, trade.id, user.id);
  const shares = Number(trade.shares), price = Number(trade.price);
  if (trade.side === "BUY") {
    if (active.length === 1) {
      // The opening purchase: the position never existed, so hide it (closed without a sale price).
      await env.DB.batch([env.DB.prepare("UPDATE holdings SET closed_at = ?, sell_price = NULL WHERE id = ? AND user_id = ?").bind(now, holding.id, user.id), voidTrade]);
    } else {
      const remaining = Number(holding.shares) - shares;
      if (holding.closed_at || remaining <= 1e-9) throw Object.assign(new Error("This entry cannot be undone"), { status: 400 });
      const average = (Number(holding.shares) * Number(holding.buy_price) - shares * price) / remaining;
      await env.DB.batch([env.DB.prepare("UPDATE holdings SET shares = ?, buy_price = ? WHERE id = ? AND user_id = ? AND closed_at IS NULL").bind(remaining, average, holding.id, user.id), voidTrade]);
    }
  } else if (trade.holding_id === chain) {
    if (!holding.closed_at || holding.sell_price == null) throw Object.assign(new Error("This entry cannot be undone"), { status: 400 });
    await env.DB.batch([env.DB.prepare("UPDATE holdings SET closed_at = NULL, sell_price = NULL WHERE id = ? AND user_id = ?").bind(holding.id, user.id), voidTrade]);
  } else {
    const parent = await env.DB.prepare("SELECT * FROM holdings WHERE id = ? AND user_id = ?").bind(chain, user.id).first();
    if (!parent || parent.closed_at) throw Object.assign(new Error("This sale cannot be undone because the position has changed"), { status: 400 });
    await env.DB.batch([
      env.DB.prepare("UPDATE holdings SET shares = shares + ? WHERE id = ? AND user_id = ? AND closed_at IS NULL").bind(shares, parent.id, user.id),
      env.DB.prepare("UPDATE holdings SET sell_price = NULL WHERE id = ? AND user_id = ?").bind(holding.id, user.id),
      voidTrade,
    ]);
  }
  return { undone: true };
}

// Editing corrects the newest entry of a position: the old version stays in History marked as undone and a
// corrected entry takes its place, so there is always a trail. Shares and price can change; the date only for
// an opening purchase. A full sale keeps its share count (undo it and sell again to change that).
async function editEntry(request, env) {
  const user = await holdingsUser(request, env);
  const body = await readBody(request);
  const { trade, chain, active, holding } = await latestEntryContext(env, user, String(body.id || ""));
  const price = toAmount(body.price);
  if (!Number.isFinite(price) || price < MIN_AMOUNT || price > 1e8) throw Object.assign(new Error("Enter a valid price"), { status: 400 });
  const oldShares = Number(trade.shares), oldPrice = Number(trade.price);
  const shares = body.shares === undefined || body.shares === null || body.shares === "" ? oldShares : toAmount(body.shares);
  if (!Number.isFinite(shares) || shares < MIN_AMOUNT || shares > 1e9) throw Object.assign(new Error("Enter a valid number of shares"), { status: 400 });
  const now = new Date().toISOString();
  const voidOld = env.DB.prepare("UPDATE holding_trades SET voided_at = ? WHERE id = ? AND user_id = ?").bind(now, trade.id, user.id);
  const record = (count, at, pnl = null) => tradeStatement(env, user.id, trade.holding_id, holding, trade.side, count, price, at, pnl, chain);
  if (trade.side === "BUY" && active.length === 1) {
    if (holding.closed_at) throw Object.assign(new Error("This entry cannot be edited"), { status: 400 });
    const today = new Date().toISOString().slice(0, 10);
    const boughtAt = body.bought_at ? body.bought_at : holding.bought_at;
    if (!validPastDay(boughtAt, today)) throw Object.assign(new Error("Enter a valid purchase date that is not in the future"), { status: 400 });
    await env.DB.batch([
      env.DB.prepare("UPDATE holdings SET bought_at = ?, shares = ?, buy_price = ? WHERE id = ? AND user_id = ? AND closed_at IS NULL").bind(boughtAt, shares, price, holding.id, user.id),
      voidOld, record(shares, `${boughtAt}T00:00:00.000Z`),
    ]);
  } else if (trade.side === "BUY") {
    const before = Number(holding.shares) - oldShares;
    if (holding.closed_at || before <= 1e-9) throw Object.assign(new Error("This entry cannot be edited"), { status: 400 });
    const beforeAverage = (Number(holding.shares) * Number(holding.buy_price) - oldShares * oldPrice) / before;
    const total = before + shares;
    await env.DB.batch([
      env.DB.prepare("UPDATE holdings SET shares = ?, buy_price = ? WHERE id = ? AND user_id = ? AND closed_at IS NULL").bind(total, (before * beforeAverage + shares * price) / total, holding.id, user.id),
      voidOld, record(shares, trade.at),
    ]);
  } else if (trade.holding_id === chain) {
    if (Math.abs(shares - oldShares) > 1e-9) throw Object.assign(new Error("To change how many shares you sold, undo this sale and record it again"), { status: 400 });
    if (!holding.closed_at || holding.sell_price == null) throw Object.assign(new Error("This entry cannot be edited"), { status: 400 });
    await env.DB.batch([
      env.DB.prepare("UPDATE holdings SET sell_price = ? WHERE id = ? AND user_id = ?").bind(price, holding.id, user.id),
      voidOld, record(oldShares, trade.at, (price - Number(holding.buy_price)) * oldShares),
    ]);
  } else {
    const parent = await env.DB.prepare("SELECT * FROM holdings WHERE id = ? AND user_id = ?").bind(chain, user.id).first();
    if (!parent || parent.closed_at) throw Object.assign(new Error("This sale cannot be edited because the position has changed"), { status: 400 });
    const available = Number(parent.shares) + oldShares;
    if (shares >= available - 1e-9) throw Object.assign(new Error("That would sell the whole remaining position. Undo this sale and use Sell all instead."), { status: 400 });
    await env.DB.batch([
      env.DB.prepare("UPDATE holdings SET shares = ? WHERE id = ? AND user_id = ? AND closed_at IS NULL").bind(available - shares, parent.id, user.id),
      env.DB.prepare("UPDATE holdings SET shares = ?, sell_price = ? WHERE id = ? AND user_id = ?").bind(shares, price, holding.id, user.id),
      voidOld, record(shares, trade.at, (price - Number(holding.buy_price)) * shares),
    ]);
  }
  return { edited: true };
}

async function removeHolding(request, env) {
  const user = await holdingsUser(request, env);
  const id = String((await readBody(request)).id || "");
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) throw Object.assign(new Error("Holding not found"), { status: 404 });
  await env.DB.batch([
    env.DB.prepare("DELETE FROM holdings WHERE id = ? AND user_id = ?").bind(id, user.id),
    env.DB.prepare("DELETE FROM holding_trades WHERE holding_id = ? AND user_id = ?").bind(id, user.id),
  ]);
  return { removed: true };
}

// Every market's index trends in one list (US, India, forex), read from the stored scans, so one swipe-through
// covers all markets whichever one is being viewed.
async function allMarketTrends(env, current, scan) {
  const trends = [];
  for (const id of ["US", "IN", "FX"]) {
    const list = id === current.id ? scan.market_trends : (await readStoredScan(env, MARKETS[id]))?.payload?.market_trends;
    if (Array.isArray(list)) trends.push(...list);
  }
  return trends;
}

async function handle(request, env, ctx) {
  if (request.method === "HEAD") {
    // Uptime monitors probe with HEAD: answer like GET and drop the body.
    const probe = await handle(new Request(request.url, { method: "GET", headers: request.headers }), env, ctx);
    return new Response(null, { status: probe.status, headers: probe.headers });
  }
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/") {
    return new Response(PAGE, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=60",
        "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://s3.tradingview.com; frame-src https://www.tradingview-widget.com https://s.tradingview.com; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        "referrer-policy": "strict-origin-when-cross-origin",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
      },
    });
  }
  if (request.method === "GET" && ["/privacy", "/terms", "/support"].includes(url.pathname)) return legalPage(env, url.pathname.slice(1));
  if (request.method === "GET" && url.pathname === "/auth/google/start") {
    try { return await startGoogleSignIn(request, env); } catch (error) { return json({ error: cleanError(error) }, Number(error?.status) || 502); }
  }
  if (request.method === "GET" && url.pathname === "/auth/google/callback") {
    try { return await finishGoogleSignIn(request, env); } catch { return redirect("/?signin=failed"); }
  }
  if (request.method === "GET" && url.pathname === "/auth/dev") return devSignIn(request, env);
  if (request.method === "GET" && url.pathname === "/api/track-record") {
    try { return json(await publicTrackRecord(env.DB), 200, { "cache-control": "public, max-age=300" }); }
    catch (error) { return json({ error: cleanError(error) }, 502); }
  }
  if (request.method === "GET" && url.pathname === "/health") return json({ status: "ok", read_only: true, order_submission_supported: false, data_source: "Robinhood" });
  if (request.method === "GET" && url.pathname === "/api/access") {
    try {
      const sessionId = url.searchParams.get("session_id");
      const { customer_id, ...access } = sessionId
        ? await subscriptionAccessFromCheckout(request, env, sessionId)
        : await subscriptionAccess(request, env);
      void customer_id;
      return json(access);
    } catch (error) { return json({ error: cleanError(error) }, Number(error?.status) || 502); }
  }
  if (request.method !== "POST") return json({ error: "Not found" }, 404);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin && parseCookies(request).has(SESSION_COOKIE)) return json({ error: "Cross-site requests are not allowed" }, 403);
  try {
    if (url.pathname === "/auth/logout") return await signOut(request, env);
    if (url.pathname === "/api/mobile/pair/start") {
      return json(await startMobilePairing(env, await readBody(request)));
    }
    if (url.pathname === "/api/mobile/pair/status") {
      return json(await mobilePairingStatus(env, await readBody(request)));
    }
    if (url.pathname === "/api/mobile/pair/approve") {
      return json(await approveMobilePairing(request, env, await readBody(request)));
    }
    if (url.pathname === "/api/holdings") return json(await listHoldings(request, env));
    if (url.pathname === "/api/holdings/undo") return json(await undoEntry(request, env));
    if (url.pathname === "/api/holdings/edit") return json(await editEntry(request, env));
    if (url.pathname === "/api/holdings/stats") return json(await holdingStats(request, env));
    if (url.pathname === "/api/holdings/alerts/seen") return json(await markAlertsSeen(request, env));
    if (url.pathname === "/api/holdings/add") return json(await addHolding(request, env));
    if (url.pathname === "/api/holdings/increase") return json(await increaseHolding(request, env));
    if (url.pathname === "/api/holdings/sell") return json(await sellHolding(request, env));
    if (url.pathname === "/api/holdings/close") return json(await closeHolding(request, env));
    if (url.pathname === "/api/holdings/remove") return json(await removeHolding(request, env));
    if (url.pathname === "/api/mobile/account/delete") {
      return json(await deleteMobileAccountData(request, env));
    }
    if (url.pathname === "/api/mobile/session/revoke") {
      return json(await revokeMobileSession(request, env));
    }
    if (url.pathname === "/api/billing/checkout") {
      const session = await createCheckout(request, env);
      return json({ url: session.url });
    }
    if (url.pathname === "/api/billing/portal") {
      const session = await createBillingPortal(request, env);
      return json({ url: session.url });
    }
    if (url.pathname === "/api/briefing") return json(await buildBriefing(request, env, ctx));
    if (url.pathname === "/api/discover") {
      await requireSubscription(request, env);
      const body = await readBody(request);
      const market = marketFrom(body);
      // Every market is served from the shared stored scan, so repeated requests never multiply upstream calls. There is no manual
      // refresh: a "refresh" flag sent by an older app or page is ignored.
      const scan = await autoScanResponse(env, market, ctx);
      return json({ ...scan, all_market_trends: await allMarketTrends(env, market, scan) });
    }
    if (url.pathname === "/api/memory") {
      await requireSubscription(request, env);
      await readBody(request);
      const user = await requestUser(request, env);
      if (!user) throw Object.assign(new Error("Sign in to use persistent recommendation memory"), { status: 401 });
      return json(await recommendationMemory(env.DB, user.id, env));
    }
    if (url.pathname === "/api/analyze") {
      await requireSubscription(request, env);
      const body = await readBody(request);
      const market = marketFrom(body);
      const symbol = String(body.symbol || "").trim().toUpperCase();
      if (!/^[A-Z0-9.\-^&]{1,15}$/.test(symbol)) throw new Error("Enter a valid ticker symbol");
      if (market.universe && !market.universe.some(entry => entry.symbol === symbol)) throw Object.assign(new Error(`Choose one of the ${market.name} symbols`), { status: 400 });
      const cacheName = market.id === "US" ? `analysis-${symbol}-v7-regime-filter` : `analysis-${market.id}-${symbol}-v8`;
      const cacheSeconds = market.id === "US" ? ANALYSIS_CACHE_SECONDS : EXTERNAL_ANALYSIS_CACHE_SECONDS;
      const flightKey = `${market.id}:${symbol}`;
      const payload = await fromCache(request, cacheName, cacheSeconds, async () => {
        if (!analysisInFlight.has(flightKey)) analysisInFlight.set(flightKey, analyze(symbol, market, env).finally(() => analysisInFlight.delete(flightKey)));
        return analysisInFlight.get(flightKey);
      }, ctx);
      const user = await requestUser(request, env);
      let memoryLogged = false;
      if (user && env.DB) {
        try { memoryLogged = await rememberRecommendation(env.DB, user.id, payload); }
        catch { memoryLogged = false; }
      }
      return json({ ...payload, memory_logged: memoryLogged, memory_horizon_trading_days: 10 });
    }
    if (url.pathname === "/api/grade") return json({ error: "Public grading is disabled; this deployment stores no visitor portfolio data." }, 405);
    return json({ error: "Not found" }, 404);
  } catch (error) {
    const message = cleanError(error);
    const status = Number(error?.status) || (/valid ticker|body is too large/i.test(message) ? 400 : 502);
    return json({ error: message }, status);
  }
}

export default {
  fetch: handle,
  // One market per cron trigger, so each job has its own outgoing-request budget.
  async scheduled(event, env, ctx) {
    const byCron = { "5 * * * *": "IN", "*/15 3-10 * * 1-5": "IN", "10 * * * *": "FX", "*/15 13-21 * * 1-5": "US" };
    const market = MARKETS[byCron[event.cron]];
    if (market) ctx.waitUntil((async () => {
      await refreshScanIfDue(env, market, ctx).catch(() => {});
      await refreshHoldingsIfDue(env, market).catch(() => {});
      await monitorHoldings(env, market).catch(() => {});
      // The hourly jobs rank their own market; the forex job also ranks the US scan, which has no hourly job of its own (it runs on weekdays only).
      for (const target of market.id === "FX" ? [MARKETS.FX, MARKETS.US] : market.id === "IN" ? [MARKETS.IN] : []) {
        await rankStoredScan(env, target).catch(error => console.error(`AI ranking job failed for ${target.id}: ${cleanError(error)}`));
      }
      // Once an hour, grade scanner picks that hit a level or whose window has closed.
      if (market.id === "US" && env.DB && new Date(event.scheduledTime).getUTCMinutes() < 5) {
        await settlePendingRecommendations(env.DB, SCANNER_USER_ID, env).catch(() => {});
      }
    })());
  },
};
