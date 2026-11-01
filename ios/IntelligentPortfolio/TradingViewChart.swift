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

/// TradingView's free Advanced Chart widget with Volume, Supertrend (10, 3) and an SMA (the free
/// widget cannot change the SMA length, so it keeps TradingView's default of 9).
/// The widget draws no entry, stop, or target levels; those stay on the native chart.
struct TradingViewChart: UIViewRepresentable {
    let symbol: String
    let interval: String

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.isOpaque = false
        web.backgroundColor = .clear
        web.scrollView.backgroundColor = .clear
        web.scrollView.isScrollEnabled = false
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
            guard key != loaded, TradingViewLink.isValid(symbol: symbol) else { return }
            loaded = key
            let config: [String: Any] = [
                "autosize": true, "symbol": symbol, "interval": interval,
                "timezone": "America/New_York", "theme": "dark", "style": "1", "locale": "en",
                "hide_side_toolbar": true, "allow_symbol_change": false,
                "studies": ["STD;Supertrend", "STD;SMA"],
                "backgroundColor": "#090c0b", "support_host": "https://www.tradingview.com"
            ]
            guard let data = try? JSONSerialization.data(withJSONObject: config),
                  let json = String(data: data, encoding: .utf8) else { return }
            let html = """
            <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>html,body{margin:0;height:100%;background:#090c0b}</style></head><body>
            <div class="tradingview-widget-container" style="height:100%;width:100%">
            <div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>
            <script src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js" async>\(json)</script>
            </div></body></html>
            """
            web.loadHTMLString(html, baseURL: URL(string: "https://www.tradingview.com"))
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            // Links inside the widget leave the app for the system browser (or the TradingView app).
            if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url,
               url.scheme == "https" {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}
