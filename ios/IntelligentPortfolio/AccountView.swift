import SwiftUI

struct AccountView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openURL) private var openURL
    @State private var confirmDelete = false
    @AppStorage("sizing.account") private var sizingAccount = 0.0
    @AppStorage("sizing.riskPct") private var sizingRisk = 1.0
    private let webURL = APIClient.productionOrigin

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ReadOnlyBadge()
                    Text("This device can request market research and, when connected, view your private learning history. It cannot access a brokerage account, positions, or orders.")
                        .foregroundStyle(AppTheme.muted)
                        .panel()
                    ResearchFootnote()
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Desk display").font(.headline)
                        Picker("Desk display", selection: $model.deskSetting) {
                            ForEach(AppModel.DeskSetting.allCases) { Text($0.rawValue).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        Text("A full-screen ticker for a phone standing on a desk: markets with a price line, and setups with their buy ranges, changing together every 5 seconds. Auto starts it like StandBy does, when the phone is on its side and still (no charger needed), and ends it when you turn it upright or pick it up. On keeps it up all the time. Touch and hold to leave.")
                            .font(.footnote)
                            .foregroundStyle(AppTheme.muted)
                    }
                    .panel()
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Position sizing").font(.headline)
                        TextField("Account size", value: $sizingAccount, format: .number)
                            .keyboardType(.decimalPad)
                            .textFieldStyle(.roundedBorder)
                        TextField("Risk per trade, %", value: $sizingRisk, format: .number)
                            .keyboardType(.decimalPad)
                            .textFieldStyle(.roundedBorder)
                        Text("Used to show how many shares keep the loss at an idea's stop within your limit. Saved on this device only and never sent anywhere.")
                            .font(.footnote)
                            .foregroundStyle(AppTheme.muted)
                    }
                    .panel()
                    Button("Open the website") { openURL(webURL) }
                        .buttonStyle(.bordered)
                    if model.isGuest {
                        Button("Connect an account") { model.leaveGuest() }
                            .buttonStyle(.borderedProminent)
                            .tint(AppTheme.amber)
                    } else {
                        Button("Disconnect this device", role: .destructive) {
                            Task { await model.disconnect() }
                        }
                        .buttonStyle(.bordered)
                        Button("Delete my account data", role: .destructive) { confirmDelete = true }
                            .buttonStyle(.bordered)
                    }
                    HStack(spacing: 18) {
                        Link("Terms", destination: webURL.appending(path: "terms"))
                        Link("Privacy", destination: webURL.appending(path: "privacy"))
                        Link("Support", destination: webURL.appending(path: "support"))
                    }
                    .font(.footnote)
                    Text("Charts by TradingView. Market data from third-party providers.")
                        .font(.caption)
                        .foregroundStyle(AppTheme.muted)
                }
                .padding(20)
                .readableWidth()
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .background(AppTheme.background)
            .navigationTitle("Account")
            .confirmationDialog("Delete your account data?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete everything", role: .destructive) { Task { await model.deleteAccountData() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This erases your research history and every connected device and website session, then disconnects this device. It cannot be undone.")
            }
        }
    }
}
