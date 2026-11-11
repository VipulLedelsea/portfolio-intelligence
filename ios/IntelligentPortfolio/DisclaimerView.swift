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


/// The one research line at the foot of a screen, with the way in to the explanation. Replaces a disclaimer on every card.
struct ResearchFootnote: View {
    @State private var showing = false
    var body: some View {
        Button { showing = true } label: {
            (Text("Research, not advice. ").foregroundStyle(AppTheme.muted) + Text("How it works").foregroundStyle(AppTheme.amber))
                .font(.footnote)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showing) { HowItWorksView() }
    }
}

/// How ideas are found, the few words the app uses, and the fine print, said once.
struct HowItWorksView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var showingSettings = false

    private let steps: [(String, String)] = [
        ("Is it clearly rising or falling?", "We look at the daily chart for a steady direction."),
        ("Is the move getting stronger?", "Fading moves are skipped."),
        ("Is now a reasonable moment?", "A shorter 4-hour chart times the entry, and ideas that have already run too far are dropped."),
    ]
    private let words: [(String, String)] = [
        ("Long", "An idea on a stock that is rising."),
        ("Short", "An idea on a stock that is falling."),
        ("Exit line", "The price where the trend counts as broken. A close beyond it ends the idea."),
        ("Risk", "How far the exit line is from the signal price."),
        ("Strength", "A 0 to 100 score for how well an idea passes the checks."),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("The app checks each market on a schedule and keeps only the ideas that pass three tests.")
                        .fixedSize(horizontal: false, vertical: true)
                    VStack(alignment: .leading, spacing: 14) {
                        ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                            HStack(alignment: .firstTextBaseline, spacing: 12) {
                                Text("\(index + 1)").font(.title3.weight(.bold)).foregroundStyle(AppTheme.amber).frame(width: 20, alignment: .leading)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(step.0).font(.headline)
                                    Text(step.1).font(.subheadline).foregroundStyle(AppTheme.muted).fixedSize(horizontal: false, vertical: true)
                                }
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .panel()
                    Text("Words we use").font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(words, id: \.0) { word in
                            (Text(word.0 + ". ").fontWeight(.semibold) + Text(word.1).foregroundStyle(AppTheme.muted))
                                .font(.subheadline).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Button {
                        withAnimation(.snappy(duration: 0.25)) { showingSettings.toggle() }
                    } label: {
                        HStack {
                            Text("Indicator settings").font(.subheadline.weight(.semibold))
                            Spacer(minLength: 8)
                            Image(systemName: "chevron.down").font(.footnote.weight(.semibold)).foregroundStyle(AppTheme.muted)
                                .rotationEffect(.degrees(showingSettings ? 180 : 0))
                        }
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if showingSettings {
                        Text("Direction is the daily Supertrend (10, 3). Strength is the daily ADX (14), which must be at least 20 and rising against five sessions ago. Timing is the 4-hour Supertrend on completed bars. The exit line for a trend idea is the daily Supertrend line.")
                            .font(.footnote).foregroundStyle(AppTheme.muted).fixedSize(horizontal: false, vertical: true)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text("The fine print").font(.headline)
                        Text("This is automated research from public price data, not personal financial advice. It doesn't know your goals, taxes or other holdings. Data can be delayed or wrong, nothing is ever sent to a broker, and trading can lose money.")
                            .font(.footnote).foregroundStyle(AppTheme.muted).fixedSize(horizontal: false, vertical: true)
                        Link("Read the terms", destination: APIClient.productionOrigin.appending(path: "terms")).font(.footnote)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .panel()
                }
                .padding(16)
                .readableWidth()
            }
            .background(AppTheme.background)
            .navigationTitle("How it works")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
    }
}
