import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchMovers } from './src/finviz.js';
import { getMockLending } from './src/lending.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

async function getMoversCached(type) {
  const cached = cache.get(type);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }
  const data = await fetchMovers(type);
  cache.set(type, { data, ts: Date.now() });
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
  if (!['gainers', 'losers', 'volatile'].includes(type)) {
    return res.status(400).json({ error: 'type must be "gainers", "losers", or "volatile"' });
  }
  try {
    const movers = await getMoversCached(type);
    res.json({ type, updatedAt: new Date().toISOString(), ...summarize(movers) });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch data from Finviz', detail: err.message });
  }
});

app.get('/api/summary', async (req, res) => {
  try {
    const [gainers, losers, volatile] = await Promise.all([
      getMoversCached('gainers'),
      getMoversCached('losers'),
      getMoversCached('volatile'),
    ]);
    res.json({
      updatedAt: new Date().toISOString(),
      gainers: summarize(gainers),
      losers: summarize(losers),
      volatile: summarize(volatile),
    });
  } catch (err) {
    res.status(502).json({ error: 'Failed to build summary', detail: err.message });
  }
});

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  app.listen(PORT, () => {
    console.log(`stokc running on http://localhost:${PORT}`);
  });
}

export default app;
