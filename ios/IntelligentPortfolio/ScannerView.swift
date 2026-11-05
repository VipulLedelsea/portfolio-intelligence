import SwiftUI

struct ScannerView: View {
    @EnvironmentObject private var model: AppModel
    @State private var selected: Candidate?
    @State private var trailingInset: CGFloat = 0
    @State private var showingTrend = false
    @State private var trendStart = 0
    @ScaledMetric(relativeTo: .largeTitle) private var heroSize = 34

    /// iPhone Duo reserves a trailing strip for system status; when it is wide enough the market trend lives in it.
    private var trendInStrip: Bool { trailingInset >= 56 }
    /// Every market's indexes in one list, so a single swipe-through covers US, India and forex.
    private var trends: [MarketTrend] {
        model.discovery?.allMarketTrends.flatMap { $0.isEmpty ? nil : $0 }
            ?? model.discovery?.marketTrends
            ?? model.discovery?.marketTrend.map { [$0] }
            ?? []
    }
    private var trendStartPage: Int { trends.firstIndex { $0.market == model.market.rawValue } ?? 0 }

    var body: some View {
        GeometryReader { proxy in
            let wide = AdaptiveLayout.isWide(proxy.size.width)
            let posture = AdaptiveLayout.posture(proxy.size, proxy.safeAreaInsets, model.fold)
            ZStack(alignment: .topTrailing) {
                switch posture {
                case .creaseAcross: tabletopLayout
                case .creaseDown: splitLayout(leftWidth: AdaptiveLayout.creaseLeftWidth(proxy.size, proxy.safeAreaInsets))
                case .book: splitLayout(leftWidth: AdaptiveLayout.listPaneWidth)
                case .compact: compactLayout
                }
                // In the wide layout the chart rail takes this strip once a setup is open, so step aside then.
                if trendInStrip, !trends.isEmpty, !(posture != .compact && selected != nil) {
                    HStack(spacing: 0) {
                        Spacer(minLength: 0)
                        MarketTrendStrip(trends: trends, start: trendStartPage) { index in trendStart = index; showingTrend = true }
                            .id(model.market.rawValue)
                            .frame(width: trailingInset)
                            .offset(x: AdaptiveLayout.sideShift(strip: trailingInset))
                    }
                    .padding(.top, 175)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    .ignoresSafeArea(.container, edges: .trailing)
                }
            }
            #if DEBUG
            .overlay(alignment: .bottomLeading) {
                HingeStrip(size: proxy.size, insets: proxy.safeAreaInsets, fold: model.fold, posture: posture)
            }
            #endif
            .background(GeometryReader { inner in
                Color.clear.preference(key: ScannerInsetKey.self, value: inner.safeAreaInsets.trailing)
            })
            .onPreferenceChange(ScannerInsetKey.self) { trailingInset = $0 }
            .sheet(isPresented: $showingTrend) { MarketTrendSheet(trends: trends, start: trendStart) }
            // Glide between postures instead of jumping while the phone is opened or folded.
            .animation(.smooth(duration: 0.4), value: posture)
        }
    }

    /// Narrow scene: one column, analysis opens as a sheet.
    private var compactLayout: some View {
        NavigationStack {
            scannerList(selectable: false)
                .navigationTitle("Top setups")
                .toolbar { ToolbarItem(placement: .topBarTrailing) { ReadOnlyBadge() } }
            .solidNavigationBar()
                .sheet(item: $selected) { candidate in
                    AnalysisView(candidate: candidate)
                }
        }
    }

    /// Title rows drawn by the app instead of the system bar, so the two panes never share a bar that reacts to
    /// whichever one is scrolling. The list pane is titled "Top setups"; the stock name sits in the middle of the
    /// detail pane, above its data, with the read-only badge at the far edge.
    private var listHeader: some View {
        HStack { Text("Top setups").font(.headline); Spacer() }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .frame(minHeight: 44)
            .background(AppTheme.background)
    }

