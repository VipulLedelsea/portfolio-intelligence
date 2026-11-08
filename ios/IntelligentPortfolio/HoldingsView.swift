import SwiftUI

/// Stocks the user bought, entered by hand. The server re-checks each against the 4H and daily trend.
struct HoldingsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var showingAdd = false
    @State private var positionEdit: PositionEdit?
    @State private var section = HoldingsSection.positions
    @State private var detail = HoldingsSection.portfolio
    @State private var undoTarget: Holding?
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            Group {
                if model.isGuest {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Connect an account to track holdings.").font(.headline)
                            Text("Your positions are saved to your account so they can be checked against the market.")
                                .foregroundStyle(AppTheme.muted)
                            Button("Connect an account") { model.leaveGuest() }
                                .buttonStyle(.borderedProminent)
                                .tint(AppTheme.amber)
                        }
                        .panel()
                        .padding(16)
                        .readableWidth()
                    }
                } else {
                    GeometryReader { outer in
                        let posture = AdaptiveLayout.posture(outer.size, outer.safeAreaInsets, model.fold)
                        if posture == .creaseAcross {
                            // Half open: Positions above the crease, the other three sections below it.
                            let split = AdaptiveLayout.creaseSplit(outer.size, outer.safeAreaInsets)
                            VStack(spacing: 0) {
                                scrolling(.positions).frame(height: split.top)
                                Rectangle().fill(AppTheme.line).frame(height: 10)
                                VStack(spacing: 0) {
                                    SectionTabs(selection: $detail, cases: HoldingsSection.detailCases)
                                    detailPager
                                }
                                .frame(height: split.bottom)
                            }
                        } else if posture != .compact {
                            // Fully unfolded: Positions on the left, the other three sections share the right pane.
                            HStack(spacing: 0) {
                                scrolling(.positions)
                                    .frame(width: posture == .creaseDown ? AdaptiveLayout.creaseLeftWidth(outer.size, outer.safeAreaInsets) : AdaptiveLayout.listPaneWidth)
                                Rectangle().fill(AppTheme.line).frame(width: 1)
                                VStack(spacing: 0) {
                                    SectionTabs(selection: $detail, cases: HoldingsSection.detailCases)
                                    detailPager
                                }
                                .frame(maxWidth: .infinity)
                            }
                        } else {
                            pager
                        }
                    }
                    .animation(.smooth(duration: 0.4), value: model.fold)
                }
            }
            .sensoryFeedback(.selection, trigger: section)
            .background(AppTheme.background)
            .navigationTitle("My holdings")
            .solidNavigationBar()
            .toolbar {
                if !model.isGuest {
                    ToolbarItem(placement: .principal) { MarketPill() }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showingAdd = true } label: { Image(systemName: "plus") }
                            .accessibilityLabel("Add a holding")
                    }
                }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await model.refreshHoldings() } }
            }
            .sheet(isPresented: $showingAdd) { AddHoldingSheet().environmentObject(model) }
            .sheet(item: $positionEdit) { edit in PositionSheet(holding: edit.holding, startsAsSell: edit.sell).environmentObject(model) }
            .confirmationDialog("Undo last entry?", isPresented: Binding(get: { undoTarget != nil }, set: { if !$0 { undoTarget = nil } }), titleVisibility: .visible) {
                Button("Undo", role: .destructive) {
                    if let entry = undoTarget?.lastEntry { Task { await model.undoEntry(id: entry.id) } }
                    undoTarget = nil
                }
                Button("Cancel", role: .cancel) { undoTarget = nil }
            } message: {
                if let entry = undoTarget?.lastEntry {
                    Text("\(entry.side == "BUY" ? "Bought" : "Sold") \(shareText(entry.shares)) shares at \(money(undoTarget?.currencySymbol ?? "$", undoTarget?.priceDecimals ?? 2, entry.price)). It stays in History marked as undone and no longer counts in Performance.")
                }
            }
            .task {
                // Re-check automatically while this tab is on screen.
                while !Task.isCancelled {
                    await model.refreshHoldings()
                    try? await Task.sleep(for: model.holdingsRefreshInterval)
                }
            }
        }
    }
    /// The Portfolio, Performance and History pages beside or below Positions. Swiping moves between them and the tabs above follow.
    private var detailPager: some View {
        TabView(selection: $detail) {
            ForEach(HoldingsSection.detailCases) { tab in
                scrolling(tab).tag(tab)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
    }

    private func scrolling(_ tab: HoldingsSection) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) { page(for: tab) }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .id(tab)
    }

    private var pager: some View {
        VStack(spacing: 0) {
            SectionTabs(selection: $section, cases: HoldingsSection.allCases)
            // A paged TabView keeps swiping and the tab bar above in step; the pages scroll vertically on their own.
            TabView(selection: $section) {
                ForEach(HoldingsSection.allCases) { tab in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 14) { page(for: tab) }
                            .padding(16)
                            .readableWidth()
                            .frame(maxWidth: .infinity, alignment: .topLeading)
                    }
                    .tag(tab)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
        }
    }

    @ViewBuilder
    private func page(for tab: HoldingsSection) -> some View {
        switch tab {
        case .portfolio: PortfolioPanel()
        case .performance: PerformancePanel()
        case .history: HistoryPanel()
        case .positions: positionsPage
        }
    }

    @ViewBuilder
    private var positionsPage: some View {
        if let data = model.holdings {
            HStack(spacing: 6) {
                if model.isLoadingHoldings { ProgressView().controlSize(.small) }
                Text(updatedText(data))
            }
            .font(.caption)
            .foregroundStyle(AppTheme.muted)
            if let alerts = data.alerts, !alerts.items.isEmpty {
                AlertsCard(alerts: alerts)
                    .task(id: alerts.unseen) {
                        guard alerts.unseen > 0 else { return }
                        try? await Task.sleep(for: .seconds(4))
                        await model.markAlertsSeen()
                    }
            }
            ForEach(data.totals) { total in
                HeroCard(total: total, multiple: data.totals.count > 1)
            }
            if data.open.count > 1 {
                AllocationBar(holdings: data.open)
            }
            if data.open.isEmpty {
                Text("No holdings yet. Tap + to add a stock you bought, with the price and number of shares.")
                    .foregroundStyle(AppTheme.muted)
                    .panel()
            }
            ForEach(data.open) { holding in
                HoldingCard(holding: holding, onBuyMore: { positionEdit = PositionEdit(holding: holding, sell: false) }, onSell: { positionEdit = PositionEdit(holding: holding, sell: true) }, onUndo: { undoTarget = holding })
            }
            if !data.closed.isEmpty {
                SectionLabel(text: "Closed positions")
                ForEach(data.closed) { item in
                    HStack {
                        Text("\(item.symbol) · \(shareText(item.shares)) sh")
                        Spacer()
                        Text("\(signed(item.currencySymbol, item.pnlValue)) (\(String(format: "%+.2f", item.pnlPct))%)")
                            .foregroundStyle(item.pnlValue >= 0 ? AppTheme.mint : AppTheme.red)
                    }
                    .font(.footnote)
                }
            }
            Text(data.disclaimer)
                .font(.caption)
                .foregroundStyle(AppTheme.muted)
        } else {
            ProgressView("Checking your holdings…").tint(AppTheme.amber)
        }
    }
}

