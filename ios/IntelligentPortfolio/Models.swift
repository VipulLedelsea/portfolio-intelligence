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

struct PairingStatus: Decodable, Sendable {
    let approved: Bool
    let token: String?
    let expiresAt: String
}

struct DiscoveryResponse: Decodable, Sendable {
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

struct Candidate: Decodable, Identifiable, Hashable, Sendable {
    var id: String { symbol }
    let symbol: String
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
}

struct AnalysisResponse: Decodable, Sendable {
    let symbol: String
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
    let explanation: [String]?
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

struct APIError: Decodable, Error, LocalizedError, Sendable {
    let error: String
    var errorDescription: String? { error }
}

