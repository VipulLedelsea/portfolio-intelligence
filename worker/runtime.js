const ROBINHOOD_HISTORICALS = "https://api.robinhood.com/quotes/historicals/";
const ROBINHOOD_QUOTES = "https://api.robinhood.com/quotes/";
const ROBINHOOD_FUNDAMENTALS = "https://api.robinhood.com/fundamentals/";
const SP500_SOURCE = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv";
const STRIPE_API = "https://api.stripe.com/v1";
const SUBSCRIPTION_PRICE_CENTS = 1499;
const SCAN_CACHE_SECONDS = 300;
const ANALYSIS_CACHE_SECONDS = 90;
const MAX_ENTRY_AGE_BARS = 1;
const MAX_ENTRY_EXTENSION_ATR = 0.5;
const MAX_ADVERSE_EXTENSION_ATR = 0.75;
const MOBILE_PAIRING_MINUTES = 10;
const MOBILE_SESSION_DAYS = 90;
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

function authenticatedUser(request) {
  const id = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  return id && email ? { id, email } : null;
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
  const browserUser = authenticatedUser(request);
  if (browserUser) return { ...browserUser, auth_type: "chatgpt" };
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
  const customer = await findStripeCustomer(env, user.id);
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
  const user = authenticatedUser(request);
  if (!user) throw Object.assign(new Error("Sign in with ChatGPT to verify checkout"), { status: 401 });
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
    auth_type: "chatgpt",
  };
  accessCache.set(`${user.id}:chatgpt`, { value, expiresAt: Date.now() + 2 * 60 * 1000 });
  return value;
}

async function requireSubscription(request, env) {
  const access = await subscriptionAccess(request, env);
  if (!access.paywall_enabled || access.subscribed) return access;
  const message = access.signed_in ? "An active IntelligentPortfolio subscription is required" : "Sign in with ChatGPT to continue";
  throw Object.assign(new Error(message), { status: 402 });
}

async function createCheckout(request, env) {
  if (env.PAYWALL_ENABLED !== "true") throw new Error("The subscription paywall is not enabled yet");
  const user = authenticatedUser(request);
  if (!user) throw Object.assign(new Error("Sign in with ChatGPT before subscribing"), { status: 401 });
  const current = await subscriptionAccess(request, env, { force: true });
  if (current.subscribed) throw new Error("This account already has an active subscription");
  const customer = await findStripeCustomer(env, user.id) || await createStripeCustomer(env, user);
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

async function startMobilePairing(env, body) {
  if (!env.DB) throw new Error("Mobile pairing is not configured yet");
  const code = randomPairingCode();
  const pairingSecret = randomBase64Url();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MOBILE_PAIRING_MINUTES * 60 * 1000);
  await env.DB.prepare("DELETE FROM mobile_pairings WHERE expires_at <= ?").bind(now.toISOString()).run();
  await env.DB.prepare(`INSERT INTO mobile_pairings
    (code_hash, secret_hash, device_name, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)`).bind(
    await sha256(code), await sha256(pairingSecret), cleanDeviceName(body.device_name), now.toISOString(), expiresAt.toISOString(),
  ).run();
  return { code, pairing_secret: pairingSecret, expires_at: expiresAt.toISOString(), poll_after_seconds: 2 };
}

async function approveMobilePairing(request, env, body) {
  const user = authenticatedUser(request);
  if (!user) throw Object.assign(new Error("Sign in with ChatGPT to pair an iPhone"), { status: 401 });
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

function normalizeBars(item, timeframe) {
  const now = Date.now();
  const nowParts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(now)).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
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
      return barDate < currentMarketDate || (barDate === currentMarketDate && marketMinutes >= 16 * 60);
    }
    if (timeframe !== "hour") return true;
    const begins = Date.parse(bar.date);
    return !Number.isFinite(begins) || begins <= now - 60 * 60 * 1000;
  });
}

