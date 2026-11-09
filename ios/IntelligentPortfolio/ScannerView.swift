import SwiftUI

struct ScannerView: View {
    @EnvironmentObject private var model: AppModel
    @State private var selected: Candidate?
    @State private var sideInsets = SideInsets()
    @State private var screenHeight: CGFloat = 1000
    @State private var showingTrend = false
    @State private var showingRecent = false
    @State private var showingScanners = false
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

                    if let ranking = discovery.ranking, ranking.available {
                        RankedIdeasSection(ranking: ranking)
                    }

                    // The separate scanner lists stay available, closed by default, now that the ranked list above covers all of them.
                    Button {
                        withAnimation(.snappy(duration: 0.25)) { showingScanners.toggle() }
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                SectionLabel(text: "By scanner")
                                Text("The Supertrend, dip and pattern lists, one by one.")
                                    .font(.caption).foregroundStyle(AppTheme.muted)
                            }
                            Spacer(minLength: 8)
                            Image(systemName: "chevron.down").font(.footnote.weight(.semibold)).foregroundStyle(AppTheme.muted)
                                .rotationEffect(.degrees(showingScanners ? 180 : 0))
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 6)
                    .accessibilityHint(showingScanners ? "Hides the separate scanner lists" : "Shows the separate scanner lists")

                    if showingScanners || discovery.ranking?.available != true {
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
                        // A drop-down: closed by default so the list of fresh setups stays the first thing on screen.
                        Button {
                            withAnimation(.snappy(duration: 0.25)) { showingRecent.toggle() }
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    SectionLabel(text: "Recent setups · last 24 hours · \(recent.count)")
                                    Text("Fresh entries that dropped out, with why and how the price has moved since the signal.")
                                        .font(.caption)
                                        .foregroundStyle(AppTheme.muted)
                                        .multilineTextAlignment(.leading)
                                }
                                Spacer(minLength: 8)
                                Image(systemName: "chevron.down")
                                    .font(.footnote.weight(.semibold))
                                    .foregroundStyle(AppTheme.muted)
                                    .rotationEffect(.degrees(showingRecent ? 180 : 0))
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .padding(.top, 14)
                        .accessibilityHint(showingRecent ? "Hides the recent setups" : "Shows the recent setups")
                        if showingRecent {
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
                    }

                    if let dip = discovery.dipScan, dip.available {
                        let ideas = dip.candidates?.count ?? 0
                        ScannerBoxHeader(title: "Dip scan",
                                         chip: dip.gate?.open == true ? "\(ideas) \(ideas == 1 ? "idea" : "ideas")" : "Market calm",
                                         tint: dip.gate?.open == true ? AppTheme.mint : AppTheme.muted)
                            .padding(.top, 18)
                        DipScanSection(dip: dip)
                    }

                    if let pattern = discovery.patternScan, pattern.available {
                        let count = (pattern.breakoutCount ?? 0) + (pattern.breakdownCount ?? 0)
                        ScannerBoxHeader(title: "Pattern scan",
                                         chip: count > 0 ? "Experimental · \(count)" : "Experimental",
                                         tint: AppTheme.amber)
                            .padding(.top, 18)
                        PatternScanSection(pattern: pattern)
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
            Label(autoRefreshText, systemImage: "clock.arrow.circlepath")
                .font(.footnote)
                .foregroundStyle(AppTheme.muted)
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

/// Top ideas: every scanner's setups in one ranked list. Each row says which scanner found it, and the numbers come from the scanner.
private struct RankedIdeasSection: View {
    let ranking: RankedIdeas
    @State private var selected: RankedIdea?
    @State private var showingSkipped = false

    private var sourceChip: (String, Color) {
        ranking.source == "ai" ? ("Ranked by AI", AppTheme.mint) : ("Ranked by rules", AppTheme.muted)
    }

    var body: some View {
        VStack(spacing: 12) {
            ScannerBoxHeader(title: "Top ideas", chip: sourceChip.0, tint: sourceChip.1)
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: ranking.nothingCompelling ? "moon.zzz.fill" : "list.number")
                    .foregroundStyle(ranking.nothingCompelling ? AppTheme.muted : AppTheme.mint)
                VStack(alignment: .leading, spacing: 4) {
                    Text(ranking.headline).font(.headline)
                    if ranking.source != "ai" {
                        Text("Ordered by fixed rules (backtest edge, reward to risk, alignment, entry, liquidity, freshness). The AI explanation is not switched on.")
                            .font(.footnote).foregroundStyle(AppTheme.muted)
                    }
                    if let notes = ranking.orderingNotes, !notes.isEmpty {
                        Text(notes).font(.footnote).foregroundStyle(AppTheme.muted)
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .panel()
            if ranking.items.isEmpty {
                Text("No ideas passed the filters right now.").font(.footnote).foregroundStyle(AppTheme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ListFrame {
                    ForEach(Array(ranking.items.enumerated()), id: \.element.id) { index, idea in
                        if index > 0 { RowDivider() }
                        Button { selected = idea } label: { RankedRow(idea: idea) }.buttonStyle(.plain)
                    }
                }
            }
            if !ranking.rejected.isEmpty {
                Button {
                    withAnimation(.snappy(duration: 0.25)) { showingSkipped.toggle() }
                } label: {
                    HStack {
                        SectionLabel(text: "Skipped · \(ranking.rejected.count)")
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.down").font(.footnote.weight(.semibold)).foregroundStyle(AppTheme.muted)
                            .rotationEffect(.degrees(showingSkipped ? 180 : 0))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if showingSkipped {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(ranking.rejected) { item in
                            Text("\(item.symbol) · \(item.tag): \(item.reason)").font(.caption).foregroundStyle(AppTheme.muted)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            if !ranking.dataGaps.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    SectionLabel(text: "What this ranking can't see")
                    ForEach(ranking.dataGaps, id: \.self) { gap in
                        Text("• \(gap)").font(.caption2).foregroundStyle(AppTheme.muted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Text("Research, not advice. Prices come from the scanners; scores use each scanner's backtest, which is hypothetical. Live results are in the track record.")
                .font(.caption2).foregroundStyle(AppTheme.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .sheet(item: $selected) { idea in RankedDetailSheet(idea: idea, method: ranking.method) }
    }
}

private func scannerTint(_ strategy: String) -> Color {
    switch strategy {
    case "SUPERTREND": AppTheme.mint
    case "DIP": AppTheme.amber
    default: AppTheme.muted
    }
}

private struct RankedRow: View {
    let idea: RankedIdea
    private func money(_ value: Double) -> String { PriceFormat.string(value, prefix: idea.currencySymbol, decimals: idea.priceDecimals) }
    private var long: Bool { idea.direction == "LONG" }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(idea.rank)").font(.subheadline.weight(.bold).monospaced()).foregroundStyle(AppTheme.muted).frame(width: 24, alignment: .trailing).padding(.top, 2)
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(idea.symbol).font(.headline)
                    Text(idea.tag).font(.caption2.weight(.semibold)).foregroundStyle(scannerTint(idea.strategy))
                        .padding(.horizontal, 7).padding(.vertical, 2).background(scannerTint(idea.strategy).opacity(0.15), in: Capsule())
                    Text(long ? "Long" : "Short").font(.caption2.weight(.semibold)).foregroundStyle(long ? AppTheme.mint : AppTheme.red)
                }
                Text(idea.reason).font(.caption).foregroundStyle(AppTheme.muted).fixedSize(horizontal: false, vertical: true)
                Text("Score \(Int(idea.score)) · \(idea.confidence) confidence").font(.caption2.weight(.semibold)).foregroundStyle(idea.confidence == "High" ? AppTheme.mint : AppTheme.muted)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 3) {
                Text(money(idea.price)).font(.headline)
                Text("Stop \(money(idea.stop))").font(.caption).foregroundStyle(AppTheme.red)
                if let target = idea.target1 { Text("Target \(money(target))").font(.caption).foregroundStyle(AppTheme.mint) }
                else { Text("Trend line exit").font(.caption).foregroundStyle(AppTheme.muted) }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// A ranked idea in full: chart, entry, stop, targets, exit rule, the evidence behind its score, and the bull and bear case when the model wrote them.
private struct RankedDetailSheet: View {
    @Environment(\.dismiss) private var dismiss
    let idea: RankedIdea
    let method: String?
    private var long: Bool { idea.direction == "LONG" }
    private func money(_ value: Double) -> String { PriceFormat.string(value, prefix: idea.currencySymbol, decimals: idea.priceDecimals) }
    private var candles: [Candle] {
        (idea.bars ?? []).map { Candle(date: $0.d, open: $0.o, high: $0.h, low: $0.l, close: $0.c, supertrend: nil, supertrendDirection: nil, barStatus: nil) }
    }
    private func filingText(_ f: FilingCheck) -> String? {
        var parts: [String] = []
        if let days = f.earningsInDays, let date = f.earningsEstimate, days >= 0, days <= 45 {
            if f.earningsConfirmed == true {
                let when = f.earningsTiming == "pm" ? " after the close" : f.earningsTiming == "am" ? " before the open" : ""
                parts.append("Earnings confirmed for \(date)\(when).")
            } else {
                parts.append("Earnings expected about \(date) (not yet confirmed by the company).")
            }
        }
        if let cautions = f.cautions, !cautions.isEmpty { parts.append("Recent filing: " + cautions.joined(separator: "; ") + ".") }
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }

    private var evidenceText: String {
        let e = idea.evidence
        guard let ev = e.evPct, let wins = e.winRatePct, let n = e.n else { return "No backtest in this market. " + e.note }
        return String(format: "%+.2f%% per trade, %.0f%% wins, %@ trades. ", ev, wins, n.formatted()) + e.note + (e.experimental ? " Experimental: not recommended." : "")
    }
    /// Supertrend ideas have no target, so the chart shows 1 and 2 ATR zones from the entry for reference only.
    private var chartTarget1: Double { idea.target1 ?? (idea.entry + (long ? 1 : -1) * (idea.atr ?? 0)) }
    private var chartTarget2: Double { idea.target2 ?? (idea.entry + (long ? 2 : -2) * (idea.atr ?? 0)) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("\(idea.company) · \(idea.tag) · \(long ? "Long" : "Short")").font(.subheadline).foregroundStyle(AppTheme.muted)
                    Text(idea.reason).font(.callout)
                    if candles.count > 1 {
                        CandlestickChart(series: candles,
                                         levels: ScenarioLevels(reference: idea.entry, current: idea.price, risk: idea.stop, target1: chartTarget1, target2: chartTarget2),
                                         referenceLines: [])
                            .aspectRatio(1.5, contentMode: .fit)
                            .frame(minHeight: 240, maxHeight: 440)
                            .panel()
                    }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                        tile("Score", "\(Int(idea.score)) · \(idea.confidence)")
                        tile("Entry (signal)", money(idea.entry))
                        tile("Now", money(idea.price))
                        tile("Stop", money(idea.stop))
                        if let t1 = idea.target1 { tile("Target 1", money(t1)) }
                        if let t2 = idea.target2 { tile("Target 2", money(t2)) }
                        if let rr = idea.rrT1 { tile("Reward to risk", String(format: "%.1f to target 1", rr)) }
                        if let ext = idea.fromEntryAtr { tile("From entry", String(format: "%+.1f ATR", ext)) }
                    }
                    SizingBlock(idea: idea)
                    block("Exit", idea.exitRule)
                    if let note = idea.alignmentNote { block("Trend and market", note) }
                    block("Backtest behind the score", evidenceText)
                    if let debate = idea.debate {
                        DebateSection(debate: debate)
                    } else {
                        if let bull = idea.bull { block("Bull case", bull) }
                        if let bear = idea.bear { block("Bear case", bear) }
                    }
                    if let invalid = idea.invalidation { block("What invalidates it", invalid) }
                    if let filing = idea.filing, let text = filingText(filing) { block("SEC filings", text) }
                    if idea.crowded == true { block("Crowding", "Other ideas in the same sector and direction rank higher, so this is largely the same bet.") }
                    Text("Research, not advice. Levels are research scenarios, not orders.").font(.caption2).foregroundStyle(AppTheme.muted)
                }
                .padding(16)
            }
            .background(AppTheme.background)
            .navigationTitle(idea.symbol)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
    }

    private func block(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionLabel(text: title)
            Text(text).font(.footnote).foregroundStyle(AppTheme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }

    private func tile(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading) {
            Text(title.uppercased()).font(.caption2).foregroundStyle(AppTheme.muted)
            Text(value).font(.headline.monospaced()).minimumScaleFactor(0.7).lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }
}

/// The pattern scan: candlestick patterns on a breakout (long) or breakdown (short) day, with entry, stop, targets and every exit rule.
private struct PatternScanSection: View {
    let pattern: PatternScan
    @State private var selected: PatternPick?

    var body: some View {
        VStack(spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "flask.fill").foregroundStyle(AppTheme.amber)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Experimental, not a recommendation").font(.headline)
                    Text(pattern.notice ?? "Backtests found no reliable edge for these patterns. Picks are logged so live results can confirm or reject them.")
                        .font(.footnote).foregroundStyle(AppTheme.muted)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .panel()
            list(title: "Breakouts · long", picks: pattern.breakouts ?? [], tint: AppTheme.mint)
            list(title: "Breakdowns · short", picks: pattern.breakdowns ?? [], tint: AppTheme.red)
            if (pattern.breakouts ?? []).isEmpty && (pattern.breakdowns ?? []).isEmpty {
                Text("No candlestick pattern broke out on volume today.")
                    .font(.footnote).foregroundStyle(AppTheme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .sheet(item: $selected) { pick in PatternDetailSheet(pick: pick) }
    }

    @ViewBuilder
    private func list(title: String, picks: [PatternPick], tint: Color) -> some View {
        if !picks.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel(text: "\(title) · \(picks.count)")
                ListFrame {
                    ForEach(Array(picks.enumerated()), id: \.element.id) { index, pick in
                        if index > 0 { RowDivider() }
                        Button { selected = pick } label: { PatternRow(pick: pick, tint: tint) }.buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

private struct PatternRow: View {
    let pick: PatternPick
    let tint: Color
    private func money(_ value: Double) -> String { PriceFormat.string(value, prefix: pick.currencySymbol, decimals: pick.priceDecimals) }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Monogram(symbol: pick.symbol, colour: tint)
            VStack(alignment: .leading, spacing: 4) {
                Text(pick.symbol).font(.headline)
                Text("\(pick.company) · \(Int(pick.score))/100").font(.caption).foregroundStyle(AppTheme.muted).lineLimit(1)
                Text(pick.patterns.joined(separator: " + ")).font(.caption2.weight(.semibold)).foregroundStyle(tint)
                Text(String(format: "Volume %.1f× average · %.1f%% from 200-day", pick.volumeRatio, abs(pick.aboveSma200Pct)))
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
        .accessibilityElement(children: .combine)
    }
}

/// A pattern pick's daily chart and every exit: stop, two targets, the failed-breakout close, and the day-10 limit.
private struct PatternDetailSheet: View {
    @Environment(\.dismiss) private var dismiss
    let pick: PatternPick
    private var long: Bool { pick.direction == "LONG" }
    private func money(_ value: Double) -> String { PriceFormat.string(value, prefix: pick.currencySymbol, decimals: pick.priceDecimals) }
    private var candles: [Candle] {
        (pick.bars ?? []).map { Candle(date: $0.d, open: $0.o, high: $0.h, low: $0.l, close: $0.c, supertrend: nil, supertrendDirection: nil, barStatus: nil) }
    }
    private var lines: [ReferenceLine] {
        [ReferenceLine(key: "breakout", label: long ? "Breakout level (20-day high)" : "Breakdown level (20-day low)", value: pick.breakoutLevel)] + (pick.referenceLines ?? [])
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("\(pick.company) · \(pick.label)").font(.subheadline).foregroundStyle(AppTheme.muted)
                    if candles.count > 1 {
                        CandlestickChart(series: candles,
                                         levels: ScenarioLevels(reference: pick.signalClose, current: pick.price, risk: pick.stopPrice, target1: pick.target1, target2: pick.target2),
                                         referenceLines: lines)
                            .aspectRatio(1.5, contentMode: .fit)
                            .frame(minHeight: 240, maxHeight: 440)
                            .panel()
                        Text("Daily candles, last 60 sessions. Amber is the signal close, red the stop, green the targets, blue dotted lines the breakout level and chart reference.")
                            .font(.caption).foregroundStyle(AppTheme.muted)
                    }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                        tile(long ? "Buy at" : "Short at", "Next open · signal \(money(pick.signalClose))")
                        tile("Now", money(pick.price))
                        tile("Stop (\(String(format: "%.1f", pick.riskAtr)) ATR)", money(pick.stopPrice))
                        tile("Target 1 (1R)", money(pick.target1))
                        tile("Target 2 (2R)", money(pick.target2))
                        tile("Fails if a day closes \(long ? "under" : "over")", money(pick.failureLevel))
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(text: "Every exit")
                        exit("Stop", "Leave if price touches \(money(pick.stopPrice)), just \(long ? "under" : "over") the pattern's \(long ? "low" : "high") of \(money(pick.patternExtreme)).")
                        exit("Target 1", "Take profit at \(money(pick.target1)), the same distance as the stop (1R). This is where the track record grades a win.")
                        exit("Target 2", "Optional second zone at \(money(pick.target2)) (2R).")
                        exit("Failed \(long ? "breakout" : "breakdown")", "If a day closes back \(long ? "under" : "over") \(money(pick.failureLevel)), the idea has failed. Leave at the next open.")
                        exit("Time limit", "Close anything still open at the close of day \(pick.horizonTradingDays).")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .panel()
                    Text("Experimental. Backtests did not show a reliable edge for these patterns, and the stop and targets are research levels, not orders.")
                        .font(.caption2).foregroundStyle(AppTheme.muted)
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

    private func exit(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.subheadline.weight(.semibold))
            Text(text).font(.footnote).foregroundStyle(AppTheme.muted)
        }
    }

    private func tile(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading) {
            Text(title.uppercased()).font(.caption2).foregroundStyle(AppTheme.muted)
            Text(value).font(.headline.monospaced()).minimumScaleFactor(0.7).lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
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

// MARK: - Today tab

/// The first thing to look at: where each market stands, the best few ideas, and what changed on your holdings. Reads stored results only.
struct TodayView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let briefing = model.briefing {
                        ForEach(briefing.markets) { market in TodayMarketBlock(market: market) }
                        if let holdings = briefing.holdings { TodayHoldingsBlock(holdings: holdings) }
                        Text(briefing.disclaimer).font(.caption2).foregroundStyle(AppTheme.muted)
                    } else {
                        ProgressView("Loading today's briefing…").tint(AppTheme.amber).frame(maxWidth: .infinity)
                    }
                }
                .padding(16)
            }
            .background(AppTheme.background)
            .navigationTitle("Today")
            .task { await model.refreshBriefing() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await model.refreshBriefing() } }
            }
        }
    }
}

private struct TodayMarketBlock: View {
    let market: BriefingMarket

    private var trendColor: Color {
        switch market.trend?.state {
        case "UP": return AppTheme.mint
        case "DOWN": return AppTheme.red
        default: return AppTheme.amber
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Circle().fill(trendColor).frame(width: 9, height: 9)
                Text(market.label).font(.headline)
                if let trend = market.trend { Text(trend.headline).font(.subheadline).foregroundStyle(AppTheme.muted) }
            }
            if market.warmingUp == true {
                Text("Still loading the first scan.").font(.caption).foregroundStyle(AppTheme.muted)
            } else if market.unavailable == true {
                Text("Not available right now.").font(.caption).foregroundStyle(AppTheme.muted)
            } else {
                if let headline = market.headline { Text(headline).font(.subheadline).foregroundStyle(AppTheme.muted) }
                ForEach(market.top) { idea in TodayIdeaRow(idea: idea) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }
}

private struct TodayIdeaRow: View {
    let idea: BriefingIdea

    private func money(_ value: Double) -> String { (idea.currencySymbol ?? "") + String(format: "%.\(idea.priceDecimals ?? 2)f", value) }

    private var earningsText: String? {
        guard let e = idea.earnings else { return nil }
        let when = e.timing == "pm" ? " after the close" : e.timing == "am" ? " before the open" : ""
        return (e.confirmed ? "Earnings confirmed for " : "Earnings expected about ") + e.date + when
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text("#\(idea.rank) \(idea.symbol)").font(.subheadline.weight(.semibold))
                Text("\(idea.direction) · \(idea.tag)").font(.caption).foregroundStyle(AppTheme.muted)
                Spacer()
                Text("\(Int(idea.score))/100 \(idea.confidence ?? "")").font(.caption.weight(.semibold))
            }
            if let reason = idea.reason { Text(reason).font(.caption).foregroundStyle(AppTheme.muted) }
            Text("Entry \(money(idea.entry)) · Stop \(money(idea.stop))").font(.caption)
            if let text = earningsText { Text("! " + text).font(.caption).foregroundStyle(AppTheme.amber) }
        }
        .padding(.vertical, 4)
    }
}

private struct TodayHoldingsBlock: View {
    let holdings: BriefingHoldings

    private func label(_ key: String) -> String {
        ["HOLD": "hold", "WATCH": "watch", "TAKE_PROFIT": "take profit", "EXIT": "exit", "NO_DATA": "no data"][key] ?? key.lowercased()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(holdings.alerts.unseen > 0 ? "Your holdings · \(holdings.alerts.unseen) new" : "Your holdings").font(.headline)
            if holdings.count == 0 {
                Text("No holdings yet.").font(.caption).foregroundStyle(AppTheme.muted)
            } else {
                Text(holdings.counts.sorted { $0.key < $1.key }.map { "\($0.value) \(label($0.key))" }.joined(separator: " · "))
                    .font(.subheadline).foregroundStyle(AppTheme.muted)
            }
            ForEach(holdings.attention) { item in
                Text("\(item.symbol): \(item.actionLabel). \(item.headline)").font(.caption)
            }
            ForEach(holdings.alerts.items.prefix(4)) { alert in
                VStack(alignment: .leading, spacing: 2) {
                    Text((alert.seenAt == nil ? "● " : "") + alert.title).font(.caption.weight(.semibold))
                    Text(alert.detail).font(.caption2).foregroundStyle(AppTheme.muted)
                }
                .opacity(alert.seenAt == nil ? 1 : 0.7)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }
}


/// Bull versus bear: each claim cites facts that the server checked against the idea's figures. The verdict is for reading only; it never changes the score.
private struct DebateSection: View {
    let debate: Debate

    private func leaning(_ judge: DebateJudge) -> String {
        switch judge.leaning {
        case "bull": return "Leans for the idea"
        case "bear": return "Leans against the idea"
        default: return "Even"
        }
    }

    private func claims(_ title: String, _ list: [DebateClaim], tint: Color, rebuttals: [DebateRebuttal]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.footnote.weight(.semibold)).foregroundStyle(tint)
            if list.isEmpty {
                Text("No claim from this side matched the data.").font(.caption).foregroundStyle(AppTheme.muted)
            }
            ForEach(list) { claim in
                VStack(alignment: .leading, spacing: 2) {
                    Text(claim.text).font(.callout)
                    Text(claim.facts.map { "\($0.label): \($0.display)" }.joined(separator: " · ")).font(.caption2).foregroundStyle(AppTheme.muted)
                }
            }
            ForEach(rebuttals, id: \.text) { item in
                Text("Reply to \(item.to): \(item.text)").font(.caption).foregroundStyle(AppTheme.muted)
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Bull versus bear")
            if let judge = debate.judge {
                VStack(alignment: .leading, spacing: 3) {
                    Text(leaning(judge)).font(.subheadline.weight(.semibold))
                    Text(judge.verdict).font(.callout)
                    if let change = judge.wouldChangeMyMind { Text("What would change this: " + change).font(.caption).foregroundStyle(AppTheme.muted) }
                }
            }
            claims("For", debate.bull, tint: AppTheme.mint, rebuttals: debate.rebuttals.bull)
            claims("Against", debate.bear, tint: AppTheme.red, rebuttals: debate.rebuttals.bear)
            Text(debate.droppedClaims > 0 ? "\(debate.droppedClaims) claim\(debate.droppedClaims == 1 ? "" : "s") dropped because a figure did not match the data. The verdict does not change the score." : "Every claim was checked against the data. The verdict does not change the score.")
                .font(.caption2).foregroundStyle(AppTheme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }
}


/// How many shares keep the loss at your stop within your risk limit, from the account size and risk percent set on the Account tab (stored on this device only).
/// Plain arithmetic on the idea's entry and stop; no position is capped below 25% of the account.
private struct SizingBlock: View {
    let idea: RankedIdea
    @AppStorage("sizing.account") private var account = 0.0
    @AppStorage("sizing.riskPct") private var riskPct = 1.0
    @EnvironmentObject private var model: AppModel

    private var held: Bool { model.holdings?.open.contains { $0.symbol == idea.symbol } ?? false }

    var body: some View {
        let symbol = idea.currencySymbol ?? ""
        let perShare = abs(idea.entry - idea.stop)
        if !symbol.isEmpty, perShare > 0, idea.entry > 0 {
            VStack(alignment: .leading, spacing: 4) {
                SectionLabel(text: "Position size")
                if account > 0, riskPct > 0 {
                    let riskAmount = account * riskPct / 100
                    let byRisk = Int((riskAmount / perShare).rounded(.down))
                    let byCap = Int((account * 0.25 / idea.entry).rounded(.down))
                    let shares = max(0, min(byRisk, byCap))
                    let value = Double(shares) * idea.entry
                    if shares == 0 {
                        Text("One share already risks more than your \(String(format: "%.1f", riskPct))% limit (\(symbol)\(String(format: "%.0f", riskAmount))), so this idea is too small to size for your account.")
                            .font(.callout)
                    } else {
                        Text("\(shares) shares: about \(symbol)\(String(format: "%.0f", value)) (\(String(format: "%.0f", value / account * 100))% of your account). If the stop is hit you lose about \(symbol)\(String(format: "%.0f", Double(shares) * perShare)).")
                            .font(.callout)
                        if byRisk > byCap { Text("Capped at 25% of your account; your risk limit alone would allow \(byRisk) shares.").font(.caption).foregroundStyle(AppTheme.amber) }
                    }
                    if held { Text("You already hold \(idea.symbol); this would add to the position.").font(.caption).foregroundStyle(AppTheme.amber) }
                    Text("Arithmetic from your own limits, not advice. Gaps can take the loss past the stop.").font(.caption2).foregroundStyle(AppTheme.muted)
                } else {
                    Text("Set your account size and risk per trade on the Account tab to see a share count.").font(.footnote).foregroundStyle(AppTheme.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .panel()
        }
    }
}
