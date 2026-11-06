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

    func testMarketTrendDecodesDayChangeAndOldPayloads() throws {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let withChange = #"{"market":"US","index_symbol":"SPY","state":"MIXED","index_state":"DOWN","headline":"h","note":"n","label":"S&P 500","daily":"DOWN","four_hour":"DOWN","adx":16,"day_change_pct":0.82,"breadth_daily_pct":71}"#
        let trend = try decoder.decode(MarketTrend.self, from: Data(withChange.utf8))
        XCTAssertEqual(trend.state, "MIXED")
        XCTAssertEqual(trend.dayChangePct, 0.82)
        let old = #"{"index_symbol":"SPY","state":"DOWN","headline":"h","note":"n","label":"S&P 500","daily":"DOWN","four_hour":"DOWN","adx":16,"breadth_daily_pct":null}"#
        XCTAssertNil(try decoder.decode(MarketTrend.self, from: Data(old.utf8)).dayChangePct)
    }

    func testDipScanAndStrategyTrackRecordDecode() throws {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let scan = #"{"candidates":[],"long_candidates":[],"short_candidates":[],"late_candidates":[],"universe_size":503,"successful":503,"fresh_entry_count":0,"method":"m","next_step":"n","dip_scan":{"available":true,"gate":{"open":false,"spy_5d_pct":0.4,"breadth_pct":1.2,"headline":"Calm market: no dip ideas","note":"n"},"scanned":503,"dip_count":1,"candidates":[],"waiting":[{"symbol":"AAA","company":"A","sector":"Tech","currency_symbol":"$","price_decimals":2,"price":150.5,"signal_close":151,"rsi2":3.2,"return_3d_pct":-6.1,"above_sma200_pct":9.5,"sharp":true,"score":82.5,"label":"Sharp dip in an uptrend","atr_14":4,"atr_14_pct":2.6,"stop_price":135,"target_1":159,"target_2":163,"horizon_trading_days":5,"reference_lines":[{"key":"low_20","label":"20-day low","value":140.5}],"bars":[{"d":"2026-11-04","o":150,"h":152,"l":148,"c":151}]}]}}"#
        let discovery = try decoder.decode(DiscoveryResponse.self, from: Data(scan.utf8))
        XCTAssertEqual(discovery.dipScan?.gate?.open, false)
        let pick = try XCTUnwrap(discovery.dipScan?.waiting?.first)
        XCTAssertEqual(pick.return3DPct, -6.1)
        XCTAssertEqual(pick.target1, 159)
        XCTAssertTrue(pick.sharp)
        XCTAssertEqual(pick.referenceLines?.first?.label, "20-day low")
        XCTAssertEqual(pick.bars?.first?.c, 151)
        let summary = #"{"settled_picks":1,"pending_picks":0,"win_rate_pct":100,"average_return_pct":3,"average_win_pct":3,"average_loss_pct":null,"worst_loss_pct":3,"profit_factor":null,"stop_hit_rate_pct":0,"target_hit_rate_pct":100,"long":{"samples":1,"average_return_pct":3,"win_rate_pct":100},"short":{"samples":0,"average_return_pct":null,"win_rate_pct":null}}"#
        let record = #"{"available":true,"since":null,"horizon_trading_days":5,"summary":\#(summary),"strategies":[{"id":"DIP_WAIT","label":"l","since":null,"summary":\#(summary)}],"methodology":"x"}"#
        let decoded = try decoder.decode(TrackRecordResponse.self, from: Data(record.utf8))
        XCTAssertEqual(decoded.strategies?.first?.id, "DIP_WAIT", "Strategy ids must survive the snake_case key conversion")
    }

    func testPairingExpiryParsesFractionalSeconds() throws {
        XCTAssertNotNil(PairingExpiryParser.date(from: "2026-10-31T12:00:00.000Z"))
    }

    func testPairingExpiryParsesWholeSeconds() throws {
        XCTAssertNotNil(PairingExpiryParser.date(from: "2026-10-31T12:00:00Z"))
    }

    func testStandByRuleNeedsLandscapeAndStillness() {
        // Starts only on its side and still for long enough; no charger needed.
        XCTAssertTrue(StandByRule.decide(active: false, landscape: true, stillFor: 2.5, pickedUp: false))
        XCTAssertFalse(StandByRule.decide(active: false, landscape: true, stillFor: 0.5, pickedUp: false))
        XCTAssertFalse(StandByRule.decide(active: false, landscape: false, stillFor: 9, pickedUp: false))
        // Once on, it stays on through small bumps and ends on turning upright or being picked up.
        XCTAssertTrue(StandByRule.decide(active: true, landscape: true, stillFor: 0, pickedUp: false))
        XCTAssertFalse(StandByRule.decide(active: true, landscape: false, stillFor: 9, pickedUp: false))
        XCTAssertFalse(StandByRule.decide(active: true, landscape: true, stillFor: 9, pickedUp: true))
    }
}
