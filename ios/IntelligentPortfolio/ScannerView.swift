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
                .navigationTitle("Ideas")
                .toolbar { ToolbarItem(placement: .topBarTrailing) { ReadOnlyBadge() } }
            .solidNavigationBar()
                .sheet(item: $selected) { candidate in
                    AnalysisView(candidate: candidate)
                }
        }
    }

    /// Title rows drawn by the app instead of the system bar, so the two panes never share a bar that reacts to
    /// whichever one is scrolling. The list pane is titled "Ideas"; the stock name sits in the middle of the
    /// detail pane, above its data, with the read-only badge at the far edge.
    private var listHeader: some View {
        HStack { Text("Ideas").font(.headline); Spacer() }
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
                                SectionLabel(text: "Browse by scan type")
                                Text("The trend, dip and pattern lists, one by one.")
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
                    .accessibilityHint(showingScanners ? "Hides the separate scan lists" : "Shows the separate scan lists")

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
                    ResearchFootnote().padding(.top, 8)
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

    /// One line under the market picker: how many ideas, out of how many stocks, and when.
    private var summaryText: String {
        var text = "Checks the \(model.market.scanTitle) automatically."
        if let discovery = model.discovery, discovery.warmingUp != true {
            let ideas = discovery.ranking?.available == true ? discovery.ranking?.items.count ?? 0 : discovery.freshEntryCount
            text = "\(ideas) \(ideas == 1 ? "idea" : "ideas") today from \(discovery.successful) \(model.market == .forex ? "pairs" : "stocks") checked."
        }
        if let stamp = model.discovery?.refreshedAt, let date = PairingExpiryParser.date(from: stamp) {
            text += " Updated \(date.formatted(date: .omitted, time: .shortened))."
        }
        return text
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            marketMenu
            Text(summaryText)
                .font(.footnote)
                .foregroundStyle(AppTheme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 4)
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

/// Top ideas: every scanner's setups in one ranked list, one card each. Skipped ideas and data gaps sit behind one disclosure.
private struct RankedIdeasSection: View {
    let ranking: RankedIdeas
    @State private var selected: RankedIdea?
    @State private var showingSkipped = false

    var body: some View {
        VStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Top ideas").font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
                Text(ranking.headline).font(.footnote).foregroundStyle(AppTheme.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if ranking.items.isEmpty {
                Text("No ideas passed the checks right now.").font(.footnote).foregroundStyle(AppTheme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading).panel()
            } else {
                ForEach(ranking.items) { idea in
                    Button { selected = idea } label: { RankedRow(idea: idea) }.buttonStyle(.plain)
                }
            }
            if !ranking.rejected.isEmpty || !ranking.dataGaps.isEmpty {
                Button {
                    withAnimation(.snappy(duration: 0.25)) { showingSkipped.toggle() }
                } label: {
                    HStack {
                        SectionLabel(text: ranking.rejected.isEmpty ? "What this list can't see" : "\(ranking.rejected.count) skipped today, and why")
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.down").font(.footnote.weight(.semibold)).foregroundStyle(AppTheme.muted)
                            .rotationEffect(.degrees(showingSkipped ? 180 : 0))
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if showingSkipped {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(ranking.rejected) { item in
                            Text("\(item.symbol): \(item.reason)").font(.caption).foregroundStyle(AppTheme.muted)
                        }
                        if !ranking.dataGaps.isEmpty {
                            SectionLabel(text: "What this list can't see").padding(.top, 4)
                            ForEach(ranking.dataGaps, id: \.self) { gap in
                                Text("• \(gap)").font(.caption).foregroundStyle(AppTheme.muted)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .sheet(item: $selected) { idea in RankedDetailSheet(idea: idea) }
    }
}

/// Long or Short, as a small coloured tag.
struct SideTag: View {
    let direction: String
    var body: some View {
        let long = direction == "LONG"
        Text(PlainWords.side(direction)).font(.caption.weight(.semibold)).foregroundStyle(long ? AppTheme.mint : AppTheme.red)
            .padding(.horizontal, 10).padding(.vertical, 4)
            .background((long ? AppTheme.mint : AppTheme.red).opacity(0.15), in: Capsule())
    }
}

/// A small label over a value. Three of these make the row of numbers on every idea card.
struct FactColumn: View {
    let title: String
    let value: String
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption).foregroundStyle(AppTheme.muted)
            Text(value).font(.subheadline.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// The idea's 0 to 100 score as one labelled bar.
struct StrengthBar: View {
    let score: Double
    var body: some View {
        HStack(spacing: 8) {
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(AppTheme.line)
                    Capsule().fill(AppTheme.mint).frame(width: proxy.size.width * CGFloat(min(max(score, 0), 100) / 100))
                }
            }
            .frame(height: 6)
            Text("Strength \(Int(score))").font(.caption).foregroundStyle(AppTheme.muted)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Strength \(Int(score)) out of 100")
    }
}

private func scannerTint(_ strategy: String) -> Color {
    switch strategy {
    case "SUPERTREND": AppTheme.mint
    case "DIP": AppTheme.amber
    default: AppTheme.muted
    }
}

/// Neutral, wrapping chips for the information-only chart labels (pattern, prior run-up, market state).
private struct LabelChips: View {
    let chips: [String]
    var body: some View {
        if !chips.isEmpty {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 6, alignment: .leading)], alignment: .leading, spacing: 4) {
                ForEach(chips, id: \.self) { chip in
                    Text(chip).font(.caption2).foregroundStyle(AppTheme.muted).lineLimit(1)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .overlay(Capsule().stroke(AppTheme.muted.opacity(0.4), lineWidth: 0.5))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
}

private struct RankedRow: View {
    let idea: RankedIdea
    private func money(_ value: Double) -> String { PriceFormat.string(value, prefix: idea.currencySymbol, decimals: idea.priceDecimals) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("\(idea.rank)").font(.subheadline).foregroundStyle(AppTheme.muted)
                Text(idea.company.isEmpty ? idea.symbol : idea.company).font(.headline).lineLimit(1)
                if !idea.company.isEmpty { Text(idea.symbol).font(.caption).foregroundStyle(AppTheme.muted) }
                Spacer(minLength: 8)
                SideTag(direction: idea.direction)
            }
            Text(idea.plainReason).font(.subheadline).foregroundStyle(.white.opacity(0.85)).fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .top, spacing: 8) {
                FactColumn(title: "Price now", value: money(idea.price))
                FactColumn(title: PlainWords.exitLabel(idea.direction), value: money(idea.stop))
                FactColumn(title: "Risk", value: PlainWords.risk(entry: idea.entry, stop: idea.stop, stopPct: idea.stopPct))
            }
            StrengthBar(score: idea.score)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

/// A ranked idea in full. The plain reading comes first: what it is, three numbers, a labelled chart, what speaks for it
/// and what to watch, and when to get out. The scanner's figures, backtest and debate sit behind one disclosure.
struct RankedDetailSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var model: AppModel
    let idea: RankedIdea
    @State private var showingNumbers = false
    @State private var logging = false
    private var long: Bool { idea.isLong }
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
        return String(format: "Across %@ past trades of this kind, %.0f%% made money and the average result was %+.2f%% per trade. ", n.formatted(), wins, ev) + e.note + (e.experimental ? " Experimental: not recommended." : "")
    }
    /// Supertrend ideas have no target, so the chart shows one and two typical daily ranges from the entry for reference only.
    private var chartTarget1: Double { idea.target1 ?? (idea.entry + (long ? 1 : -1) * (idea.atr ?? 0)) }
    private var chartTarget2: Double { idea.target2 ?? (idea.entry + (long ? 2 : -2) * (idea.atr ?? 0)) }
    private var marketState: String? { model.discovery?.marketTrend?.state }
    /// Trend ideas leave on the trend line, which moves; the others have their own written rule.
    private var exitText: String {
        guard idea.strategy.uppercased().hasPrefix("SUPERTREND") else { return idea.exitRule }
        return "If a day closes \(long ? "below" : "above") the exit line (now \(money(idea.stop))), the idea is over. There is no profit target: you stay in for as long as the trend holds."
    }
    private var canLog: Bool { idea.market != "FX" && !(idea.currencySymbol ?? "").isEmpty }

    var body: some View {
        let checks = idea.checks(marketState: marketState)
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(idea.company.isEmpty ? idea.symbol : idea.company).font(.title2.weight(.semibold))
                        Spacer(minLength: 8)
                        SideTag(direction: idea.direction)
                    }
                    Text(idea.plainReason).font(.callout).fixedSize(horizontal: false, vertical: true)
                    HStack(alignment: .top, spacing: 8) {
                        if let zone = idea.buyZoneText(money) { FactColumn(title: long ? "Buy near" : "Short near", value: zone).tile() }
                        else { FactColumn(title: "Signal price", value: money(idea.entry)).tile() }
                        FactColumn(title: PlainWords.exitLabel(idea.direction), value: money(idea.stop)).tile()
                        FactColumn(title: "Risk", value: PlainWords.risk(entry: idea.entry, stop: idea.stop, stopPct: idea.stopPct)).tile()
                    }
                    if candles.count > 1 {
                        VStack(alignment: .leading, spacing: 8) {
                            CandlestickChart(series: candles,
                                             levels: ScenarioLevels(reference: idea.entry, current: idea.price, risk: idea.stop, target1: chartTarget1, target2: chartTarget2),
                                             referenceLines: [])
                                .aspectRatio(1.5, contentMode: .fit)
                                .frame(minHeight: 220, maxHeight: 440)
                            ViewThatFits(in: .horizontal) {
                                HStack(spacing: 14) { legend }
                                VStack(alignment: .leading, spacing: 4) { legend }
                            }
                        }
                        .panel()
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        if !checks.good.isEmpty {
                            Text("Why it's on the list").font(.headline)
                            ForEach(checks.good, id: \.self) { checkLine($0, good: true) }
                        }
                        if !checks.careful.isEmpty {
                            Text("What to watch").font(.headline).padding(.top, checks.good.isEmpty ? 0 : 6)
                            ForEach(checks.careful, id: \.self) { checkLine($0, good: false) }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .panel()
                    if let reading = idea.lorentzian { LorentzianBlock(reading: reading, long: long) }
                    block("When to get out", exitText)
                    if let filing = idea.filing, let text = filingText(filing) { block("Company news", text) }
                    SizingBlock(idea: idea)
                    Button {
                        withAnimation(.snappy(duration: 0.25)) { showingNumbers.toggle() }
                    } label: {
                        HStack {
                            Text("Full numbers and backtest").font(.subheadline.weight(.semibold))
                            Spacer(minLength: 8)
                            Image(systemName: "chevron.down").font(.footnote.weight(.semibold)).foregroundStyle(AppTheme.muted)
                                .rotationEffect(.degrees(showingNumbers ? 180 : 0))
                        }
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if showingNumbers { numbers }
                    if canLog {
                        Button { logging = true } label: { Text("Log my buy").font(.headline).frame(maxWidth: .infinity, minHeight: 32) }
                            .buttonStyle(.borderedProminent).tint(AppTheme.amber).foregroundStyle(.black)
                        Text("Records a purchase you made yourself. Nothing is sent to a broker.").font(.caption).foregroundStyle(AppTheme.muted)
                    }
                }
                .padding(16)
                .readableWidth()
            }
            .background(AppTheme.background)
            .navigationTitle(idea.symbol)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .sheet(isPresented: $logging) {
                AddHoldingSheet(market: idea.market == "IN" ? "IN" : "US", symbol: idea.symbol, shares: SizingMath.shareText(idea), price: String(idea.price)).environmentObject(model)
            }
        }
    }

    /// What the dashed lines on the chart mean.
    @ViewBuilder private var legend: some View {
        legendItem("Signal price", AppTheme.amber)
        legendItem("Exit line", AppTheme.red)
        legendItem(idea.target1 == nil ? "1 and 2 typical days' move" : "Targets", AppTheme.mint)
    }

    private func legendItem(_ text: String, _ colour: Color) -> some View {
        HStack(spacing: 5) {
            Capsule().fill(colour).frame(width: 14, height: 3)
            Text(text).font(.caption).foregroundStyle(AppTheme.muted)
        }
    }

    private func checkLine(_ text: String, good: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: good ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .font(.footnote).foregroundStyle(good ? AppTheme.mint : AppTheme.amber)
                .accessibilityLabel(good ? "Yes" : "Careful")
            Text(text).font(.subheadline).fixedSize(horizontal: false, vertical: true)
        }
    }

    /// Everything the scanner and the model produced, for anyone who wants to check the working.
    @ViewBuilder private var numbers: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
            tile("Strength", "\(Int(idea.score)) of 100 · \(idea.confidence)")
            tile("Signal price", money(idea.entry))
            tile("Price now", money(idea.price))
            tile(PlainWords.exitLabel(idea.direction), money(idea.stop))
            if let t1 = idea.target1 { tile("Target 1", money(t1)) }
            if let t2 = idea.target2 { tile("Target 2", money(t2)) }
            if let rr = idea.rrT1 { tile("Reward for each 1 risked", String(format: "%.1f to target 1", rr)) }
            if let ext = idea.fromEntryAtr { tile("Moved since signal", String(format: "%+.1f typical days", ext)) }
        }
        if let range = idea.buyRange {
            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(text: "Where the price sits around the signal")
                BuyRangeBar(range: range, currency: idea.currencySymbol, decimals: idea.priceDecimals)
                Text("Green is the buy zone, amber is stretched, red is too far. The thick mark is the price now and the thin mark is the signal price.").font(.caption).foregroundStyle(AppTheme.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .panel()
        }
        block("How this kind of idea did in the past", evidenceText)
        if let note = idea.alignmentNote { block("Trend readings", note) }
        if let debate = idea.debate {
            DebateSection(debate: debate)
        } else {
            if let bull = idea.bull { block("The case for", bull) }
            if let bear = idea.bear { block("The case against", bear) }
        }
        if !idea.labelChips.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(text: "Chart labels")
                LabelChips(chips: idea.labelChips)
                Text("For information only. They don't change the strength or the exit line, and testing found no reliable edge from them.")
                    .font(.caption).foregroundStyle(AppTheme.muted).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .panel()
        }
    }

    private func block(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.headline)
            Text(text).font(.subheadline).foregroundStyle(.white.opacity(0.85)).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }

    private func tile(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption).foregroundStyle(AppTheme.muted)
            Text(value).font(.subheadline.weight(.semibold)).minimumScaleFactor(0.7).lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .tile()
    }
}

/// The Lorentzian Classification indicator's reading, shown for information only. The wording follows what the indicator's source
/// actually does: a past day votes long when the price had fallen over the four days before it, and short when it had risen.
private struct LorentzianBlock: View {
    let reading: LorentzianReading
    let long: Bool

    private var lean: String { reading.prediction > 0 ? "Leans long" : reading.prediction < 0 ? "Leans short" : "No lean" }
    private var agreement: String? {
        guard reading.prediction != 0 else { return nil }
        return (reading.prediction > 0) == long ? "That agrees with this idea." : "That disagrees with this idea."
    }
    private func pip(_ index: Int) -> Color {
        index < reading.votesLong ? AppTheme.mint : index >= reading.neighbors - reading.votesShort ? AppTheme.red : AppTheme.line
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Lorentzian reading").font(.headline)
            HStack(spacing: 4) {
                ForEach(0..<max(reading.neighbors, 1), id: \.self) { index in
                    RoundedRectangle(cornerRadius: 3).fill(pip(index)).frame(height: 10)
                }
            }
            .accessibilityHidden(true)
            Text("\(lean): of \(reading.neighbors) similar past days, \(reading.votesLong) vote long and \(reading.votesShort) vote short (\(String(format: "%+d", reading.prediction)) of \(reading.neighbors)). \(agreement ?? "")")
                .font(.subheadline).foregroundStyle(.white.opacity(0.85)).fixedSize(horizontal: false, vertical: true)
            if !reading.filtersPass {
                Text("The indicator's own volatility and trend filters would not confirm a new signal today.")
                    .font(.caption).foregroundStyle(AppTheme.amber).fixedSize(horizontal: false, vertical: true)
            }
            Text(LorentzianBlock.note)
                .font(.caption).foregroundStyle(AppTheme.muted).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }

    static let note = "From the Lorentzian Classification indicator by jdehorty, run on this stock's last year of daily bars. It finds past days whose RSI, WaveTrend, CCI and ADX readings looked like today's; a past day votes long when the price had fallen over the four days before it, and short when it had risen. In our test on 20 years of S&P 500 daily bars it did not predict the next 4 to 10 days: stocks it leaned long on did slightly worse than average. Information only: it doesn't change the strength or the exit line."
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
                        ResearchFootnote()
                    } else if model.isGuest {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Connect an account to see today's briefing.").font(.headline)
                            Text("The briefing summarises each market, the top ideas and what changed on your holdings.")
                                .foregroundStyle(AppTheme.muted)
                            Button("Connect an account") { model.leaveGuest() }
                                .buttonStyle(.borderedProminent)
                                .tint(AppTheme.amber)
                        }
                        .panel()
                    } else {
                        ProgressView("Loading today's briefing…").tint(AppTheme.amber).frame(maxWidth: .infinity)
                    }
                }
                .padding(16)
                .readableWidth()
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

