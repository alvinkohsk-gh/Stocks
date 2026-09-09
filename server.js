import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { getMockLending } from './src/lending.js';
import { getQuote, getMovers, symbolLookup } from './src/yahoo.js';
import { LiveFeed } from './src/liveFeed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Yahoo's screener already returns live quote data, so the whole mover row
// (ticker + price + change) is fresh on every fetch. We still cache briefly
// to avoid hammering the endpoint if the dashboard is refreshed rapidly.
const MOVERS_CACHE_TTL_MS = 30 * 1000;
const moversCache = new Map();

async function getMoversCached(type) {
  const cached = moversCache.get(type);
  if (cached && Date.now() - cached.ts < MOVERS_CACHE_TTL_MS) {
    return cached.data;
  }
  const data = await getMovers(type);
  moversCache.set(type, { data, ts: Date.now() });
  return data;
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
    const movers = await getMoversCached(type);
    res.json({ type, updatedAt: new Date().toISOString(), ...summarize(movers) });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch data from Yahoo Finance', detail: err.message });
  }
});

app.get('/api/summary', async (req, res) => {
  try {
    const [gainers, losers] = await Promise.all([getMoversCached('gainers'), getMoversCached('losers')]);
    res.json({
      updatedAt: new Date().toISOString(),
      gainers: summarize(gainers),
      losers: summarize(losers),
    });
  } catch (err) {
    res.status(502).json({ error: 'Failed to build summary', detail: err.message });
  }
});

// Live quote for an arbitrary symbol, used by the watchlist.
app.get('/api/quote/:symbol', async (req, res) => {
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
  try {
    res.json({ results: await symbolLookup(q) });
  } catch (err) {
    res.status(502).json({ error: 'Symbol search failed', detail: err.message });
  }
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
const liveFeed = new LiveFeed();
wss.on('connection', (ws) => liveFeed.addClient(ws));

httpServer.listen(PORT, () => {
  console.log(`stokc running on http://localhost:${PORT}`);
});