/// The four Holdings tabs as a heading bar: the current tab is bold with an amber underline that slides to the next
/// one, the others are muted. On narrow screens or with large text it scrolls sideways instead of truncating.
/// What happened to your holdings while the app was closed. New items have a dot; they are marked seen a few seconds after they appear.
private struct AlertsCard: View {
    let alerts: HoldingAlerts

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: alerts.unseen > 0 ? "Alerts · \(alerts.unseen) new" : "Recent alerts")
            ForEach(alerts.items.prefix(6)) { item in
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        if item.seenAt == nil { Circle().fill(item.severity == "high" ? Color.red : Color.orange).frame(width: 8, height: 8) }
                        Text(item.title).font(.subheadline.weight(.semibold))
                    }
                    Text(item.detail).font(.caption).foregroundStyle(AppTheme.muted)
                }
                .opacity(item.seenAt == nil ? 1 : 0.7)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }
}

private struct SectionTabs: View {
    @Binding var selection: HoldingsSection
    var cases: [HoldingsSection] = HoldingsSection.allCases
    @Namespace private var pill

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 4) { ForEach(cases) { tab in segment(tab).frame(maxWidth: .infinity) } }
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 4) { ForEach(cases) { tab in segment(tab).id(tab) } }
                }
                .onChange(of: selection) { _, tab in withAnimation(.snappy) { proxy.scrollTo(tab, anchor: .center) } }
            }
        }
        .padding(4)
        .background(AppTheme.panel, in: Capsule())
        .padding(.horizontal, 16).padding(.vertical, 8)
        .background(AppTheme.background)
    }

    private func segment(_ tab: HoldingsSection) -> some View {
        let selected = selection == tab
        return Button { withAnimation(.snappy) { selection = tab } } label: {
            Text(tab.rawValue)
                .font(.subheadline.weight(selected ? .semibold : .medium))
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
                .foregroundStyle(selected ? AppTheme.amber : AppTheme.muted)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .frame(maxWidth: .infinity)
                .background {
                    if selected { Capsule().fill(AppTheme.amber.opacity(0.16)).matchedGeometryEffect(id: "pill", in: pill) }
                }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private enum HoldingsSection: String, CaseIterable, Identifiable {
    case positions = "Positions"
    case portfolio = "Portfolio"
    case performance = "Performance"
    case history = "History"
    var id: String { rawValue }
    static let detailCases: [HoldingsSection] = [.portfolio, .performance, .history]
    var icon: String {
        switch self {
        case .positions: "briefcase"
        case .portfolio: "chart.pie"
        case .performance: "chart.line.uptrend.xyaxis"
        case .history: "clock.arrow.circlepath"
        }
    }
}

private func updatedText(_ data: HoldingsResponse) -> String {
    let when = PairingExpiryParser.date(from: data.updatedAt)?.formatted(date: .omitted, time: .standard) ?? data.updatedAt
    let every = (data.refreshAfterSeconds ?? 300) >= 600 ? "every 10 minutes, markets closed" : "every 5 minutes, market open"
    return "Updated \(when) · auto-updates \(every)"
}

private func money(_ symbol: String, _ decimals: Int, _ value: Double) -> String {
    symbol + value.formatted(.number.precision(.fractionLength(decimals)))
}

private func signed(_ symbol: String, _ value: Double) -> String {
    (value < 0 ? "−" : "+") + money(symbol, 2, abs(value))
}

private func shareText(_ shares: Double) -> String {
    shares.formatted(.number.precision(.fractionLength(0...4)))
}

/// The same colour for the same ticker everywhere (monogram, allocation bar).
private func symbolColour(_ symbol: String) -> Color {
    AppTheme.colour(at: symbol.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0xFFFF })
}

private struct HeroCard: View {
    let total: HoldingTotal
    let multiple: Bool

    var body: some View {
        let positive = total.pnlValue >= 0
        let invested = total.value - total.pnlValue
        VStack(alignment: .leading, spacing: 10) {
            Text(multiple ? "Portfolio value · \(total.market)" : "Portfolio value")
                .font(.footnote).foregroundStyle(AppTheme.muted)
            Text(money(total.currencySymbol, 2, total.value))
                .font(.system(size: 38, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .contentTransition(.numericText())
                .minimumScaleFactor(0.6).lineLimit(1)
            HStack(spacing: 8) {
                PnLChip(text: "\(money(total.currencySymbol, 2, abs(total.pnlValue))) · \(String(format: "%.2f", abs(total.pnlPct)))%", positive: positive)
                Text("on \(money(total.currencySymbol, 0, invested)) invested")
                    .font(.caption).foregroundStyle(AppTheme.muted).lineLimit(1).minimumScaleFactor(0.7)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(alignment: .topTrailing) {
            RadialGradient(colors: [(positive ? AppTheme.mint : AppTheme.red).opacity(0.14), .clear], center: .center, startRadius: 0, endRadius: 100)
                .frame(width: 200, height: 200).offset(x: 40, y: -50).allowsHitTesting(false)
        }
        .background(AppTheme.panel, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(AppTheme.hairline, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

/// How the portfolio value is split between holdings, as one slim bar with a legend of the largest.
private struct AllocationBar: View {
    let holdings: [Holding]

    private var slices: [(symbol: String, weight: Double)] {
        // Mixed currencies can't be added up, so weigh the currency with the most value.
        let byCurrency = Dictionary(grouping: holdings, by: \.currencySymbol)
        guard let group = byCurrency.max(by: { $0.value.compactMap(\.value).reduce(0, +) < $1.value.compactMap(\.value).reduce(0, +) })?.value else { return [] }
        let items = group.compactMap { h in h.value.map { (h.symbol, $0) } }.sorted { $0.1 > $1.1 }
        let total = items.map(\.1).reduce(0, +)
        guard total > 0 else { return [] }
        return items.map { ($0.0, $0.1 / total) }
    }

    var body: some View {
        let shown = Array(slices.prefix(4))
        if !shown.isEmpty {
            let rest = max(0, 1 - shown.map(\.weight).reduce(0, +))
            VStack(alignment: .leading, spacing: 8) {
                GeometryReader { geo in
                    HStack(spacing: 2) {
                        ForEach(shown, id: \.symbol) { s in
                            Capsule().fill(symbolColour(s.symbol)).frame(width: max(4, geo.size.width * s.weight - 2))
                        }
                        if rest > 0.005 { Capsule().fill(AppTheme.line).frame(maxWidth: .infinity) }
                    }
                }
                .frame(height: 7)
                HStack(spacing: 12) {
                    ForEach(shown, id: \.symbol) { s in
                        HStack(spacing: 4) {
                            Circle().fill(symbolColour(s.symbol)).frame(width: 6, height: 6)
                            Text("\(s.symbol) \(Int((s.weight * 100).rounded()))%")
                        }
                    }
                    if rest > 0.005 { Text("Other \(Int((rest * 100).rounded()))%") }
                    Spacer(minLength: 0)
                }
                .font(.caption2).foregroundStyle(AppTheme.muted).lineLimit(1).minimumScaleFactor(0.7)
            }
            .padding(.horizontal, 4)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Allocation: " + shown.map { "\($0.symbol) \(Int(($0.weight * 100).rounded())) percent" }.joined(separator: ", "))
        }
    }
}

private struct HoldingCard: View {
    /// Tile columns widen with the text size, so at large sizes they stack in one column instead of squeezing words.
    @ScaledMetric(relativeTo: .caption) private var tileMinimum: CGFloat = 130
    let holding: Holding
    let onBuyMore: () -> Void
    let onSell: () -> Void
    let onUndo: () -> Void

    private var tint: Color {
        switch holding.action {
        case "HOLD": AppTheme.mint
        case "WATCH": AppTheme.amber
        case "TAKE_PROFIT": Color(red: 0.43, green: 0.78, blue: 1.0)
        case "EXIT": AppTheme.red
        default: AppTheme.muted
        }
    }

    @State private var expanded = false

    private var titleBlock: some View {
        HStack(spacing: 12) {
            Monogram(symbol: holding.symbol, colour: symbolColour(holding.symbol))
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(holding.symbol).font(.headline)
                    Text(holding.market).font(.caption).foregroundStyle(AppTheme.muted)
                }
                Text("\(shareText(holding.shares)) shares · avg \(money(holding.currencySymbol, holding.priceDecimals, holding.buyPrice))")
                    .font(.footnote)
                    .foregroundStyle(AppTheme.muted)
            }
        }
    }

    private var valueBlock: some View {
        VStack(alignment: .trailing, spacing: 3) {
            if let value = holding.value { Text(money(holding.currencySymbol, 2, value)).font(.headline).monospacedDigit() }
            if let pct = holding.pnlPct {
                PnLChip(text: String(format: "%.2f%%", abs(pct)), positive: pct >= 0)
            }
            Text(holding.actionLabel)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(tint)
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(tint.opacity(0.15), in: Capsule())
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button { withAnimation(.snappy) { expanded.toggle() } } label: {
                HStack(spacing: 10) {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .center) { titleBlock; Spacer(minLength: 8); valueBlock }
                        VStack(alignment: .leading, spacing: 8) { titleBlock; valueBlock }
                    }
                    Image(systemName: "chevron.down")
                        .font(.caption)
                        .foregroundStyle(AppTheme.muted)
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(expanded ? "Hides the details" : "Shows the details")
            if expanded { details }
        }
        .panel()
    }

    @ViewBuilder
    private var details: some View {
        let symbol = holding.currencySymbol, decimals = holding.priceDecimals
        Text("Bought \(holding.boughtAt) at \(money(symbol, decimals, holding.buyPrice))")
            .font(.footnote)
            .foregroundStyle(AppTheme.muted)
        Text(holding.headline).font(.subheadline.bold())
        if let price = holding.currentPrice, let pnl = holding.pnlValue, let pct = holding.pnlPct {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: tileMinimum), spacing: 8)], spacing: 8) {
                stat("Now", money(symbol, decimals, price))
                stat("Profit / loss", "\(signed(symbol, pnl)) (\(String(format: "%+.2f", pct))%)", color: pnl >= 0 ? AppTheme.mint : AppTheme.red)
                if let v = holding.stopLevel { stat("Exit line", money(symbol, decimals, v)) }
                if let v = holding.trailingLevel { stat("Trailing (4H)", money(symbol, decimals, v)) }
                if let v = holding.target1 { stat("Profit zone 1", money(symbol, decimals, v)) }
                if let v = holding.target2 { stat("Profit zone 2", money(symbol, decimals, v)) }
                if let a = holding.trend4h, let d = holding.dailyTrend { stat("4H · Daily", "\(a) · \(d)") }
            }
        }
        ForEach(holding.reasons, id: \.self) { reason in
            Text("• \(reason)").font(.footnote).foregroundStyle(AppTheme.muted)
        }
        if let note = holding.stopNote {
            Text("Protective level: \(note).").font(.caption).foregroundStyle(AppTheme.muted)
        }
        if let lines = holding.referenceLines, !lines.isEmpty {
            ReferenceLinesList(lines: lines, currency: symbol, decimals: decimals)
        }
        if let events = holding.levelEvents?.filter({ $0.kind != "INITIAL" }), !events.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                SectionLabel(text: "Level changes")
                ForEach(events) { event in
                    Text("• \(event.reason)").font(.caption).foregroundStyle(AppTheme.amber)
                }
            }
        }
        if let previous = holding.previousAction, previous != holding.action, holding.action != "NO_DATA" {
            Text("Changed from \(label(previous)) to \(holding.actionLabel)")
                .font(.caption.bold())
                .foregroundStyle(tint)
        }
        HStack {
            Button("Buy more", action: onBuyMore).buttonStyle(.bordered).tint(AppTheme.amber)
            Button("Sell", action: onSell).buttonStyle(.bordered)
            if holding.lastEntry != nil {
                Button("Undo last entry", action: onUndo).buttonStyle(.bordered)
            }
        }
        .font(.footnote)
    }

    private func label(_ action: String) -> String {
        switch action {
        case "HOLD": "Hold"
        case "WATCH": "Watch closely"
        case "TAKE_PROFIT": "Consider taking profit"
        case "EXIT": "Exit signal"
        default: action
        }
    }

    private func stat(_ title: String, _ value: String, color: Color = .primary) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption2).foregroundStyle(AppTheme.muted)
            Text(value).font(.footnote.bold()).foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .tile()
    }
}

