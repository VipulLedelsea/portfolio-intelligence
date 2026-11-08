import Foundation

struct AccessResponse: Decodable, Sendable {
    let paywallEnabled: Bool
    let configured: Bool
    let signedIn: Bool
    let subscribed: Bool
    let subscriptionStatus: String?
    let renewsAt: String?
    let authType: String?
}

struct PairingStart: Decodable, Sendable {
    let code: String
    let pairingSecret: String
    let expiresAt: String
    let pollAfterSeconds: Int
}

enum PairingExpiryParser {
    static func date(from value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) {
            return date
        }

        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: value)
    }
}

struct PairingStatus: Decodable, Sendable {
    let approved: Bool
    let token: String?
    let expiresAt: String
}

enum Market: String, CaseIterable, Identifiable, Sendable {
    case us = "US"
    case india = "IN"
    case forex = "FX"

    var id: String { rawValue }
    var label: String {
        switch self {
        case .us: "US"
        case .india: "BSE"
        case .forex: "Forex"
        }
    }
    var fullLabel: String {
        switch self {
        case .us: "US stocks"
        case .india: "India (BSE)"
        case .forex: "Forex"
        }
    }
    /// Every scan refreshes on the server schedule and cannot be refreshed by hand.
    var isAutomatic: Bool { true }
    var scanTitle: String {
        switch self {
        case .us: "S&P 500"
        case .india: "Sensex 30"
        case .forex: "Major forex pairs"
        }
    }

    func tradingViewSymbol(_ symbol: String) -> String {
        switch self {
        case .us: symbol
        case .india: "BSE:\(symbol)"
        case .forex: "FX:\(symbol)"
        }
    }
}

enum PriceFormat {
    static func string(_ value: Double, prefix: String?, decimals: Int?) -> String {
        let digits = decimals ?? 2
        return (prefix ?? "$") + String(format: "%.\(digits)f", value)
    }
}

struct DiscoveryResponse: Decodable, Sendable {
    let market: String?
    let marketTrend: MarketTrend?
    let marketTrends: [MarketTrend]?
    let allMarketTrends: [MarketTrend]?
    let recentSetups: [RecentSetup]?
    let dipScan: DipScan?
    let patternScan: PatternScan?
    let ranking: RankedIdeas?
    let autoRefresh: Bool?
    let refreshedAt: String?
    let warmingUp: Bool?
    let message: String?
    let candidates: [Candidate]
    let longCandidates: [Candidate]
    let shortCandidates: [Candidate]
    let lateCandidates: [Candidate]
    let universeSize: Int
    let successful: Int
    let freshEntryCount: Int
    let method: String
    let nextStep: String
}

/// One ranked list of every scanner's ideas. `source` is "ai" when a Claude model ranked them and "rules" when the fixed scoring did.
struct RankedIdeas: Decodable, Sendable {
    let available: Bool
    let source: String
    let model: String?
    let headline: String
    let nothingCompelling: Bool
    let marketState: String?
    let items: [RankedIdea]
    let rejected: [RankedReject]
    let dataGaps: [String]
    let orderingNotes: String?
    let method: String?
}

struct RankedReject: Decodable, Identifiable, Sendable {
    var id: String
    let symbol: String
    let strategy: String
    let tag: String
    let reason: String
}

struct RankedEvidence: Decodable, Hashable, Sendable {
    let label: String
    /// Backtested trades, win rate and expected value are nil where the strategy has not been backtested in that market (India, forex).
    let n: Int?
    let winRatePct: Double?
    let evPct: Double?
    let experimental: Bool
    let note: String
}

/// SEC EDGAR check for US ideas. The earnings date is an estimate from past filings, not a calendar.
struct FilingCheck: Decodable, Hashable, Sendable {
    let earningsInDays: Int?
    let earningsEstimate: String?
    let severe: [String]?
    let cautions: [String]?
}

