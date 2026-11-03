# Getting IntelligentPortfolio onto TestFlight

The app is read-only research. It stays free during the beta and only invited people get it.

## What is already in place
- **Browse without an account** in the app, so a reviewer or tester can use it with no sign-in (Guideline 2.1, demo access). The server allows it only while the paywall is off.
- **In-app research disclaimer** shown once at first launch, plus Terms, Privacy and Support links in the app and website footer.
- **In-app deletion of account data** (Account tab ▸ Delete my account data), as Guideline 5.1.1(v) requires when accounts exist.
- **Public pages**: `/privacy`, `/terms`, `/support` on the live site.
- **Privacy manifest** (`PrivacyInfo.xcprivacy`): no tracking, email address and user ID collected for app functionality.
- **Export compliance**: `ITSAppUsesNonExemptEncryption = NO` (HTTPS only).
- Version 1.0, build 1, iOS 17+, iPhone only, 1024 px icon without transparency.

## You need to do (Apple account steps)
1. **Join the paid Apple Developer Program** (US$99/year) at developer.apple.com/programs. A free "Personal Team" cannot use TestFlight. This Mac currently has only an *Apple Development* certificate.
2. In **App Store Connect ▸ Apps ▸ +** create the app: bundle ID `com.vipulledelsea.IntelligentPortfolio`, a name, a SKU, category Finance.
3. **Upload a build**: open `ios/IntelligentPortfolio.xcodeproj`, pick *Any iOS Device (arm64)*, Product ▸ Archive, then Distribute App ▸ App Store Connect ▸ Upload. Raise the build number (`CURRENT_PROJECT_VERSION` in `ios/project.yml`, then `xcodegen generate`) for every upload.
4. **App Privacy** in App Store Connect: data collected = Email Address, User ID and Other Financial Info (the holdings users type in), linked to the user, not used for tracking, purpose App Functionality. Tracking = No.
5. **Test Information** (TestFlight tab): feedback email, privacy policy URL `https://intelligent-portfolio.portfolio-intelligence-site.workers.dev/privacy`, description, and the review notes below.
6. **Testers**: internal testing (up to 100 people added as App Store Connect users) needs no review. For outside people use *External Testing* with email invitations (or a public link with a tester limit). The first build of each version goes through Beta App Review, usually within a day.

## Review notes to paste
> IntelligentPortfolio is a read-only stock, India (BSE) and forex research tool. It does not connect to a brokerage and cannot place orders. No account is needed: on the first screen tap "I understand", then "Browse without an account" to use the scanner. Optionally "Connect existing account" pairs the phone with a website account using a one-time code. Account data can be deleted in the Account tab. Charts are provided by TradingView. Not investment advice.

## Risks to know about
- **Data sources.** Prices come from Robinhood's and Yahoo's unofficial public endpoints. Apple will not check this, but the owners could block the service or object. For a wider launch move to a licensed data provider (the code already supports Twelve Data).
- **TradingView free widget.** Its terms limit use and require attribution (already shown). Check them again before any public launch.
- **Turning on subscriptions.** Selling access through Stripe on the web and unlocking it in the app falls under Guidelines 3.1.1 and 3.1.3. Expect to need Apple in-app purchase or a compliant external-purchase route. Do this before the paywall returns, and re-check "Browse without an account" because it stops working when the paywall is on.
- **Sign in with Apple (4.8).** Not required today because Google sign-in happens on the website, not inside the app. If Google sign-in is ever added inside the app, add Sign in with Apple too.
- **Finance apps.** Keep the "not advice" wording. Do not claim guaranteed returns.
- **Support email.** Set `SUPPORT_EMAIL` in `wrangler.toml` `[vars]` and deploy, so the Privacy and Support pages show a real contact.
- TestFlight builds expire after 90 days.

## Pre-submission audit (3 November 2026)

**Passed**
- No secrets in tracked files or git history; no `.env`, key, certificate or provisioning files tracked.
- Release archive: iOS 17 minimum, `ITSAppUsesNonExemptEncryption = false`, privacy manifest bundled (no tracking; email, user ID and other financial info for app functionality; UserDefaults reason `CA92.1`), 1024 px icon without transparency, no third-party frameworks, no private APIs, no plain `http` URLs.
- The debug-only server override is compiled out of Release builds (verified in the binary).
- Server: every query is bound (the one interpolated column list is a constant); user-controlled text in the dashboard is escaped; the CSP is strict; cookies are HttpOnly and SameSite; no CORS.
- Public pairing endpoint now has a shared ceiling of 30 new codes a minute.

**Answers to prepare for App Store Connect**
- *Age rating, "Unrestricted web access":* No. The only web content is the TradingView chart widget.
- *App Privacy:* besides email address, user ID and other financial info (linked, not for tracking), consider declaring that the embedded TradingView chart may collect usage data and identifiers as a third party. Declaring it is the cautious choice.
- *Review notes:* use the text above ("Browse without an account"). Keep the paywall off while the beta is under review, because guest browsing only works then.

**Risks that can still cause a rejection or a later problem**
1. **Data provenance (guideline 5.2).** Prices come from Robinhood's and Yahoo's unofficial endpoints. Apple does not test this, but the owners could object. Move to a licensed provider before a public launch.
2. **Turning the paywall on (guideline 3.1.1 / 3.1.3).** Selling access on the web and unlocking it in the app needs an in-app purchase or an approved external-purchase route. Browse-without-account also stops working then.
3. **Brand names.** The app never names Robinhood or Yahoo; the website does. Keep it out of App Store metadata and screenshots.
4. **No rate limit on market scans or holdings lookups.** Anyone can trigger repeated US rescans. Fine for a small beta; add a per-IP limit before opening it up.
