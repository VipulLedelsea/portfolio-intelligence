import SwiftUI

struct MemoryView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Every idea is recorded the moment it appears and scored when it ends. Losses count too.")
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
                        Text("Your own research calls").font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
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
                    } else if model.memory != nil {
                        // Loaded, with nothing recorded yet: say so instead of waiting for a summary that will not come.
                        Text("No research calls recorded yet. Calls you look up on the website are tracked here once they are graded.")
                            .foregroundStyle(AppTheme.muted)
                            .panel()
                    } else if model.failedLoads.contains(.memory) {
                        LoadFailedView(message: "Couldn't load your research calls.") { await model.refreshMemory() }
                    } else {
                        ProgressView("Loading your research calls…").tint(AppTheme.amber)
                    }
                    ResearchFootnote()
                }
                .padding(16)
                .readableWidth()
            }
            .background(AppTheme.background)
            .navigationTitle("Track record")
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
    private func shortName(_ id: String) -> String { id == "SUPERTREND" ? "Trend" : id == "DIP" ? "Dips" : id == "PATTERN" ? "Patterns" : "Skipped" }
    @State private var showingMethod = false
    /// Averages and win rates are held back until this many ideas have finished, because fewer swing by luck.
    private static let enough = 30

    /// Finished ideas grouped by which way the for-and-against reading leaned. Shown once any such idea has finished.
    @ViewBuilder private var debateResults: some View {
        let rows = (record?.debate ?? []).filter { $0.summary.settledPicks > 0 }
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(text: "Results by the for-and-against reading")
                ForEach(rows) { row in
                    Text("\(row.label): \(row.summary.settledPicks) finished, \(percent(row.summary.averageReturnPct, signed: true)) average, \(percent(row.summary.winRatePct, signed: false)) made money")
                        .font(.footnote)
                }
                Text("This checks whether that reading means anything. It does not change any strength score.").font(.caption).foregroundStyle(AppTheme.muted)
            }
        }
    }

    /// What finished ideas have in common. Counts only; small samples are flagged.
    @ViewBuilder private var lessonsBlock: some View {
        if let lessons = record?.lessons, lessons.graded > 0 {
            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(text: "What finished ideas have in common")
                ForEach(lessons.notes, id: \.self) { Text($0).font(.footnote).foregroundStyle(AppTheme.muted) }
            }
        }
    }

    /// The most recent finished ideas for the chosen scan type, one line each, so the totals can be checked against named results.
    @ViewBuilder private var finishedList: some View {
        let rows = (record?.finished ?? []).filter { $0.strategy == strategy }.prefix(10)
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text("Finished ideas").font(.headline).padding(.bottom, 6)
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, idea in
                    if index > 0 { Rectangle().fill(AppTheme.hairline).frame(height: 1) }
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(idea.symbol).font(.subheadline.weight(.semibold))
                        Text(PlainWords.side(idea.direction)).font(.caption).foregroundStyle(AppTheme.muted)
                        if let day = idea.settledAt.flatMap(Self.shortDay) { Text(day).font(.caption).foregroundStyle(AppTheme.muted) }
                        Spacer(minLength: 8)
                        if let value = idea.returnPct {
                            Text((value > 0 ? "Gain " : value < 0 ? "Loss " : "Flat ") + String(format: "%+.2f%%", value))
                                .font(.subheadline.weight(.semibold)).foregroundStyle(value > 0 ? AppTheme.mint : value < 0 ? AppTheme.red : AppTheme.muted)
                        }
                    }
                    .padding(.vertical, 10)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    /// "Nov 9" from an ISO timestamp or date.
    private static func shortDay(_ stamp: String) -> String? {
        let parts = stamp.prefix(10).split(separator: "-")
        guard parts.count == 3, let month = Int(parts[1]), let day = Int(parts[2]), (1...12).contains(month) else { return nil }
        return "\(Calendar.current.shortMonthSymbols[month - 1]) \(day)"
    }

    /// How many of the finished ideas made money, from the win rate the server reports.
    private func winners(_ summary: TrackRecordSummary) -> Int? {
        summary.winRatePct.map { Int(($0 / 100 * Double(summary.settledPicks)).rounded()) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let strategies = record?.strategies, strategies.count > 1 {
                Picker("Scan type", selection: $strategy) {
                    ForEach(strategies) { Text(shortName($0.id)).tag($0.id) }
                }
                .pickerStyle(.segmented)
            }
            if let summary = shownSummary, record?.available == true {
                let n = summary.settledPicks
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 10)], spacing: 10) {
                    stat("Finished", "\(n)")
                    stat("Made money", winners(summary).map { "\($0) of \(n)" } ?? "-")
                    stat("Still open", "\(summary.pendingPicks)")
                }
                if n < Self.enough {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Too early to judge").font(.headline)
                        Text("A handful of results can swing either way by luck. Win rate and average return appear here once \(Self.enough) ideas have finished.")
                            .font(.subheadline).foregroundStyle(.white.opacity(0.85)).fixedSize(horizontal: false, vertical: true)
                        ProgressView(value: Double(n), total: Double(Self.enough)).tint(AppTheme.amber)
                            .accessibilityLabel("\(n) of \(Self.enough) finished")
                        Text("\(n) of \(Self.enough) finished").font(.caption).foregroundStyle(AppTheme.muted)
                    }
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 10)], spacing: 10) {
                        stat("Win rate", percent(summary.winRatePct, signed: false))
                        stat("Average result", percent(summary.averageReturnPct, signed: true))
                        stat("Average gain", percent(summary.averageWinPct, signed: true))
                        stat("Average loss", percent(summary.averageLossPct, signed: true))
                        stat("Worst loss", percent(summary.worstLossPct, signed: true))
                        stat("Hit the exit line", percent(summary.stopHitRatePct, signed: false))
                    }
                }
                finishedList
                Button {
                    withAnimation(.snappy(duration: 0.25)) { showingMethod.toggle() }
                } label: {
                    HStack {
                        Text("How ideas are scored").font(.subheadline.weight(.semibold))
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.down").font(.footnote.weight(.semibold)).foregroundStyle(AppTheme.muted)
                            .rotationEffect(.degrees(showingMethod ? 180 : 0))
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if showingMethod {
                    if n > 0, n < Self.enough {
                        Text("So far: \(percent(summary.averageReturnPct, signed: true)) average result across \(n) finished \(n == 1 ? "idea" : "ideas"). Too few to mean anything yet.")
                            .font(.footnote).foregroundStyle(AppTheme.muted)
                    }
                    debateResults
                    lessonsBlock
                    Text(record?.methodology ?? "")
                        .font(.footnote).foregroundStyle(AppTheme.muted)
                }
            } else {
                Text("The track record is loading or not available yet.").foregroundStyle(AppTheme.muted)
            }
        }
        .panel()
    }

    private func stat(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading) {
            Text(title).font(.caption).foregroundStyle(AppTheme.muted)
            Text(value).font(.title3.bold()).lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
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

    @State private var showingDetail = false
    private var rules: [LearningRule] { learning?.rules ?? [] }
    /// Why "nothing measured" can sit beside finished ideas: the early ones were recorded before their evidence was logged.
    private var unloggedNote: String {
        guard let n = learning?.report?.settledWithoutEvidence, n > 0 else { return "" }
        return " \(n) finished \(n == 1 ? "idea was" : "ideas were") recorded before the evidence behind each idea was logged, so the first measured results come as newer ideas finish."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("What we've learned").font(.headline)
            Text(rules.isEmpty
                 ? "Nothing yet. A lesson is only adopted once enough ideas have finished to trust it." + unloggedNote
                 : "\(rules.count) possible \(rules.count == 1 ? "lesson" : "lessons") so far. Nothing changes until it is approved.")
                .font(.subheadline).foregroundStyle(.white.opacity(0.85)).fixedSize(horizontal: false, vertical: true)
            Button {
                withAnimation(.snappy(duration: 0.25)) { showingDetail.toggle() }
            } label: {
                HStack {
                    Text("Show the working").font(.subheadline.weight(.semibold))
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.down").font(.footnote.weight(.semibold)).foregroundStyle(AppTheme.muted)
                        .rotationEffect(.degrees(showingDetail ? 180 : 0))
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if showingDetail { detail }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }

    @ViewBuilder private var detail: some View {
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
}