struct RankedIdea: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let rank: Int
    let symbol: String
    let company: String
    let sector: String
    let strategy: String
    let tag: String
    let detail: String?
    let direction: String
    let currencySymbol: String?
    let priceDecimals: Int?
    let price: Double
    let entry: Double
    let stop: Double
    let target1: Double?
    let target2: Double?
    let atr: Double?
    let exitRule: String
    let stopPct: Double?
    let rrT1: Double?
    let rrT2: Double?
    let fromEntryAtr: Double?
    let ageDays: Int?
    let alignmentNote: String?
    let score: Double
    let confidence: String
    let reason: String
    let sources: [String]?
    let crowded: Bool?
    let evidence: RankedEvidence
    let bull: String?
    let bear: String?
    let invalidation: String?
    let filing: FilingCheck?
    let bars: [DailyBar]?
}

/// The third scanner mode (experimental): candlestick patterns on a breakout or breakdown day.
struct PatternScan: Decodable, Sendable {
    let available: Bool
    let reason: String?
    let experimental: Bool?
    let scanned: Int?
    let breakoutCount: Int?
    let breakdownCount: Int?
    let breakouts: [PatternPick]?
    let breakdowns: [PatternPick]?
    let notice: String?
    let method: String?
}

struct PatternPick: Decodable, Identifiable, Hashable, Sendable {
    var id: String { "\(symbol)-\(direction)" }
    let symbol: String
    let company: String
    let sector: String
    let currencySymbol: String?
    let priceDecimals: Int?
    let direction: String
    let patterns: [String]
    let label: String
    let price: Double
    let signalClose: Double
    let signalAsOf: String
    let volumeRatio: Double
    let aboveSma200Pct: Double
    let breakoutLevel: Double
    let patternExtreme: Double
    let score: Double
    let atr14Pct: Double
    let riskAtr: Double
    let stopPrice: Double
    let target1: Double
    let target2: Double
    let failureLevel: Double
    let horizonTradingDays: Int
    let referenceLines: [ReferenceLine]?
    let bars: [DailyBar]?
}

/// The second scanner mode: dips inside an uptrend, shown only while the market is under stress.
struct DipScan: Decodable, Sendable {
    let available: Bool
    let reason: String?
    let gate: DipGate?
    let scanned: Int?
    let dipCount: Int?
    let candidates: [DipPick]?
    let waiting: [DipPick]?
    let method: String?
}

struct DipGate: Decodable, Sendable {
    let open: Bool
    let spy5DPct: Double?
    let breadthPct: Double
    let headline: String
    let note: String
}

struct DipPick: Decodable, Identifiable, Hashable, Sendable {
    var id: String { symbol }
    let symbol: String
    let company: String
    let sector: String
    let currencySymbol: String?
    let priceDecimals: Int?
    let price: Double
    let signalClose: Double
    let rsi2: Double
    let return3DPct: Double
    let aboveSma200Pct: Double
    let sharp: Bool
    let score: Double
    let label: String
    let atr14Pct: Double
    let stopPrice: Double
    let target1: Double
    let target2: Double
    let referenceLines: [ReferenceLine]?
    let bars: [DailyBar]?
}

struct Candidate: Decodable, Identifiable, Hashable, Sendable {
    var id: String { symbol }
    let symbol: String
    let currencySymbol: String?
    let priceDecimals: Int?
    let company: String
    let sector: String
    let direction: String
    let label: String
    let price: Double
    let score: Double
    let entryEligible: Bool
    let entryStatus: String
    let dailySupertrendDirection: String
    let dailyAligned: Bool
    let dailyAdx: Double
    let dailyAdxRising: Bool
    let signalConfirmedAt: String
    let signalEntryPrice: Double
    let extensionAtr: Double
    let reasons: [String]
    let cautions: [String]
    /// When this setup stops counting as a fresh entry (about a trading day after the signal).
    let windowClosesAt: String?
    let firstSeenAt: String?
    let buyRange: BuyRange?
}

