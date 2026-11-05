import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ZStack {
            AppTheme.background.ignoresSafeArea()
            if !model.disclaimerAccepted {
                DisclaimerView()
            } else {
            switch model.connectionState {
            case .checking:
                ProgressView("Checking secure access…")
                    .tint(AppTheme.amber)
            case .disconnected, .pairing:
                ConnectionView()
            case .connected:
                TabView {
                    ScannerView()
                        .tabItem { Label("Scanner", systemImage: "chart.xyaxis.line") }
                    HoldingsView()
                        .tabItem { Label("Holdings", systemImage: "briefcase") }
                    MemoryView()
                        .tabItem { Label("Memory", systemImage: "brain.head.profile") }
                    AccountView()
                        .tabItem { Label("Account", systemImage: "person.crop.circle") }
                }
                .tint(AppTheme.amber)
            }
            }
        }
        .background(HingeReader { state, angle in
            // Only a change of state reaches the layouts; the live angle changes too often to publish.
            if model.fold != state { model.fold = state }
        })
        .alert("IntelligentPortfolio", isPresented: Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { model.errorMessage = nil }
        } message: {
            Text(model.errorMessage ?? "")
        }
    }
}

