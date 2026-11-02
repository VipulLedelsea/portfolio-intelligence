import SwiftUI

struct ConnectionView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openURL) private var openURL
    private let webURL = APIClient.productionOrigin

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack {
                    Text("IntelligentPortfolio")
                        .font(.headline)
                    Spacer()
                    ReadOnlyBadge()
                }

                VStack(alignment: .leading, spacing: 14) {
                    Text("Your research desk, now on iPhone.")
                        .font(.system(size: 42, weight: .medium, design: .serif))
                    Text("Connect your existing web subscription with a one-time code. No brokerage login or order access is requested.")
                        .foregroundStyle(AppTheme.muted)
                }

                if let pairing = model.pairing {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("ONE-TIME CODE")
                            .font(.caption.monospaced().bold())
                            .foregroundStyle(AppTheme.amber)
                        Text(pairing.code)
                            .font(.system(size: 38, weight: .bold, design: .monospaced))
                            .tracking(5)
                            .textSelection(.enabled)
                        Text("Open the website, tap Pair iPhone, and enter this code. This screen will connect automatically after approval.")
                            .foregroundStyle(AppTheme.muted)
                        Label("Code stays valid for up to 10 minutes", systemImage: "clock")
                            .font(.footnote)
                            .foregroundStyle(AppTheme.muted)
                        Button("Open website to approve") { openURL(webURL) }
                            .buttonStyle(.borderedProminent)
                            .tint(AppTheme.amber)
                    }
                    .panel()
                } else {
                    Button {
                        Task { await model.beginPairing() }
                    } label: {
                        Label("Connect existing account", systemImage: "iphone.and.arrow.forward")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AppTheme.amber)
                }

                Button("Browse without an account") {
                    Task { await model.enterGuest() }
                }
                .buttonStyle(.bordered)
                .tint(AppTheme.amber)
                .frame(maxWidth: .infinity)

                HStack(spacing: 18) {
                    Link("Terms", destination: webURL.appending(path: "terms"))
                    Link("Privacy", destination: webURL.appending(path: "privacy"))
                    Link("Support", destination: webURL.appending(path: "support"))
                }
                .font(.footnote)

                Label("Analysis only - no orders are ever placed", systemImage: "lock.fill")
                    .font(.footnote)
                    .foregroundStyle(AppTheme.muted)
            }
            .padding(24)
            .readableWidth()
        }
    }
}

