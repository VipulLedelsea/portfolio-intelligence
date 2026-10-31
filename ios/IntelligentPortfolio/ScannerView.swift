import SwiftUI

struct ScannerView: View {
    @EnvironmentObject private var model: AppModel
    @State private var selected: Candidate?

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 12) {
                    header
                    if let discovery = model.discovery {
                        HStack {
                            Label("\(discovery.successful)/\(discovery.universeSize) scanned", systemImage: "checkmark.circle")
                            Spacer()
                            Text("\(discovery.freshEntryCount) fresh")
                        }
                        .font(.caption.monospaced())
                        .foregroundStyle(AppTheme.muted)

                        ForEach(discovery.candidates) { candidate in
                            Button { selected = candidate } label: {
                                CandidateCard(candidate: candidate)
                            }
                            .buttonStyle(.plain)
                        }
                    } else if model.isScanning {
                        ProgressView("Scanning the S&P 500…")
                            .tint(AppTheme.amber)
                            .padding(.top, 50)
                    }
                }
                .padding(16)
            }
            .background(AppTheme.background)
            .navigationTitle("Top setups")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { ReadOnlyBadge() }
            }
            .refreshable { await model.refreshScanner() }
            .sheet(item: $selected) { candidate in
                AnalysisView(candidate: candidate)
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Daily direction.\nOne-hour timing.")
                .font(.system(size: 34, weight: .medium, design: .serif))
            Text("Confirmed daily and hourly Supertrend, strengthening ADX, and entry-extension controls rank the current S&P 500.")
                .foregroundStyle(AppTheme.muted)
            Button {
                Task { await model.refreshScanner() }
            } label: {
                Label(model.isScanning ? "Scanning…" : "Refresh scan", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.borderedProminent)
            .tint(AppTheme.amber)
            .disabled(model.isScanning)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 12)
    }
}

private struct CandidateCard: View {
    let candidate: Candidate
    private var directionColor: Color { candidate.direction == "SHORT" ? AppTheme.red : AppTheme.mint }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(candidate.symbol).font(.title2.monospaced().bold())
                    Text(candidate.company).font(.caption).foregroundStyle(AppTheme.muted).lineLimit(1)
                }
                Spacer()
                VStack(alignment: .trailing) {
                    Text(candidate.price, format: .currency(code: "USD")).bold()
                    Text("\(Int(candidate.score))/100").font(.caption.monospaced()).foregroundStyle(AppTheme.muted)
                }
            }
            HStack {
                Text("\(candidate.direction) · \(candidate.label)")
                    .font(.caption.monospaced().bold())
                    .foregroundStyle(directionColor)
                Spacer()
                Text(candidate.entryStatus.replacingOccurrences(of: "_", with: " "))
                    .font(.caption2.monospaced())
                    .foregroundStyle(candidate.entryEligible ? AppTheme.mint : AppTheme.red)
            }
            ProgressView(value: candidate.score, total: 100).tint(AppTheme.amber)
            Text("Daily \(candidate.dailySupertrendDirection) · ADX \(candidate.dailyAdx, specifier: "%.1f") \(candidate.dailyAdxRising ? "rising" : "fading") · \(candidate.extensionAtr, specifier: "%+.2f") ATR")
                .font(.caption)
                .foregroundStyle(AppTheme.muted)
        }
        .panel()
    }
}

