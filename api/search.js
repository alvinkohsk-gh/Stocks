import { symbolLookup } from '../src/yahoo.js';

export default async function handler(req, res) {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'q query param is required' });
  try {
    res.json({ results: await symbolLookup(q) });
  } catch (err) {
    res.status(502).json({ error: 'Symbol search failed', detail: err.message });
  }
}
