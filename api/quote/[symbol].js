import { getQuote } from '../../src/yahoo.js';

export default async function handler(req, res) {
  const { symbol } = req.query;
  try {
    const quote = await getQuote(symbol.toUpperCase());
    if (!quote) return res.status(404).json({ error: `No quote found for ${symbol}` });
    res.json(quote);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch live quote', detail: err.message });
  }
}