    private var detailHeader: some View {
        ZStack {
            Text(selected?.symbol ?? "").font(.headline)
            HStack { Spacer(); ReadOnlyBadge() }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .frame(minHeight: 44)
        .background(AppTheme.background)
    }

    private var analysisPane: some View {
        Group {
            if let candidate = selected {
                AnalysisContent(candidate: candidate)
            } else {
                ContentUnavailableView("Select a setup", systemImage: "chart.xyaxis.line",
                    description: Text("Choose a ranked setup to see its chart, gates, and scenario levels here."))
                    .foregroundStyle(AppTheme.muted)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppTheme.background)
    }

    /// Half open, crease across the middle: the header and chart fill the top screen and the ranked list and controls
    /// the bottom one, with the divider on the crease. The first setup opens by itself so the top is never empty.
    private var tabletopLayout: some View {
        NavigationStack {
            GeometryReader { proxy in
                let split = AdaptiveLayout.creaseSplit(proxy.size, proxy.safeAreaInsets)
                VStack(spacing: 0) {
                    VStack(spacing: 0) { detailHeader; analysisPane }
                        .frame(height: split.top)
                        .clipped()
                    Rectangle().fill(AppTheme.line).frame(height: 10)
                    scannerList(selectable: true)
                        .frame(height: split.bottom)
                }
            }
            .background(AppTheme.background)
            .toolbar(.hidden, for: .navigationBar)
            .onChange(of: model.discovery?.candidates.first?.id, initial: true) { _, _ in
                if selected == nil { selected = model.discovery?.candidates.first }
            }
        }
    }

    /// Fully unfolded: a fixed-width ranked list beside a live analysis pane. Half open with the crease running top to
    /// bottom (`leftWidth`): the divider sits exactly on the crease.
    private func splitLayout(leftWidth: CGFloat) -> some View {
        NavigationStack {
            HStack(spacing: 0) {
                VStack(spacing: 0) {
                    listHeader
                    scannerList(selectable: true)
                }
                .frame(width: leftWidth)
                Rectangle().fill(AppTheme.line).frame(width: 1)
                VStack(spacing: 0) {
                    detailHeader
                    analysisPane
                }
            }
            .background(AppTheme.background)
            .toolbar(.hidden, for: .navigationBar)
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

                    if !trendInStrip, let trend = model.discovery?.marketTrend ?? trends.first { MarketTrendLine(trend: trend) { trendStart = trendStartPage; showingTrend = true } }

                    ListFrame {
                        ForEach(Array(discovery.candidates.enumerated()), id: \.element.id) { index, candidate in
                            if index > 0 { RowDivider() }
                            Button { selected = candidate } label: {
                                CandidateRow(candidate: candidate, isSelected: selectable && selected == candidate)
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    if let recent = discovery.recentSetups, !recent.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("RECENT SETUPS · LAST 24 HOURS")
                                .font(.caption.monospaced().bold())
                                .foregroundStyle(AppTheme.amber)
                            Text("Fresh entries that dropped out, with why and how the price has moved since the signal.")
                                .font(.caption)
                                .foregroundStyle(AppTheme.muted)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 14)
                        ListFrame {
                            ForEach(Array(recent.enumerated()), id: \.element.id) { index, setup in
                                if index > 0 { RowDivider() }
                                Button { selected = setup.candidate } label: {
                                    RecentSetupRow(setup: setup, isSelected: selectable && selected == setup.candidate)
                                }
                                .buttonStyle(.plain)
                            }
                        }
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
            .frame(minHeight: 44)
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
                .font(.system(size: heroSize, weight: .medium, design: .serif))
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

/// One bordered frame around a whole list, with thin lines between the rows instead of a box per row.
private struct ListFrame<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        VStack(spacing: 0) { content }
            .frame(maxWidth: .infinity)
            .background(AppTheme.panel)
            .overlay(Rectangle().stroke(AppTheme.line, lineWidth: 1))
    }
}

private struct RowDivider: View {
    var body: some View { Rectangle().fill(AppTheme.line).frame(height: 1) }
}

/// A quiet one-glance row: symbol, how it sits against its buy zone, price and time left. Everything else is one tap away.
private struct CandidateRow: View {
    let candidate: Candidate
    var isSelected = false
    private var directionColor: Color { candidate.direction == "SHORT" ? AppTheme.red : AppTheme.mint }
    private var statusLabel: String { candidate.buyRange?.label.uppercased() ?? candidate.entryStatus.replacingOccurrences(of: "_", with: " ") }
    private var statusColor: Color { candidate.buyRange.map { zoneColour($0.state) } ?? (candidate.entryEligible ? AppTheme.mint : AppTheme.red) }

    private var leading: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(candidate.symbol).font(.headline.monospaced().bold())
                Text(candidate.direction).font(.caption2.monospaced().bold()).foregroundStyle(directionColor)
            }
            Text("\(candidate.company) · \(Int(candidate.score))/100")
                .font(.caption)
                .foregroundStyle(AppTheme.muted)
                .lineLimit(1)
            if let range = candidate.buyRange {
                BuyRangeBar(range: range, currency: candidate.currencySymbol, decimals: candidate.priceDecimals, compact: true)
                    .frame(maxWidth: 220)
                    .padding(.top, 2)
            }
        }
    }

    private var trailing: some View {
        VStack(alignment: .trailing, spacing: 3) {
            Text(PriceFormat.string(candidate.price, prefix: candidate.currencySymbol, decimals: candidate.priceDecimals)).font(.headline)
            Text(statusLabel)
                .font(.caption2.monospaced().bold())
                .foregroundStyle(statusColor)
                .multilineTextAlignment(.trailing)
                .fixedSize(horizontal: false, vertical: true)
            if let closing = candidate.windowClosesAt.flatMap(PairingExpiryParser.date(from:)) {
                Text(shortLeft(closing)).font(.caption).foregroundStyle(AppTheme.amber)
            }
        }
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 12) { leading; Spacer(minLength: 8); trailing }
            VStack(alignment: .leading, spacing: 8) { leading; trailing }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .background(isSelected ? AppTheme.amber.opacity(0.1) : Color.clear)
        .overlay(Rectangle().stroke(AppTheme.amber, lineWidth: isSelected ? 2 : 0))
        .accessibilityElement(children: .combine)
    }
}

private struct ScannerInsetKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// "2:00 PM" today, or "Tue 2:00 PM" on another day.
func timeText(_ date: Date) -> String {
    if Calendar.current.isDateInToday(date) { return date.formatted(date: .omitted, time: .shortened) }
    return date.formatted(.dateTime.weekday(.abbreviated).hour().minute())
}

func leftText(_ date: Date) -> String {
    let minutes = Int(date.timeIntervalSinceNow / 60)
    if minutes <= 0 { return "closing now" }
    if minutes < 45 { return "\(minutes) min left" }
    let hours = Int((Double(minutes) / 60).rounded())
    return hours < 24 ? "about \(hours) h left" : "about \(Int((Double(hours) / 24).rounded())) d left"
}

func shortLeft(_ date: Date) -> String {
    let minutes = Int(date.timeIntervalSinceNow / 60)
    if minutes <= 0 { return "closing now" }
    if minutes < 60 { return "\(minutes) min left" }
    let hours = Int((Double(minutes) / 60).rounded())
    return hours < 24 ? "\(hours) h left" : "\(Int((Double(hours) / 24).rounded())) d left"
}

/// A setup that dropped out of the fresh list in the last day, as a quieter row than a live one.
private struct RecentSetupRow: View {
    let setup: RecentSetup
    var isSelected = false