function calculateSupertrend(rows, period = 10, multiplier = 3, timeframe = "1h") {
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
  const intervalMinutes = timeframe === "1d" ? 1440 : 60;
  const signalConfirmedAt = Number.isFinite(signalStartedAt) ? new Date(signalStartedAt + intervalMinutes * 60 * 1000).toISOString() : signalBar.date;
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

function snapshotFromPayload(symbol, dailyItem, signalItem, quote) {
  const daily = normalizeBars(dailyItem, "day");
  const signal = normalizeBars(signalItem, "hour");
  if (daily.length < 35) throw new Error(`Insufficient daily history for ${symbol}`);
  if (signal.length < 22) throw new Error(`Insufficient confirmed one-hour history for ${symbol}`);
  const closes = daily.map(row => row.close);
  const highs = daily.map(row => row.high);
  const lows = daily.map(row => row.low);
  const volumes = daily.map(row => row.volume);
  const supertrend = calculateSupertrend(signal);
  const dailySupertrend = calculateSupertrend(daily, 10, 3, "1d");
  const dailyAdx = calculateAdx(daily, 14);
  const price = numeric(quote?.last_trade_price) || closes.at(-1);
  const logReturns = closes.slice(1).map((close, index) => Math.log(close / closes[index])).filter(Number.isFinite);
  const trueRanges = highs.map((high, index) => index === 0 ? high - lows[index] : Math.max(high - lows[index], Math.abs(high - closes[index - 1]), Math.abs(lows[index] - closes[index - 1])));
  const signalRanges = signal.map((row, index) => index === 0 ? row.high - row.low : Math.max(row.high - row.low, Math.abs(row.high - signal[index - 1].close), Math.abs(row.low - signal[index - 1].close)));
  const atr14 = mean(trueRanges.slice(-14)) || price * 0.03;
  const signalAtr14 = mean(signalRanges.slice(-14)) || atr14;
  const recentVolume = mean(volumes.slice(-5));
  const baseVolume = mean(volumes.slice(-25, -5)) || recentVolume || 1;
  return {
    symbol,
    currency: "USD",
    exchange: "US Market",
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
    signal_atr_14: round(signalAtr14, 4),
    signal_atr_14_pct: round(signalAtr14 / price * 100, 3),
    volume_ratio_5d_to_20d: round(recentVolume / baseVolume, 3),
    market_time: quote?.venue_last_trade_time || signal.at(-1)?.date || daily.at(-1)?.date,
    fetched_at: new Date().toISOString(),
    data_source: "Robinhood",
    data_source_detail: "Robinhood confirmed daily trend with regular-hours one-hour entry candles; only completed bars are used",
    supertrend,
    daily_supertrend: dailySupertrend,
    daily_adx: dailyAdx,
    data_complete: true,
    history: signal.slice(-120),
  };
}

async function fetchBatch(symbols) {
  const encoded = encodeURIComponent(symbols.join(",")).replaceAll("%2C", ",");
  const [dailyPayload, signalPayload, quotePayload] = await Promise.all([
    fetchJson(`${ROBINHOOD_HISTORICALS}?symbols=${encoded}&bounds=regular&interval=day&span=6month`),
    fetchJson(`${ROBINHOOD_HISTORICALS}?symbols=${encoded}&bounds=regular&interval=hour&span=month`),
    fetchJson(`${ROBINHOOD_QUOTES}?symbols=${encoded}`),
  ]);
  const daily = new Map((dailyPayload.results || []).filter(Boolean).map(item => [String(item.symbol || "").toUpperCase(), item]));
  const signal = new Map((signalPayload.results || []).filter(Boolean).map(item => [String(item.symbol || "").toUpperCase(), item]));
  const quotes = new Map((quotePayload.results || []).filter(Boolean).map(item => [String(item.symbol || "").toUpperCase(), item]));
  const snapshots = new Map(), errors = [];
  for (const symbol of symbols) {
    try {
      if (!daily.has(symbol) || !signal.has(symbol)) throw new Error("Robinhood returned no history");
      snapshots.set(symbol, snapshotFromPayload(symbol, daily.get(symbol), signal.get(symbol), quotes.get(symbol)));
    } catch (error) { errors.push({ symbol, error: cleanError(error) }); }
  }
  return { snapshots, errors };
}

async function fetchSnapshots(symbols) {
  const batches = [];
  for (let index = 0; index < symbols.length; index += 20) batches.push(symbols.slice(index, index + 20));
  const snapshots = new Map(), errors = [];
  for (let index = 0; index < batches.length; index += 5) {
    const results = await Promise.allSettled(batches.slice(index, index + 5).map(fetchBatch));
    results.forEach((result, resultIndex) => {
      if (result.status === "fulfilled") {
        result.value.snapshots.forEach((value, key) => snapshots.set(key, value));
        errors.push(...result.value.errors);
      } else {
        const reason = cleanError(result.reason);
        errors.push(...batches[index + resultIndex].map(symbol => ({ symbol, error: reason })));
      }
    });
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
  const riskDistance = Math.max(2 * signalAtr, entryReference * 0.0125);
  const target1 = direction === "SHORT" ? Math.max(0.01, entryReference - 2 * riskDistance) : entryReference + 2 * riskDistance;
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
    ? `Confirmed daily Supertrend agrees: ${dailyDirection} at $${numeric(dailySupertrend.value).toFixed(2)}`
    : `Daily Supertrend is ${dailyDirection} while the 1H trigger is ${direction} — countertrend entry rejected`);
  (regimeEligible ? reasons : cautions).push(regimeEligible
    ? `Daily ADX (14) is ${dailyAdx.toFixed(1)} and rising from ${dailyAdxPrior.toFixed(1)} five sessions ago`
    : `Trend-strength veto: daily ADX (14) is ${dailyAdx.toFixed(1)} and must be at least 20 and rising versus five sessions ago`);
  reasons.push(`Confirmed 1H Supertrend (10, 3) is ${direction} at $${numeric(supertrend.value).toFixed(2)}`);
  if (entryEligible) reasons.push(`Entry window is open: signal is ${age + 1} completed hourly bar${age ? "s" : ""} old and price is ${Math.abs(extensionAtr).toFixed(2)} ATR from the signal entry`);
  else if (!isFresh) cautions.push(`Late trend: the signal is ${age + 1} completed hourly bars old`);
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
    extension_atr: round(extensionAtr, 3),
    extension_pct: round(extensionPct, 3),
    entry_status: entryStatus,
    entry_eligible: entryEligible,
    target_1_reached: target1Reached,
    reasons: reasons.slice(0, 4),
    cautions: cautions.slice(0, 3),
    market_time: snapshot.market_time,
  };
}

