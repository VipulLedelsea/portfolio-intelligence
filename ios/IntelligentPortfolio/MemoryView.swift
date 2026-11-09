import SwiftUI

struct MemoryView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("US Supertrend ideas are followed until the daily Supertrend breaks and graded at the next open, with no time limit. Other calls are graded when they hit a level or after ten completed market sessions.")
                        .foregroundStyle(AppTheme.muted)
                    TrackRecordPanel(record: model.trackRecord)
                    LearningPanel(learning: model.learning)
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
            .task { await model.refreshTrackRecord(); await model.refreshLearning() }
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
                Text(record.symbol).font(.headline)
                Text("\(record.action) · \(record.direction)").font(.caption).foregroundStyle(AppTheme.muted)
            }
            Spacer()
            VStack(alignment: .trailing) {
                Text(record.status == "PENDING" ? "PENDING" : record.grade ?? "SETTLED")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(gradeColor)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(gradeColor.opacity(0.15), in: Capsule())
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
    @State private var strategy = "SUPERTREND"

    /// The summary for the chosen scanner; falls back to the Supertrend summary from older servers.
    private var chosen: TrackRecordStrategy? { record?.strategies?.first { $0.id == strategy } }
    private var shownSummary: TrackRecordSummary? { chosen?.summary ?? record?.summary }
    private func shortName(_ id: String) -> String { id == "SUPERTREND" ? "Supertrend" : id == "DIP" ? "Dip scan" : id == "PATTERN" ? "Pattern" : "Dip, gate closed" }

    /// Graded picks grouped by what the bull-versus-bear debate leaned. Shown once any pick with a logged lean has been graded.
    @ViewBuilder private var debateResults: some View {
        let rows = (record?.debate ?? []).filter { $0.summary.settledPicks > 0 }
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(text: "Results by the debate's lean")
                ForEach(rows) { row in
                    Text("\(row.label): \(row.summary.settledPicks) graded, \(percent(row.summary.averageReturnPct, signed: true)) average, \(percent(row.summary.winRatePct, signed: false)) wins")
                        .font(.footnote)
                }
                Text("This checks whether the debate's lean means anything. It does not change any score.").font(.caption2).foregroundStyle(AppTheme.muted)
            }
        }
    }

    /// What graded picks have in common (hit the stop, earnings in the hold, the market moved against them). Counts only; small samples are flagged.
    @ViewBuilder private var lessonsBlock: some View {
        if let lessons = record?.lessons, lessons.graded > 0 {
            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(text: "What graded picks have in common")
                ForEach(lessons.notes, id: \.self) { Text($0).font(.footnote).foregroundStyle(AppTheme.muted) }
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Scanner track record")
            if let strategies = record?.strategies, strategies.count > 1 {
                Picker("Scanner", selection: $strategy) {
                    ForEach(strategies) { Text(shortName($0.id)).tag($0.id) }
                }
                .pickerStyle(.segmented)
                if let label = chosen?.label { Text(label).font(.footnote).foregroundStyle(AppTheme.muted) }
            }
            if let summary = shownSummary, record?.available == true {
                let n = summary.settledPicks
                if n == 0 {
                    Text("No scanner picks have been graded yet. \(summary.pendingPicks) are still running: Supertrend picks close when the daily trend breaks.")
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
                debateResults
                lessonsBlock
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


/// What the learning loop has found in graded picks: whether scores meant anything, whether each filter removed worse ideas, and any rule proposed or in force.
/// Rules are proposed by code from strict tests and only take effect when an administrator approves them on the website.
struct LearningPanel: View {
    let learning: LearningResponse?

    private func pct(_ value: Double?) -> String { value.map { String(format: "%+.2f%%", $0) } ?? "n/a" }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "What we have learned")
            if let report = learning?.report {
                Text("\(report.gradedReal) graded picks measured, plus \(report.gradedShadow) that our filters skipped.").font(.footnote).foregroundStyle(AppTheme.muted)
                if let note = report.note { Text(note).font(.footnote).foregroundStyle(AppTheme.amber) }
                Text("Did a higher score mean a better result?").font(.subheadline.weight(.semibold))
                Text(report.calibrationNote).font(.footnote)
                ForEach(report.calibration.filter { $0.n > 0 }) { band in
                    Text("Score \(band.label): \(band.n) picks, \(pct(band.meanReturnPct)) average").font(.caption).foregroundStyle(AppTheme.muted)
                }
                if report.filters.contains(where: { $0.n > 0 }) {
                    Text("Did our filters remove worse ideas?").font(.subheadline.weight(.semibold))
                    ForEach(report.filters.filter { $0.n > 0 }) { filter in
                        Text("Skipped, \(filter.label): \(filter.n) picks, \(pct(filter.meanReturnPct)) average. \(filter.verdict)").font(.caption).foregroundStyle(AppTheme.muted)
                    }
                }
                let rules = learning?.rules ?? []
                if !rules.isEmpty {
                    Text("Learned rules").font(.subheadline.weight(.semibold))
                    ForEach(rules) { rule in
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(rule.status.capitalized): \(rule.label)").font(.footnote.weight(.semibold))
                            if let e = rule.evidence { Text("Flagged picks \(pct(e.meanFlagged)) vs \(pct(e.meanClear)) on \(e.nFlagged) and \(e.nClear) picks.").font(.caption2).foregroundStyle(AppTheme.muted) }
                        }
                    }
                    Text("A proposed rule does nothing until an administrator approves it on the website.").font(.caption2).foregroundStyle(AppTheme.muted)
                } else {
                    Text("No rule has cleared the test yet. A rule needs at least 30 graded picks on each side and the same result in both halves of the history.").font(.caption2).foregroundStyle(AppTheme.muted)
                }
            } else {
                Text("The first learning report is written after picks are graded. Nothing is changed automatically.").font(.footnote).foregroundStyle(AppTheme.muted)
            }
            if let how = learning?.howItWorks { Text(how).font(.caption2).foregroundStyle(AppTheme.muted) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }
}
