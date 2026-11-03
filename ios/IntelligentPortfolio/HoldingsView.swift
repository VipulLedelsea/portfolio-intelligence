import SwiftUI

/// Stocks the user bought, entered by hand. The server re-checks each against the 4H and daily trend.
struct HoldingsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var showingAdd = false
    @State private var positionEdit: PositionEdit?
    @State private var section = HoldingsSection.positions
    @State private var undoTarget: Holding?
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if !model.isGuest {
                        Picker("View", selection: $section) {
                            ForEach(HoldingsSection.allCases) { Text($0.rawValue).tag($0) }
                        }
                        .pickerStyle(.segmented)
                    }
                    if model.isGuest {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Connect an account to track holdings.").font(.headline)
                            Text("Your positions are saved to your account so they can be checked against the market.")
                                .foregroundStyle(AppTheme.muted)
                            Button("Connect an account") { model.leaveGuest() }
                                .buttonStyle(.borderedProminent)
                                .tint(AppTheme.amber)
                        }
                        .panel()
                    } else if section == .performance {
                        PerformancePanel()
                    } else if section == .history {
                        HistoryPanel()
                    } else if let data = model.holdings {
                        HStack(spacing: 6) {
                            if model.isLoadingHoldings { ProgressView().controlSize(.small) }
                            Text(updatedText(data))
                        }
                        .font(.caption)
                        .foregroundStyle(AppTheme.muted)
                        ForEach(data.totals) { total in
                            HStack {
                                Text("\(total.market) value \(money(total.currencySymbol, 2, total.value))")
                                Spacer()
                                Text("\(signed(total.currencySymbol, total.pnlValue)) (\(String(format: "%+.2f", total.pnlPct))%)")
                                    .foregroundStyle(total.pnlValue >= 0 ? AppTheme.mint : AppTheme.red)
                            }
                            .font(.subheadline.bold())
                            .panel()
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
                            Text("CLOSED").font(.caption.monospaced().bold()).foregroundStyle(AppTheme.amber)
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
                .padding(16)
                .readableWidth()
            }
            .background(AppTheme.background)
            .navigationTitle("My holdings")
            .toolbar {
                if !model.isGuest {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { Task { await model.refreshHoldings(manual: true) } } label: { Image(systemName: "arrow.clockwise") }
                            .disabled(model.isLoadingHoldings)
                            .accessibilityLabel("Refresh holdings")
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showingAdd = true } label: { Image(systemName: "plus") }
                            .accessibilityLabel("Add a holding")
                    }
                }
            }
            .refreshable { await Task { await model.refreshHoldings(manual: true) }.value }
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
}

private enum HoldingsSection: String, CaseIterable, Identifiable {
    case positions = "Positions"
    case performance = "Performance"
    case history = "History"
    var id: String { rawValue }
}

private func updatedText(_ data: HoldingsResponse) -> String {
    let when = PairingExpiryParser.date(from: data.updatedAt)?.formatted(date: .omitted, time: .standard) ?? data.updatedAt
    let every = (data.refreshAfterSeconds ?? 300) >= 600 ? "every 10 minutes, markets closed" : "every minute, market open"
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

private struct HoldingCard: View {
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

    var body: some View {
        let symbol = holding.currencySymbol, decimals = holding.priceDecimals
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(holding.symbol) · \(holding.market)").font(.title3.bold())
                    Text("\(shareText(holding.shares)) shares at \(money(symbol, decimals, holding.buyPrice)) · \(holding.boughtAt)")
                        .font(.footnote)
                        .foregroundStyle(AppTheme.muted)
                }
                Spacer()
                Text(holding.actionLabel.uppercased())
                    .font(.caption.bold())
                    .foregroundStyle(tint)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .overlay(Rectangle().stroke(tint))
            }
            Text(holding.headline).font(.subheadline.bold())
            if let price = holding.currentPrice, let pnl = holding.pnlValue, let pct = holding.pnlPct {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 8)], spacing: 8) {
                    stat("Now", money(symbol, decimals, price))
                    stat("Profit / loss", "\(signed(symbol, pnl)) (\(String(format: "%+.2f", pct))%)", color: pnl >= 0 ? AppTheme.mint : AppTheme.red)
                    if let v = holding.value { stat("Value", money(symbol, 2, v)) }
                    if let v = holding.stopLevel { stat("Protective level", money(symbol, decimals, v)) }
                    if let v = holding.trailingLevel { stat("Trailing (4H)", money(symbol, decimals, v)) }
                    if let v = holding.target1 { stat("Target 1 (2R)", money(symbol, decimals, v)) }
                    if let v = holding.target2 { stat("Target 2 (3R)", money(symbol, decimals, v)) }
                    if let a = holding.trend4h, let d = holding.dailyTrend { stat("4H · Daily", "\(a) · \(d)") }
                }
            }
            ForEach(holding.reasons, id: \.self) { reason in
                Text("• \(reason)").font(.footnote).foregroundStyle(AppTheme.muted)
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
        .panel()
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
            Text(title.uppercased()).font(.caption2).foregroundStyle(AppTheme.muted)
            Text(value).font(.footnote.bold()).foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .overlay(Rectangle().stroke(AppTheme.line))
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
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 8)], spacing: 8) {
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
                    Text(month.month).font(.caption.monospaced()).foregroundStyle(AppTheme.muted).frame(width: 64, alignment: .leading)
                    GeometryReader { proxy in
                        Rectangle()
                            .fill(month.pnl >= 0 ? AppTheme.mint.opacity(0.55) : AppTheme.red.opacity(0.55))
                            .frame(width: max(3, proxy.size.width * abs(month.pnl) / largest), height: 10)
                            .frame(maxHeight: .infinity, alignment: .center)
                    }
                    .frame(height: 14)
                    Text("\(signed(m.currencySymbol, month.pnl)) · \(month.trades)")
                        .font(.caption.monospaced())
                        .foregroundStyle(month.pnl >= 0 ? AppTheme.mint : AppTheme.red)
                }
            }
        }
    }

    private func tile(_ title: String, _ value: String, color: Color = .primary) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased()).font(.caption2).foregroundStyle(AppTheme.muted)
            Text(value).font(.footnote.bold()).foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .overlay(Rectangle().stroke(AppTheme.line))
    }
}

/// Every purchase and sale the user recorded, newest first.
private struct HistoryPanel: View {
    @EnvironmentObject private var model: AppModel
    @State private var undoTarget: TradeEntry?

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
                        if trade.canUndo {
                            Button("Undo") { undoTarget = trade }
                                .buttonStyle(.bordered)
                                .font(.footnote)
                        }
                    }
                    .opacity(trade.voided ? 0.55 : 1)
                    .panel()
                }
                Text("Only the newest entry for a stock can be undone, so averages stay exact. Undone entries stay here, marked as undone, and do not count in Performance.")
                    .font(.caption)
                    .foregroundStyle(AppTheme.muted)
            } else {
                ProgressView("Loading history…").tint(AppTheme.amber)
            }
        }
        .task { await model.refreshHoldingStats() }
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
