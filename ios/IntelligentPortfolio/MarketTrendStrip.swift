import SwiftUI

func trendColour(_ state: String) -> Color {
    switch state {
    case "UP": AppTheme.mint
    case "DOWN": AppTheme.red
    default: AppTheme.amber
    }
}

extension MarketTrend {
    /// A label short enough for the narrow strip.
    var shortLabel: String {
        switch indexSymbol {
        case "SPY": "S&P 500"
        case "QQQ": "NASDAQ"
        case "DIA": "DOW"
        case "IWM": "RUSSELL"
        case "^BSESN": "SENSEX"
        case "DX-Y.NYB": "DOLLAR"
        default: label.uppercased()
        }
    }

    var stateWord: String { state == "UP" ? "UP" : state == "DOWN" ? "DOWN" : "MIXED" }
    var symbolName: String { state == "UP" ? "arrow.up.right" : state == "DOWN" ? "arrow.down.right" : "arrow.left.and.right" }
}

private struct ArcShape: Shape {
    let from: Double
    let to: Double
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.addArc(center: CGPoint(x: rect.midX, y: rect.midY), radius: min(rect.width, rect.height) / 2,
                    startAngle: .degrees(from), endAngle: .degrees(to), clockwise: false)
        return path
    }
}

/// A glass ring split into Down, Mixed and Up with the current third lit and a trend arrow in the middle.
/// It stays put when the index changes: the lit third and the colours animate instead of a panel sliding away.
struct TrendRing: View {
    let trend: MarketTrend
    /// Grows by a full turn on every swipe, so the ring visibly spins even when two neighbours share a reading.
    let spin: Double
    /// Also grows by a full turn: the arrow flips like a coin, so it visibly changes even when the next index points the same way.
    let flip: Double

    var body: some View {
        ZStack {
            Circle().fill(.ultraThinMaterial)
            Circle().stroke(AppTheme.line, lineWidth: 1)
            ZStack {
                ForEach(["DOWN", "MIXED", "UP"], id: \.self) { state in
                    let angles: (Double, Double) = state == "DOWN" ? (100, 215) : state == "MIXED" ? (225, 315) : (325, 440)
                    ArcShape(from: angles.0, to: angles.1)
                        .stroke(trendColour(state), style: StrokeStyle(lineWidth: 4, lineCap: .butt))
                        .padding(5)
                        .opacity(state == trend.state ? 1 : 0.3)
                }
            }
            .rotationEffect(.degrees(spin))
            Image(systemName: trend.symbolName)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(trendColour(trend.state))
                .contentTransition(.symbolEffect(.replace))
                .rotation3DEffect(.degrees(flip), axis: (x: 0, y: 1, z: 0))
        }
        .frame(width: 54, height: 54)
    }
}

/// Fills the empty strip beside the content on the Duo. Swipe sideways to move between the US indexes (it wraps
/// around); tap for the detail. Only the ring's reading and the labels change, so nothing slides out of a box.
struct MarketTrendStrip: View {
    let trends: [MarketTrend]
    let onTap: (Int) -> Void
    @State private var page: Int
    @State private var spin = 0.0
    @State private var flip = 0.0

    init(trends: [MarketTrend], start: Int = 0, onTap: @escaping (Int) -> Void) {
        self.trends = trends
        self.onTap = onTap
        _page = State(initialValue: min(max(start, 0), max(trends.count - 1, 0)))
    }

    private var trend: MarketTrend { trends[min(page, trends.count - 1)] }

