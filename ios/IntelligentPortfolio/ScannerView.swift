import SwiftUI

struct ScannerView: View {
    @EnvironmentObject private var model: AppModel
    @State private var selected: Candidate?
    @State private var sideInsets = SideInsets()
    @State private var screenHeight: CGFloat = 1000
    @State private var showingTrend = false
    @State private var trendStart = 0
    @ScaledMetric(relativeTo: .largeTitle) private var heroSize = 34

    /// iPhone Duo reserves a trailing strip for system status; when it is wide enough the market trend lives in it.
    private var trendInStrip: Bool { sideInsets.strip != nil }
    /// Where the gauge starts below the top. Usually 175 points. In landscape the system tab bar rises to about 288
    /// points above the bottom edge, so on a short screen the gauge moves up to end just above it instead of behind it.
    /// Turned the other way up, the strip is on the camera side and the camera cut-out takes the top of it, so the gauge
    /// starts this much lower there.
    private static let cameraClearance: CGFloat = 40
    private var stripTop: CGFloat {
        let tabBarTop = screenHeight - 288, gauge: CGFloat = 125
        return min(175, max(8, tabBarTop - gauge - 10))
    }
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
                if let strip = sideInsets.strip, !trends.isEmpty, !(posture != .compact && selected != nil) {
                    SideStrip(edge: strip.edge, width: strip.width, top: stripTop + (strip.edge == .leading ? Self.cameraClearance : 0)) {
                        MarketTrendStrip(trends: trends, start: trendStartPage) { index in trendStart = index; showingTrend = true }
                            .id(model.market.rawValue)
                    }
                }
            }
            .reportSideInsets { sideInsets = $0 }
            .onChange(of: AdaptiveLayout.screenHeight(proxy.size, proxy.safeAreaInsets), initial: true) { _, height in screenHeight = height }
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
                    .font(.caption)
                    .foregroundStyle(AppTheme.muted)

                    if !trendInStrip, let trend = model.discovery?.marketTrend ?? trends.first { MarketTrendLine(trend: trend) { trendStart = trendStartPage; showingTrend = true } }

                    ScannerBoxHeader(title: "Supertrend setups",
                                     chip: discovery.candidates.isEmpty ? "None fresh" : "\(discovery.candidates.count) fresh",
                                     tint: discovery.candidates.isEmpty ? AppTheme.muted : AppTheme.mint)
                    if discovery.candidates.isEmpty {
                        Text("No fresh Supertrend entries right now.")
                            .font(.footnote).foregroundStyle(AppTheme.muted)
                            .frame(maxWidth: .infinity, alignment: .leading).panel()
                    }
                    if !discovery.candidates.isEmpty {
                    ListFrame {
                        ForEach(Array(discovery.candidates.enumerated()), id: \.element.id) { index, candidate in
                            if index > 0 { RowDivider() }
                            Button { selected = candidate } label: {
                                CandidateRow(candidate: candidate, isSelected: selectable && selected == candidate)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    }

                    if let recent = discovery.recentSetups, !recent.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            SectionLabel(text: "Recent setups · last 24 hours")
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

                    if let dip = discovery.dipScan, dip.available {
                        let ideas = dip.candidates?.count ?? 0
                        ScannerBoxHeader(title: "Dip scan",
                                         chip: dip.gate?.open == true ? "\(ideas) \(ideas == 1 ? "idea" : "ideas")" : "Market calm",
                                         tint: dip.gate?.open == true ? AppTheme.mint : AppTheme.muted)
                            .padding(.top, 18)
                        DipScanSection(dip: dip)
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
                .font(.system(size: heroSize, weight: .medium, design: .rounded))
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
            .clipShape(RoundedRectangle(cornerRadius: AppTheme.radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: AppTheme.radius, style: .continuous).stroke(AppTheme.hairline, lineWidth: 1))
    }
}

private struct RowDivider: View {
    var body: some View { Rectangle().fill(AppTheme.hairline).frame(height: 1).padding(.leading, 66) }
}

/// A quiet one-glance row: symbol, how it sits against its buy zone, price and time left. Everything else is one tap away.
private struct CandidateRow: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let candidate: Candidate
    var isSelected = false
    private var directionColor: Color { candidate.direction == "SHORT" ? AppTheme.red : AppTheme.mint }
    private var statusLabel: String { candidate.buyRange?.label.uppercased() ?? candidate.entryStatus.replacingOccurrences(of: "_", with: " ") }
    private var statusColor: Color { candidate.buyRange.map { zoneColour($0.state) } ?? (candidate.entryEligible ? AppTheme.mint : AppTheme.red) }

    private var leading: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(candidate.symbol).font(.headline)
                Text(candidate.direction.capitalized).font(.caption2.weight(.semibold)).foregroundStyle(directionColor)
                    .padding(.horizontal, 7).padding(.vertical, 2).background(directionColor.opacity(0.15), in: Capsule())
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
            Text(statusLabel.capitalized)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(statusColor)
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(statusColor.opacity(0.15), in: Capsule())
                .multilineTextAlignment(.trailing)
                .fixedSize(horizontal: false, vertical: true)
            if let closing = candidate.windowClosesAt.flatMap(PairingExpiryParser.date(from:)) {
                Text(shortLeft(closing)).font(.caption).foregroundStyle(AppTheme.amber)
            }
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Monogram(symbol: candidate.symbol, colour: directionColor)
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 8) { leading; trailing }
            } else {
                HStack(alignment: .top, spacing: 12) { leading; Spacer(minLength: 8); trailing }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .background(isSelected ? AppTheme.amber.opacity(0.1) : Color.clear)
        .overlay(alignment: .leading) { Rectangle().fill(AppTheme.amber).frame(width: isSelected ? 3 : 0) }
        .accessibilityElement(children: .combine)
    }
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
                    Text(candidate.symbol).font(.headline)
                    Text(candidate.direction.capitalized).font(.caption2.weight(.semibold)).foregroundStyle(candidate.direction == "SHORT" ? AppTheme.red : AppTheme.mint)
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
                    PnLChip(text: String(format: "%.2f%%", abs(since)), positive: since >= 0)
                    Text("since signal").font(.caption2).foregroundStyle(AppTheme.muted)
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .background(isSelected ? AppTheme.amber.opacity(0.1) : Color.clear)
        .overlay(alignment: .leading) { Rectangle().fill(AppTheme.amber).frame(width: isSelected ? 3 : 0) }
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
                        Capsule()
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
                Text(range.label)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(colour(range.state))
                    .padding(.horizontal, 7).padding(.vertical, 2)
                    .background(colour(range.state).opacity(0.15), in: Capsule())
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


