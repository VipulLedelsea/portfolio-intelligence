# IntelligentPortfolio for iPhone

This is the native, read-only SwiftUI client for IntelligentPortfolio. It uses the same hosted scanner and private five-session recommendation memory as the web app.

## Security model

- The app never receives Stripe secrets, ChatGPT identity headers, or brokerage credentials.
- A one-time eight-character code links the phone to an existing signed-in web account.
- The resulting random device token is stored in the iOS Keychain and expires after 90 days.
- The app exposes research only. It contains no order, position, or brokerage endpoints.

## Open locally

1. Install Xcode from the Mac App Store.
2. Install XcodeGen with `brew install xcodegen`.
3. From this `ios` directory, run `xcodegen generate`.
4. Open `IntelligentPortfolio.xcodeproj` in Xcode.
5. Select your Apple development team, choose an iPhone or simulator, and press Run.

The production API origin is configured in `APIClient.swift`.