/// The zones around a signal price: failing, deep dip, buy zone, extended and chasing, with where the price sits now.
struct BuyRange: Decodable, Hashable, Sendable {
    let state: String
    let label: String
    let price: Double
    let entry: Double
    let atr: Double
    let zones: [BuyZone]
    let scaleMin: Double
    let scaleMax: Double
}

struct BuyZone: Decodable, Hashable, Sendable {
    let key: String
    let label: String
    let lo: Double?
    let hi: Double?
}

/// A setup that was a fresh entry in the last 24 hours and no longer is, with why and how the price has moved since.
struct RecentSetup: Decodable, Identifiable, Hashable, Sendable {
    let candidate: Candidate
    let droppedAt: String
    let dropReason: String
    let sinceSignalPct: Double?
    var id: String { candidate.symbol }

    private enum Keys: String, CodingKey { case droppedAt, dropReason, sinceSignalPct }

    init(from decoder: Decoder) throws {
        candidate = try Candidate(from: decoder)
        let container = try decoder.container(keyedBy: Keys.self)
        droppedAt = try container.decode(String.self, forKey: .droppedAt)
        dropReason = try container.decode(String.self, forKey: .dropReason)
        sinceSignalPct = try container.decodeIfPresent(Double.self, forKey: .sinceSignalPct)
    }
}

struct AnalysisResponse: Decodable, Sendable {
    let symbol: String
    let market: String?
    let currencySymbol: String?
    let priceDecimals: Int?
    let direction: String
    let action: String
    let currentPrice: Double
    let entryPrice: Double
    let stopPrice: Double
    let entryStatus: String
    let confidence: Double
    let thesis: String
    let signalConfirmedAt: String
    let dailySupertrendDirection: String
    let dailyAligned: Bool
    let dailyAdx: Double
    let dailyAdxPrior: Double
    let dailyAdxRising: Bool
    let regimeEligible: Bool
    let approved: Bool
    let vetoReasons: [String]
    let contextWarnings: [String]
    let chart: ChartPayload?
}

struct ChartPayload: Decodable, Sendable {
    let source: String?
    let series: [Candle]
    let levels: ScenarioLevels
    /// Chart context (20-day low, recent highs, moving averages). Reference only: they do not set the stop or targets.
    let referenceLines: [ReferenceLine]?
    let explanation: [String]?
}

struct ReferenceLine: Decodable, Identifiable, Hashable, Sendable {
    var id: String { key }
    let key: String
    let label: String
    let value: Double
}

struct DailyBar: Decodable, Hashable, Sendable {
    let d: String
    let o: Double
    let h: Double
    let l: Double
    let c: Double
}

struct ScenarioLevels: Decodable, Sendable {
    let reference: Double
    let current: Double
    let risk: Double
    let target1: Double
    let target2: Double
}

struct Candle: Decodable, Identifiable, Sendable {
    var id: String { date }
    let date: String
    let open: Double
    let high: Double
    let low: Double
    let close: Double
    let supertrend: Double?
    let supertrendDirection: String?
    let barStatus: String?
}

struct MemoryResponse: Decodable, Sendable {
    let available: Bool
    let newlySettled: Int?
    let settlementWarning: String?
    let horizonTradingDays: Int?
    let summary: MemorySummary?
    let learningNote: String?
    let recent: [MemoryRecord]?
    let methodology: String?
}

struct MemorySummary: Decodable, Sendable {
    let totalCalls: Int
    let pendingCalls: Int
    let settledCalls: Int
    let scoredSetups: Int
    let averageReturnPct: Double
    let winRatePct: Double
    let profitFactor: Double?
}

struct MemoryRecord: Decodable, Identifiable, Sendable {
    var id: String { "\(symbol)-\(generatedAt)-\(action)" }
    let symbol: String
    let action: String
    let direction: String
    let generatedAt: String
    let status: String
    let settledAt: String?
    let strategyReturnPct: Double?
    let maxFavorablePct: Double?
    let maxAdversePct: Double?
    let grade: String?
    let entryStatus: String
}