/// A scanner's name with a small status pill, so each box says at a glance whether it has ideas.
private struct ScannerBoxHeader: View {
    let title: String
    let chip: String
    let tint: Color
    var body: some View {
        HStack {
            Text(title).font(.title3.weight(.semibold))
            Spacer()
            Text(chip).font(.caption.weight(.semibold)).foregroundStyle(tint)
                .padding(.horizontal, 10).padding(.vertical, 4).background(tint.opacity(0.15), in: Capsule())
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// The dip scan: a banner for the market gate, then the dips (only while the gate is open) with their stop and targets.
private struct DipScanSection: View {
    let dip: DipScan
    @State private var selected: DipPick?

    var body: some View {
        VStack(spacing: 12) {
            if let gate = dip.gate {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: gate.open ? "bolt.fill" : "moon.zzz.fill")
                        .foregroundStyle(gate.open ? AppTheme.mint : AppTheme.muted)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(gate.headline).font(.headline)
                        Text(gate.note).font(.footnote).foregroundStyle(AppTheme.muted)
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .panel()
            }
            if let picks = dip.candidates, !picks.isEmpty {
                ListFrame {
                    ForEach(Array(picks.enumerated()), id: \.element.id) { index, pick in
                        if index > 0 { RowDivider() }
                        Button { selected = pick } label: { DipRow(pick: pick, active: true) }.buttonStyle(.plain)
                    }
                }
            } else if let waiting = dip.waiting, !waiting.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    SectionLabel(text: "Dips waiting for market stress · not ideas")
                    Text("These stocks are in a dip, but dips only paid off in backtests while the market was under stress.")
                        .font(.caption).foregroundStyle(AppTheme.muted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                ListFrame {
                    ForEach(Array(waiting.prefix(8).enumerated()), id: \.element.id) { index, pick in
                        if index > 0 { RowDivider() }
                        Button { selected = pick } label: { DipRow(pick: pick, active: false) }.buttonStyle(.plain)
                    }
                }
            }
            Text("Long ideas only, from a backtest on past data. Results are hypothetical, and each pick is logged to the track record so live results can confirm or reject the rule. Research, not advice.")
                .font(.caption2).foregroundStyle(AppTheme.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .sheet(item: $selected) { pick in DipDetailSheet(pick: pick) }
    }
}

/// A dip pick's daily chart with its entry, stop and targets, and the chart reference lines beside them.
private struct DipDetailSheet: View {
    @Environment(\.dismiss) private var dismiss
    let pick: DipPick
    private func money(_ value: Double) -> String { PriceFormat.string(value, prefix: pick.currencySymbol, decimals: pick.priceDecimals) }
    private var candles: [Candle] {
        (pick.bars ?? []).map { Candle(date: $0.d, open: $0.o, high: $0.h, low: $0.l, close: $0.c, supertrend: nil, supertrendDirection: nil, barStatus: nil) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("\(pick.company) · \(pick.label)").font(.subheadline).foregroundStyle(AppTheme.muted)
                    if candles.count > 1 {
                        CandlestickChart(series: candles,
                                         levels: ScenarioLevels(reference: pick.signalClose, current: pick.price, risk: pick.stopPrice, target1: pick.target1, target2: pick.target2),
                                         referenceLines: pick.referenceLines ?? [])
                            .aspectRatio(1.5, contentMode: .fit)
                            .frame(minHeight: 240, maxHeight: 440)
                            .panel()
                        Text("Daily candles, last 60 sessions. Amber is the signal close, red the stop, green the targets, blue dotted lines the chart reference.")
                            .font(.caption).foregroundStyle(AppTheme.muted)
                    }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                        tile("Signal close", money(pick.signalClose))
                        tile("Now", money(pick.price))
                        tile("Stop (2 ATR)", money(pick.stopPrice))
                        tile("Target 1 (1 ATR)", money(pick.target1))
                        tile("Target 2 (2 ATR)", money(pick.target2))
                        tile("RSI(2)", String(format: "%.0f", pick.rsi2))
                    }
                    ReferenceLinesList(lines: pick.referenceLines ?? [], currency: pick.currencySymbol, decimals: pick.priceDecimals)
                }
                .padding(16)
            }
            .background(AppTheme.background)
            .navigationTitle(pick.symbol)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
    }

    private func tile(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading) {
            Text(title.uppercased()).font(.caption2).foregroundStyle(AppTheme.muted)
            Text(value).font(.headline.monospaced())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }
}

private struct DipRow: View {
    let pick: DipPick
    let active: Bool
    private func money(_ value: Double) -> String { PriceFormat.string(value, prefix: pick.currencySymbol, decimals: pick.priceDecimals) }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Monogram(symbol: pick.symbol, colour: active ? AppTheme.mint : AppTheme.muted)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(pick.symbol).font(.headline)
                    if pick.sharp {
                        Text("Sharp").font(.caption2.weight(.semibold)).foregroundStyle(AppTheme.amber)
                            .padding(.horizontal, 7).padding(.vertical, 2).background(AppTheme.amber.opacity(0.15), in: Capsule())
                    }
                }
                Text("\(pick.company) · \(Int(pick.score))/100").font(.caption).foregroundStyle(AppTheme.muted).lineLimit(1)
                Text(String(format: "RSI(2) %.0f · 3-day %+.1f%% · %.1f%% above 200-day", pick.rsi2, pick.return3DPct, pick.aboveSma200Pct))
                    .font(.caption2).foregroundStyle(AppTheme.muted)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 3) {
                Text(money(pick.price)).font(.headline)
                Text("Stop \(money(pick.stopPrice))").font(.caption).foregroundStyle(AppTheme.red)
                Text("Target \(money(pick.target1))").font(.caption).foregroundStyle(AppTheme.mint)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .opacity(active ? 1 : 0.7)
        .accessibilityElement(children: .combine)
    }
}