private struct AddHoldingSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var market = "US"
    @State private var symbol = ""
    @State private var shares = ""
    @State private var price = ""
    @State private var date = Date()
    @State private var saving = false

    private var parsedShares: Double? { Double(shares.replacingOccurrences(of: ",", with: ".")) }
    private var parsedPrice: Double? { Double(price.replacingOccurrences(of: ",", with: ".")) }
    private var canSave: Bool {
        !symbol.trimmingCharacters(in: .whitespaces).isEmpty && (parsedShares ?? 0) > 0 && (parsedPrice ?? 0) > 0 && !saving
    }

    var body: some View {
        NavigationStack {
            Form {
                Picker("Market", selection: $market) {
                    Text("US stocks").tag("US")
                    Text("India (BSE)").tag("IN")
                }
                TextField("Ticker, e.g. AAPL", text: $symbol)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                TextField("Shares", text: $shares).keyboardType(.decimalPad)
                TextField("Price paid per share", text: $price).keyboardType(.decimalPad)
                DatePicker("Bought on", selection: $date, in: ...Date(), displayedComponents: .date)
                Text("Only recorded here for research. Nothing is sent to a broker.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .navigationTitle("Add holding")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        guard let shares = parsedShares, let price = parsedPrice else { return }
                        saving = true
                        Task {
                            let day = date.formatted(.iso8601.year().month().day())
                            let saved = await model.addHolding(symbol: symbol.trimmingCharacters(in: .whitespaces).uppercased(), market: market, shares: shares, price: price, boughtAt: day)
                            saving = false
                            if saved { dismiss() }
                        }
                    }
                    .disabled(!canSave)
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}

private struct PositionEdit: Identifiable {
    let holding: Holding
    let sell: Bool
    var id: String { holding.id + (sell ? "-sell" : "-buy") }
}

/// One place to record buying more or selling some or all shares of a holding. Buying keeps a weighted-average
/// buy price; selling records realised profit, and selling everything closes the position.
private struct PositionSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let holding: Holding
    @State private var selling: Bool
    @State private var shares = ""
    @State private var price: String
    @State private var saving = false

    init(holding: Holding, startsAsSell: Bool) {
        self.holding = holding
        _selling = State(initialValue: startsAsSell)
        _price = State(initialValue: startsAsSell ? (holding.currentPrice.map { String($0) } ?? "") : "")
    }

    private var count: Double? { Double(shares.replacingOccurrences(of: ",", with: ".")) }
    private var value: Double? { Double(price.replacingOccurrences(of: ",", with: ".")) }
    private var canSave: Bool {
        guard let n = count, n > 0, let p = value, p > 0, !saving else { return false }
        return !selling || n <= holding.shares + 1e-9
    }

    private var summary: String? {
        guard let n = count, n > 0, let p = value, p > 0 else { return nil }
        let symbol = holding.currencySymbol, decimals = holding.priceDecimals
        if selling {
            guard n <= holding.shares + 1e-9 else { return "You only hold \(shareText(holding.shares)) shares." }
            let profit = (p - holding.buyPrice) * n
            let pct = (p / holding.buyPrice - 1) * 100
            let lead = n >= holding.shares - 1e-9 ? "This closes the position. " : "\(shareText(holding.shares - n)) shares remain. "
            return "\(lead)Realised \(signed(symbol, profit)) (\(String(format: "%+.2f", pct))%)"
        }
        let total = holding.shares + n
        let average = (holding.shares * holding.buyPrice + n * p) / total
        return "New position: \(shareText(total)) shares at an average of \(money(symbol, decimals, average))."
    }

    var body: some View {
        NavigationStack {
            Form {
                Picker("Action", selection: $selling) {
                    Text("Buy more").tag(false)
                    Text("Sell").tag(true)
                }
                .pickerStyle(.segmented)
                .onChange(of: selling) { _, isSelling in
                    price = isSelling ? (holding.currentPrice.map { String($0) } ?? "") : ""
                }
                Text("You hold \(shareText(holding.shares)) shares of \(holding.symbol) at an average of \(money(holding.currencySymbol, holding.priceDecimals, holding.buyPrice)).")
                HStack {
                    TextField(selling ? "Shares sold" : "Extra shares bought", text: $shares).keyboardType(.decimalPad)
                    if selling {
                        Button("All") { shares = shareText(holding.shares) }.buttonStyle(.bordered)
                    }
                }
                TextField(selling ? "Price sold at, per share" : "Price paid per share", text: $price).keyboardType(.decimalPad)
                if let summary { Text(summary).font(.footnote.bold()) }
                Text(selling ? "Only recorded here for research. It does not place an order." : "Only recorded here for research. The protective level and targets follow the new average price.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .navigationTitle(holding.symbol)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(selling ? "Record sale" : "Save") {
                        guard let n = count, let p = value else { return }
                        saving = true
                        Task {
                            let saved = selling
                                ? await model.sellHolding(id: holding.id, shares: n, price: p)
                                : await model.increaseHolding(id: holding.id, shares: n, price: p)
                            saving = false
                            if saved { dismiss() }
                        }
                    }
                    .disabled(!canSave)
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}

/// Results from the user's own closed sales, kept per market because currencies cannot be added together.
private struct PerformancePanel: View {
    @EnvironmentObject private var model: AppModel
    @ScaledMetric(relativeTo: .caption) private var tileMinimum: CGFloat = 140

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let stats = model.holdingStats {
                if stats.markets.isEmpty {
                    Text("No closed trades yet. Record a sale with Sell on a holding and your results appear here.")
                        .foregroundStyle(AppTheme.muted)
                        .panel()
                }
                ForEach(stats.markets) { market in
                    marketSection(market)
                }
                Text(stats.disclaimer).font(.caption).foregroundStyle(AppTheme.muted)
            } else {
                ProgressView("Loading performance…").tint(AppTheme.amber)
            }
        }
        .task { await model.refreshHoldingStats() }
    }

    @ViewBuilder
    private func marketSection(_ m: MarketStats) -> some View {
        Text(m.market == "IN" ? "INDIA (BSE)" : "US STOCKS")
            .font(.caption.monospaced().bold()).foregroundStyle(AppTheme.amber)
        LazyVGrid(columns: [GridItem(.adaptive(minimum: tileMinimum), spacing: 8)], spacing: 8) {
            tile("Closed trades", "\(m.closedTrades)")
            tile("Win rate", "\(String(format: "%.1f", m.winRate))% (\(m.wins) of \(m.closedTrades))")
            tile("Realised P/L", signed(m.currencySymbol, m.realizedPnl), color: m.realizedPnl >= 0 ? AppTheme.mint : AppTheme.red)
            tile("Profit factor", m.profitFactor.map { String(format: "%.2f", $0) } ?? "no losing trades")
            tile("Avg per trade", String(format: "%+.2f%%", m.avgReturnPct), color: m.avgReturnPct >= 0 ? AppTheme.mint : AppTheme.red)
            tile("Average win", String(format: "%+.2f%%", m.avgWinPct), color: AppTheme.mint)
            tile("Average loss", m.losses > 0 ? String(format: "%.2f%%", m.avgLossPct) : "none", color: AppTheme.red)
            tile("Time held", String(format: "%.1f days", m.avgHoldDays))
            tile("Best trade", "\(m.best.symbol) \(String(format: "%+.1f", m.best.pct))%", color: m.best.pct >= 0 ? AppTheme.mint : AppTheme.red)
            tile("Worst trade", "\(m.worst.symbol) \(String(format: "%+.1f", m.worst.pct))%", color: m.worst.pct >= 0 ? AppTheme.mint : AppTheme.red)
        }
        let largest = max(m.months.map { abs($0.pnl) }.max() ?? 1, 1)
        VStack(spacing: 6) {
            ForEach(m.months) { month in
                HStack(spacing: 10) {
                    Text(month.month).font(.caption.monospaced()).foregroundStyle(AppTheme.muted).lineLimit(1).fixedSize()
                    GeometryReader { proxy in
                        Rectangle()
                            .fill(month.pnl >= 0 ? AppTheme.mint.opacity(0.55) : AppTheme.red.opacity(0.55))
                            .frame(width: max(3, proxy.size.width * abs(month.pnl) / largest), height: 10)
                            .frame(maxHeight: .infinity, alignment: .center)
                    }
                    .frame(height: 14)
                    Text("\(signed(m.currencySymbol, month.pnl)) · \(month.trades)")
                        .font(.caption.monospaced())
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .fixedSize()
                        .foregroundStyle(month.pnl >= 0 ? AppTheme.mint : AppTheme.red)
                }
            }
        }
    }

    private func tile(_ title: String, _ value: String, color: Color = .primary) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption2).foregroundStyle(AppTheme.muted)
            Text(value).font(.footnote.bold()).foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .tile()
    }
}