    private var sinceColor: Color { (setup.sinceSignalPct ?? 0) >= 0 ? AppTheme.mint : AppTheme.red }

    var body: some View {
        let candidate = setup.candidate
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(candidate.symbol).font(.headline.monospaced().bold())
                    Text(candidate.direction).font(.caption2.monospaced().bold()).foregroundStyle(candidate.direction == "SHORT" ? AppTheme.red : AppTheme.mint)
                }
                Text("\(candidate.company) · \(setup.dropReason)")
                    .font(.caption)
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(2)
                Text(timeline).font(.caption2).foregroundStyle(AppTheme.muted)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 3) {
                Text(PriceFormat.string(candidate.price, prefix: candidate.currencySymbol, decimals: candidate.priceDecimals)).font(.headline)
                if let since = setup.sinceSignalPct {
                    Text(String(format: "%+.2f%%", since)).font(.caption.monospaced()).foregroundStyle(sinceColor)
                    Text("since signal").font(.caption2).foregroundStyle(AppTheme.muted)
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .background(isSelected ? AppTheme.amber.opacity(0.1) : Color.clear)
        .overlay(Rectangle().stroke(AppTheme.amber, lineWidth: isSelected ? 2 : 0))
        .accessibilityElement(children: .combine)
    }

    private var timeline: String {
        let seen = setup.candidate.firstSeenAt.flatMap(PairingExpiryParser.date(from:)).map(timeText)
        let dropped = PairingExpiryParser.date(from: setup.droppedAt).map(timeText)
        return [seen.map { "First seen \($0)" }, dropped.map { "dropped out \($0)" }].compactMap { $0 }.joined(separator: " · ")
    }
}

func zoneColour(_ key: String) -> Color {
    switch key {
    case "IN_BUY_RANGE": AppTheme.mint
    case "DEEP_DIP", "EXTENDED": AppTheme.amber
    default: AppTheme.red
    }
}

/// A slim bar of the zones around the signal price with the current price marked, plus where that puts the setup.
/// The compact form is just the bar, for list rows.
struct BuyRangeBar: View {
    let range: BuyRange
    let currency: String?
    let decimals: Int?
    var compact = false

