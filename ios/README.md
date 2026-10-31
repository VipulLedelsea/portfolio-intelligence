# IntelligentPortfolio for iPhone

This is the native, read-only SwiftUI client for IntelligentPortfolio. It uses the same hosted scanner and private five-session recommendation memory as the web app.

## Security model

- The app never receives Stripe secrets, ChatGPT identity headers, or brokerage credentials.
- A one-time eight-character code links the phone to an existing signed-in web account.
- The resulting random device token is stored in the iOS Keychain and expires after 90 days.
- The app exposes research only. It contains no order, position, or brokerage endpoints.

## Open locally

The generated Xcode project is included in this repository and has been build-checked with Xcode 27.2.

1. Open `IntelligentPortfolio.xcodeproj` in Xcode.
2. Choose an iPhone simulator, such as iPhone Duo, from the run-destination menu.
3. Press Run.

An Apple development team is only required when installing on a physical iPhone. If you change `project.yml`, install XcodeGen with `brew install xcodegen` and run `xcodegen generate` from this directory.

### iPhone Duo runtime note

If iPhone Duo remains on the Apple logo or Xcode reports `Data Migration Failed`, the installed Duo simulator runtime did not complete Apple's first-boot setup. Update or reinstall the iPhone Duo runtime from Xcode's Components settings, then erase and restart that simulator. This is a simulator-runtime failure; the IntelligentPortfolio app still compiles for the Duo's iOS simulator architecture.

The production API origin is configured in `APIClient.swift`.

