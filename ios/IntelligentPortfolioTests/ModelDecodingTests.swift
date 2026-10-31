import XCTest
@testable import IntelligentPortfolio

final class ModelDecodingTests: XCTestCase {
    func testPairingResponseDecodesSnakeCase() throws {
        let data = Data(#"{"code":"ABCD2345","pairing_secret":"secret","expires_at":"2026-10-31T12:00:00.000Z","poll_after_seconds":2}"#.utf8)
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let result = try decoder.decode(PairingStart.self, from: data)
        XCTAssertEqual(result.code, "ABCD2345")
        XCTAssertEqual(result.pollAfterSeconds, 2)
    }
}

