import SwiftUI

/// Stocks the user bought, entered by hand. The server re-checks each against the 4H and daily trend.
struct HoldingsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var showingAdd = false
    @State private var sellTarget: Holding?
    @State private var removeTarget: Holding?
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
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
                            HoldingCard(holding: holding, onSell: { sellTarget = holding }, onRemove: { removeTarget = holding })
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
            .refreshable { await model.refreshHoldings(manual: true) }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await model.refreshHoldings() } }
            }
            .sheet(isPresented: $showingAdd) { AddHoldingSheet().environmentObject(model) }
            .sheet(item: $sellTarget) { holding in SellSheet(holding: holding).environmentObject(model) }
            .confirmationDialog("Remove this holding?", isPresented: Binding(get: { removeTarget != nil }, set: { if !$0 { removeTarget = nil } }), titleVisibility: .visible) {
                Button("Remove", role: .destructive) {
                    if let target = removeTarget { Task { await model.removeHolding(id: target.id) } }
                    removeTarget = nil
                }
                Button("Cancel", role: .cancel) { removeTarget = nil }
            } message: { Text("It will not be kept in your closed list.") }
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
    let onSell: () -> Void
    let onRemove: () -> Void

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
                Button("Mark as sold", action: onSell).buttonStyle(.bordered)
                Button("Remove", role: .destructive, action: onRemove).buttonStyle(.bordered)
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

private struct SellSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let holding: Holding
    @State private var price = ""

    var body: some View {
        NavigationStack {
            Form {
                TextField("Price sold at, per share", text: $price).keyboardType(.decimalPad)
                Text("Records the sale for your closed list. It does not place an order.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .navigationTitle("Sold \(holding.symbol)")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear { if let current = holding.currentPrice { price = String(current) } }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        guard let value = Double(price.replacingOccurrences(of: ",", with: ".")), value > 0 else { return }
                        Task { await model.closeHolding(id: holding.id, sellPrice: value); dismiss() }
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}
