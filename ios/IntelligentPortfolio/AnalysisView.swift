import SwiftUI

struct AnalysisView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let candidate: Candidate

    var body: some View {
        NavigationStack {
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
            }
            .background(AppTheme.background)
            .navigationTitle(candidate.symbol)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Close") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) { ReadOnlyBadge() }
            }
            .task { await model.analyze(symbol: candidate.symbol) }
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
            CandlestickChart(series: chart.series, levels: chart.levels)
                .frame(height: 280)
                .panel()
            levels(chart.levels)
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
            gate("Trend strength", value: "ADX \(analysis.dailyAdx, specifier: "%.1f")", pass: analysis.regimeEligible)
            gate("Entry timing", value: analysis.entryStatus.replacingOccurrences(of: "_", with: " "), pass: analysis.entryStatus == "ENTRY_WINDOW")
            gate("Risk review", value: analysis.approved ? "CLEARED" : "VETO", pass: analysis.approved)
        }
        .panel()
    }

    private func levels(_ levels: ScenarioLevels) -> some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
            level("Signal entry", levels.reference)
            level("Current", levels.current)
            level("Invalidation", levels.risk)
            level("Target 1", levels.target1)
            level("Target 2", levels.target2)
        }
    }

    private func level(_ title: String, _ value: Double) -> some View {
        VStack(alignment: .leading) {
            Text(title.uppercased()).font(.caption2).foregroundStyle(AppTheme.muted)
            Text(value, format: .currency(code: "USD")).font(.headline.monospaced())
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

