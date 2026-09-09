import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fetchMovers } from './src/finviz.js';
import { getMockLending } from './src/lending.js';
import { getQuote, getQuotes, symbolLookup, hasFinnhubKey } from './src/finnhub.js';
import { LiveFeed } from './src/liveFeed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// The list of which tickers are today's biggest movers barely changes
// minute to minute, so it's safe to cache. Their *prices*, on the other
// hand, are refreshed live from Finnhub on every request (see withLiveQuotes)
// so percent moves shown to the user stay accurate to the last live trade.
const TICKER_LIST_CACHE_TTL_MS = 5 * 60 * 1000;
const tickerListCache = new Map();

async function getMoversCached(type) {
  const cached = tickerListCache.get(type);
  if (cached && Date.now() - cached.ts < TICKER_LIST_CACHE_TTL_MS) {
    return cached.data;
  }
  const data = await fetchMovers(type);
  tickerListCache.set(type, { data, ts: Date.now() });
  return data;
}

// Overlays live Finnhub quotes onto the Finviz-sourced rows, when a
// FINNHUB_API_KEY is configured. Falls back to Finviz's own price/change
// fields otherwise (still fresh within the 5-minute screener cache).
async function withLiveQuotes(movers) {
  if (!hasFinnhubKey()) return movers;
  const quotes = await getQuotes(movers.map((m) => m.ticker));
  const bySymbol = new Map(quotes.map((q) => [q.symbol, q]));
  return movers.map((m) => {
    const live = bySymbol.get(m.ticker);
    if (!live) return m;
    return {
      ...m,
      price: live.price,
      changePct: live.changePct,
      quoteSource: 'finnhub-live',
      quoteAsOf: live.asOf,
    };
  });
}

function withLending(movers) {
  return movers.map((m) => ({ ...m, lending: getMockLending(m.ticker) }));
}

function summarize(movers) {
  const enriched = withLending(movers);
  const fees = enriched.filter((m) => m.lending.feeRatePct != null).map((m) => m.lending.feeRatePct);
  const avgFeeRatePct = fees.length ? +(fees.reduce((s, f) => s + f, 0) / fees.length).toFixed(2) : null;
  const hardToBorrowCount = enriched.filter((m) =>
    ['Hard to Borrow', 'Very Hard to Borrow', 'Not Available'].includes(m.lending.category)
  ).length;
  const squeezeCandidates = enriched
    .filter((m) => ['Very Hard to Borrow', 'Not Available'].includes(m.lending.category))
    .sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0))
    .slice(0, 5);

  return {
    count: enriched.length,
    hardToBorrowCount,
    avgFeeRatePct,
    squeezeCandidates,
    results: enriched,
  };
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/movers/:type', async (req, res) => {
  const { type } = req.params;
  if (!['gainers', 'losers'].includes(type)) {
    return res.status(400).json({ error: 'type must be "gainers" or "losers"' });
  }
  try {
    const movers = await withLiveQuotes(await getMoversCached(type));
    res.json({ type, updatedAt: new Date().toISOString(), liveQuotes: hasFinnhubKey(), ...summarize(movers) });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch data from Finviz', detail: err.message });
  }
});

app.get('/api/summary', async (req, res) => {
  try {
    const [gainers, losers] = await Promise.all([
      getMoversCached('gainers').then(withLiveQuotes),
      getMoversCached('losers').then(withLiveQuotes),
    ]);
    res.json({
      updatedAt: new Date().toISOString(),
      liveQuotes: hasFinnhubKey(),
      gainers: summarize(gainers),
      losers: summarize(losers),
    });
  } catch (err) {
    res.status(502).json({ error: 'Failed to build summary', detail: err.message });
  }
});

// Live quote for an arbitrary symbol, used by the watchlist.
app.get('/api/quote/:symbol', async (req, res) => {
  if (!hasFinnhubKey()) {
    return res.status(503).json({ error: 'Live quotes unavailable: FINNHUB_API_KEY is not configured' });
  }
  try {
    const quote = await getQuote(req.params.symbol.toUpperCase());
    if (!quote) return res.status(404).json({ error: `No quote found for ${req.params.symbol}` });
    res.json(quote);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch live quote', detail: err.message });
  }
});

app.get('/api/search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'q query param is required' });
  if (!hasFinnhubKey()) {
    return res.status(503).json({ error: 'Symbol search unavailable: FINNHUB_API_KEY is not configured' });
  }
  try {
    res.json({ results: await symbolLookup(q) });
  } catch (err) {
    res.status(502).json({ error: 'Symbol search failed', detail: err.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({ liveQuotes: hasFinnhubKey() });
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
const liveFeed = new LiveFeed();
wss.on('connection', (ws) => liveFeed.addClient(ws));

httpServer.listen(PORT, () => {
  console.log(`stokc running on http://localhost:${PORT}`);
  console.log(hasFinnhubKey() ? 'Live Finnhub quotes: enabled' : 'Live Finnhub quotes: disabled (set FINNHUB_API_KEY)');
});
