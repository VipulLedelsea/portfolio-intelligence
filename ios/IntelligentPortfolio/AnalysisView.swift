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
    @State private var chartMode = ChartMode.signal
    @State private var trailingInset: CGFloat = 0
    @Namespace private var railNamespace
    let candidate: Candidate
    /// When set, a glass back button sits beside the chart controls (sheet presentation).
    var onBack: (() -> Void)?

    /// iPhone Duo reserves a trailing strip for system status. When that strip is wide enough
    /// the rail lives in it, below the status icons, so the chart keeps the full content width.
    private var railInInset: Bool { trailingInset >= 56 }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            scrollContent
            if railInInset, model.analysis?.symbol == candidate.symbol, model.analysis?.chart != nil {
                HStack(spacing: 0) {
                    Spacer(minLength: 0)
                    chartRail.frame(width: trailingInset)
                }
                .padding(.top, 175)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                .ignoresSafeArea(.container, edges: .trailing)
            }
        }
        .background(AppTheme.background)
        .background(GeometryReader { proxy in
            Color.clear.preference(key: TrailingInsetKey.self, value: proxy.safeAreaInsets.trailing)
        })
        .onPreferenceChange(TrailingInsetKey.self) { trailingInset = $0 }
        .task(id: candidate.symbol) { await model.analyze(symbol: candidate.symbol) }
    }

    private var scrollContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
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
                            .frame(width: 52, height: 52)
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
        .frame(width: 56)
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
                .frame(width: 52, height: Self.itemHeight)
                .foregroundStyle(selected ? AppTheme.amber : Color.white.opacity(0.85))
                .background {
                    if selected {
                        RoundedRectangle(cornerRadius: 26)
                            .fill(Color.white.opacity(0.18))
                            .matchedGeometryEffect(id: "railHighlight", in: railNamespace)
                    }
                }
                .contentShape(RoundedRectangle(cornerRadius: 26))
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
                .font(.system(size: 30, weight: .bold, design: .monospaced))
                .foregroundStyle(analysis.direction == "SHORT" ? AppTheme.red : AppTheme.mint)
            Text(analysis.entryStatus.replacingOccurrences(of: "_", with: " "))
                .font(.caption.monospaced())
                .foregroundStyle(AppTheme.muted)
        }

        if let chart = analysis.chart {
            HStack(alignment: .top, spacing: 10) {
                Group {
                    switch chartMode {
                    case .signal:
                        CandlestickChart(series: chart.series, levels: chart.levels)
                            .aspectRatio(1.5, contentMode: .fit)
                            .frame(minHeight: 240, maxHeight: 440)
                            .panel()
                    case .hourly, .daily:
                        TradingViewChart(symbol: (Market(rawValue: analysis.market ?? "US") ?? .us).tradingViewSymbol(analysis.symbol), interval: chartMode == .daily ? "D" : "240")
                            .frame(height: 420)
                            .overlay(Rectangle().stroke(AppTheme.line, lineWidth: 1))
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
        }

        VStack(alignment: .leading, spacing: 10) {
            Text("RESEARCH CONCLUSION").font(.caption.monospaced().bold()).foregroundStyle(AppTheme.amber)
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
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
            level("Signal entry", format(levels.reference))
            level("Current", format(levels.current))
            level("Invalidation", format(levels.risk))
            level("Target 1", format(levels.target1))
            level("Target 2", format(levels.target2))
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

private struct CandlestickChart: View {
    let series: [Candle]
    let levels: ScenarioLevels

    var body: some View {
        Canvas { context, size in
            guard series.count > 1 else { return }
            let allPrices = series.flatMap { [$0.low, $0.high] } + [levels.risk, levels.reference, levels.target1, levels.target2]
            guard let low = allPrices.min(), let high = allPrices.max(), high > low else { return }
            let range = high - low
            let xStep = size.width / CGFloat(series.count - 1)
            let y: (Double) -> CGFloat = { value in size.height - CGFloat((value - low) / range) * size.height }

            for (index, candle) in series.enumerated() {
                let x = CGFloat(index) * xStep
                let color = candle.close >= candle.open ? AppTheme.mint : AppTheme.red
                var wick = Path()
                wick.move(to: CGPoint(x: x, y: y(candle.high)))
                wick.addLine(to: CGPoint(x: x, y: y(candle.low)))
                context.stroke(wick, with: .color(color), lineWidth: 1)
                let top = min(y(candle.open), y(candle.close))
                let height = max(1, abs(y(candle.open) - y(candle.close)))
                context.fill(Path(CGRect(x: x - max(1, xStep * 0.28), y: top, width: max(2, xStep * 0.56), height: height)), with: .color(color))
            }

            for (value, color) in [(levels.reference, AppTheme.amber), (levels.risk, AppTheme.red), (levels.target1, AppTheme.mint), (levels.target2, AppTheme.mint)] {
                var line = Path()
                line.move(to: CGPoint(x: 0, y: y(value)))
                line.addLine(to: CGPoint(x: size.width, y: y(value)))
                context.stroke(line, with: .color(color.opacity(0.8)), style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
            }
        }
        .accessibilityLabel("Candlestick chart with entry, invalidation, and target levels")
    }
}


private struct TrailingInsetKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}
