import Foundation

actor APIClient {
    static let shared = APIClient()
    /// The only place the server address is set. Change it when the site moves.
    static let productionOrigin = URL(string: "https://intelligent-portfolio.portfolio-intelligence-site.workers.dev")!

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
        try await request(path: "/api/mobile/pair/start", body: ["device_name": deviceName])
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

    func revoke(token: String) async throws {
        let _: RevokeResponse = try await request(path: "/api/mobile/session/revoke", token: token, body: [:] as [String: String])
    }

    func holdings(token: String, refresh: Bool = false) async throws -> HoldingsResponse {
        try await request(path: "/api/holdings", token: token, body: HoldingsBody(refresh: refresh))
    }

    func holdingStats(token: String) async throws -> HoldingStatsResponse {
        try await request(path: "/api/holdings/stats", token: token, body: [:] as [String: String])
    }

    func addHolding(_ body: AddHoldingBody, token: String) async throws {
        let _: HoldingChangeResponse = try await request(path: "/api/holdings/add", token: token, body: body)
    }

    func increaseHolding(_ body: IncreaseHoldingBody, token: String) async throws {
        let _: HoldingChangeResponse = try await request(path: "/api/holdings/increase", token: token, body: body)
    }

    func sellHolding(_ body: SellHoldingBody, token: String) async throws {
        let _: HoldingChangeResponse = try await request(path: "/api/holdings/sell", token: token, body: body)
    }

    func undoEntry(id: String, token: String) async throws {
        let _: HoldingChangeResponse = try await request(path: "/api/holdings/undo", token: token, body: UndoEntryBody(id: id))
    }

    func deleteAccountData(token: String) async throws {
        let _: DeleteResponse = try await request(path: "/api/mobile/account/delete", token: token, body: [:] as [String: String])
    }

    private func request<Response: Decodable, Body: Encodable>(
        path: String,
        method: String = "POST",
        token: String? = nil,
        body: Body?
    ) async throws -> Response {
        var request = URLRequest(url: origin.appending(path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(http.statusCode) else {
            if let apiError = try? decoder.decode(APIError.self, from: data) { throw apiError }
            throw URLError(.badServerResponse)
        }
        return try decoder.decode(Response.self, from: data)
    }
}

private struct RevokeResponse: Decodable { let revoked: Bool }
private struct DiscoverBody: Encodable { let limit: Int; let market: String; let refresh: Bool }
private struct AnalyzeBody: Encodable { let symbol: String; let market: String }