/// One market on the Today tab: how it stands in a sentence, then its top ideas as cards. A market with no ideas is one short panel.
private struct TodayMarketBlock: View {
    let market: BriefingMarket

    private var trendColor: Color {
        switch market.trend?.state {
        case "UP": return AppTheme.mint
        case "DOWN": return AppTheme.red
        default: return AppTheme.amber
        }
    }
    private var status: String {
        if market.warmingUp == true { return "Still loading the first scan." }
        if market.unavailable == true { return "Not available right now." }
        return market.top.isEmpty ? "No ideas today." : "\(market.top.count) top \(market.top.count == 1 ? "idea" : "ideas") today."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Circle().fill(trendColor).frame(width: 10, height: 10).padding(.top, 5).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(market.label).font(.headline)
                    Text([market.trend?.headline, status].compactMap { $0 }.joined(separator: ". ").replacingOccurrences(of: "..", with: "."))
                        .font(.subheadline).foregroundStyle(AppTheme.muted).fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .panel()
            if market.warmingUp != true, market.unavailable != true {
                ForEach(market.top) { idea in TodayIdeaRow(idea: idea) }
            }
        }
    }
}

/// A top idea on the Today tab. When the same idea is in the loaded Ideas list, the card uses its fuller wording and opens its detail.
private struct TodayIdeaRow: View {
    let idea: BriefingIdea
    @EnvironmentObject private var model: AppModel
    @State private var showing: RankedIdea?

