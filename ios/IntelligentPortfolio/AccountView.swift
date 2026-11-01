import SwiftUI

struct AccountView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openURL) private var openURL
    private let webURL = APIClient.productionOrigin

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                ReadOnlyBadge()
                Text("This device can request market research and view your private learning history. It cannot access a brokerage account, positions, or orders.")
                    .foregroundStyle(AppTheme.muted)
                    .panel()
                Button("Manage subscription on the web") { openURL(webURL) }
                    .buttonStyle(.bordered)
                Button("Disconnect this device", role: .destructive) {
                    Task { await model.disconnect() }
                }
                .buttonStyle(.bordered)
                Spacer()
            }
            .padding(20)
            .readableWidth()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(AppTheme.background)
            .navigationTitle("Account")
        }
    }
}

