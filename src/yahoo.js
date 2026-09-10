// Client for Yahoo Finance's public (unofficial, keyless) endpoints.
//
// No account or API key is required. These endpoints aren't formally
// documented or guaranteed stable, but they're the standard no-signup
// source for live-ish quotes: query1.finance.yahoo.com serves chart/quote
// data and a predefined "day gainers/losers" screener that the finance.yahoo.com
// site itself uses. If Yahoo changes or blocks these paths, that's the
// tradeoff of not requiring registration — see README for a paid-key
// alternative if that becomes a problem.

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

async function yahooGet(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Yahoo Finance request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// Live-ish quote (delayed a few seconds to a couple minutes depending on
// exchange) built from the same chart data Yahoo's own site polls.
export async function getQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
  const data = await yahooGet(url);
  const result = data.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || meta.regularMarketPrice == null) return null;

  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
  const change = prevClose != null ? price - prevClose : null;
  const changePct = prevClose ? (change / prevClose) * 100 : null;

  return {
    symbol: meta.symbol || symbol,
    price,
    change,
    changePct,
    high: meta.regularMarketDayHigh ?? null,
    low: meta.regularMarketDayLow ?? null,
    open: meta.regularMarketOpen ?? null,
    prevClose,
    volume: meta.regularMarketVolume ?? null,
    asOf: new Date((meta.regularMarketTime || Date.now() / 1000) * 1000).toISOString(),
    source: 'yahoo-live',
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
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
  const data = await yahooGet(url);
  return (data.quotes || [])
    .filter((q) => q.quoteType === 'EQUITY' && q.symbol)
    .slice(0, 10)
    .map((q) => ({ symbol: q.symbol, name: q.shortname || q.longname || q.symbol }));
}

const SCREENER_IDS = {
  gainers: 'day_gainers',
  losers: 'day_losers',
};

// Yahoo's predefined screener — the same data backing finance.yahoo.com's
// own "Top Gainers"/"Top Losers" pages. Returns already-live quote data,
// so no separate quote lookup is needed to enrich these rows.
export async function getMovers(type) {
  const scrId = SCREENER_IDS[type];
  if (!scrId) throw new Error(`Unknown mover type: ${type}`);

  const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?count=25&scrIds=${scrId}`;
  const data = await yahooGet(url);
  const quotes = data.finance?.result?.[0]?.quotes || [];

  return quotes.map((q) => ({
    ticker: q.symbol,
    company: q.shortName || q.longName || q.symbol,
    sector: null,
    industry: null,
    price: q.regularMarketPrice ?? null,
    changePct: q.regularMarketChangePercent ?? null,
    volume: q.regularMarketVolume ?? null,
  }));
}
