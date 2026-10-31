import SwiftUI

@main
struct IntelligentPortfolioApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .preferredColorScheme(.dark)
                .task { await model.restoreSession() }
        }
    }
}