/// Every purchase and sale the user recorded, newest first.
private struct HistoryPanel: View {
    @EnvironmentObject private var model: AppModel
    @State private var undoTarget: TradeEntry?
    @State private var editTarget: TradeEntry?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let stats = model.holdingStats {
                if stats.history.isEmpty {
                    Text("No trades recorded yet.").foregroundStyle(AppTheme.muted).panel()
                }
                ForEach(stats.history) { trade in
                    let bought = trade.side == "BUY"
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(trade.voided ? "Undone · " : "")\(bought ? "Bought" : "Sold") \(trade.symbol)")
                                .font(.subheadline.bold())
                                .strikethrough(trade.voided)
                                .foregroundStyle(trade.voided ? AppTheme.muted : bought ? AppTheme.mint : AppTheme.red)
                            Text("\(shareText(trade.shares)) sh at \(money(trade.currencySymbol, trade.priceDecimals, trade.price)) · \(dateText(trade.at))")
                                .font(.caption)
                                .foregroundStyle(AppTheme.muted)
                        }
                        Spacer()
                        if let pnl = trade.realizedPnl {
                            Text(signed(trade.currencySymbol, pnl))
                                .font(.footnote.bold())
                                .strikethrough(trade.voided)
                                .foregroundStyle(trade.voided ? AppTheme.muted : pnl >= 0 ? AppTheme.mint : AppTheme.red)
                        }
                        if trade.canUndo, trade.edit != nil {
                            Button("Edit") { editTarget = trade }
                                .buttonStyle(.bordered)
                                .font(.footnote)
                        }
                        if trade.canUndo {
                            Button("Undo") { undoTarget = trade }
                                .buttonStyle(.bordered)
                                .font(.footnote)
                        }
                    }
                    .opacity(trade.voided ? 0.55 : 1)
                    .panel()
                }
                Text("Only the newest entry for a stock can be undone or edited, so averages stay exact. Undone entries (including the old version of an edited one) stay here, marked as undone, and do not count in Performance.")
                    .font(.caption)
                    .foregroundStyle(AppTheme.muted)
            } else {
                ProgressView("Loading history…").tint(AppTheme.amber)
            }
        }
        .task { await model.refreshHoldingStats() }
        .sheet(item: $editTarget) { trade in EditEntrySheet(trade: trade).environmentObject(model) }
        .confirmationDialog("Undo this entry?", isPresented: Binding(get: { undoTarget != nil }, set: { if !$0 { undoTarget = nil } }), titleVisibility: .visible) {
            Button("Undo", role: .destructive) {
                if let entry = undoTarget { Task { await model.undoEntry(id: entry.id) } }
                undoTarget = nil
            }
            Button("Cancel", role: .cancel) { undoTarget = nil }
        } message: {
            Text("It stays in History marked as undone and no longer counts in Performance.")
        }
    }

    private func dateText(_ iso: String) -> String {
        PairingExpiryParser.date(from: iso)?.formatted(date: .abbreviated, time: .omitted) ?? iso
    }
}