    private func money(_ value: Double) -> String { (idea.currencySymbol ?? "") + String(format: "%.\(idea.priceDecimals ?? 2)f", value) }
    private var ranked: RankedIdea? {
        model.discovery?.ranking?.items.first { $0.symbol == idea.symbol && $0.direction == idea.direction && $0.entry == idea.entry }
    }
    private var sentence: String {
        ranked?.plainReason ?? PlainWords.setup(strategy: idea.tag, long: idea.direction == "LONG") ?? idea.reason ?? ""
    }
    private var earningsText: String? {
        guard let e = idea.earnings else { return nil }
        let when = e.timing == "pm" ? " after the close" : e.timing == "am" ? " before the open" : ""
        return (e.confirmed ? "Earnings confirmed for " : "Earnings expected about ") + e.date + when
    }

    var body: some View {
        let card = VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(ranked.map { $0.company.isEmpty ? $0.symbol : $0.company } ?? idea.symbol).font(.headline).lineLimit(1)
                if let ranked, !ranked.company.isEmpty { Text(idea.symbol).font(.caption).foregroundStyle(AppTheme.muted) }
                Spacer(minLength: 8)
                SideTag(direction: idea.direction)
            }
            if !sentence.isEmpty { Text(sentence).font(.subheadline).foregroundStyle(.white.opacity(0.85)).fixedSize(horizontal: false, vertical: true) }
            HStack(alignment: .top, spacing: 8) {
                if let ranked { FactColumn(title: "Price now", value: money(ranked.price)) }
                else { FactColumn(title: "Signal price", value: money(idea.entry)) }
                FactColumn(title: PlainWords.exitLabel(idea.direction), value: money(idea.stop))
                FactColumn(title: "Risk", value: PlainWords.risk(entry: idea.entry, stop: idea.stop, stopPct: ranked?.stopPct))
            }
            if let text = earningsText {
                Label(text, systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(AppTheme.amber)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)

        if let ranked {
            Button { showing = ranked } label: { card }.buttonStyle(.plain)
                .sheet(item: $showing) { RankedDetailSheet(idea: $0) }
        } else {
            card
        }
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
                Text(holdings.counts.sorted { $0.key < $1.key }.map { "\($0.value) to \(label($0.key))" }.joined(separator: ", "))
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
                Text("Counterpoint: \(item.text)").font(.caption).foregroundStyle(AppTheme.muted)
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "The case for and against")
            if let judge = debate.judge {
                VStack(alignment: .leading, spacing: 3) {
                    Text(leaning(judge)).font(.subheadline.weight(.semibold))
                    Text(judge.verdict).font(.callout)
                    if let change = judge.wouldChangeMyMind { Text("What would change this: " + change).font(.caption).foregroundStyle(AppTheme.muted) }
                }
            }
            claims("For", debate.bull, tint: AppTheme.mint, rebuttals: debate.rebuttals.bull)
            claims("Against", debate.bear, tint: AppTheme.red, rebuttals: debate.rebuttals.bear)
            Text(debate.droppedClaims > 0 ? "\(debate.droppedClaims) point\(debate.droppedClaims == 1 ? " was" : "s were") left out because a figure didn't match the data. This reading doesn't change the strength." : "Every figure quoted was checked against the data. This reading doesn't change the strength.")
                .font(.caption2).foregroundStyle(AppTheme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }
}


/// Shares that keep the loss at the stop within the user's risk limit, capped at 25% of the account. Settings live on this device only.
enum SizingMath {
    static func shares(_ idea: RankedIdea) -> Int? {
        let account = UserDefaults.standard.double(forKey: "sizing.account")
        let riskPct = (UserDefaults.standard.object(forKey: "sizing.riskPct") as? Double) ?? 1.0
        let perShare = abs(idea.entry - idea.stop)
        guard account > 0, riskPct > 0, perShare > 0, idea.price > 0 else { return nil }
        let byRisk = Int((account * riskPct / 100 / perShare).rounded(.down))
        let byCap = Int((account * 0.25 / idea.price).rounded(.down))
        let n = max(0, min(byRisk, byCap))
        return n > 0 ? n : nil
    }
    static func shareText(_ idea: RankedIdea) -> String { shares(idea).map(String.init) ?? "" }
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
