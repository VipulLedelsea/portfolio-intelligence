import SwiftUI

private func trendColour(_ state: String) -> Color {
    switch state {
    case "UP": AppTheme.mint
    case "DOWN": AppTheme.red
    default: AppTheme.amber
    }
}

private extension MarketTrend {
    /// A label short enough for the narrow strip.
    var shortLabel: String {
        switch indexSymbol {
        case "SPY": "S&P 500"
        case "QQQ": "NASDAQ"
        case "DIA": "DOW"
        case "IWM": "RUSSELL"
        case "^BSESN": "SENSEX"
        default: label.uppercased()
        }
    }

    var stateWord: String { state == "UP" ? "UP" : state == "DOWN" ? "DOWN" : "MIXED" }
    var symbolName: String { state == "UP" ? "arrow.up.right" : state == "DOWN" ? "arrow.down.right" : "arrow.left.and.right" }
}

/// A glass ring split into Down, Mixed and Up with the current third lit and a trend arrow in the middle.
private struct TrendRing: View {
    let trend: MarketTrend

    var body: some View {
        ZStack {
            Circle().fill(.ultraThinMaterial)
            Circle().stroke(AppTheme.line, lineWidth: 1)
            Canvas { context, size in
                let centre = CGPoint(x: size.width / 2, y: size.height / 2)
                let radius = min(size.width, size.height) / 2 - 5
                let parts: [(String, Double, Double)] = [("DOWN", 100, 215), ("MIXED", 225, 315), ("UP", 325, 440)]
                for (state, from, to) in parts {
                    var arc = Path()
                    arc.addArc(center: centre, radius: radius, startAngle: .degrees(from), endAngle: .degrees(to), clockwise: false)
                    context.stroke(arc, with: .color(trendColour(state).opacity(state == trend.state ? 1 : 0.3)), style: StrokeStyle(lineWidth: 4, lineCap: .butt))
                }
            }
            Image(systemName: trend.symbolName)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(trendColour(trend.state))
        }
        .frame(width: 54, height: 54)
    }
}

/// Fills the empty strip beside the content on the Duo. Swipe sideways to move between the US indexes; tap for the detail.
struct MarketTrendStrip: View {
    let trends: [MarketTrend]
    let onTap: (Int) -> Void
    @State private var page = 0

    var body: some View {
        VStack(spacing: 6) {
            TabView(selection: $page) {
                ForEach(Array(trends.enumerated()), id: \.offset) { index, trend in
                    VStack(spacing: 5) {
                        Text(trend.shortLabel).font(.system(size: 9, weight: .semibold)).tracking(0.4).foregroundStyle(AppTheme.muted)
                        TrendRing(trend: trend)
                        Text(trend.stateWord).font(.system(size: 11, weight: .semibold)).foregroundStyle(trendColour(trend.state))
                        VStack(spacing: 1) {
                            Text("ADX \(Int(trend.adx))")
                            if let breadth = trend.breadthDailyPct { Text("\(Int(breadth))% up") }
                        }
                        .font(.system(size: 9))
                        .foregroundStyle(AppTheme.muted)
                    }
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                    .onTapGesture { onTap(index) }
                    .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .frame(height: 124)
            if trends.count > 1 {
                HStack(spacing: 5) {
                    ForEach(0..<trends.count, id: \.self) { index in
                        Circle().fill(index == page ? AppTheme.amber : AppTheme.line).frame(width: 5, height: 5)
                    }
                }
            }
        }
        .sensoryFeedback(.selection, trigger: page)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(trends.indices.contains(page) ? "Market trend, \(trends[page].label): \(trends[page].headline). Swipe sideways for other indexes." : "Market trend")
        .accessibilityAddTraits(.isButton)
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
        return trends[selection].indexSymbol == "^BSESN" ? "BSE:SENSEX" : trends[selection].indexSymbol
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if trends.count > 1 {
                        Picker("Index", selection: $selection) {
                            ForEach(Array(trends.enumerated()), id: \.offset) { index, trend in Text(trend.label).tag(index) }
                        }
                        .pickerStyle(.segmented)
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