    var body: some View {
        VStack(spacing: 6) {
            VStack(spacing: 5) {
                Text(trend.shortLabel)
                    .font(.system(size: 9, weight: .semibold)).tracking(0.4)
                    .foregroundStyle(AppTheme.muted)
                    .id("label-\(page)")
                    .transition(.opacity.combined(with: .scale(scale: 0.7)))
                TrendRing(trend: trend, spin: spin, flip: flip)
                VStack(spacing: 2) {
                    Text(trend.stateWord)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(trendColour(trend.state))
                    VStack(spacing: 1) {
                        Text("ADX \(Int(trend.adx))")
                        if let breadth = trend.breadthDailyPct { Text("\(Int(breadth))% up") }
                    }
                    .font(.system(size: 9))
                    .foregroundStyle(AppTheme.muted)
                }
                .id("state-\(page)")
                .transition(.opacity.combined(with: .scale(scale: 0.7)))
            }
            .frame(height: 112)
            if trends.count > 1 {
                HStack(spacing: 5) {
                    ForEach(0..<trends.count, id: \.self) { index in
                        Circle().fill(index == page ? AppTheme.amber : AppTheme.line).frame(width: 5, height: 5)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
        .animation(.snappy(duration: 0.28), value: page)
        .animation(.snappy(duration: 0.5), value: spin)
        .animation(.snappy(duration: 0.55), value: flip)
        .contentShape(Rectangle())
        .onTapGesture { onTap(page) }
        .gesture(
            DragGesture(minimumDistance: 10).onEnded { drag in
                guard trends.count > 1, abs(drag.translation.width) > 18, abs(drag.translation.width) > abs(drag.translation.height) else { return }
                let forward = drag.translation.width < 0
                spin += forward ? 360 : -360
                flip += forward ? 360 : -360
                page = (page + (forward ? 1 : trends.count - 1)) % trends.count
            }
        )
        .sensoryFeedback(.selection, trigger: page)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Market trend, \(trend.label): \(trend.headline). Swipe sideways for other indexes.")
        .accessibilityAddTraits(.isButton)
        .accessibilityAdjustableAction { direction in
            guard trends.count > 1 else { return }
            spin += direction == .increment ? 360 : -360
            flip += direction == .increment ? 360 : -360
            page = direction == .increment ? (page + 1) % trends.count : (page + trends.count - 1) % trends.count
        }
    }
}

/// Borderless one-line version for narrow screens that have no empty strip.
struct MarketTrendLine: View {
    let trend: MarketTrend
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 8) {
                Circle().fill(trendColour(trend.state)).frame(width: 8, height: 8)
                Text("Market \(trend.stateWord.lowercased())").font(.footnote.bold())
                Text("· \(trend.label)\(trend.breadthDailyPct.map { " · \(Int($0))% of stocks up" } ?? "")")
                    .font(.footnote)
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(1)
                Spacer()
                Image(systemName: "chevron.right").font(.caption2).foregroundStyle(AppTheme.muted)
            }
            .padding(.vertical, 8)
            .overlay(alignment: .top) { Rectangle().fill(AppTheme.line).frame(height: 1) }
            .overlay(alignment: .bottom) { Rectangle().fill(AppTheme.line).frame(height: 1) }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Market trend, \(trend.label): \(trend.headline). Tap for details.")
    }
}

/// The detail for an index: its gauge card and a TradingView chart with the Supertrend. Swipe the picker to change index.
struct MarketTrendSheet: View {
    let trends: [MarketTrend]
    @State private var selection: Int
    @State private var interval = "240"
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    init(trends: [MarketTrend], start: Int) {
        self.trends = trends
        _selection = State(initialValue: min(max(start, 0), max(trends.count - 1, 0)))
    }

    private var chartSymbol: String {
        guard trends.indices.contains(selection) else { return "SPY" }
        switch trends[selection].indexSymbol {
        case "^BSESN": return "BSE:SENSEX"
        case "DX-Y.NYB": return "TVC:DXY"
        default: return trends[selection].indexSymbol
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if trends.count > 1 {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(Array(trends.enumerated()), id: \.offset) { index, trend in
                                    Button { selection = index } label: {
                                        Text(trend.label)
                                            .font(.footnote.bold())
                                            .padding(.horizontal, 12).padding(.vertical, 7)
                                            .foregroundStyle(index == selection ? AppTheme.background : .primary)
                                            .background(index == selection ? AppTheme.amber : AppTheme.panel)
                                            .overlay(Rectangle().stroke(AppTheme.line))
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                    if trends.indices.contains(selection) {
                        MarketTrendCard(trend: trends[selection])
                        Picker("Chart interval", selection: $interval) {
                            Text("4H").tag("240")
                            Text("Daily").tag("D")
                        }
                        .pickerStyle(.segmented)
                        TradingViewChart(symbol: chartSymbol, interval: interval)
                            .id("\(chartSymbol)-\(interval)")
                            .frame(height: 380)
                            .overlay(Rectangle().stroke(AppTheme.line, lineWidth: 1))
                        HStack {
                            Text("Chart by TradingView: Volume, Supertrend (10, 3) and a 9-period SMA.")
                                .font(.caption)
                                .foregroundStyle(AppTheme.muted)
                            Spacer()
                            if let url = TradingViewLink.url(symbol: chartSymbol, interval: interval) {
                                Button { openURL(url) } label: { Image(systemName: "arrow.up.right.square") }
                                    .accessibilityLabel("Open in TradingView")
                            }
                        }
                    }
                    Text("Each reading uses the index's daily and 4H Supertrend (10, 3) and ADX. Only the S&P 500 shows how many stocks are trending up. This is context, not personal financial advice.")
                        .font(.caption)
                        .foregroundStyle(AppTheme.muted)
                }
                .padding(16)
            }
            .background(AppTheme.background)
            .navigationTitle("Market trend")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .preferredColorScheme(.dark)
        .presentationDetents([.large])
    }
}
