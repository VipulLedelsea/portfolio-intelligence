import SwiftUI

/// Full-screen analysis presented as a sheet on narrow scenes.
struct AnalysisView: View {
    @Environment(\.dismiss) private var dismiss
    let candidate: Candidate

    var body: some View {
        NavigationStack {
            AnalysisContent(candidate: candidate, onBack: { dismiss() })
                .navigationTitle(candidate.symbol)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) { ReadOnlyBadge() }
                }
        }
    }
}

/// Analysis body shared by the sheet and the inline detail pane on wide scenes.
struct AnalysisContent: View {
    private enum ChartMode: String, CaseIterable, Identifiable {
        case signal = "Signal"
        case hourly = "TV 4H"
        case daily = "TV Daily"
        var id: String { rawValue }
        var icon: String {
            switch self {
            case .signal: "waveform.path.ecg"
            case .hourly: "clock"
            case .daily: "calendar"
            }
        }
        var railLabel: String {
            switch self {
            case .signal: "Signal"
            case .hourly: "4H"
            case .daily: "1D"
            }
        }
    }

    @EnvironmentObject private var model: AppModel
    @Environment(\.openURL) private var openURL
    @ScaledMetric(relativeTo: .caption) private var tileMinimum: CGFloat = 150
    @State private var chartMode = ChartMode.signal
    @State private var sideInsets = SideInsets()
    @Namespace private var railNamespace
    let candidate: Candidate
    /// When set, a glass back button sits beside the chart controls (sheet presentation).
    var onBack: (() -> Void)?