/// Public, app-wide record of every fresh scanner pick the app surfaced (not tied to any user).
struct TrackRecordResponse: Decodable, Sendable {
    let available: Bool
    let since: String?
    let horizonTradingDays: Int?
    let summary: TrackRecordSummary?
    /// One summary per scanner (Supertrend, dip scan, and dips seen while the market gate was closed), so they can be compared.
    let strategies: [TrackRecordStrategy]?
    let methodology: String?
}

struct TrackRecordStrategy: Decodable, Identifiable, Sendable {
    let id: String
    let label: String
    let since: String?
    let summary: TrackRecordSummary
}

struct TrackRecordSummary: Decodable, Sendable {
    let settledPicks: Int
    let pendingPicks: Int
    let winRatePct: Double?
    let averageReturnPct: Double?
    let averageWinPct: Double?
    let averageLossPct: Double?
    let worstLossPct: Double?
    let profitFactor: Double?
    let stopHitRatePct: Double?
    let targetHitRatePct: Double?
    let long: TrackRecordSide
    let short: TrackRecordSide
}

struct TrackRecordSide: Decodable, Sendable {
    let samples: Int
    let averageReturnPct: Double?
    let winRatePct: Double?
}

struct APIError: Decodable, Error, LocalizedError, Sendable {
    let error: String
    var errorDescription: String? { error }
}


struct DeleteResponse: Decodable, Sendable {
    let deleted: Bool
}

struct HoldingsResponse: Decodable, Sendable {
    let updatedAt: String
    let refreshAfterSeconds: Int?
    let open: [Holding]
    let closed: [ClosedHolding]
    let totals: [HoldingTotal]
    let portfolio: PortfolioSummary?
    let marketTrends: [String: MarketTrend?]?
    let disclaimer: String
}

struct LevelEvent: Decodable, Identifiable, Sendable {
    var id: String { at + kind }
    let at: String
    let kind: String
    let reason: String
}

struct Holding: Decodable, Identifiable, Sendable {
    let id: String
    let symbol: String
    let market: String
    let currencySymbol: String
    let priceDecimals: Int
    let shares: Double
    let buyPrice: Double
    let boughtAt: String
    let action: String
    let actionLabel: String
    let headline: String
    let reasons: [String]
    let currentPrice: Double?
    let value: Double?
    let pnlValue: Double?
    let pnlPct: Double?
    let stopLevel: Double?
    /// Why the protective level sits where it does ("raised to your buy price once the trade gained one daily range", ...).
    let stopNote: String?
    let trailingLevel: Double?
    let target1: Double?
    let target2: Double?
    let referenceLines: [ReferenceLine]?
    /// The position monitor's recent changes to this position's levels, newest first, each with its reason.
    let levelEvents: [LevelEvent]?
    let trend4h: String?
    let dailyTrend: String?
    let previousAction: String?
    let actionSince: String?
    let lastEntry: LastEntry?
}

struct LastEntry: Decodable, Sendable {
    let id: String
    let side: String
    let shares: Double
    let price: Double
    let at: String
}

struct ClosedHolding: Decodable, Identifiable, Sendable {
    let id: String
    let symbol: String
    let currencySymbol: String
    let priceDecimals: Int
    let shares: Double
    let buyPrice: Double
    let sellPrice: Double
    let pnlValue: Double
    let pnlPct: Double
}

struct HoldingTotal: Decodable, Identifiable, Sendable {
    let market: String
    let currencySymbol: String
    let value: Double
    let pnlValue: Double
    let pnlPct: Double
    var id: String { market }
}

struct AddHoldingBody: Encodable, Sendable {
    let symbol: String
    let market: String
    let shares: Double
    let price: Double
    let boughtAt: String

    enum CodingKeys: String, CodingKey {
        case symbol, market, shares, price
        case boughtAt = "bought_at"
    }
}