/// Corrects the newest entry for a stock. The old version stays in History as undone.
private struct EditEntrySheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let trade: TradeEntry
    @State private var shares: String
    @State private var price: String
    @State private var date: Date
    @State private var saving = false

    init(trade: TradeEntry) {
        self.trade = trade
        _shares = State(initialValue: shareText(trade.shares))
        _price = State(initialValue: String(trade.price))
        _date = State(initialValue: PairingExpiryParser.date(from: trade.at) ?? Date())
    }

    private var canEditShares: Bool { trade.edit?.shares ?? false }
    private var canEditDate: Bool { trade.edit?.date ?? false }
    private var count: Double? { Double(shares.replacingOccurrences(of: ",", with: ".")) }
    private var value: Double? { Double(price.replacingOccurrences(of: ",", with: ".")) }

    var body: some View {
        NavigationStack {
            Form {
                Text("\(trade.side == "BUY" ? "Bought" : "Sold") \(trade.symbol) · \(shareText(trade.shares)) shares at \(money(trade.currencySymbol, trade.priceDecimals, trade.price))")
                TextField("Shares", text: $shares)
                    .keyboardType(.decimalPad)
                    .disabled(!canEditShares)
                    .foregroundStyle(canEditShares ? .primary : .secondary)
                TextField("Price per share", text: $price).keyboardType(.decimalPad)
                if canEditDate {
                    DatePicker("Bought on", selection: $date, in: ...Date(), displayedComponents: .date)
                }
                if !canEditShares {
                    Text("To change how many shares you sold, undo this sale and record it again.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Text("The old version stays in History marked as undone, and Performance uses the corrected one.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .navigationTitle("Edit entry")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        guard let n = count, n > 0, let p = value, p > 0 else { return }
                        saving = true
                        Task {
                            let day = canEditDate ? date.formatted(.iso8601.year().month().day()) : nil
                            let saved = await model.editEntry(id: trade.id, shares: n, price: p, boughtAt: day)
                            saving = false
                            if saved { dismiss() }
                        }
                    }
                    .disabled((count ?? 0) <= 0 || (value ?? 0) <= 0 || saving)
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}

/// How the open holdings fit together, per market: weights, sectors, concentration and risk to the protective levels.
private struct PortfolioPanel: View {
    @EnvironmentObject private var model: AppModel
    @ScaledMetric(relativeTo: .caption) private var tileMinimum: CGFloat = 140

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let portfolio = model.holdings?.portfolio {
                if portfolio.markets.isEmpty {
                    Text("Add a holding to see how your positions fit together.")
                        .foregroundStyle(AppTheme.muted)
                        .panel()
                }
                ForEach(portfolio.markets) { market in
                    marketSection(market, limit: portfolio.limitPct)
                }
                Text("Risk down to protective levels is what you would lose if every holding fell to its protective level. It ignores overnight gaps. Weights use current prices. This is not personal financial advice.")
                    .font(.caption)
                    .foregroundStyle(AppTheme.muted)
            } else {
                ProgressView("Loading portfolio…").tint(AppTheme.amber)
            }
        }
    }

    @ViewBuilder
    private func marketSection(_ m: PortfolioMarket, limit: Double) -> some View {
        let symbol = m.currencySymbol
        Text(m.label.uppercased()).font(.caption.monospaced().bold()).foregroundStyle(AppTheme.amber)
        if let trend = model.holdings?.marketTrends?[m.market] ?? nil { MarketTrendCard(trend: trend) }
        if !m.concentrated.isEmpty {
            let names = m.concentrated.map { "\($0.symbol) is \(String(format: "%.1f", $0.weightPct))%" }.joined(separator: ", ")
            Text("Concentrated: \(names) of your \(m.label) holdings (limit \(Int(limit))%). One bad move in a single stock would hit your total hard.")
                .font(.footnote)
                .foregroundStyle(AppTheme.amber)
                .panel()
        } else if m.singlePosition {
            Text("Only one position, so everything rides on one stock.")
                .font(.footnote)
                .foregroundStyle(AppTheme.amber)
                .panel()
        }
        LazyVGrid(columns: [GridItem(.adaptive(minimum: tileMinimum), spacing: 8)], spacing: 8) {
            tile("Total value", money(symbol, 2, m.value))
            tile("Cost", money(symbol, 2, m.cost))
            tile("Unrealised P/L", "\(signed(symbol, m.pnlValue)) (\(String(format: "%+.2f", m.pnlPct))%)", color: m.pnlValue >= 0 ? AppTheme.mint : AppTheme.red)
            tile("Risk to protective levels", "\(money(symbol, 2, m.riskToStopsValue)) (\(String(format: "%.1f", m.riskToStopsPct))%)")
            tile("Positions", "\(m.positions.count)")
            if let largest = m.positions.first { tile("Largest", "\(largest.symbol) \(String(format: "%.1f", largest.weightPct))%") }
        }
        AllocationDonut(market: m, limit: limit)
        Text("WHAT THE READINGS SAY").font(.caption2).foregroundStyle(AppTheme.muted)
        LazyVGrid(columns: [GridItem(.adaptive(minimum: tileMinimum + 20), spacing: 8)], spacing: 8) {
            ForEach(m.readings) { reading in
                tile(reading.label, "\(reading.count) holding\(reading.count == 1 ? "" : "s") · \(String(format: "%.1f", reading.weightPct))%")
            }
        }
    }

    private func tile(_ title: String, _ value: String, color: Color = .primary) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption2).foregroundStyle(AppTheme.muted)
            Text(value).font(.footnote.bold()).foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .tile()
    }
}

private extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}

private func readingName(_ action: String?) -> String? {
    switch action {
    case "HOLD": "Hold"
    case "WATCH": "Watch closely"
    case "TAKE_PROFIT": "Consider taking profit"
    case "EXIT": "Exit signal"
    default: nil
    }
}

private struct DonutSlice: Identifiable {
    let id: String
    let name: String
    let sub: String
    let value: Double
    let weight: Double
    let pnl: Double?
    let action: String?
    let over: Bool
    let color: Color
}

/// A donut of one market's allocations, by stock or by sector. Slices are coloured per stock (or sector), tapping
/// one shows its details in the middle, and an amber arc marks a stock above the concentration limit.
private struct AllocationDonut: View {
    let market: PortfolioMarket
    let limit: Double
    @State private var bySector = false
    @State private var selected: String?

    private static let palette: [Color] = [0x2A78D6, 0xEB6834, 0x1BAF7A, 0xEDA100, 0xE87BA4, 0x008300, 0x6250D6, 0xE34948].map { Color(hex: $0) }
    private static let other = Color(hex: 0x898781)

    private var slices: [DonutSlice] {
        var items: [DonutSlice]
        if bySector {
            items = market.sectors.map { sector in
                DonutSlice(id: sector.sector, name: sector.sector,
                           sub: market.positions.filter { $0.sector == sector.sector }.map(\.symbol).joined(separator: ", "),
                           value: sector.value, weight: sector.weightPct, pnl: nil, action: nil, over: false, color: .clear)
            }
        } else {
            items = market.positions.map { position in
                DonutSlice(id: position.symbol, name: position.symbol, sub: position.sector, value: position.value, weight: position.weightPct,
                           pnl: position.pnlPct, action: position.action,
                           over: market.positions.count > 1 && position.weightPct > limit, color: .clear)
            }
        }
        if items.count > 8 {
            let rest = Array(items[7...])
            items = Array(items[..<7]) + [DonutSlice(id: "__other", name: "Other (\(rest.count))", sub: rest.map(\.name).joined(separator: ", "),
                                                    value: rest.reduce(0) { $0 + $1.value }, weight: (rest.reduce(0) { $0 + $1.weight } * 10).rounded() / 10,
                                                    pnl: nil, action: nil, over: false, color: .clear)]
        }
        return items.enumerated().map { index, item in
            DonutSlice(id: item.id, name: item.name, sub: item.sub, value: item.value, weight: item.weight, pnl: item.pnl, action: item.action, over: item.over,
                       color: item.id == "__other" ? Self.other : Self.palette[index % Self.palette.count])
        }
    }

