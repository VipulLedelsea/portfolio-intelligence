# Deploying to Cloudflare (free plan)

The Worker, dashboard, database, and hourly BSE/forex scans all run on Cloudflare's free tier.
Sign-in is Google OAuth with server-side sessions stored in D1. Nothing here needs a paid plan.

## One-time setup

1. Create a free Cloudflare account and run `npx wrangler login`.
2. Create the database and paste the printed `database_id` into `wrangler.toml`:
   ```bash
   npx wrangler d1 create intelligent-portfolio
   ```
3. Apply the migrations to it:
   ```bash
   npm run db:migrate
   ```
4. Create a Google OAuth client (Google Cloud Console > APIs & Services > Credentials > OAuth client ID > Web application).
   Authorized redirect URI: `https://<your-worker-host>/auth/google/callback`
   (for the first deploy use `https://intelligent-portfolio.<your-workers-subdomain>.workers.dev/auth/google/callback`).
5. Store the secrets. Each command prompts for the value; never put them in the repo:
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put PAYWALL_ENABLED     # value: true, once Stripe is ready
   ```
6. Deploy (builds, validates, then publishes):
   ```bash
   npm run deploy
   ```
7. Put the new site address in `APIClient.productionOrigin` (`ios/IntelligentPortfolio/APIClient.swift`) and reinstall the app.

## Everyday commands

- `npm run dev` runs the site locally. Add `--var AUTH_MODE:dev` to `wrangler dev` to get a throwaway `/auth/dev` sign-in (never set this in production).
- `npm run db:migrate:local` applies migrations to the local database.
- `npm run deploy` publishes the current code.

## Notes

- Existing Stripe subscribers are matched to their new Google sign-in by verified email.
- The BSE and forex scans refresh at most once an hour while their markets are open (a cron trigger runs at five past each hour). After a provider error the Worker waits 15 minutes before trying again.
- Data comes from Yahoo's chart endpoint by default. Set `TWELVE_DATA_API_KEY` to use Twelve Data instead.
- `AUTH_MODE=oai` re-enables the OpenAI Sites identity headers. Never set it on Cloudflare: those headers can be forged there.
