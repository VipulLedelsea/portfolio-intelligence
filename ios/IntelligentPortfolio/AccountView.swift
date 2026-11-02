import SwiftUI

struct AccountView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openURL) private var openURL
    @State private var confirmDelete = false
    private let webURL = APIClient.productionOrigin

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ReadOnlyBadge()
                    Text("This device can request market research and, when connected, view your private learning history. It cannot access a brokerage account, positions, or orders.")
                        .foregroundStyle(AppTheme.muted)
                        .panel()
                    Text("Research and education only. Nothing here is investment, financial, tax or legal advice.")
                        .font(.footnote)
                        .foregroundStyle(AppTheme.muted)
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
