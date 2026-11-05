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

    func testTrackRecordDecodesAndKeepsLosses() throws {
        let json = #"{"available":true,"since":"2026-10-01T15:00:00Z","horizon_trading_days":5,"summary":{"settled_picks":4,"pending_picks":3,"win_rate_pct":50,"average_return_pct":-0.5,"average_win_pct":3,"average_loss_pct":-4,"worst_loss_pct":-6,"profit_factor":0.75,"stop_hit_rate_pct":50,"target_hit_rate_pct":25,"long":{"samples":2,"average_return_pct":1,"win_rate_pct":50},"short":{"samples":2,"average_return_pct":-2,"win_rate_pct":50}},"methodology":"x"}"#
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let record = try decoder.decode(TrackRecordResponse.self, from: Data(json.utf8))
        XCTAssertEqual(record.summary?.settledPicks, 4)
        XCTAssertEqual(record.summary?.worstLossPct, -6)
        XCTAssertEqual(record.summary?.short.averageReturnPct, -2)
    }

    func testTrackRecordDecodesEmptyState() throws {
        let json = #"{"available":true,"since":null,"horizon_trading_days":5,"summary":{"settled_picks":0,"pending_picks":2,"win_rate_pct":null,"average_return_pct":null,"average_win_pct":null,"average_loss_pct":null,"worst_loss_pct":null,"profit_factor":null,"stop_hit_rate_pct":null,"target_hit_rate_pct":null,"long":{"samples":0,"average_return_pct":null,"win_rate_pct":null},"short":{"samples":0,"average_return_pct":null,"win_rate_pct":null}},"methodology":"x"}"#
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let record = try decoder.decode(TrackRecordResponse.self, from: Data(json.utf8))
        XCTAssertEqual(record.summary?.pendingPicks, 2)
        XCTAssertNil(record.summary?.winRatePct)
    }

    func testPairingExpiryParsesFractionalSeconds() throws {
        XCTAssertNotNil(PairingExpiryParser.date(from: "2026-10-31T12:00:00.000Z"))
    }

    func testPairingExpiryParsesWholeSeconds() throws {
        XCTAssertNotNil(PairingExpiryParser.date(from: "2026-10-31T12:00:00Z"))
    }
}

