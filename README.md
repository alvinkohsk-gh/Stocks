# Stokc

Daily dashboard of Finviz's biggest stock gainers and losers, paired with a
short-sale lending summary modeled on Interactive Brokers' borrow
availability metrics (fee rate, shares available, borrow status).

## What it does

- Scrapes [Finviz](https://finviz.com)'s public screener for the day's Top
  Gainers and Top Losers (`ta_topgainers` / `ta_toplosers` views).
- For each ticker, attaches a short-lending summary: borrow status (Easy /
  Hard / Very Hard to Borrow / Not Available), annualized fee rate, and
  shares available.
- Surfaces a "Squeeze Watch" list: big movers that are also very hard or
  impossible to borrow — the combination that tends to precede short
  squeezes.
- Caches Finviz responses for 5 minutes to avoid hammering the site.

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
npm start
```

Then open http://localhost:3000.

## Notes on the Finviz scraper

Finviz periodically changes its screener page's CSS classes. `src/finviz.js`
avoids depending on class names: it finds the results table by locating the
header row that contains both a "Ticker" and "Price" column label, then
reads each row positionally. If Finviz overhauls its markup enough that no
row contains those labels, the scraper will throw a clear error rather than
silently returning garbage — check `src/finviz.js` first if `/api/movers/*`
starts failing.

Scraping is done with a normal desktop User-Agent header. If Finviz starts
blocking requests (403s), consider adding request delays, rotating
User-Agents, or switching to an official data provider.

## API

- `GET /api/movers/:type` — `type` is `gainers` or `losers`. Returns the
  mover list enriched with lending data plus summary stats.
- `GET /api/summary` — both gainers and losers in one response, as used by
  the dashboard.

## Deployment

This is a plain Node/Express app (not a static site) because it needs
server-side fetch access to Finviz. Deploy it anywhere that runs a
long-lived Node process (Render, Railway, Fly.io, a VPS, etc.) with:

```bash
npm install
npm start
```

Set `PORT` if your host requires a specific port.
