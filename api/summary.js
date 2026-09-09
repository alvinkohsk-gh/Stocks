import { getMoversCached, summarize } from '../src/movers.js';

export default async function handler(req, res) {
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
}
