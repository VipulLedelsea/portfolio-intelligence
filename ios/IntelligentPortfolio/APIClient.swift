import Foundation

actor APIClient {
    static let shared = APIClient()
    static let productionOrigin = URL(string: "https://intelligent-portfolio.vipulsvdhotre.chatgpt.site")!

    private let origin: URL
    private let session: URLSession
    private let decoder: JSONDecoder

    init(origin: URL = APIClient.productionOrigin, session: URLSession = .shared) {
        self.origin = origin
        self.session = session
        decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
    }

    func access(token: String) async throws -> AccessResponse {
        try await request(path: "/api/access", method: "GET", token: token, body: Optional<String>.none)
    }

    func startPairing(deviceName: String) async throws -> PairingStart {
        try await request(path: "/api/mobile/pair/start", body: ["device_name": deviceName])
    }

    func pairingStatus(code: String, secret: String) async throws -> PairingStatus {
        try await request(path: "/api/mobile/pair/status", body: ["code": code, "pairing_secret": secret])
    }

    func discover(token: String) async throws -> DiscoveryResponse {
        try await request(path: "/api/discover", token: token, body: ["limit": 20])
    }

    func analyze(symbol: String, token: String) async throws -> AnalysisResponse {
        try await request(path: "/api/analyze", token: token, body: ["symbol": symbol])
    }

    func memory(token: String) async throws -> MemoryResponse {
        try await request(path: "/api/memory", token: token, body: [:] as [String: String])
    }

    func revoke(token: String) async throws {
        let _: RevokeResponse = try await request(path: "/api/mobile/session/revoke", token: token, body: [:] as [String: String])
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

