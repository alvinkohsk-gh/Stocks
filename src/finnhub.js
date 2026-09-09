// Thin client for Finnhub's REST + WebSocket APIs, used to pull real-time
// quotes and trade ticks. Finnhub's free tier covers US equities with
// second-level quote data and a live trade WebSocket feed, which is what
// gives this app its "most accurate, timely" price movements — the Finviz
// scraper below is only used to discover *which* tickers are moving, not
// their live price.
//
// Requires FINNHUB_API_KEY. Get a free key at https://finnhub.io/register.

const FINNHUB_REST_BASE = 'https://finnhub.io/api/v1';

export function hasFinnhubKey() {
  return Boolean(process.env.FINNHUB_API_KEY);
}

async function finnhubGet(path, params = {}) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) throw new Error('FINNHUB_API_KEY is not set');

  const url = new URL(`${FINNHUB_REST_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set('token', apiKey);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Finnhub request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// Real-time quote: current price, change, percent change, day high/low/open,
// previous close. Finnhub updates this from live exchange trades.
export async function getQuote(symbol) {
  const q = await finnhubGet('/quote', { symbol });
  if (q.c == null || q.c === 0) return null;
  return {
    symbol,
    price: q.c,
    change: q.d,
    changePct: q.dp,
    high: q.h,
    low: q.l,
    open: q.o,
    prevClose: q.pc,
    asOf: new Date((q.t || Date.now() / 1000) * 1000).toISOString(),
    source: 'finnhub-live',
  };
}

export async function getQuotes(symbols) {
  const results = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        return await getQuote(symbol);
      } catch {
        return null;
      }
    })
  );
  return results.filter(Boolean);
}

export async function symbolLookup(query) {
  const data = await finnhubGet('/search', { q: query });
  return (data.result || [])
    .filter((r) => r.type === 'Common Stock' && !r.symbol.includes('.'))
    .slice(0, 10)
    .map((r) => ({ symbol: r.symbol, name: r.description }));
}

export const FINNHUB_WS_URL = (apiKey) => `wss://ws.finnhub.io?token=${apiKey}`;
