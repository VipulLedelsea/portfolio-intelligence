import Foundation

actor APIClient {
    static let shared = APIClient()
    /// The only place the server address is set. Change it when the site moves.
    private static let liveOrigin = URL(string: "https://intelligent-portfolio.portfolio-intelligence-site.workers.dev")!

    /// Debug builds can point at a local test server through the `apiOriginOverride` default (simulator testing only).
    /// Release builds always use the live address.
    static var productionOrigin: URL {
        #if DEBUG
        if let text = UserDefaults.standard.string(forKey: "apiOriginOverride"), let url = URL(string: text) { return url }
        #endif
        return liveOrigin
    }

    private let origin: URL
    private let session: URLSession
    private let decoder: JSONDecoder

    init(origin: URL = APIClient.productionOrigin, session: URLSession = .shared) {
        self.origin = origin
        self.session = session
        decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
    }

    func access(token: String?) async throws -> AccessResponse {
        try await request(path: "/api/access", method: "GET", token: token, body: Optional<String>.none)
    }

    func startPairing(deviceName: String) async throws -> PairingStart {
        try await request(path: "/api/mobile/pair/start", body: ["device_name": deviceName], retryOnConnectionLoss: false)
    }

    func pairingStatus(code: String, secret: String) async throws -> PairingStatus {
        try await request(path: "/api/mobile/pair/status", body: ["code": code, "pairing_secret": secret])
    }

    func discover(market: Market, token: String?, refresh: Bool = false) async throws -> DiscoveryResponse {
        try await request(path: "/api/discover", token: token, body: DiscoverBody(limit: 20, market: market.rawValue, refresh: refresh))
    }

    func analyze(symbol: String, market: Market, token: String?) async throws -> AnalysisResponse {
        try await request(path: "/api/analyze", token: token, body: AnalyzeBody(symbol: symbol, market: market.rawValue))
    }

    func memory(token: String) async throws -> MemoryResponse {
        try await request(path: "/api/memory", token: token, body: [:] as [String: String])
    }

    func trackRecord() async throws -> TrackRecordResponse {
        try await request(path: "/api/track-record", method: "GET", body: Optional<String>.none)
    }

    func revoke(token: String) async throws {
        let _: RevokeResponse = try await request(path: "/api/mobile/session/revoke", token: token, body: [:] as [String: String])
    }

    func holdings(token: String, refresh: Bool = false) async throws -> HoldingsResponse {
        try await request(path: "/api/holdings", token: token, body: HoldingsBody(refresh: refresh))
    }

    func learning(token: String) async throws -> LearningResponse {
        try await request(path: "/api/learning", token: token, body: [:] as [String: String])
    }

    func briefing(token: String) async throws -> Briefing {
        try await request(path: "/api/briefing", token: token, body: [:] as [String: String])
    }

    func markAlertsSeen(ids: [String], token: String) async throws {
        let _: HoldingChangeResponse = try await request(path: "/api/holdings/alerts/seen", token: token, body: AlertsSeenBody(ids: ids), retryOnConnectionLoss: false)
    }

    func holdingStats(token: String) async throws -> HoldingStatsResponse {
        try await request(path: "/api/holdings/stats", token: token, body: [:] as [String: String])
    }

    func addHolding(_ body: AddHoldingBody, token: String) async throws {
        let _: HoldingChangeResponse = try await request(path: "/api/holdings/add", token: token, body: body, retryOnConnectionLoss: false)
    }

    func increaseHolding(_ body: IncreaseHoldingBody, token: String) async throws {
        let _: HoldingChangeResponse = try await request(path: "/api/holdings/increase", token: token, body: body, retryOnConnectionLoss: false)
    }

    func sellHolding(_ body: SellHoldingBody, token: String) async throws {
        let _: HoldingChangeResponse = try await request(path: "/api/holdings/sell", token: token, body: body, retryOnConnectionLoss: false)
    }

    func editEntry(_ body: EditEntryBody, token: String) async throws {
        let _: HoldingChangeResponse = try await request(path: "/api/holdings/edit", token: token, body: body, retryOnConnectionLoss: false)
    }

    func undoEntry(id: String, token: String) async throws {
        let _: HoldingChangeResponse = try await request(path: "/api/holdings/undo", token: token, body: UndoEntryBody(id: id), retryOnConnectionLoss: false)
    }

    func deleteAccountData(token: String) async throws {
        let _: DeleteResponse = try await request(path: "/api/mobile/account/delete", token: token, body: [:] as [String: String], retryOnConnectionLoss: false)
    }

    private func request<Response: Decodable, Body: Encodable>(
        path: String,
        method: String = "POST",
        token: String? = nil,
        body: Body?,
        retryOnConnectionLoss: Bool = true
    ) async throws -> Response {
        var request = URLRequest(url: origin.appending(path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        var (data, response) = try await send(request, retry: retryOnConnectionLoss)
        // The host sometimes answers a heavy request with a plain-text 5xx page (for example when a fresh analysis runs
        // over its limits). Reads try once more, since the second run is usually served from the shared cache.
        if retryOnConnectionLoss, let http = response as? HTTPURLResponse, [500, 502, 503, 504].contains(http.statusCode),
           (try? decoder.decode(APIError.self, from: data)) == nil {
            try? await Task.sleep(for: .milliseconds(800))
            (data, response) = try await send(request, retry: retryOnConnectionLoss)
        }
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(http.statusCode) else {
            if let apiError = try? decoder.decode(APIError.self, from: data) { throw apiError }
            if http.statusCode >= 500 { throw APIError(error: "The service is busy right now. Try again in a moment.") }
            throw APIError(error: "The request couldn't be completed (code \(http.statusCode)). Try again in a moment.")
        }
        return try decoder.decode(Response.self, from: data)
    }
}

private extension APIClient {
    /// After the app has been in the background, iOS may have silently dropped the idle connection, and the first
    /// request on it fails with "network connection was lost" even though the network is fine. Reads are simply
    /// retried on a fresh connection. Requests that change data are never retried, so nothing is applied twice.
    func send(_ request: URLRequest, retry: Bool) async throws -> (Data, URLResponse) {
        do { return try await session.data(for: request) }
        catch let error as URLError where retry && (error.code == .networkConnectionLost || error.code == .notConnectedToInternet) {
            try? await Task.sleep(for: .milliseconds(400))
            return try await session.data(for: request)
        }
    }
}

private struct RevokeResponse: Decodable { let revoked: Bool }
private struct DiscoverBody: Encodable { let limit: Int; let market: String; let refresh: Bool }
private struct AnalyzeBody: Encodable { let symbol: String; let market: String }

