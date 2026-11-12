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

    func testRankedIdeasDecodeFromWorkerPayload() throws {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let rules = try decoder.decode(RankedIdeas.self, from: Data(#"{"available":true,"source":"rules","model":null,"headline":"2 ideas with a positive backtest edge today","nothing_compelling":false,"market_state":"UP","items":[{"strategy":"SUPERTREND","symbol":"AAA","company":"A Co","sector":"Tech","direction":"LONG","price":101,"entry":100,"stop":94,"target_1":null,"target_2":null,"atr":2.5,"atr_pct":2.5,"volume_ratio":null,"age_days":0,"scanner_score":80,"tag":"Supertrend","detail":"Strong fresh long entry","exit_rule":"Leave when a day closes under the daily Supertrend line, at the next open. No fixed target and no time limit.","alignment_score":100,"alignment_note":"Daily Supertrend LONG, daily ADX 28 and rising; market up.","currency_symbol":"$","price_decimals":2,"id":"SUPERTREND:AAA:LONG","evidence":{"label":"Supertrend","n":503,"win_rate_pct":45,"avg_win_pct":11.3,"avg_loss_pct":-6.2,"ev_pct":1.61,"experimental":false,"note":"Daily Supertrend flip with the ADX gate, held until a daily close under the Supertrend line (about 34 days on average); no target. About 500 trades over four years in a mostly rising market; the edge was larger in the first half."},"scanner_rank_in_list":1,"stop_pct":6,"stop_atr":2.4,"rr_t1":null,"rr_t2":null,"from_entry_atr":0.4,"stop_hit":false,"rules_score":81.3,"crowded":false,"rank":1,"score":81.3,"confidence":"High","reason":"Supertrend: backtest +1.61% per trade, 45% wins (503 trades) · exits on the daily trend line · 0.4 ATR from the entry","sources":["rules"],"bars":[{"d":"2026-11-06","o":1,"h":2,"l":0.5,"c":1.5}]},{"strategy":"DIP","symbol":"CCC","company":"C","sector":"Energy","direction":"LONG","price":20,"entry":20,"stop":19,"target_1":20.5,"target_2":21,"atr":0.5,"atr_pct":2.5,"volume_ratio":null,"age_days":0,"scanner_score":80,"tag":"Sharp dip","detail":"Sharp dip in an uptrend","exit_rule":"Leave at the stop, at target 1, or at the close of day 10, whichever comes first.","alignment_score":70,"alignment_note":"Stock above its 200-day average; the market-stress gate is open (SPY -2% over 5 days).","id":"DIP:CCC:LONG","evidence":{"label":"Dip","n":1010,"win_rate_pct":72,"avg_win_pct":null,"avg_loss_pct":null,"ev_pct":1.14,"experimental":false,"note":"Sharper dip (RSI(2) under 5, down 5% or more in 3 days) while SPY was down 1.5% or more over 5 days. Fewer trades, more clustered in a few selloff weeks."},"scanner_rank_in_list":1,"stop_pct":5,"stop_atr":2,"rr_t1":0.5,"rr_t2":1,"from_entry_atr":0,"stop_hit":false,"rules_score":67.6,"crowded":false,"rank":2,"score":67.6,"confidence":"High","reason":"Dip: backtest +1.14% per trade, 72% wins (1,010 trades) · R:R 0.5 to target 1 · 0 ATR from the entry","sources":["rules"],"bars":[{"d":"2026-11-06","o":1,"h":2,"l":0.5,"c":1.5}]},{"strategy":"PATTERN","symbol":"DDD","company":"D","sector":"Energy","direction":"LONG","price":30,"entry":30,"stop":29,"target_1":31,"target_2":32,"atr":0.6,"atr_pct":2,"volume_ratio":2,"age_days":0,"scanner_score":60,"tag":"Pattern","detail":"Hammer on a breakout","exit_rule":"Leave at the stop, at target 1 or 2, when a day closes back under 28.5, or at the close of day 10.","alignment_score":100,"alignment_note":"Close beyond the 20-day high on 2x volume; market up.","id":"PATTERN:DDD:LONG","evidence":{"label":"Pattern","n":347,"win_rate_pct":55,"avg_win_pct":null,"avg_loss_pct":null,"ev_pct":-0.37,"experimental":true,"note":"Bullish candlestick pattern on a 20-day-high breakout with volume 1.4x average, 5-day hold with 2 ATR stop and 1 ATR target. It did worse than breakouts without a pattern (-0.2% to -0.5% per trade) and lost money in absolute terms."},"scanner_rank_in_list":1,"stop_pct":3.33,"stop_atr":1.67,"rr_t1":1,"rr_t2":2,"from_entry_atr":0,"stop_hit":false,"rules_score":40,"crowded":false,"rank":3,"score":40,"confidence":"Low","reason":"Pattern: backtest -0.37% per trade, 55% wins (347 trades) · R:R 1 to target 1 · 0 ATR from the entry · experimental, not recommended","sources":["rules"],"bars":[{"d":"2026-11-06","o":1,"h":2,"l":0.5,"c":1.5}]}],"rejected":[{"id":"SUPERTREND:BBB:LONG","symbol":"BBB","strategy":"SUPERTREND","tag":"Supertrend","reason":"The stop is 40% from entry, wider than the 12% limit."}],"data_gaps":["No earnings calendar or news feed is connected, so earnings or events inside the holding window are not checked.","Dollar volume is not in the data feed; liquidity is judged from the volume ratio only.","Backtest figures are per strategy, not per stock, and most were tested on the S&P 500 in a mostly rising market."],"ordering_notes":null,"deep_dives":[],"method":"Rules: expected value from each scanner's backtest 35%, reward to risk 20%, trend and market alignment 15%, entry quality 15%, liquidity 10%, freshness 5%. Experimental and unproven scanners are penalised, negative-edge scanners are capped, and a third setup in the same sector and direction loses ground. Hard filters drop setups with a stop already hit, a stop wider than 12%, a chase of more than 1.5 ATR, or a stale signal."}"#.utf8))
        XCTAssertEqual(rules.source, "rules")
        XCTAssertEqual(rules.items.first?.tag, "Supertrend")
        XCTAssertNil(rules.items.first?.target1)
        XCTAssertEqual(rules.items.first?.evidence.n, 503)
        XCTAssertEqual(rules.rejected.first?.reason.isEmpty, false)
        let ai = try decoder.decode(RankedIdeas.self, from: Data(#"{"available":true,"source":"ai","model":"m","headline":"h","nothing_compelling":false,"market_state":"UP","items":[{"strategy":"DIP","symbol":"CCC","company":"C","sector":"Energy","direction":"LONG","price":20,"entry":20,"stop":19,"target_1":20.5,"target_2":21,"atr":0.5,"atr_pct":2.5,"volume_ratio":null,"age_days":0,"scanner_score":80,"tag":"Sharp dip","detail":"Sharp dip in an uptrend","exit_rule":"Leave at the stop, at target 1, or at the close of day 10, whichever comes first.","alignment_score":70,"alignment_note":"Stock above its 200-day average; the market-stress gate is open (SPY -2% over 5 days).","id":"DIP:CCC:LONG","evidence":{"label":"Dip","n":1010,"win_rate_pct":72,"avg_win_pct":null,"avg_loss_pct":null,"ev_pct":1.14,"experimental":false,"note":"Sharper dip (RSI(2) under 5, down 5% or more in 3 days) while SPY was down 1.5% or more over 5 days. Fewer trades, more clustered in a few selloff weeks."},"scanner_rank_in_list":1,"stop_pct":5,"stop_atr":2,"rr_t1":0.5,"rr_t2":1,"from_entry_atr":0,"stop_hit":false,"rules_score":67.6,"crowded":false,"rank":1,"score":77,"confidence":"High","reason":"ok","sources":["ai"],"bars":[{"d":"2026-11-06","o":1,"h":2,"l":0.5,"c":1.5}],"bull":"b","bear":"r","invalidation":"i"},{"strategy":"PATTERN","symbol":"DDD","company":"D","sector":"Energy","direction":"LONG","price":30,"entry":30,"stop":29,"target_1":31,"target_2":32,"atr":0.6,"atr_pct":2,"volume_ratio":2,"age_days":0,"scanner_score":60,"tag":"Pattern","detail":"Hammer on a breakout","exit_rule":"Leave at the stop, at target 1 or 2, when a day closes back under 28.5, or at the close of day 10.","alignment_score":100,"alignment_note":"Close beyond the 20-day high on 2x volume; market up.","id":"PATTERN:DDD:LONG","evidence":{"label":"Pattern","n":347,"win_rate_pct":55,"avg_win_pct":null,"avg_loss_pct":null,"ev_pct":-0.37,"experimental":true,"note":"Bullish candlestick pattern on a 20-day-high breakout with volume 1.4x average, 5-day hold with 2 ATR stop and 1 ATR target. It did worse than breakouts without a pattern (-0.2% to -0.5% per trade) and lost money in absolute terms."},"scanner_rank_in_list":1,"stop_pct":3.33,"stop_atr":1.67,"rr_t1":1,"rr_t2":2,"from_entry_atr":0,"stop_hit":false,"rules_score":40,"crowded":false,"rank":2,"score":40,"confidence":"Low","reason":"Pattern: backtest -0.37% per trade, 55% wins (347 trades) · R:R 1 to target 1 · 0 ATR from the entry · experimental, not recommended · not scored by the model","sources":["rules"],"bars":[{"d":"2026-11-06","o":1,"h":2,"l":0.5,"c":1.5}]}],"rejected":[{"id":"SUPERTREND:BBB:LONG","symbol":"BBB","strategy":"SUPERTREND","tag":"Supertrend","reason":"The stop is 40% from entry, wider than the 12% limit."},{"id":"SUPERTREND:AAA:LONG","symbol":"AAA","strategy":"SUPERTREND","tag":"Supertrend","reason":"skip"}],"data_gaps":["No earnings calendar or news feed is connected, so earnings or events inside the holding window are not checked.","Dollar volume is not in the data feed; liquidity is judged from the volume ratio only.","Backtest figures are per strategy, not per stock, and most were tested on the S&P 500 in a mostly rising market.","g"],"ordering_notes":"n","deep_dives":[],"method":"Rules: expected value from each scanner's backtest 35%, reward to risk 20%, trend and market alignment 15%, entry quality 15%, liquidity 10%, freshness 5%. Experimental and unproven scanners are penalised, negative-edge scanners are capped, and a third setup in the same sector and direction loses ground. Hard filters drop setups with a stop already hit, a stop wider than 12%, a chase of more than 1.5 ATR, or a stale signal. A Claude model then ranked the setups and wrote the reasons; every price comes from the scanners, not the model.","ai_generated_at":"t"}"#.utf8))
        XCTAssertEqual(ai.source, "ai")
        XCTAssertEqual(ai.items.first?.bull, "b")
        XCTAssertEqual(ai.items.first?.rrT1, 0.5)
        XCTAssertEqual(ai.items.first?.bars?.count, 1)
    }

    func testRankedIdeaDecodesInformationOnlyChartLabels() throws {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let item = #"{"strategy":"SUPERTREND","symbol":"AAA","company":"A Co","sector":"Tech","direction":"LONG","price":101,"entry":100,"stop":94,"target_1":null,"target_2":null,"atr":2.5,"atr_pct":2.5,"volume_ratio":null,"age_days":0,"scanner_score":80,"tag":"Supertrend","detail":"Strong fresh long entry","exit_rule":"x","alignment_score":100,"alignment_note":"n","currency_symbol":"$","price_decimals":2,"id":"SUPERTREND:AAA:LONG","evidence":{"label":"Supertrend","n":503,"win_rate_pct":45,"avg_win_pct":11.3,"avg_loss_pct":-6.2,"ev_pct":1.61,"experimental":false,"note":"n"},"scanner_rank_in_list":1,"stop_pct":6,"stop_atr":2.4,"rr_t1":null,"rr_t2":null,"from_entry_atr":0.4,"stop_hit":false,"rules_score":81.3,"crowded":false,"rank":1,"score":81.3,"confidence":"High","reason":"r","sources":["rules"]"#
        let labelled = try decoder.decode(RankedIdea.self, from: Data((item + #","chart_pattern":"Bull flag","chart_pattern_days_ago":1,"prior_run_up":true,"market_regime":"CORRECTION","spy_below_high_pct":7.4}"#).utf8))
        XCTAssertEqual(labelled.chartPattern, "Bull flag")
        XCTAssertEqual(labelled.labelChips, ["Bull flag · 1d ago", "Ran up 20%+ first", "Market in correction"])
        let today = try decoder.decode(RankedIdea.self, from: Data((item + #","chart_pattern":"Flat base","chart_pattern_days_ago":0,"prior_run_up":false,"market_regime":"NEAR_HIGHS"}"#).utf8))
        XCTAssertEqual(today.labelChips, ["Flat base · today", "Market near highs"])
        let old = try decoder.decode(RankedIdea.self, from: Data((item + "}").utf8))
        XCTAssertNil(old.chartPattern)
        XCTAssertTrue(old.labelChips.isEmpty, "an older payload without labels shows no chips")
    }

    func testHoldingDecodesProfitLockAndOldPayloads() throws {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let base = #"{"id":"h1","symbol":"AAA","market":"US","currency_symbol":"$","price_decimals":2,"shares":5,"buy_price":100,"bought_at":"2026-11-02","action":"TAKE_PROFIT","action_label":"Consider taking profit","headline":"h","reasons":["r"]"#
        let withLock = try decoder.decode(Holding.self, from: Data((base + #","profit_lock":{"armed":true,"level":101,"arm_price":103,"arm_pct":3,"lock_pct":1,"armed_on":"2026-11-04","hit":true,"touched_on":"2026-11-06","superseded":false}}"#).utf8))
        XCTAssertEqual(withLock.profitLock?.level, 101)
        XCTAssertEqual(withLock.profitLock?.hit, true)
        XCTAssertEqual(withLock.profitLock?.armedOn, "2026-11-04")
        let old = try decoder.decode(Holding.self, from: Data((base + "}").utf8))
        XCTAssertNil(old.profitLock, "an older payload without the lock still decodes")
    }

    func testLorentzianReadingDecodes() throws {
        let json = #"{"prediction":4,"neighbors":8,"signal":1,"filters_pass":false,"votes_long":6,"votes_short":2,"bars":251}"#
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let reading = try decoder.decode(LorentzianReading.self, from: Data(json.utf8))
        XCTAssertEqual(reading.prediction, 4)
        XCTAssertEqual(reading.votesLong, 6)
        XCTAssertFalse(reading.filtersPass)
    }

    func testFinishedIdeasDecode() throws {
        let json = #"[{"symbol":"AAA","market":"US","direction":"LONG","strategy":"SUPERTREND","opened_at":"2026-11-05T14:00:00Z","settled_at":"2026-11-09T14:35:00Z","entry_price":10,"exit_price":13.1,"return_pct":31.29,"stop_hit":false,"target_hit":false},{"symbol":"BBB","market":"US","direction":"SHORT","strategy":"SUPERTREND","opened_at":"2026-11-05T14:00:00Z","settled_at":null,"entry_price":10,"exit_price":null,"return_pct":null,"stop_hit":true,"target_hit":false}]"#
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let ideas = try decoder.decode([FinishedIdea].self, from: Data(json.utf8))
        XCTAssertEqual(ideas.count, 2)
        XCTAssertEqual(ideas[0].returnPct, 31.29)
        XCTAssertNil(ideas[1].returnPct, "a finished idea with no recorded return still decodes")
    }
}
