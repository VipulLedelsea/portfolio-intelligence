import SwiftUI

/// A TradingView-style chart drawn natively so it can show the Supertrend strategy replay, which
/// TradingView's free embedded widget cannot: candles, volume, Supertrend (10, 3), SMA 9, Long/Short
/// entries with P&L, and the open trade shaded green or red. Research replay only; no orders exist.
struct TradingStyleChart: View {
    let series: [Candle]
    let strategy: StrategyPayload?
    var decimals: Int = 2
    var prefix: String = ""

    private static let up = Color(red: 0.15, green: 0.65, blue: 0.60)
    private static let down = Color(red: 0.94, green: 0.33, blue: 0.31)
    private static let sma = Color(red: 0.16, green: 0.38, blue: 1.0)
    private static let longMark = Color(red: 0.36, green: 0.55, blue: 1.0)
    private static let shortMark = Color(red: 1.0, green: 0.30, blue: 0.43)
    private static let axisWidth: CGFloat = 54

    var body: some View {
        Canvas { context, size in
            guard series.count > 1 else { return }
            var context = context
            draw(&context, size)
        }
        .background(Color(red: 0.075, green: 0.09, blue: 0.13))
        .overlay(Rectangle().stroke(AppTheme.line, lineWidth: 1))
        .accessibilityLabel("Candlestick chart with volume, Supertrend, SMA, and strategy entries")
    }

    private func format(_ value: Double) -> String { prefix + String(format: "%.\(decimals)f", value) }

    private func smaValues(period: Int = 9) -> [Double?] {
        series.indices.map { index in
            guard index >= period - 1 else { return nil }
            return series[(index - period + 1)...index].reduce(0) { $0 + $1.close } / Double(period)
        }
    }

