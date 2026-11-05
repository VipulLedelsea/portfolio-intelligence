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
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Market trend, \(trend.label): \(trend.headline). \(trend.note)")
    }

    private func chip(_ text: String) -> some View {
        Text(text)
            .font(.caption2)
            .foregroundStyle(AppTheme.muted)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(AppTheme.raised, in: Capsule())
    }
}
