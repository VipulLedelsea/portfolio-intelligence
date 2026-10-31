import SwiftUI

enum AppTheme {
    static let background = Color(red: 0.035, green: 0.047, blue: 0.043)
    static let panel = Color(red: 0.067, green: 0.086, blue: 0.075)
    static let line = Color(red: 0.18, green: 0.21, blue: 0.19)
    static let amber = Color(red: 1.0, green: 0.616, blue: 0.184)
    static let mint = Color(red: 0.322, green: 0.875, blue: 0.592)
    static let red = Color(red: 1.0, green: 0.435, blue: 0.38)
    static let muted = Color(red: 0.61, green: 0.65, blue: 0.62)
}

struct PanelModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(16)
            .background(AppTheme.panel)
            .overlay(Rectangle().stroke(AppTheme.line, lineWidth: 1))
    }
}

extension View {
    func panel() -> some View { modifier(PanelModifier()) }
}

struct ReadOnlyBadge: View {
    var body: some View {
        Label("READ-ONLY", systemImage: "lock.shield.fill")
            .font(.caption2.monospaced().bold())
            .foregroundStyle(AppTheme.mint)
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .overlay(Capsule().stroke(AppTheme.mint.opacity(0.5)))
            .accessibilityLabel("Read only. No order access.")
    }
}

