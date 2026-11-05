import SwiftUI

/// Shown once before anything else: the app is research only and gives no investment advice.
struct DisclaimerView: View {
    @EnvironmentObject private var model: AppModel
    @ScaledMetric(relativeTo: .largeTitle) private var titleSize = 36

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Image(systemName: "info.circle")
                    .font(.system(size: 34))
                    .foregroundStyle(AppTheme.amber)
                Text("Research, not advice")
                    .font(.system(size: titleSize, weight: .semibold, design: .rounded))
                Text("IntelligentPortfolio shows market research and educational information from third-party data. It is not investment, financial, tax or legal advice, and it is not a recommendation to buy or sell anything.")
                    .foregroundStyle(AppTheme.muted)
                Text("Signals, targets, stops and test results are scenarios. Data can be delayed or wrong, past results do not predict future ones, and trading can lose money. The app is read-only: it never connects to a brokerage or places orders.")
                    .foregroundStyle(AppTheme.muted)
                HStack(spacing: 18) {
                    Link("Terms", destination: APIClient.productionOrigin.appending(path: "terms"))
                    Link("Privacy", destination: APIClient.productionOrigin.appending(path: "privacy"))
                }
                .font(.footnote)
                Button {
                    model.acceptDisclaimer()
                } label: {
                    Text("I understand").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(AppTheme.amber)
            }
            .padding(24)
            .readableWidth()
        }
    }
}