    var body: some View {
        let items = slices
        let total = max(items.reduce(0) { $0 + $1.value }, 0.0001)
        let chosen = items.first { $0.id == selected }
        VStack(alignment: .leading, spacing: 10) {
            Picker("Group by", selection: $bySector) {
                Text("By stock").tag(false)
                Text("By sector").tag(true)
            }
            .pickerStyle(.segmented)
            .onChange(of: bySector) { _, _ in selected = nil }

            GeometryReader { proxy in
                let side = min(proxy.size.width, 280)
                ZStack {
                    Canvas { context, size in
                        draw(items: items, total: total, in: &context, size: size)
                    }
                    centre(chosen: chosen, total: total)
                }
                .frame(width: side, height: side)
                .contentShape(Rectangle())
                .onTapGesture(coordinateSpace: .local) { location in
                    selected = hit(at: location, side: side, items: items, total: total)
                }
                .frame(maxWidth: .infinity)
            }
            .frame(height: 280)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Allocations \(bySector ? "by sector" : "by stock"): " + items.map { "\($0.name) \(String(format: "%.1f", $0.weight)) percent" }.joined(separator: ", "))

            VStack(spacing: 0) {
                ForEach(items) { item in
                    Button { selected = selected == item.id ? nil : item.id } label: {
                        HStack(spacing: 10) {
                            Rectangle().fill(item.color).frame(width: 12, height: 12)
                            VStack(alignment: .leading, spacing: 1) {
                                HStack(spacing: 6) {
                                    Text(item.name).font(.footnote.bold())
                                    if item.over {
                                        Text("over \(Int(limit))% limit").font(.caption2.bold()).foregroundStyle(AppTheme.amber)
                                    }
                                }
                                if !item.sub.isEmpty { Text(item.sub).font(.caption2).foregroundStyle(AppTheme.muted).lineLimit(1) }
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 1) {
                                Text("\(String(format: "%.1f", item.weight))%").font(.footnote.bold())
                                Text(item.pnl.map { String(format: "%+.1f%%", $0) } ?? money(market.currencySymbol, 0, item.value))
                                    .font(.caption2)
                                    .foregroundStyle(item.pnl.map { $0 >= 0 ? AppTheme.mint : AppTheme.red } ?? AppTheme.muted)
                            }
                        }
                        .padding(.vertical, 8).padding(.horizontal, 6)
                        .frame(minHeight: 44)
                        .background(item.id == selected ? AppTheme.panel : .clear)
                        .overlay(alignment: .bottom) { Rectangle().fill(AppTheme.line).frame(height: 1) }
                    }
                    .buttonStyle(.plain)
                }
            }
            Text("Tap a slice or a row for detail.\(!bySector && items.contains { $0.over } ? " An amber arc marks a position above the limit." : "")")
                .font(.caption)
                .foregroundStyle(AppTheme.muted)
        }
        .sensoryFeedback(.selection, trigger: selected)
    }