    private func colour(_ key: String) -> Color { zoneColour(key) }

    private func money(_ value: Double) -> String { PriceFormat.string(value, prefix: currency, decimals: decimals) }

    var body: some View {
        let span = max(range.scaleMax - range.scaleMin, 0.0001)
        let buy = range.zones.first { $0.key == "IN_BUY_RANGE" }
        VStack(alignment: .leading, spacing: 6) {
            GeometryReader { proxy in
                let width = proxy.size.width
                let x: (Double) -> CGFloat = { price in CGFloat(min(max((price - range.scaleMin) / span, 0), 1)) * width }
                ZStack(alignment: .leading) {
                    ForEach(range.zones, id: \.key) { zone in
                        let start = x(zone.lo ?? range.scaleMin), end = x(zone.hi ?? range.scaleMax)
                        Rectangle()
                            .fill(colour(zone.key).opacity(zone.key == "IN_BUY_RANGE" ? 1 : 0.5))
                            .frame(width: max(0, end - start), height: compact ? 6 : 8)
                            .offset(x: start)
                    }
                    Rectangle().fill(Color.primary.opacity(0.65)).frame(width: 1, height: compact ? 10 : 14).offset(x: x(range.entry))
                    Rectangle().fill(Color.primary).frame(width: compact ? 2 : 3, height: compact ? 14 : 18).offset(x: x(range.price) - 1.5)
                }
                .frame(height: compact ? 14 : 18, alignment: .center)
            }
            .frame(height: compact ? 14 : 18)
            if !compact { HStack(spacing: 8) {
                Text(range.label.uppercased())
                    .font(.caption2.bold())
                    .foregroundStyle(colour(range.state))
                    .padding(.horizontal, 7).padding(.vertical, 2)
                    .overlay(Rectangle().stroke(colour(range.state).opacity(0.7)))
                if let buy, let lo = buy.lo, let hi = buy.hi {
                    Text("Buy zone \(money(lo)) – \(money(hi))")
                        .font(.caption)
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            } }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Buy range: \(range.label).\(buy.flatMap { zone in zone.lo.flatMap { lo in zone.hi.map { hi in " Buy zone \(money(lo)) to \(money(hi))." } } } ?? "")")
    }
}

#if DEBUG
private struct HingeStrip: View {
    @ObservedObject private var probe = HingeProbe.shared
    let size: CGSize
    let insets: EdgeInsets
    let fold: AdaptiveLayout.FoldState
    let posture: AdaptiveLayout.Posture

    var body: some View {
        let screenH = AdaptiveLayout.screenHeight(size, insets)
        Text("win \(Int(size.width))×\(Int(screenH)) · ratio \(String(format: "%.2f", screenH / max(size.width, 1))) · inset t\(Int(insets.top)) b\(Int(insets.bottom)) l\(Int(insets.leading)) r\(Int(insets.trailing)) · \(fold) ∠\(probe.angle.map { String(format: "%.2f", $0) } ?? "–") · \(posture)")
            .font(.caption2.monospaced()).padding(4).background(.black.opacity(0.7)).foregroundStyle(.white)
            .allowsHitTesting(false)
    }
}
#endif
