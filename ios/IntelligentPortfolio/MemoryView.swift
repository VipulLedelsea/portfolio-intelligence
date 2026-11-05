import SwiftUI

struct MemoryView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("The system grades every research call after five completed market sessions.")
                        .foregroundStyle(AppTheme.muted)
                    TrackRecordPanel(record: model.trackRecord)
                    if model.isGuest {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Connect an account to see your learning history.")
                                .font(.headline)
                            Text("Browsing without an account does not save any research calls.")
                                .foregroundStyle(AppTheme.muted)
                            Button("Connect an account") { model.leaveGuest() }
                                .buttonStyle(.borderedProminent)
                                .tint(AppTheme.amber)
                        }
                        .panel()
                    } else if let memory = model.memory, let summary = memory.summary {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
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
                .readableWidth()
            }
            .background(AppTheme.background)
            .navigationTitle("Learning memory")
            .task { await model.refreshTrackRecord() }
            .refreshable { await Task { await model.refreshMemory(); await model.refreshTrackRecord() }.value }
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


/// App-wide results of every fresh scanner pick, wins and losses included. Always shows how many picks sit behind each number.
struct TrackRecordPanel: View {
    let record: TrackRecordResponse?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("SCANNER TRACK RECORD").font(.caption2).foregroundStyle(AppTheme.muted)
            if let summary = record?.summary, record?.available == true {
                let n = summary.settledPicks
                if n == 0 {
                    Text("No scanner picks have been graded yet. \(summary.pendingPicks) are waiting for their five-session window to close.")
                        .foregroundStyle(AppTheme.muted)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 10)], spacing: 10) {
                        stat("Graded picks", "\(n)")
                        stat("Still open", "\(summary.pendingPicks)")
                        stat("Win rate", percent(summary.winRatePct, signed: false))
                        stat("Avg return", percent(summary.averageReturnPct, signed: true))
                        stat("Avg win", percent(summary.averageWinPct, signed: true))
                        stat("Avg loss", percent(summary.averageLossPct, signed: true))
                        stat("Worst loss", percent(summary.worstLossPct, signed: true))
                        stat("Stop hit", percent(summary.stopHitRatePct, signed: false))
                    }
                    if n < 30 {
                        Text("Only \(n) graded so far. Small samples can swing widely, so treat these as early results.")
                            .font(.footnote).foregroundStyle(AppTheme.amber)
                    }
                }
                Text(record?.methodology ?? "")
                    .font(.footnote).foregroundStyle(AppTheme.muted)
            } else {
                Text("Track record is loading or not available yet.").foregroundStyle(AppTheme.muted)
            }
        }
        .panel()
    }

    private func stat(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading) {
            Text(title.uppercased()).font(.caption2).foregroundStyle(AppTheme.muted)
            Text(value).font(.title3.monospaced().bold())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func percent(_ value: Double?, signed: Bool) -> String {
        guard let value else { return "-" }
        return String(format: signed ? "%+.2f%%" : "%.1f%%", value)
    }
}
