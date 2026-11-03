import SwiftUI

struct ScannerView: View {
    @EnvironmentObject private var model: AppModel
    @State private var selected: Candidate?

    var body: some View {
        GeometryReader { proxy in
            if AdaptiveLayout.isWide(proxy.size.width) {
                splitLayout
            } else {
                compactLayout
            }
        }
    }

    /// Narrow scene: one column, analysis opens as a sheet.
    private var compactLayout: some View {
        NavigationStack {
            scannerList(selectable: false)
                .navigationTitle("Top setups")
                .toolbar { ToolbarItem(placement: .topBarTrailing) { ReadOnlyBadge() } }
                .sheet(item: $selected) { candidate in
                    AnalysisView(candidate: candidate)
                }
        }
    }

    /// Wide scene (unfolded Duo or landscape): ranked list beside a live analysis pane.
    private var splitLayout: some View {
        NavigationStack {
            HStack(spacing: 0) {
                scannerList(selectable: true)
                    .frame(width: AdaptiveLayout.listPaneWidth)
                Rectangle().fill(AppTheme.line).frame(width: 1)
                Group {
                    if let candidate = selected {
                        AnalysisContent(candidate: candidate)
                    } else {
                        ContentUnavailableView(
                            "Select a setup",
                            systemImage: "chart.xyaxis.line",
                            description: Text("Choose a ranked setup to see its chart, gates, and scenario levels here.")
                        )
                        .foregroundStyle(AppTheme.muted)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(AppTheme.background)
            }
            .navigationTitle(selected?.symbol ?? "Top setups")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { ReadOnlyBadge() } }
        }
    }

    private func scannerList(selectable: Bool) -> some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                header
                if let discovery = model.discovery, discovery.warmingUp == true {
                    Label(discovery.message ?? "Preparing the first scan…", systemImage: "hourglass")
                        .font(.footnote)
                        .foregroundStyle(AppTheme.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .panel()
                } else if let discovery = model.discovery {
                    HStack {
                        Label("\(discovery.successful)/\(discovery.universeSize) scanned", systemImage: "checkmark.circle")
                        Spacer()
                        Text("\(discovery.freshEntryCount) fresh")
                    }
                    .font(.caption.monospaced())
                    .foregroundStyle(AppTheme.muted)

                    if let trend = discovery.marketTrend { MarketTrendCard(trend: trend) }

                    ForEach(discovery.candidates) { candidate in
                        Button { selected = candidate } label: {
                            CandidateCard(candidate: candidate, isSelected: selectable && selected == candidate)
                        }
                        .buttonStyle(.plain)
                    }
                } else if model.isScanning {
                    ProgressView("Loading the \(model.market.scanTitle) scan…")
                        .tint(AppTheme.amber)
                        .padding(.top, 50)
                }
            }
            .padding(16)
        }
        .background(AppTheme.background)
        .refreshableIf(!model.market.isAutomatic) { await Task { await model.refreshScanner(manual: true) }.value }
    }

    private var marketMenu: some View {
        Menu {
            ForEach(Market.allCases) { market in
                Button {
                    Task { await model.selectMarket(market) }
                } label: {
                    if market == model.market {
                        Label(market.fullLabel, systemImage: "checkmark")
                    } else {
                        Text(market.fullLabel)
                    }
                }
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "globe")
                Text(model.market.fullLabel).fontWeight(.semibold)
                Image(systemName: "chevron.up.chevron.down").font(.caption)
            }
            .padding(.horizontal, 16)
            .frame(height: 44)
            .foregroundStyle(.white)
            .contentShape(Capsule())
        }
        .glass(Capsule())
        .accessibilityLabel("Market: \(model.market.fullLabel)")
    }

    private var autoRefreshText: String {
        guard let stamp = model.discovery?.refreshedAt, let date = PairingExpiryParser.date(from: stamp) else {
            return "Updates automatically. There is no manual refresh."
        }
        return "Updated \(date.formatted(date: .omitted, time: .shortened)). Refreshes automatically; no manual refresh."
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Daily direction.\nFour-hour timing.")
                .font(.system(size: 34, weight: .medium, design: .serif))
            marketMenu
            Text("Confirmed daily and 4-hour Supertrend, strengthening ADX, and entry-extension controls rank the \(model.market.scanTitle).")
                .foregroundStyle(AppTheme.muted)
            if model.market.isAutomatic {
                Label(autoRefreshText, systemImage: "clock.arrow.circlepath")
                    .font(.footnote)
                    .foregroundStyle(AppTheme.muted)
            } else {
                Button {
                    Task { await model.refreshScanner(manual: true) }
                } label: {
                    Label(model.isScanning ? "Scanning…" : "Refresh scan", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.borderedProminent)
                .tint(AppTheme.amber)
                .disabled(model.isScanning)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 12)
    }
}

private struct CandidateCard: View {
    let candidate: Candidate
    var isSelected = false
    private var directionColor: Color { candidate.direction == "SHORT" ? AppTheme.red : AppTheme.mint }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(candidate.symbol).font(.title2.monospaced().bold())
                    Text(candidate.company).font(.caption).foregroundStyle(AppTheme.muted).lineLimit(1)
                }
                Spacer()
                VStack(alignment: .trailing) {
                    Text(PriceFormat.string(candidate.price, prefix: candidate.currencySymbol, decimals: candidate.priceDecimals)).bold()
                    Text("\(Int(candidate.score))/100").font(.caption.monospaced()).foregroundStyle(AppTheme.muted)
                }
            }
            HStack {
                Text("\(candidate.direction) · \(candidate.label)")
                    .font(.caption.monospaced().bold())
                    .foregroundStyle(directionColor)
                Spacer()
                Text(candidate.entryStatus.replacingOccurrences(of: "_", with: " "))
                    .font(.caption2.monospaced())
                    .foregroundStyle(candidate.entryEligible ? AppTheme.mint : AppTheme.red)
            }
            ProgressView(value: candidate.score, total: 100).tint(AppTheme.amber)
            Text("Daily \(candidate.dailySupertrendDirection) · ADX \(candidate.dailyAdx, specifier: "%.1f") \(candidate.dailyAdxRising ? "rising" : "fading") · \(candidate.extensionAtr, specifier: "%+.2f") ATR")
                .font(.caption)
                .foregroundStyle(AppTheme.muted)
        }
        .panel()
        .overlay(Rectangle().stroke(AppTheme.amber, lineWidth: isSelected ? 2 : 0))
    }
}