struct IncreaseHoldingBody: Encodable, Sendable {
    let id: String
    let shares: Double
    let price: Double
}

struct SellHoldingBody: Encodable, Sendable {
    let id: String
    let shares: Double
    let price: Double
}

struct EditEntryBody: Encodable, Sendable {
    let id: String
    let shares: Double
    let price: Double
    let boughtAt: String?

    enum CodingKeys: String, CodingKey {
        case id, shares, price
        case boughtAt = "bought_at"
    }
}

struct UndoEntryBody: Encodable, Sendable {
    let id: String
}

struct HoldingsBody: Encodable, Sendable {
    let refresh: Bool
}

struct HoldingChangeResponse: Decodable, Sendable {}

struct HoldingStatsResponse: Decodable, Sendable {
    let updatedAt: String
    let markets: [MarketStats]
    let history: [TradeEntry]
    let disclaimer: String
}

struct MarketStats: Decodable, Identifiable, Sendable {
    let market: String
    let currencySymbol: String
    let closedTrades: Int
    let wins: Int
    let losses: Int
    let winRate: Double
    let realizedPnl: Double
    let avgReturnPct: Double
    let avgWinPct: Double
    let avgLossPct: Double
    let profitFactor: Double?
    let best: TradeExtreme
    let worst: TradeExtreme
    let avgHoldDays: Double
    let months: [MonthStats]
    var id: String { market }
}

struct TradeExtreme: Decodable, Sendable {
    let symbol: String
    let pct: Double
    let pnl: Double
}

struct MonthStats: Decodable, Identifiable, Sendable {
    let month: String
    let pnl: Double
    let trades: Int
    let wins: Int
    var id: String { month }
}

struct TradeEntry: Decodable, Identifiable, Sendable {
    let id: String
    let at: String
    let symbol: String
    let market: String
    let side: String
    let shares: Double
    let price: Double
    let currencySymbol: String
    let priceDecimals: Int
    let realizedPnl: Double?
    let voided: Bool
    let canUndo: Bool
    let edit: TradeEditRules?
}

struct TradeEditRules: Decodable, Sendable {
    let shares: Bool
    let date: Bool
}

struct PortfolioSummary: Decodable, Sendable {
    let limitPct: Double
    let markets: [PortfolioMarket]
}

struct PortfolioMarket: Decodable, Identifiable, Sendable {
    let market: String
    let label: String
    let currencySymbol: String
    let value: Double
    let cost: Double
    let pnlValue: Double
    let pnlPct: Double
    let riskToStopsValue: Double
    let riskToStopsPct: Double
    let positions: [PortfolioPosition]
    let sectors: [PortfolioSector]
    let readings: [PortfolioReading]
    let singlePosition: Bool
    let concentrated: [PortfolioConcentrated]
    var id: String { market }
}

struct PortfolioPosition: Decodable, Identifiable, Sendable {
    let symbol: String
    let sector: String
    let action: String
    let value: Double
    let weightPct: Double
    let pnlPct: Double
    var id: String { symbol }
}

struct PortfolioSector: Decodable, Identifiable, Sendable {
    let sector: String
    let value: Double
    let weightPct: Double
    var id: String { sector }
}

struct PortfolioReading: Decodable, Identifiable, Sendable {
    let action: String
    let label: String
    let count: Int
    let value: Double
    let weightPct: Double
    var id: String { action }
}

struct PortfolioConcentrated: Decodable, Sendable {
    let symbol: String
    let weightPct: Double
}

/// How the market's main index is trending, from the same Supertrend and ADX the scanner uses.
struct MarketTrend: Decodable, Sendable {
    let market: String?
    let indexSymbol: String
    let state: String
    let headline: String
    let note: String
    let label: String
    let daily: String
    let fourHour: String
    let adx: Double
    let dayChangePct: Double?
    let breadthDailyPct: Double?
    /// Recent closes of the index, oldest first, for the desk display's line chart. Absent on older server data.
    let spark: [Double]?
}
