import SwiftUI

struct MemoryView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("The system grades every research call after five completed market sessions.")
                        .foregroundStyle(AppTheme.muted)
                    if let memory = model.memory, let summary = memory.summary {
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                            metric("Tracked", "\(summary.totalCalls)")
                            metric("Pending", "\(summary.pendingCalls)")
                            metric("Win rate", summary.scoredSetups > 0 ? String(format: "%.1f%%", summary.winRatePct) : "-")
                            metric("Avg return", summary.scoredSetups > 0 ? String(format: "%+.2f%%", summary.averageReturnPct) : "-")
                        }
                        Text(memory.learningNote ?? "Collecting evidence before drawing conclusions.")
                            .foregroundStyle(AppTheme.muted)
                            .panel()
                        ForEach(memory.recent ?? []) { record in
                            MemoryRow(record: record)
                        }
                    } else {
                        ProgressView("Loading recommendation memory…").tint(AppTheme.amber)
                    }
                }
                .padding(16)
            }
            .background(AppTheme.background)
            .navigationTitle("Learning memory")
            .refreshable { await model.refreshMemory() }
        }
    }

    private func metric(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading) {
            Text(title.uppercased()).font(.caption2).foregroundStyle(AppTheme.muted)
            Text(value).font(.title2.monospaced().bold())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }
}

private struct MemoryRow: View {
    let record: MemoryRecord
    private let good = Set(["TARGET", "WIN", "CORRECT_PASS"])
    private let bad = Set(["STOP", "LOSS", "MISSED_MOVE"])

    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                Text(record.symbol).font(.headline.monospaced())
                Text("\(record.action) · \(record.direction)").font(.caption).foregroundStyle(AppTheme.muted)
            }
            Spacer()
            VStack(alignment: .trailing) {
                Text(record.status == "PENDING" ? "PENDING" : record.grade ?? "SETTLED")
                    .font(.caption.monospaced().bold())
                    .foregroundStyle(gradeColor)
                if let value = record.strategyReturnPct {
                    Text(String(format: "%+.2f%%", value)).font(.caption).foregroundStyle(AppTheme.muted)
                }
            }
        }
        .panel()
    }

    private var gradeColor: Color {
        if good.contains(record.grade ?? "") { return AppTheme.mint }
        if bad.contains(record.grade ?? "") { return AppTheme.red }
        return AppTheme.muted
    }
}