    private func geometry(_ side: CGFloat) -> (centre: CGPoint, outer: CGFloat, inner: CGFloat) {
        let outer = side / 2 - 16
        return (CGPoint(x: side / 2, y: side / 2), outer, outer * 0.65)
    }

    private func draw(items: [DonutSlice], total: Double, in context: inout GraphicsContext, size: CGSize) {
        let g = geometry(min(size.width, size.height))
        var start = -Double.pi / 2
        for item in items {
            let sweep = item.value / total * 2 * Double.pi
            let gap = items.count > 1 ? 0.012 : 0
            let a0 = start + gap, a1 = max(a0 + 0.001, start + sweep - gap)
            let radius = item.id == selected ? g.outer + 5 : g.outer
            var path = Path()
            path.addArc(center: g.centre, radius: radius, startAngle: .radians(a0), endAngle: .radians(a1), clockwise: false)
            path.addArc(center: g.centre, radius: g.inner, startAngle: .radians(a1), endAngle: .radians(a0), clockwise: true)
            path.closeSubpath()
            context.fill(path, with: .color(item.color.opacity(selected == nil || selected == item.id ? 1 : 0.5)))
            if item.over {
                var arc = Path()
                arc.addArc(center: g.centre, radius: g.outer + 10, startAngle: .radians(a0), endAngle: .radians(a1), clockwise: false)
                context.stroke(arc, with: .color(AppTheme.amber), lineWidth: 3)
            }
            start += sweep
        }
    }

    private func hit(at point: CGPoint, side: CGFloat, items: [DonutSlice], total: Double) -> String? {
        let g = geometry(side)
        let dx = point.x - g.centre.x, dy = point.y - g.centre.y
        let distance = (dx * dx + dy * dy).squareRoot()
        guard distance >= g.inner - 8, distance <= g.outer + 14 else { return nil }
        var angle = atan2(dy, dx) + Double.pi / 2
        if angle < 0 { angle += 2 * Double.pi }
        var running = 0.0
        for item in items {
            running += item.value / total * 2 * Double.pi
            if angle <= running { return item.id == selected ? nil : item.id }
        }
        return nil
    }

    @ViewBuilder
    private func centre(chosen: DonutSlice?, total: Double) -> some View {
        VStack(spacing: 2) {
            if let chosen {
                Text(chosen.name).font(.caption).foregroundStyle(AppTheme.muted).lineLimit(1).minimumScaleFactor(0.6)
                Text("\(String(format: "%.1f", chosen.weight))%").font(.title2.bold()).lineLimit(1).minimumScaleFactor(0.6)
                Text(money(market.currencySymbol, 0, chosen.value)).font(.caption).foregroundStyle(AppTheme.muted).lineLimit(1).minimumScaleFactor(0.6)
                if let reading = readingName(chosen.action) { Text(reading).font(.caption2).foregroundStyle(AppTheme.muted).lineLimit(1).minimumScaleFactor(0.6) }
            } else {
                Text("Total").font(.caption).foregroundStyle(AppTheme.muted)
                Text(money(market.currencySymbol, 0, total)).font(.title3.bold()).lineLimit(1).minimumScaleFactor(0.5)
            }
        }
        .frame(width: 130)
        .allowsHitTesting(false)
    }
}
