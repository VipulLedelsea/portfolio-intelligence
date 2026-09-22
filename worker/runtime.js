const ROBINHOOD_HISTORICALS = "https://api.robinhood.com/quotes/historicals/";
const ROBINHOOD_QUOTES = "https://api.robinhood.com/quotes/";
const ROBINHOOD_FUNDAMENTALS = "https://api.robinhood.com/fundamentals/";
const SP500_SOURCE = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv";
const SCAN_CACHE_SECONDS = 300;
const ANALYSIS_CACHE_SECONDS = 90;
let discoveryInFlight = null;
const analysisInFlight = new Map();
const memoryCache = new Map();

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
    if (timeframe !== "hour") return true;
    const begins = Date.parse(bar.date);
    return !Number.isFinite(begins) || begins <= now - 60 * 60 * 1000;
  });
}

function calculateSupertrend(rows, period = 10, multiplier = 3) {
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
  if (lastIndex < 0) throw new Error("Insufficient one-hour history to calculate Supertrend");
  const direction = directions[lastIndex];
  let priorDirection = direction;
  for (let index = lastIndex - 1; index >= 0; index -= 1) if (directions[index]) { priorDirection = directions[index]; break; }
  let barsSinceFlip = 0;
  for (let index = lastIndex - 1; index >= 0; index -= 1) {
    if (directions[index] && directions[index] !== direction) break;
    if (directions[index]) barsSinceFlip += 1;
  }
  return {
    period,
    multiplier,
    direction,
    value: round(values[lastIndex], 4),
    distance_pct: round((rows[lastIndex].close / values[lastIndex] - 1) * 100, 3),
    flipped_today: priorDirection !== direction,
    bars_since_flip: barsSinceFlip,
    is_confirmed: true,
    bar_status: "confirmed_close",
    as_of: rows[lastIndex].date,
    confirmed_direction: direction,
    confirmed_value: round(values[lastIndex], 4),
    confirmed_as_of: rows[lastIndex].date,
    timeframe: "1h",
    interval_minutes: 60,
  };
}

function periodReturn(closes, periods) {
  return closes.length > periods ? (closes.at(-1) / closes.at(-periods - 1) - 1) * 100 : 0;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map(value => (value - average) ** 2)));
}

function snapshotFromPayload(symbol, dailyItem, hourlyItem, quote) {
  const daily = normalizeBars(dailyItem, "day");
  const hourly = normalizeBars(hourlyItem, "hour");
  if (daily.length < 22) throw new Error(`Insufficient daily history for ${symbol}`);
  if (hourly.length < 22) throw new Error(`Insufficient confirmed one-hour history for ${symbol}`);
  const closes = daily.map(row => row.close);
  const highs = daily.map(row => row.high);
  const lows = daily.map(row => row.low);
  const volumes = daily.map(row => row.volume);
  const supertrend = calculateSupertrend(hourly);
  const price = numeric(quote?.last_trade_price) || closes.at(-1);
  const logReturns = closes.slice(1).map((close, index) => Math.log(close / closes[index])).filter(Number.isFinite);
  const trueRanges = highs.map((high, index) => index === 0 ? high - lows[index] : Math.max(high - lows[index], Math.abs(high - closes[index - 1]), Math.abs(lows[index] - closes[index - 1])));
  const hourlyRanges = hourly.map((row, index) => index === 0 ? row.high - row.low : Math.max(row.high - row.low, Math.abs(row.high - hourly[index - 1].close), Math.abs(row.low - hourly[index - 1].close)));
  const atr14 = mean(trueRanges.slice(-14)) || price * 0.03;
  const signalAtr14 = mean(hourlyRanges.slice(-14)) || atr14;
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
    market_time: quote?.venue_last_trade_time || hourly.at(-1)?.date || daily.at(-1)?.date,
    fetched_at: new Date().toISOString(),
    data_source: "Robinhood",
    data_source_detail: "Robinhood regular-hours one-hour candles; only completed hourly bars are used for signals",
    supertrend,
    data_complete: true,
    history: hourly.slice(-120),
  };
}