    private func draw(_ context: inout GraphicsContext, _ size: CGSize) {
        let plotWidth = size.width - Self.axisWidth
        let volumeBand = size.height * 0.16
        let priceTop: CGFloat = 70
        let priceBottom = size.height - volumeBand - 10
        let sma = smaValues()
        let extra = series.compactMap(\.supertrend) + sma.compactMap { $0 }
        guard let low = (series.map(\.low) + extra).min(), let high = (series.map(\.high) + extra).max(), high > low else { return }
        let slot = plotWidth / CGFloat(series.count + 3)
        let x: (Int) -> CGFloat = { slot * (CGFloat($0) + 0.5) }
        let y: (Double) -> CGFloat = { priceBottom - CGFloat(($0 - low) / (high - low)) * (priceBottom - priceTop) }
        let indexByDate = Dictionary(series.enumerated().map { ($0.element.date, $0.offset) }, uniquingKeysWith: { first, _ in first })
        let last = series[series.count - 1]

        // Grid and price axis.
        for step in 0...4 {
            let value = low + (high - low) * Double(step) / 4
            var line = Path()
            line.move(to: CGPoint(x: 0, y: y(value)))
            line.addLine(to: CGPoint(x: plotWidth, y: y(value)))
            context.stroke(line, with: .color(Color.white.opacity(0.06)), lineWidth: 1)
            context.draw(Text(format(value)).font(.system(size: 10)).foregroundColor(AppTheme.muted),
                         at: CGPoint(x: size.width - 4, y: y(value)), anchor: .trailing)
        }

        // Volume bars along the bottom (hidden when the market reports no volume, such as forex).
        let maxVolume = series.compactMap(\.volume).max() ?? 0
        if maxVolume > 0 {
            for (index, candle) in series.enumerated() {
                let height = CGFloat((candle.volume ?? 0) / maxVolume) * volumeBand
                let color = candle.close >= candle.open ? Self.up : Self.down
                context.fill(Path(CGRect(x: x(index) - slot * 0.35, y: size.height - height, width: slot * 0.7, height: height)), with: .color(color.opacity(0.4)))
            }
        }

        // Supertrend fill and line, green while long and red while short.
        for direction in ["LONG", "SHORT"] {
            let color = direction == "LONG" ? Self.up : Self.down
            var run: [Int] = []
            func flush() {
                guard run.count > 1 else { run = []; return }
                var fill = Path()
                fill.move(to: CGPoint(x: x(run[0]), y: y(series[run[0]].supertrend ?? series[run[0]].close)))
                for index in run.dropFirst() { fill.addLine(to: CGPoint(x: x(index), y: y(series[index].supertrend ?? series[index].close))) }
                for index in run.reversed() { fill.addLine(to: CGPoint(x: x(index), y: y((series[index].open + series[index].close) / 2))) }
                fill.closeSubpath()
                context.fill(fill, with: .color(color.opacity(0.14)))
                var line = Path()
                line.move(to: CGPoint(x: x(run[0]), y: y(series[run[0]].supertrend ?? series[run[0]].close)))
                for index in run.dropFirst() { line.addLine(to: CGPoint(x: x(index), y: y(series[index].supertrend ?? series[index].close))) }
                context.stroke(line, with: .color(color), lineWidth: 1.6)
                run = []
            }
            for (index, candle) in series.enumerated() {
                if candle.supertrendDirection == direction, candle.supertrend != nil { run.append(index) } else { flush() }
            }
            flush()
        }

        // The open strategy trade, shaded from its entry to the latest close.
        if let open = strategy?.open, let start = indexByDate[open.entryDate] {
            let entryY = y(open.entryPrice), lastY = y(last.close)
            let profit = open.pnlPct >= 0
            context.fill(Path(CGRect(x: x(start) - slot / 2, y: min(entryY, lastY), width: plotWidth - (x(start) - slot / 2), height: max(1, abs(entryY - lastY)))),
                         with: .color((profit ? Self.up : Self.down).opacity(0.22)))
        }

        for (index, candle) in series.enumerated() {
            let color = candle.close >= candle.open ? Self.up : Self.down
            var wick = Path()
            wick.move(to: CGPoint(x: x(index), y: y(candle.high)))
            wick.addLine(to: CGPoint(x: x(index), y: y(candle.low)))
            context.stroke(wick, with: .color(color), lineWidth: 1)
            let top = min(y(candle.open), y(candle.close))
            context.fill(Path(CGRect(x: x(index) - slot * 0.35, y: top, width: max(1.5, slot * 0.7), height: max(1, abs(y(candle.open) - y(candle.close))))), with: .color(color))
        }

        var smaLine = Path()
        var started = false
        for (index, value) in sma.enumerated() {
            guard let value else { continue }
            let point = CGPoint(x: x(index), y: y(value))
            if started { smaLine.addLine(to: point) } else { smaLine.move(to: point); started = true }
        }
        context.stroke(smaLine, with: .color(Self.sma), lineWidth: 1.2)

        // Strategy entries with Long/Short labels, and the P&L where each trade closed.
        func arrow(_ date: String, _ side: String) {
            guard let index = indexByDate[date] else { return }
            let long = side == "LONG"
            let color = long ? Self.longMark : Self.shortMark
            let base = long ? y(series[index].low) + 5 : y(series[index].high) - 5
            let dir: CGFloat = long ? 1 : -1
            var triangle = Path()
            triangle.move(to: CGPoint(x: x(index), y: base))
            triangle.addLine(to: CGPoint(x: x(index) - 5, y: base + 10 * dir))
            triangle.addLine(to: CGPoint(x: x(index) + 5, y: base + 10 * dir))
            triangle.closeSubpath()
            context.fill(triangle, with: .color(color))
            context.draw(Text(long ? "Long" : "Short").font(.system(size: 9, weight: .bold)).foregroundColor(color),
                         at: CGPoint(x: min(max(x(index), 16), plotWidth - 16), y: base + 21 * dir))
        }
        for trade in strategy?.trades ?? [] {
            arrow(trade.entryDate, trade.side)
            if let index = indexByDate[trade.exitDate] {
                context.draw(Text(String(format: "%+.1f%%", trade.pnlPct)).font(.system(size: 10, weight: .bold)).foregroundColor(trade.pnlPct >= 0 ? Self.up : Self.down),
                             at: CGPoint(x: min(max(x(index), 20), plotWidth - 20), y: max(priceTop - 8, y(series[index].high) - 14)))
            }
        }
        if let open = strategy?.open { arrow(open.entryDate, open.side) }

        // Last-price line and tag.
        let lastColor = last.close >= last.open ? Self.up : Self.down
        var lastLine = Path()
        lastLine.move(to: CGPoint(x: 0, y: y(last.close)))
        lastLine.addLine(to: CGPoint(x: plotWidth, y: y(last.close)))
        context.stroke(lastLine, with: .color(lastColor.opacity(0.7)), style: StrokeStyle(lineWidth: 1, dash: [2, 3]))
        let tag = CGRect(x: plotWidth + 2, y: y(last.close) - 9, width: Self.axisWidth - 2, height: 18)
        context.fill(Path(roundedRect: tag, cornerRadius: 2), with: .color(lastColor))
        context.draw(Text(format(last.close)).font(.system(size: 10, weight: .semibold)).foregroundColor(.white), at: CGPoint(x: tag.midX, y: tag.midY))

        // Legend, like TradingView's indicator rows.
        let name = strategy?.name ?? "Supertrend (10, 3)"
        let rows = [
            "O \(format(last.open))  H \(format(last.high))  L \(format(last.low))  C \(format(last.close))",
            maxVolume > 0 ? "Vol \(Int(last.volume ?? 0).formatted(.number.notation(.compactName)))" : "",
            "\(name)",
            "SMA 9 close \(format(sma.last.flatMap { $0 } ?? last.close))",
        ].filter { !$0.isEmpty }
        for (index, row) in rows.enumerated() {
            context.draw(Text(row).font(.system(size: 10)).foregroundColor(index == rows.count - 1 ? Self.sma : AppTheme.muted),
                         at: CGPoint(x: 6, y: 8 + CGFloat(index) * 13), anchor: .leading)
        }
        if let strategy, !(strategy.trades.isEmpty && strategy.open == nil) {
            var summary = "\(strategy.trades.count) closed, net \(String(format: "%+.1f%%", strategy.closedPnlPct))"
            if let open = strategy.open { summary += " · open \(open.side.lowercased()) \(String(format: "%+.1f%%", open.pnlPct))" }
            context.draw(Text(summary).font(.system(size: 10)).foregroundColor(AppTheme.muted), at: CGPoint(x: plotWidth - 4, y: 8), anchor: .trailing)
        }
    }
}
