import SwiftUI
import UIKit
import WebKit

enum TradingViewLink {
    /// Universal link: opens the TradingView app when installed, otherwise Safari.
    static func url(symbol: String, interval: String) -> URL? {
        var components = URLComponents(string: "https://www.tradingview.com/chart/")
        components?.queryItems = [
            URLQueryItem(name: "symbol", value: symbol),
            URLQueryItem(name: "interval", value: interval)
        ]
        return components?.url
    }

    static func isValid(symbol: String) -> Bool {
        symbol.range(of: "^[A-Z0-9.\\-^&:_]{1,24}$", options: .regularExpression) != nil
    }
}

/// The real TradingView chart page, loaded inside the app. Signing in to TradingView once here keeps
/// the session, so the user's saved layout (for example Supertrend Strategy, SMA, and Volume) loads on the
/// symbol being viewed. Nothing is recreated: this is TradingView itself.
struct TradingViewSite: UIViewRepresentable {
    let symbol: String
    let interval: String

    private static let desktopAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let preferences = WKWebpagePreferences()
        preferences.preferredContentMode = .desktop
        configuration.defaultWebpagePreferences = preferences
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.customUserAgent = Self.desktopAgent
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 0.035, green: 0.047, blue: 0.043, alpha: 1)
        web.scrollView.backgroundColor = web.backgroundColor
        web.navigationDelegate = context.coordinator
        context.coordinator.load(symbol: symbol, interval: interval, into: web)
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        context.coordinator.load(symbol: symbol, interval: interval, into: web)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        private var loaded: String?

        func load(symbol: String, interval: String, into web: WKWebView) {
            let key = "\(symbol)|\(interval)"
            guard key != loaded, TradingViewLink.isValid(symbol: symbol),
                  let url = TradingViewLink.url(symbol: symbol, interval: interval) else { return }
            loaded = key
            web.load(URLRequest(url: url))
        }

        func webView(
            _ webView: WKWebView,
            decidePolicy navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            // Stay inside TradingView; send links to any other site to the system browser.
            if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url,
               url.scheme == "https", !(url.host ?? "").hasSuffix("tradingview.com") {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}
