import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getQuote, symbolLookup } from './src/yahoo.js';
import { getMoversCached, summarize } from './src/movers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

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

// Live quote for an arbitrary symbol, polled by the browser's watchlist.
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

app.listen(PORT, () => {
  console.log(`stokc running on http://localhost:${PORT}`);
});