async function fetchBatch(symbols) {
  const encoded = encodeURIComponent(symbols.join(",")).replaceAll("%2C", ",");
  const [dailyPayload, hourlyPayload, quotePayload] = await Promise.all([
    fetchJson(`${ROBINHOOD_HISTORICALS}?symbols=${encoded}&bounds=regular&interval=day&span=6month`),
    fetchJson(`${ROBINHOOD_HISTORICALS}?symbols=${encoded}&bounds=regular&interval=hour&span=month`),
    fetchJson(`${ROBINHOOD_QUOTES}?symbols=${encoded}`),
  ]);
  const daily = new Map((dailyPayload.results || []).filter(Boolean).map(item => [String(item.symbol || "").toUpperCase(), item]));
  const hourly = new Map((hourlyPayload.results || []).filter(Boolean).map(item => [String(item.symbol || "").toUpperCase(), item]));
  const quotes = new Map((quotePayload.results || []).filter(Boolean).map(item => [String(item.symbol || "").toUpperCase(), item]));
  const snapshots = new Map(), errors = [];
  for (const symbol of symbols) {
    try {
      if (!daily.has(symbol) || !hourly.has(symbol)) throw new Error("Robinhood returned no history");
      snapshots.set(symbol, snapshotFromPayload(symbol, daily.get(symbol), hourly.get(symbol), quotes.get(symbol)));
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
  const direction = supertrend.direction || (price >= sma20 ? "LONG" : "SHORT");
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
  const freshness = age <= 6 ? 8 : age <= 18 ? 5 : age <= 36 ? 2 : age <= 60 ? -4 : -8;
  if (direction === "LONG") longScore += freshness; else shortScore += freshness;
  longScore = round(clamp(longScore, 0, 100), 1); shortScore = round(clamp(shortScore, 0, 100), 1);
  const score = direction === "LONG" ? longScore : shortScore;
  reasons.push(`Confirmed 1H Supertrend (10, 3) is ${direction} at $${numeric(supertrend.value).toFixed(2)}`);
  if (supertrend.flipped_today) reasons.push(`Fresh ${direction.toLowerCase()} signal on the latest completed one-hour bar`);
  else if (age <= 36) reasons.push(`Signal has held for ${age + 1} completed hourly bars`);
  else cautions.push(`Signal is ${age + 1} hourly bars old; a new entry may be late`);
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
  return {
    symbol: snapshot.symbol,
    company: metadata.company || snapshot.symbol,
    sector: metadata.sector || "Unknown",
    score,
    long_score: longScore,
    short_score: shortScore,
    direction,
    label: `${strength} ${direction.toLowerCase()} setup`,
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
    signal_age_bars: age,
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
  const candidates = [...snapshots.entries()].map(([symbol, snapshot]) => scoreCandidate(snapshot, metadata.get(symbol))).sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  const longCandidates = candidates.filter(candidate => candidate.direction === "LONG").sort((a, b) => b.long_score - a.long_score || a.symbol.localeCompare(b.symbol));
  const shortCandidates = candidates.filter(candidate => candidate.direction === "SHORT").sort((a, b) => b.short_score - a.short_score || a.symbol.localeCompare(b.symbol));
  return {
    generated_at: new Date().toISOString(),
    universe_name: "S&P 500",
    universe_source: SP500_SOURCE,
    market_data_source: "Robinhood",
    universe_size: symbols.length,
    successful: candidates.length,
    candidates: candidates.slice(0, 20),
    long_candidates: longCandidates.slice(0, 20),
    short_candidates: shortCandidates.slice(0, 20),
    direction_counts: { LONG: longCandidates.length, SHORT: shortCandidates.length },
    errors,
    method: "Short-hold pre-screen: confirmed one-hour Supertrend (10, 3) drives direction; daily trend, 20/60-day momentum, volume, and volatility provide context.",
    next_step: "Confirm the completed one-hour signal in TradingView and run the detailed review before making your own decision.",
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
  const complete = reports.every(report => report.data_complete);
  const synthesis = makeReport("synthesis", symbol, averageScore, complete ? 0.68 : 0.48, `${direction} technical setup on completed one-hour candles${complete ? "." : ", but missing verified news or fundamental context keeps the research gate from clearing."}`, candidate.reasons, reports.flatMap(report => report.risks).slice(0, 5), complete);
  const bull = makeReport("bull", symbol, direction === "LONG" ? technicalScore : 100 - technicalScore, 0.62, direction === "LONG" ? "Trend, momentum, and Supertrend are aligned for the bullish case." : "A reversal back above the Supertrend line is the main bullish counter-case.", candidate.reasons, candidate.cautions, true);
  const bear = makeReport("bear", symbol, direction === "SHORT" ? technicalScore : 100 - technicalScore, 0.7, direction === "SHORT" ? "Trend, momentum, and Supertrend are aligned for the bearish case." : "Headline risk, volatility, and a close below Supertrend are the main reasons the long setup could fail.", candidate.cautions.length ? candidate.cautions : ["No setup is certain."], ["Risk is defined by the invalidation level."], true);
  const price = snapshot.price;
  const riskDistance = Math.max(2 * snapshot.signal_atr_14, price * 0.0125);
  const stop = direction === "SHORT" ? price + riskDistance : Math.max(0.01, price - riskDistance);
  const target1 = direction === "SHORT" ? Math.max(0.01, price - 2 * riskDistance) : price + 2 * riskDistance;
  const target2 = direction === "SHORT" ? Math.max(0.01, price - 3 * riskDistance) : price + 3 * riskDistance;
  const vetoReasons = reports.filter(report => !report.data_complete).map(report => `Incomplete required research: ${report.role}`);
  if (snapshot.annualized_volatility_pct > 85) vetoReasons.push(`Annualized volatility ${snapshot.annualized_volatility_pct.toFixed(1)}% exceeds the 85% review limit`);
  const approved = vetoReasons.length === 0 && technicalScore >= 65;
  const action = approved ? "IDEA" : technicalScore >= 55 ? "WATCH" : "PASS";
  const levels = { reference: round(price, 4), risk: round(stop, 4), target_1: round(target1, 4), target_2: round(target2, 4) };
  const chartExplanation = [
    `1H Supertrend (10, 3) is ${direction} at $${numeric(snapshot.supertrend.value).toFixed(2)} on the latest completed candle.`,
    ...candidate.reasons.slice(1, 3),
    ...(approved ? [] : vetoReasons),
  ];
  return {
    run_id: crypto.randomUUID(),
    decision_id: crypto.randomUUID().slice(0, 8),
    symbol,
    action,
    direction,
    approved,
    entry_price: round(price, 4),
    stop_price: round(stop, 4),
    target_position_pct: 0,
    confidence: synthesis.confidence,
    thesis: synthesis.thesis,
    veto_reasons: vetoReasons,
    market_snapshot: snapshot,
    analyst_reports: reports,
    debate: { bull, bear, synthesis },
    trade_plan: { action, direction, entry_price: round(price, 4), stop_price: round(stop, 4), target_position_pct: 0, target_1: levels.target_1, target_2: levels.target_2 },
    risk_review: { approved, veto_reasons: vetoReasons, reviewed_position_pct: 0, authority: "Risk owns the final veto; no downstream agent may override it." },
    portfolio_review: { approved, reasons: approved ? [] : ["Risk veto is active"], final_position_pct: 0, portfolio_note: approved ? "Cleared as a research idea." : "Not cleared as a research idea." },
    chart: {
      series: snapshot.history,
      source: "Robinhood",
      source_detail: snapshot.data_source_detail,
      supertrend: snapshot.supertrend,
      levels,
      target_return_pct: { target_1: round((target1 / price - 1) * 100, 2), target_2: round((target2 / price - 1) * 100, 2) },
      direction,
      stance: action,
      explanation: chartExplanation,
      method: `${direction} scenario: risk is two 14-hour average ranges against the setup; targets are 2R and 3R in the signal direction. Levels are research scenarios, not orders.`,
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

async function handle(request, env, ctx) {
  void env;
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
  if (request.method === "GET" && url.pathname === "/api/history") return json([]);
  if (request.method !== "POST") return json({ error: "Not found" }, 404);
  try {
    if (url.pathname === "/api/discover") {
      await readBody(request);
      const payload = await fromCache(request, "sp500-discovery-v1", SCAN_CACHE_SECONDS, async () => {
        if (!discoveryInFlight) discoveryInFlight = discover().finally(() => { discoveryInFlight = null; });
        return discoveryInFlight;
      }, ctx);
      return json(payload);
    }
    if (url.pathname === "/api/analyze") {
      const body = await readBody(request);
      const symbol = String(body.symbol || "").trim().toUpperCase();
      if (!/^[A-Z0-9.\-^]{1,12}$/.test(symbol)) throw new Error("Enter a valid ticker symbol");
      const payload = await fromCache(request, `analysis-${symbol}-v1`, ANALYSIS_CACHE_SECONDS, async () => {
        if (!analysisInFlight.has(symbol)) analysisInFlight.set(symbol, analyze(symbol).finally(() => analysisInFlight.delete(symbol)));
        return analysisInFlight.get(symbol);
      }, ctx);
      return json(payload);
    }
    if (url.pathname === "/api/grade") return json({ error: "Public grading is disabled; this deployment stores no visitor portfolio data." }, 405);
    return json({ error: "Not found" }, 404);
  } catch (error) {
    const message = cleanError(error);
    const status = /valid ticker|body is too large/i.test(message) ? 400 : 502;
    return json({ error: message }, status);
  }
}

export default { fetch: handle };