    /// iPhone Duo reserves a trailing strip for system status. When that strip is wide enough
    /// the rail lives in it, below the status icons, so the chart keeps the full content width.
    private var railInInset: Bool { sideInsets.strip != nil }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            scrollContent
            if let strip = sideInsets.strip, model.analysis?.symbol == candidate.symbol, model.analysis?.chart != nil {
                SideStrip(edge: strip.edge, width: strip.width, top: 175) { chartRail }
            }
        }
        .background(AppTheme.background)
        .reportSideInsets { sideInsets = $0 }
        .task(id: candidate.symbol) { await model.analyze(symbol: candidate.symbol) }
    }

    private var scrollContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                EntryDetails(candidate: candidate)
                if model.isAnalyzing {
                    ProgressView("Running analyst committee…")
                        .tint(AppTheme.amber)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 80)
                } else if let analysis = model.analysis, analysis.symbol == candidate.symbol {
                    analysisBody(analysis)
                }
            }
            .padding(16)
            .readableWidth()
        }
    }

    /// Vertical glass rail to the right of the chart: back button on top, chart modes below.
    private var chartRail: some View {
        railContainer {
            VStack(spacing: 10) {
                if let onBack {
                    Button(action: onBack) {
                        Image(systemName: "chevron.left")
                            .font(.headline)
                            .frame(width: AdaptiveLayout.sidePillWidth, height: AdaptiveLayout.sidePillWidth)
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.white)
                    .glass(Circle())
                    .accessibilityLabel("Back to scanner")
                }
                modeBar
            }
        }
        .frame(width: AdaptiveLayout.sidePillWidth)
    }

    private static let itemHeight: CGFloat = 58
    private static let itemSpacing: CGFloat = 4
    private static let barPadding: CGFloat = 4

    /// Tab-bar style selector: a highlight glides between items with a springy overshoot,
    /// and a finger dragged along the bar switches modes as it passes each item.
    private var modeBar: some View {
        VStack(spacing: Self.itemSpacing) {
            ForEach(ChartMode.allCases) { mode in
                let selected = chartMode == mode
                VStack(spacing: 3) {
                    Image(systemName: mode.icon).font(.title3)
                    Text(mode.railLabel).font(.caption2.weight(selected ? .semibold : .regular))
                }
                .frame(width: AdaptiveLayout.sidePillWidth - 2 * Self.barPadding, height: Self.itemHeight)
                .foregroundStyle(selected ? AppTheme.amber : Color.white.opacity(0.85))
                .background {
                    if selected {
                        RoundedRectangle(cornerRadius: 20)
                            .fill(Color.white.opacity(0.18))
                            .matchedGeometryEffect(id: "railHighlight", in: railNamespace)
                    }
                }
                .contentShape(RoundedRectangle(cornerRadius: 20))
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(mode.rawValue)
                .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
                .accessibilityAction { select(mode) }
            }
        }
        .padding(Self.barPadding)
        .glass(RoundedRectangle(cornerRadius: 30))
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    let step = Self.itemHeight + Self.itemSpacing
                    let index = Int(((value.location.y - Self.barPadding) / step).rounded(.down))
                    let modes = ChartMode.allCases
                    select(modes[min(max(index, 0), modes.count - 1)])
                }
        )
    }

    private func select(_ mode: ChartMode) {
        guard mode != chartMode else { return }
        UISelectionFeedbackGenerator().selectionChanged()
        withAnimation(.spring(response: 0.42, dampingFraction: 0.7)) { chartMode = mode }
    }

    @ViewBuilder
    private func railContainer<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 12) { content() }
        } else {
            content()
        }
    }

    @ViewBuilder
    private func analysisBody(_ analysis: AnalysisResponse) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(analysis.direction) · \(analysis.action)")
                .font(.system(size: 30, weight: .bold, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .foregroundStyle(analysis.direction == "SHORT" ? AppTheme.red : AppTheme.mint)
            Text(analysis.entryStatus.replacingOccurrences(of: "_", with: " "))
                .font(.caption)
                .foregroundStyle(AppTheme.muted)
        }

        if let chart = analysis.chart {
            HStack(alignment: .top, spacing: 10) {
                Group {
                    switch chartMode {
                    case .signal:
                        CandlestickChart(series: chart.series, levels: chart.levels, referenceLines: chart.referenceLines ?? [])
                            .aspectRatio(1.5, contentMode: .fit)
                            .frame(minHeight: 240, maxHeight: 440)
                            .panel()
                    case .hourly, .daily:
                        TradingViewChart(symbol: (Market(rawValue: analysis.market ?? "US") ?? .us).tradingViewSymbol(analysis.symbol), interval: chartMode == .daily ? "D" : "240")
                            .frame(height: 420)
                            .overlay(RoundedRectangle(cornerRadius: AppTheme.radiusSmall, style: .continuous).stroke(AppTheme.hairline, lineWidth: 1))
                    }
                }
                .frame(maxWidth: .infinity)
                if !railInInset { chartRail }
            }
            if chartMode != .signal {
                Text("Chart by TradingView: Volume, Supertrend (10, 3), and a 9-period SMA. Supertrend can differ slightly from the engine's signal. Entry, risk, and targets appear on the Signal chart.")
                    .font(.caption)
                    .foregroundStyle(AppTheme.muted)
                if let url = TradingViewLink.url(symbol: (Market(rawValue: analysis.market ?? "US") ?? .us).tradingViewSymbol(analysis.symbol), interval: chartMode == .daily ? "D" : "240") {
                    Button { openURL(url) } label: {
                        Label("Open in TradingView", systemImage: "arrow.up.right.square")
                    }
                    .buttonStyle(.bordered)
                    .tint(AppTheme.amber)
                }
            }
            levels(chart.levels, analysis: analysis)
            ReferenceLinesList(lines: chart.referenceLines ?? [], currency: analysis.currencySymbol, decimals: analysis.priceDecimals)
        }

        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Research conclusion")
            Text(analysis.thesis)
            if !analysis.vetoReasons.isEmpty {
                Text(analysis.vetoReasons.joined(separator: " · ")).foregroundStyle(AppTheme.red)
            }
            if !analysis.contextWarnings.isEmpty {
                Text(analysis.contextWarnings.joined(separator: " · ")).foregroundStyle(AppTheme.muted)
            }
        }
        .panel()

        VStack(spacing: 0) {
            gate("Daily structure", value: analysis.dailyAligned ? "ALIGNED" : "CONFLICT", pass: analysis.dailyAligned)
            gate("Trend strength", value: String(format: "ADX %.1f", analysis.dailyAdx), pass: analysis.regimeEligible)
            gate("Entry timing", value: analysis.entryStatus.replacingOccurrences(of: "_", with: " "), pass: analysis.entryStatus == "ENTRY_WINDOW")
            gate("Risk review", value: analysis.approved ? "CLEARED" : "VETO", pass: analysis.approved)
        }
        .panel()
    }

    @ViewBuilder
    private func levels(_ levels: ScenarioLevels, analysis: AnalysisResponse) -> some View {
        let format: (Double) -> String = { PriceFormat.string($0, prefix: analysis.currencySymbol, decimals: analysis.priceDecimals) }
        LazyVGrid(columns: [GridItem(.adaptive(minimum: tileMinimum), spacing: 10)], spacing: 10) {
            level("Signal entry", format(levels.reference))
            level("Current", format(levels.current))
            level("Exit line (daily Supertrend)", format(levels.risk))
            level("Profit zone 1 (optional)", format(levels.target1))
            level("Profit zone 2 (optional)", format(levels.target2))
        }
    }

    private func level(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading) {
            Text(title.uppercased()).font(.caption2).foregroundStyle(AppTheme.muted)
            Text(value).font(.headline.monospaced())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }

    private func gate(_ title: String, value: String, pass: Bool) -> some View {
        HStack {
            Image(systemName: pass ? "checkmark.circle.fill" : "xmark.circle.fill")
                .foregroundStyle(pass ? AppTheme.mint : AppTheme.red)
            Text(title)
            Spacer()
            Text(value).font(.caption.monospaced().bold()).foregroundStyle(AppTheme.muted)
        }
        .padding(.vertical, 8)
    }
}

