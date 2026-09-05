# Stokc

Daily dashboard consolidating the US market's biggest stock gainers, losers,
and most volatile names from Alpha Vantage, paired with a short-sale lending
summary modeled on Interactive Brokers' borrow availability metrics (fee
rate, shares available, borrow status).

## What it does

- Fetches the day's Top Gainers and Top Losers from Alpha Vantage's
  [`TOP_GAINERS_LOSERS`](https://www.alphavantage.co/documentation/#top-gainer-losers)
  endpoint.
- Derives a "Most Volatile" list from the same data: the biggest absolute
  movers across gainers and losers combined. Alpha Vantage's free tier
  doesn't expose intraday high/low, so this is a proxy for true volatility
  (e.g. ATR), not an intraday-range calculation.
- For each ticker, attaches a short-lending summary: borrow status (Easy /
  Hard / Very Hard to Borrow / Not Available), annualized fee rate, and
  shares available.
- Surfaces a "Squeeze Watch" list: big movers that are also very hard or
  impossible to borrow — the combination that tends to precede short
  squeezes.
- Caches the Alpha Vantage response (1 hour by default) since the free tier
  is capped at 25 requests/day — see below.

## Alpha Vantage API key

Get a free key at https://www.alphavantage.co/support/#api-key (instant,
no signup fee) and set it as an environment variable:

```bash
export ALPHA_VANTAGE_API_KEY=your_key_here
```

On Vercel, add it under Project Settings → Environment Variables.

**Free tier rate limit:** 25 requests/day. One cached fetch feeds all three
views (gainers/losers/volatile), so the app makes at most one Alpha Vantage
call per cache window regardless of how many users hit it. The cache TTL
defaults to 60 minutes (safely under the daily quota); override it with
`ALPHA_VANTAGE_CACHE_MINUTES` if you have a paid plan with a higher limit.

## Important: the lending data is simulated

**Interactive Brokers does not expose a public, unauthenticated API for
short-sale/borrow availability.** Real figures are only available inside an
authenticated IBKR session (Trader Workstation, IB Gateway, or the Client
Portal Web API) tied to a live account. This project does not have IBKR
credentials, so `src/lending.js` generates plausible, deterministic-per-day
numbers from a seeded random function (seeded on ticker + date, so a symbol
shows consistent figures throughout a given day). It is meant to demonstrate
the UI/workflow — **do not use these numbers to make trading decisions.**

To wire in real IBKR data, replace `getMockLending()` in `src/lending.js`
with a call to your own IBKR Client Portal Web API session (e.g. the
`/iserver/secdef/search` + short-availability endpoints), using your own
authenticated gateway.

## Running locally

```bash
npm install
export ALPHA_VANTAGE_API_KEY=your_key_here
npm start
```

Then open http://localhost:3000.

## API

- `GET /api/movers/:type` — `type` is `gainers`, `losers`, or `volatile`.
  Returns the mover list enriched with lending data plus summary stats.
- `GET /api/summary` — gainers, losers, and most-volatile in one response,
  as used by the dashboard.

## Deployment

The app runs both as a normal long-lived Node/Express process (`npm start`)
and as a Vercel serverless function via `api/index.js` (routed through
`vercel.json`). Static assets in `public/` are served automatically by
Vercel's default static hosting; `/api/*` requests are routed to the
serverless function.

Set `ALPHA_VANTAGE_API_KEY` (required) and optionally
`ALPHA_VANTAGE_CACHE_MINUTES` and `PORT` as environment variables wherever
you deploy.
