import SwiftUI

/// The Down / Mixed / Up gauge with the facts behind it, shown above the scanner and in each portfolio market.
struct MarketTrendCard: View {
    let trend: MarketTrend

    private func colour(_ state: String) -> Color {
        switch state {
        case "UP": AppTheme.mint
        case "DOWN": AppTheme.red
        default: AppTheme.amber
        }
    }

    var body: some View {
        let tint = colour(trend.state)
        VStack(alignment: .leading, spacing: 8) {
            Text("MARKET TREND · \(trend.label.uppercased())")
                .font(.caption2.bold())
                .tracking(0.8)
                .foregroundStyle(AppTheme.muted)
            HStack(spacing: 3) {
                ForEach(["DOWN", "MIXED", "UP"], id: \.self) { state in
                    Rectangle()
                        .fill(colour(state))
                        .opacity(state == trend.state ? 1 : 0.3)
                        .frame(height: 8)
                }
            }
            HStack {
                Text("Down").foregroundStyle(trend.state == "DOWN" ? tint : AppTheme.muted)
                Spacer()
                Text("Mixed").foregroundStyle(trend.state == "MIXED" ? tint : AppTheme.muted)
                Spacer()
                Text("Up").foregroundStyle(trend.state == "UP" ? tint : AppTheme.muted)
            }
            .font(.caption2)
            Text(trend.headline).font(.headline)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 6, alignment: .leading)], alignment: .leading, spacing: 6) {
                chip("Daily \(trend.daily == "UP" ? "up" : "down")")
                chip("4H \(trend.fourHour == "UP" ? "up" : "down")")
                if let change = trend.dayChangePct { chip(String(format: "Today %+.2f%%", change)) }
                chip("ADX \(Int(trend.adx))")
                if let breadth = trend.breadthDailyPct { chip("\(Int(breadth))% of stocks up") }
            }
            Text(trend.note).font(.footnote).foregroundStyle(AppTheme.muted)
            if let outlook = trend.outlook { outlookBlock(outlook) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Market trend, \(trend.label): \(trend.headline). \(trend.note)")
    }

    /// How much of a portfolio the market supports holding in stocks, in the style of Investor's Business Daily. A bar of 0-100% with the range filled.
    private func outlookBlock(_ o: MarketOutlook) -> some View {
        let tint = o.state == "UP" ? AppTheme.mint : o.state == "PRESS" ? AppTheme.amber : AppTheme.red
        return VStack(alignment: .leading, spacing: 6) {
            Divider().overlay(AppTheme.line)
            Text("SUGGESTED IN STOCKS · \(o.label.uppercased())")
                .font(.caption2.bold()).tracking(0.8).foregroundStyle(AppTheme.muted)
            Text("\(o.exposureMinPct)–\(o.exposureMaxPct)% of your portfolio").font(.title3.bold()).foregroundStyle(tint)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(AppTheme.raised)
                    Capsule().fill(tint)
                        .frame(width: geo.size.width * CGFloat(o.exposureMaxPct - o.exposureMinPct) / 100)
                        .offset(x: geo.size.width * CGFloat(o.exposureMinPct) / 100)
                }
            }
            .frame(height: 8)
            HStack { Text("0%"); Spacer(); Text("100%") }.font(.caption2).foregroundStyle(AppTheme.muted)
            Text(o.note).font(.footnote).foregroundStyle(AppTheme.muted).fixedSize(horizontal: false, vertical: true)
            Text(o.disclaimer).font(.caption2).foregroundStyle(AppTheme.muted.opacity(0.8)).fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Suggested share of your portfolio in stocks: \(o.exposureMinPct) to \(o.exposureMaxPct) percent. \(o.label). \(o.note)")
    }

    private func chip(_ text: String) -> some View {
        Text(text)
            .font(.caption2)
            .foregroundStyle(AppTheme.muted)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(AppTheme.raised, in: Capsule())
    }
}
