# Stokc

Stock monitoring dashboard: a live watchlist that updates every few seconds
over WebSocket, plus a scan of today's biggest gainers/losers, all powered
by Yahoo Finance's public (no account, no API key) endpoints — paired with
a short-sale lending summary modeled on Interactive Brokers' borrow
availability metrics.

## What it does

- **Live watchlist**: search for any symbol, add it to your watchlist, and
  watch its price update in real time. The server polls Yahoo Finance every
  ~5 seconds per watched symbol and pushes updates to the browser over its
  own WebSocket (`/ws`) — the browser never polls itself.
- Pulls the day's Top Gainers and Top Losers from Yahoo Finance's
  `day_gainers` / `day_losers` predefined screener — the same data backing
  finance.yahoo.com's own movers pages.
- For each ticker, attaches a short-lending summary: borrow status (Easy /
  Hard / Very Hard to Borrow / Not Available), annualized fee rate, and
  shares available.
- Surfaces a "Squeeze Watch" list: big movers that are also very hard or
  impossible to borrow — the combination that tends to precede short
  squeezes.
- Caches the movers list for 30 seconds to avoid hammering the endpoint on
  rapid dashboard refreshes; watchlist quotes are polled fresh continuously.

## Live market data (no account needed)

This app uses Yahoo Finance's unofficial public endpoints
(`query1.finance.yahoo.com`), which require no signup, no API key, and no
account — just run it:

```bash
npm install
npm start
```

**Caveats of going keyless:** these endpoints aren't officially documented
or guaranteed stable, prices can lag the real tape by anywhere from a few
seconds to ~15–20 minutes depending on the exchange/feed, and Yahoo can
rate-limit or block an IP that polls too aggressively. If you need
guaranteed real-time data or hit reliability problems, swap `src/yahoo.js`
for a registered provider (Finnhub, Alpha Vantage, Polygon.io, IEX Cloud,
etc. all offer free tiers with an API key) — the rest of the app (caching,
the watchlist WebSocket relay, the UI) doesn't need to change, only the
`getQuote` / `getMovers` / `symbolLookup` implementations.

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

## API

- `GET /api/movers/:type` — `type` is `gainers` or `losers`. Returns the
  mover list enriched with lending data plus summary stats.
- `GET /api/summary` — both gainers and losers in one response, as used by
  the dashboard.
- `GET /api/quote/:symbol` — live quote for any symbol.
- `GET /api/search?q=` — symbol/company search for the watchlist's add box.
- `WS /ws` — subscribe to live price updates: send
  `{"type":"subscribe","symbol":"AAPL"}`, receive
  `{"type":"tick","symbol":"AAPL","price":...,"change":...,"changePct":...,"ts":...}`
  messages roughly every 5 seconds while subscribed. Send
  `{"type":"unsubscribe","symbol":"AAPL"}` to stop.

## Deployment

This is a plain Node/Express app (not a static site) because it needs
server-side fetch access to Yahoo Finance and a long-lived process for the
WebSocket relay. Deploy it anywhere that runs a long-lived Node process
(Render, Railway, Fly.io, a VPS, etc.) with:

```bash
npm install
npm start
```

Set `PORT` if your host requires a specific port.