/// Chart lines that give context (20-day low, recent highs, moving averages) but do not set any level.
struct ReferenceLinesList: View {
    let lines: [ReferenceLine]
    let currency: String?
    let decimals: Int?
    var body: some View {
        if !lines.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(text: "Chart reference · does not set the levels")
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], alignment: .leading, spacing: 6) {
                    ForEach(lines) { line in
                        HStack {
                            Text(line.label).font(.caption).foregroundStyle(AppTheme.muted)
                            Spacer(minLength: 4)
                            Text(PriceFormat.string(line.value, prefix: currency, decimals: decimals)).font(.caption.monospaced())
                        }
                    }
                }
                Text("Backtests found stops under swing lows and targets at prior highs did worse than the volatility-based levels, so these are for reading the chart only.")
                    .font(.caption2).foregroundStyle(AppTheme.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .panel()
        }
    }
}

/// One candle's Lorentzian reading: the prediction (-8 to +8), the indicator's own signal (1 long, -1 short, 0 none) and whether the signal just flipped.
struct LorentzianBar: Equatable {
    let p: Int
    let signal: Int
    let flip: Bool
}

/// The Lorentzian Classification drawn over the candles, as TradingView does: candles tinted by the lean, arrows where the signal flips,
/// the Nadaraya-Watson kernel line, and a badge with the latest reading. Information only, so it stays muted and is off until asked for.
struct LorentzianOverlay {
    let bars: [LorentzianBar?]
    let kernel: [Double]
    let neighbors: Int
    let prediction: Int
    let filtersPass: Bool

    /// One entry per candle, matched by date; nil where the indicator has no reading for that candle. Nil overall if nothing matches.
    static func make(_ reading: LorentzianReading, candles: [Candle]) -> LorentzianOverlay? {
        guard let history = reading.history, !history.isEmpty, candles.count > 1 else { return nil }
        let byDate = Dictionary(history.compactMap { day in day.d.map { ($0, day) } }, uniquingKeysWith: { a, _ in a })
        var previous: Int?
        let mapped: [LorentzianBar?] = candles.map { candle in
            guard let day = byDate[candle.date] else { return nil }
            defer { previous = day.s }
            return LorentzianBar(p: day.p, signal: day.s, flip: previous != nil && previous != day.s && day.s != 0)
        }
        guard mapped.contains(where: { $0 != nil }) else { return nil }
        return LorentzianOverlay(bars: mapped, kernel: kernelLine(candles.map(\.close)), neighbors: reading.neighbors,
                                 prediction: reading.prediction, filtersPass: reading.filtersPass)
    }

