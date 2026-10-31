import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ZStack {
            AppTheme.background.ignoresSafeArea()
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
                    MemoryView()
                        .tabItem { Label("Memory", systemImage: "brain.head.profile") }
                    AccountView()
                        .tabItem { Label("Account", systemImage: "person.crop.circle") }
                }
                .tint(AppTheme.amber)
            }
        }
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

