# Stokc

Stock monitoring dashboard: a live watchlist streamed over WebSocket from
Finnhub's real-time trade feed, plus a daily scan of Finviz's biggest
gainers/losers (with prices refreshed from the same live quote API) paired
with a short-sale lending summary modeled on Interactive Brokers' borrow
availability metrics.

## What it does

- **Live watchlist**: search for any US-listed symbol, add it to your
  watchlist, and see its price tick in real time as trades happen —
  streamed server-side from [Finnhub](https://finnhub.io)'s WebSocket trade
  feed and pushed to the browser over its own WebSocket. No polling delay.
- Scrapes [Finviz](https://finviz.com)'s public screener to discover the
  day's Top Gainers and Top Losers (`ta_topgainers` / `ta_toplosers`
  views), then overlays live Finnhub quotes on top so the price/% change
  shown is accurate to the last live trade rather than Finviz's own cache.
- For each ticker, attaches a short-lending summary: borrow status (Easy /
  Hard / Very Hard to Borrow / Not Available), annualized fee rate, and
  shares available.
- Surfaces a "Squeeze Watch" list: big movers that are also very hard or
  impossible to borrow — the combination that tends to precede short
  squeezes.
- Caches the Finviz-derived ticker list for 5 minutes (that list barely
  changes minute to minute); live prices are never cached.

## Live market data (Finnhub)

Set `FINNHUB_API_KEY` to enable real-time quotes, symbol search, and the
live watchlist feed. Get a free key at https://finnhub.io/register (free
tier covers US equities real-time quotes + trade WebSocket, with rate
limits).

```bash
export FINNHUB_API_KEY=your_key_here
npm start
```

Without a key, the app still runs: mover tickers/prices fall back to
Finviz's own screener data, and the watchlist/search endpoints return a 503
explaining that live quotes aren't configured.

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
- `GET /api/quote/:symbol` — live Finnhub quote for any symbol (503 if
  `FINNHUB_API_KEY` isn't set).
- `GET /api/search?q=` — symbol/company search for the watchlist's add box.
- `GET /api/status` — whether live quotes are enabled.
- `WS /ws` — subscribe to live trade ticks: send
  `{"type":"subscribe","symbol":"AAPL"}`, receive
  `{"type":"tick","symbol":"AAPL","price":...,"volume":...,"ts":...}`
  messages as trades happen. Send `{"type":"unsubscribe","symbol":"AAPL"}`
  to stop.

## Deployment

This is a plain Node/Express app (not a static site) because it needs
server-side fetch access to Finviz. Deploy it anywhere that runs a
long-lived Node process (Render, Railway, Fly.io, a VPS, etc.) with:

```bash
npm install
npm start
```

Set `PORT` if your host requires a specific port.