    /// The indicator's kernel estimate (rational quadratic, lookback 8, relative weight 8), using each bar and the bars before it.
    static func kernelLine(_ closes: [Double]) -> [Double] {
        let h = 8.0, r = 8.0
        let weights = (0..<80).map { j in pow(1 + Double(j * j) / (h * h * 2 * r), -r) }
        return closes.indices.map { i in
            var num = 0.0, den = 0.0
            for j in 0...min(i, weights.count - 1) { num += closes[i - j] * weights[j]; den += weights[j] }
            return num / den
        }
    }

    func lean(_ bar: LorentzianBar) -> Color { bar.p > 0 ? AppTheme.mint : bar.p < 0 ? AppTheme.red : AppTheme.muted }
    func strength(_ bar: LorentzianBar) -> Double { bar.p == 0 ? 0.5 : 0.4 + 0.6 * Double(abs(bar.p)) / Double(max(neighbors, 1)) }
}

struct CandlestickChart: View {
    let series: [Candle]
    let levels: ScenarioLevels
    var referenceLines: [ReferenceLine] = []
    var lorentzian: LorentzianOverlay? = nil

    var body: some View {
        Canvas { context, size in
            guard series.count > 1 else { return }
            let basePrices = series.flatMap { [$0.low, $0.high] } + [levels.risk, levels.reference, levels.target1, levels.target2]
            guard let baseLow = basePrices.min(), let baseHigh = basePrices.max(), baseHigh > baseLow else { return }
            // Only reference lines near the visible prices are drawn, so a distant average never squashes the candles.
            let pad = (baseHigh - baseLow) * 0.2
            let shown = referenceLines.filter { $0.value >= baseLow - pad && $0.value <= baseHigh + pad }
            let allPrices = basePrices + shown.map(\.value)
            guard var low = allPrices.min(), var high = allPrices.max(), high > low else { return }
            if lorentzian != nil { let room = (high - low) * 0.06; low -= room; high += room } // space for the flip arrows
            let range = high - low
            let xStep = size.width / CGFloat(series.count - 1)
            let y: (Double) -> CGFloat = { value in size.height - CGFloat((value - low) / range) * size.height }

            for (index, candle) in series.enumerated() {
                let x = CGFloat(index) * xStep
                let up = candle.close >= candle.open
                var color = up ? AppTheme.mint : AppTheme.red
                if let overlay = lorentzian, index < overlay.bars.count, let bar = overlay.bars[index] {
                    color = overlay.lean(bar).opacity(overlay.strength(bar))
                } else if lorentzian != nil {
                    color = AppTheme.muted.opacity(0.35)
                }
                var wick = Path()
                wick.move(to: CGPoint(x: x, y: y(candle.high)))
                wick.addLine(to: CGPoint(x: x, y: y(candle.low)))
                context.stroke(wick, with: .color(color), lineWidth: 1)
                let top = min(y(candle.open), y(candle.close))
                let height = max(1, abs(y(candle.open) - y(candle.close)))
                let body = Path(CGRect(x: x - max(1, xStep * 0.28), y: top, width: max(2, xStep * 0.56), height: height))
                if lorentzian != nil && !up { // tinted candles show up and down as filled and hollow
                    context.fill(body, with: .color(color.opacity(0.3)))
                    context.stroke(body, with: .color(color), lineWidth: 1)
                } else {
                    context.fill(body, with: .color(color))
                }
            }

            if let overlay = lorentzian {
                // Kernel line: teal while it rises, red while it falls.
                for index in 1..<min(series.count, overlay.kernel.count) {
                    var segment = Path()
                    segment.move(to: CGPoint(x: CGFloat(index - 1) * xStep, y: y(overlay.kernel[index - 1])))
                    segment.addLine(to: CGPoint(x: CGFloat(index) * xStep, y: y(overlay.kernel[index])))
                    let rising = overlay.kernel[index] >= overlay.kernel[index - 1]
                    context.stroke(segment, with: .color((rising ? AppTheme.mint : AppTheme.red).opacity(0.9)), style: StrokeStyle(lineWidth: 1.6, lineCap: .round))
                }
                // Arrows where the indicator's own signal flips: up under the bar for long, down over it for short.
                for (index, candle) in series.enumerated() where index < overlay.bars.count {
                    guard let bar = overlay.bars[index], bar.flip else { continue }
                    let x = CGFloat(index) * xStep
                    var arrow = Path()
                    if bar.signal > 0 {
                        let base = y(candle.low)
                        arrow.move(to: CGPoint(x: x, y: base + 3)); arrow.addLine(to: CGPoint(x: x - 4.5, y: base + 11)); arrow.addLine(to: CGPoint(x: x + 4.5, y: base + 11))
                    } else {
                        let base = y(candle.high)
                        arrow.move(to: CGPoint(x: x, y: base - 3)); arrow.addLine(to: CGPoint(x: x - 4.5, y: base - 11)); arrow.addLine(to: CGPoint(x: x + 4.5, y: base - 11))
                    }
                    arrow.closeSubpath()
                    context.fill(arrow, with: .color(bar.signal > 0 ? AppTheme.mint : AppTheme.red))
                }
                // Badge with the latest reading.
                let lean = overlay.prediction > 0 ? "long" : overlay.prediction < 0 ? "short" : "no lean"
                let label = "Lorentzian \(String(format: "%+d", overlay.prediction)) \(lean)" + (overlay.filtersPass ? "" : " · filters off")
                let tint = overlay.prediction > 0 ? AppTheme.mint : overlay.prediction < 0 ? AppTheme.red : AppTheme.muted
                let text = context.resolve(Text(label).font(.system(size: 10, weight: .semibold)).foregroundColor(tint))
                let measured = text.measure(in: size)
                let pill = CGRect(x: 4, y: 4, width: measured.width + 12, height: measured.height + 6)
                context.fill(Path(roundedRect: pill, cornerRadius: pill.height / 2), with: .color(AppTheme.panel.opacity(0.9)))
                context.stroke(Path(roundedRect: pill, cornerRadius: pill.height / 2), with: .color(tint.opacity(0.5)), lineWidth: 1)
                context.draw(text, at: CGPoint(x: pill.midX, y: pill.midY), anchor: .center)
            }

            for (value, color) in [(levels.reference, AppTheme.amber), (levels.risk, AppTheme.red), (levels.target1, AppTheme.mint), (levels.target2, AppTheme.mint)] {
                var line = Path()
                line.move(to: CGPoint(x: 0, y: y(value)))
                line.addLine(to: CGPoint(x: size.width, y: y(value)))
                context.stroke(line, with: .color(color.opacity(0.8)), style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
            }

            for line in shown {
                var path = Path()
                path.move(to: CGPoint(x: 0, y: y(line.value)))
                path.addLine(to: CGPoint(x: size.width, y: y(line.value)))
                context.stroke(path, with: .color(AppTheme.sky.opacity(0.55)), style: StrokeStyle(lineWidth: 1, dash: [2, 3]))
                context.draw(Text(line.label).font(.system(size: 9)).foregroundColor(AppTheme.sky), at: CGPoint(x: size.width - 4, y: y(line.value) - 6), anchor: .trailing)
            }
        }
        .accessibilityLabel("Candlestick chart with entry, invalidation, and target levels")
    }
}


/// What the scanner row leaves out: the full buy range, when the entry window closes, and the daily trend read.
struct EntryDetails: View {
    let candidate: Candidate

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let range = candidate.buyRange {
                BuyRangeBar(range: range, currency: candidate.currencySymbol, decimals: candidate.priceDecimals)
            }
            if let closing = candidate.windowClosesAt.flatMap(PairingExpiryParser.date(from:)) {
                Label("Entry window closes \(timeText(closing)) · \(leftText(closing))", systemImage: "timer")
                    .font(.caption)
                    .foregroundStyle(AppTheme.amber)
            }
            Text("Daily \(candidate.dailySupertrendDirection) · ADX \(candidate.dailyAdx, specifier: "%.1f") \(candidate.dailyAdxRising ? "rising" : "fading") · \(candidate.extensionAtr, specifier: "%+.2f") ATR from the signal")
                .font(.caption)
                .foregroundStyle(AppTheme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }
}
