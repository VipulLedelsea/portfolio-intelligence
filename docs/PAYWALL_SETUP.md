# IntelligentPortfolio subscription setup

The production Worker contains a Stripe-hosted subscription paywall for **$14.99 USD per month**. It is disabled until the production environment is configured, so incomplete billing setup never locks visitors out.

## Stripe account setup

1. Create or use a Stripe account and finish Stripe's business verification.
2. Enable the Stripe Customer Portal in the Stripe Dashboard so subscribers can manage payment methods and cancel.
3. Copy a restricted or standard Stripe secret key that can create and read Customers, Checkout Sessions, Subscriptions, and Billing Portal Sessions.

## Sites production values

Configure these as production runtime values in OpenAI Sites, never in source control:

- `STRIPE_SECRET_KEY`: the Stripe secret key, stored as a secret.
- `PAYWALL_ENABLED`: set to `true` only when the Stripe account and Customer Portal are ready.

After changing runtime values, deploy the current saved Site version so the new environment revision is applied.

## Access model

- Visitors sign in with ChatGPT before subscribing.
- Stripe hosts checkout and never sends card details through this application.
- The Worker links the signed-in Site user to a Stripe Customer using metadata.
- Every protected API request verifies that the Stripe subscription is `active` or `trialing`.
- Billing management and cancellation use Stripe's hosted Customer Portal.
