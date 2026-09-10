import { getMoversCached, summarize } from '../../src/movers.js';

export default async function handler(req, res) {
  const { type } = req.query;
  if (!['gainers', 'losers'].includes(type)) {
    return res.status(400).json({ error: 'type must be "gainers" or "losers"' });
  }
  try {
    const movers = await getMoversCached(type);
    res.json({ type, updatedAt: new Date().toISOString(), ...summarize(movers) });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch data from Yahoo Finance', detail: err.message });
  }
}