async function discover() {
  const records = await loadUniverse();
  const metadata = new Map(records.map(record => [record.symbol, record]));
  const symbols = [...metadata.keys()];
  const { snapshots, errors } = await fetchSnapshots(symbols);
  const allCandidates = [...snapshots.entries()].map(([symbol, snapshot]) => scoreCandidate(snapshot, metadata.get(symbol))).sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  const candidates = allCandidates.filter(candidate => candidate.entry_eligible);
  const lateCandidates = allCandidates.filter(candidate => !candidate.entry_eligible);
  const longCandidates = candidates.filter(candidate => candidate.direction === "LONG").sort((a, b) => b.long_score - a.long_score || a.symbol.localeCompare(b.symbol));
  const shortCandidates = candidates.filter(candidate => candidate.direction === "SHORT").sort((a, b) => b.short_score - a.short_score || a.symbol.localeCompare(b.symbol));
  return {
    generated_at: new Date().toISOString(),
    universe_name: "S&P 500",
    universe_source: SP500_SOURCE,
    market_data_source: "Robinhood",
    universe_size: symbols.length,
    successful: allCandidates.length,
    candidates: candidates.slice(0, 20),
    long_candidates: longCandidates.slice(0, 20),
    short_candidates: shortCandidates.slice(0, 20),
    late_candidates: lateCandidates.slice(0, 20),
    direction_counts: { LONG: longCandidates.length, SHORT: shortCandidates.length },
    fresh_entry_count: candidates.length,
    late_or_extended_count: lateCandidates.length,
    daily_conflict_count: lateCandidates.filter(candidate => candidate.entry_status === "DAILY_CONFLICT").length,
    regime_filtered_count: lateCandidates.filter(candidate => candidate.entry_status === "WEAK_TREND_REGIME").length,
    errors,
    method: "Regime-aware hybrid screen: confirmed daily Supertrend (10, 3) sets direction, daily ADX (14) must be at least 20 and rising versus five sessions ago, then confirmed one-hour Supertrend finds the entry.",
    next_step: "Countertrend, weak-regime, late, extended, and weakening setups cannot rank as new entries. In TradingView, confirm the daily direction and trend strength first, then use the 1H chart with ATR length 10 and factor 3 for timing.",
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

async function analyze(symbol) {
  const [{ snapshots }, fundamentals] = await Promise.all([fetchSnapshots([symbol]), fetchFundamentals(symbol)]);
  const snapshot = snapshots.get(symbol);
  if (!snapshot) throw new Error(`Could not fetch Robinhood market data for ${symbol}${symbol === "APPL" ? ". Did you mean AAPL?" : ""}`);
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
    makeReport("price_action", symbol, technicalScore, 0.78, `${direction} on confirmed one-hour Supertrend, with a ${candidate.label.toLowerCase()}.`, candidate.reasons, candidate.cautions, true),
  ];
  const averageScore = mean(reports.map(report => report.score));
  const coreComplete = reports.filter(report => report.role === "price_action").every(report => report.data_complete);
  const contextWarnings = reports.filter(report => !report.data_complete).map(report => report.role === "news"
    ? "No live news feed is connected; check earnings, filings, and breaking headlines before acting."
    : `${report.role.replaceAll("_", " ")} context is incomplete and should be verified independently.`);
  const synthesis = makeReport("synthesis", symbol, averageScore, coreComplete ? 0.68 : 0.48, `${direction} technical setup on completed one-hour candles. Core price data is complete; unavailable news or fundamental context is a caution, not an automatic veto.`, candidate.reasons, [...reports.flatMap(report => report.risks).slice(0, 4), ...contextWarnings].slice(0, 6), coreComplete);
  const bull = makeReport("bull", symbol, direction === "LONG" ? technicalScore : 100 - technicalScore, 0.62, direction === "LONG" ? "Trend, momentum, and Supertrend are aligned for the bullish case." : "A reversal back above the Supertrend line is the main bullish counter-case.", candidate.reasons, candidate.cautions, true);
  const bear = makeReport("bear", symbol, direction === "SHORT" ? technicalScore : 100 - technicalScore, 0.7, direction === "SHORT" ? "Trend, momentum, and Supertrend are aligned for the bearish case." : "Headline risk, volatility, and a close below Supertrend are the main reasons the long setup could fail.", candidate.cautions.length ? candidate.cautions : ["No setup is certain."], ["Risk is defined by the invalidation level."], true);
  const price = snapshot.price;
  const entryReference = candidate.signal_entry_price || price;
  const riskDistance = Math.max(2 * candidate.signal_atr, entryReference * 0.0125);
  const stop = direction === "SHORT" ? entryReference + riskDistance : Math.max(0.01, entryReference - riskDistance);
  const target1 = direction === "SHORT" ? Math.max(0.01, entryReference - 2 * riskDistance) : entryReference + 2 * riskDistance;
  const target2 = direction === "SHORT" ? Math.max(0.01, entryReference - 3 * riskDistance) : entryReference + 3 * riskDistance;
  const signalStartedAt = Date.parse(snapshot.supertrend.signal_bar_started_at);
  const postSignalBars = snapshot.history.filter(row => !Number.isFinite(signalStartedAt) || Date.parse(row.date) > signalStartedAt);
  const target1Reached = direction === "SHORT"
    ? [price, ...postSignalBars.map(row => row.low)].some(value => numeric(value) <= target1)
    : [price, ...postSignalBars.map(row => row.high)].some(value => numeric(value) >= target1);
  const vetoReasons = [];
  if (snapshot.annualized_volatility_pct > 85) vetoReasons.push(`Annualized volatility ${snapshot.annualized_volatility_pct.toFixed(1)}% exceeds the 85% review limit`);
  if (!candidate.entry_eligible) vetoReasons.push(candidate.entry_status === "DAILY_CONFLICT" ? `Daily Supertrend is ${candidate.daily_supertrend_direction}; it does not confirm the ${direction} one-hour trigger` : candidate.entry_status === "WEAK_TREND_REGIME" ? `Daily ADX is ${candidate.daily_adx.toFixed(1)}; qualifying setups require ADX of at least 20 and rising versus five sessions ago` : candidate.entry_status === "TARGET_REACHED" ? "Scenario target 1 was already reached; the original entry window is closed" : candidate.entry_status === "EXTENDED_DO_NOT_CHASE" ? `Entry is extended ${candidate.extension_atr.toFixed(2)} ATR beyond the original signal price` : candidate.entry_status === "LATE_TREND" ? `Entry window passed ${candidate.signal_age_bars + 1} completed hourly bars ago` : `Signal weakened ${Math.abs(candidate.extension_atr).toFixed(2)} ATR against the intended direction`);
  if (target1Reached) vetoReasons.push("Scenario target 1 was already reached after the signal; this entry is no longer actionable");
  const approved = vetoReasons.length === 0 && technicalScore >= 65 && candidate.entry_eligible && !target1Reached;
  const action = approved ? "IDEA" : candidate.entry_eligible && !target1Reached && technicalScore >= 55 ? "WATCH" : "PASS";
  const levels = { reference: round(entryReference, 4), current: round(price, 4), risk: round(stop, 4), target_1: round(target1, 4), target_2: round(target2, 4) };
  const chartExplanation = [
    `Confirmed daily Supertrend is ${candidate.daily_supertrend_direction}; ${candidate.daily_aligned ? "it agrees with" : "it conflicts with"} the ${direction} one-hour trigger.`,
    `Daily ADX (14) is ${candidate.daily_adx.toFixed(1)} versus ${candidate.daily_adx_prior.toFixed(1)} five sessions ago; regime gate: ${candidate.regime_eligible ? "PASS" : "VETO"}.`,
    `1H Supertrend (10, 3) flipped ${direction} at ${snapshot.supertrend.signal_confirmed_at}; the anchored signal entry is $${entryReference.toFixed(2)}.`,
    `Current price is ${candidate.extension_atr >= 0 ? "+" : ""}${candidate.extension_atr.toFixed(2)} ATR from that entry; status: ${candidate.entry_status.replaceAll("_", " ")}.`,
    ...candidate.reasons.slice(1, 3),
    ...vetoReasons,
    ...contextWarnings,
  ];
  return {
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
      source: "Robinhood",
      source_detail: snapshot.data_source_detail,
      supertrend: snapshot.supertrend,
      daily_supertrend: snapshot.daily_supertrend,
      daily_adx: snapshot.daily_adx,
      levels,
      target_return_pct: { target_1: round((target1 / entryReference - 1) * 100, 2), target_2: round((target2 / entryReference - 1) * 100, 2) },
      direction,
      stance: action,
      explanation: chartExplanation,
      method: `${direction} scenario: confirmed daily Supertrend must agree and daily ADX (14) must be at least 20 and rising before the 1H trigger can qualify. Entry, risk, and 2R/3R targets stay anchored to the original hourly signal price. Late, extended, or already-targeted signals are rejected. Levels are research scenarios, not orders.`,
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

async function rememberRecommendation(db, userId, report) {
  if (!db || !userId || !report?.symbol) return false;
  const generatedAt = report.market_snapshot?.fetched_at || new Date().toISOString();
  const plan = report.trade_plan || {};
  const result = await db.prepare(`INSERT OR IGNORE INTO recommendations (
    id, user_id, symbol, action, direction, generated_at, signal_confirmed_at,
    entry_price, current_price, stop_price, target_1, target_2, confidence,
    entry_status, daily_adx, horizon_trading_days, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 5, 'PENDING')`).bind(
    crypto.randomUUID(), userId, report.symbol, report.action, report.direction, generatedAt,
    report.signal_confirmed_at, numeric(report.entry_price), numeric(report.current_price),
    numeric(report.stop_price), numeric(plan.target_1), numeric(plan.target_2),
    numeric(report.confidence), report.entry_status, numeric(report.daily_adx),
  ).run();
  return Boolean(result?.success);
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

function gradeRecommendation(recommendation, path) {
  const entry = numeric(recommendation.current_price);
  const direction = recommendation.direction;
  const exitBar = path.at(-1);
  const exit = numeric(exitBar.close);
  const rawReturnPct = entry ? (exit / entry - 1) * 100 : 0;
  const strategyReturnPct = direction === "SHORT" ? -rawReturnPct : rawReturnPct;
  const maximumHigh = Math.max(...path.map(bar => numeric(bar.high)));
  const minimumLow = Math.min(...path.map(bar => numeric(bar.low)));
  const maxFavorablePct = entry ? (direction === "SHORT" ? (entry - minimumLow) / entry : (maximumHigh - entry) / entry) * 100 : 0;
  const maxAdversePct = entry ? (direction === "SHORT" ? (maximumHigh - entry) / entry : (entry - minimumLow) / entry) * 100 : 0;
  let firstEvent = null;
  let targetHit = false;
  let stopHit = false;
  for (const bar of path) {
    const hitTarget = direction === "SHORT" ? numeric(bar.low) <= numeric(recommendation.target_1) : numeric(bar.high) >= numeric(recommendation.target_1);
    const hitStop = direction === "SHORT" ? numeric(bar.high) >= numeric(recommendation.stop_price) : numeric(bar.low) <= numeric(recommendation.stop_price);
    targetHit ||= hitTarget;
    stopHit ||= hitStop;
    if (!firstEvent && hitTarget && hitStop) firstEvent = "AMBIGUOUS";
    else if (!firstEvent && hitTarget) firstEvent = "TARGET";
    else if (!firstEvent && hitStop) firstEvent = "STOP";
  }
  let grade;
  if (recommendation.action === "PASS") grade = strategyReturnPct > 0.5 ? "MISSED_MOVE" : strategyReturnPct < -0.5 ? "CORRECT_PASS" : "FLAT_PASS";
  else grade = firstEvent || (strategyReturnPct > 0.1 ? "WIN" : strategyReturnPct < -0.1 ? "LOSS" : "FLAT");
  return {
    settledAt: exitBar.date,
    exitPrice: round(exit, 4),
    rawReturnPct: round(rawReturnPct, 3),
    strategyReturnPct: round(strategyReturnPct, 3),
    maxFavorablePct: round(maxFavorablePct, 3),
    maxAdversePct: round(maxAdversePct, 3),
    grade,
    targetHit,
    stopHit,
  };
}

async function settlePendingRecommendations(db, userId) {
  const pendingResult = await db.prepare(`SELECT id, symbol, action, direction, generated_at, current_price, stop_price, target_1, horizon_trading_days
    FROM recommendations WHERE user_id = ? AND status = 'PENDING' ORDER BY generated_at ASC LIMIT 60`).bind(userId).all();
  const pending = pendingResult?.results || [];
  if (!pending.length) return 0;
  const histories = await fetchDailySettlementBars([...new Set(pending.map(row => row.symbol))]);
  const updates = [];
  for (const recommendation of pending) {
    const generatedDate = String(recommendation.generated_at).slice(0, 10);
    const horizon = Math.max(1, Number(recommendation.horizon_trading_days) || 5);
    const path = (histories.get(recommendation.symbol) || []).filter(bar => bar.date.slice(0, 10) > generatedDate).slice(0, horizon);
    if (path.length < horizon) continue;
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

async function recommendationMemory(db, userId) {
  if (!db) return { available: false, reason: "Persistent memory is not configured." };
  let newlySettled = 0;
  let settlementWarning = null;
  try { newlySettled = await settlePendingRecommendations(db, userId); }
  catch (error) { settlementWarning = `Existing grades are available, but new settlement was delayed: ${cleanError(error)}`; }
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
    horizon_trading_days: 5,
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
    methodology: "Each call is stored once per user, ticker, signal close, and action. IDEA and WATCH results are graded from the actual price available when the report was generated to the fifth subsequent completed daily close. PASS calls are retained to measure missed moves. No orders or portfolio holdings are stored.",
  };
}

async function handle(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/") {
    return new Response(PAGE, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=60",
        "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        "referrer-policy": "strict-origin-when-cross-origin",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
      },
    });
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
    } catch (error) { return json({ error: cleanError(error) }, 502); }
  }
  if (request.method !== "POST") return json({ error: "Not found" }, 404);
  try {
    if (url.pathname === "/api/mobile/pair/start") {
      return json(await startMobilePairing(env, await readBody(request)));
    }
    if (url.pathname === "/api/mobile/pair/status") {
      return json(await mobilePairingStatus(env, await readBody(request)));
    }
    if (url.pathname === "/api/mobile/pair/approve") {
      return json(await approveMobilePairing(request, env, await readBody(request)));
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
    if (url.pathname === "/api/discover") {
      await requireSubscription(request, env);
      await readBody(request);
      const payload = await fromCache(request, "sp500-discovery-v7-regime-filter", SCAN_CACHE_SECONDS, async () => {
        if (!discoveryInFlight) discoveryInFlight = discover().finally(() => { discoveryInFlight = null; });
        return discoveryInFlight;
      }, ctx);
      return json(payload);
    }
    if (url.pathname === "/api/memory") {
      await requireSubscription(request, env);
      await readBody(request);
      const user = await requestUser(request, env);
      if (!user) throw Object.assign(new Error("Sign in with ChatGPT to use persistent recommendation memory"), { status: 401 });
      return json(await recommendationMemory(env.DB, user.id));
    }
    if (url.pathname === "/api/analyze") {
      await requireSubscription(request, env);
      const body = await readBody(request);
      const symbol = String(body.symbol || "").trim().toUpperCase();
      if (!/^[A-Z0-9.\-^]{1,12}$/.test(symbol)) throw new Error("Enter a valid ticker symbol");
      const payload = await fromCache(request, `analysis-${symbol}-v7-regime-filter`, ANALYSIS_CACHE_SECONDS, async () => {
        if (!analysisInFlight.has(symbol)) analysisInFlight.set(symbol, analyze(symbol).finally(() => analysisInFlight.delete(symbol)));
        return analysisInFlight.get(symbol);
      }, ctx);
      const user = await requestUser(request, env);
      let memoryLogged = false;
      if (user && env.DB) {
        try { memoryLogged = await rememberRecommendation(env.DB, user.id, payload); }
        catch { memoryLogged = false; }
      }
      return json({ ...payload, memory_logged: memoryLogged, memory_horizon_trading_days: 5 });
    }
    if (url.pathname === "/api/grade") return json({ error: "Public grading is disabled; this deployment stores no visitor portfolio data." }, 405);
    return json({ error: "Not found" }, 404);
  } catch (error) {
    const message = cleanError(error);
    const status = Number(error?.status) || (/valid ticker|body is too large/i.test(message) ? 400 : 502);
    return json({ error: message }, status);
  }
}

export default { fetch: handle };
