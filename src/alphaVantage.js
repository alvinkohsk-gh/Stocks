// Live US market movers via Alpha Vantage's TOP_GAINERS_LOSERS endpoint.
// https://www.alphavantage.co/documentation/#top-gainer-losers
//
// One call returns both gainers and losers (no signup-per-request, no
// scraping). Alpha Vantage's free tier does not expose intraday high/low,
// so there is no true volatility (e.g. ATR) metric available here — "most
// volatile" is derived as the biggest absolute movers across gainers and
// losers combined, which is the closest equivalent this endpoint supports.

const ENDPOINT = 'https://www.alphavantage.co/query';

export async function fetchTopMovers() {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    throw new Error('ALPHA_VANTAGE_API_KEY environment variable is not set');
  }

  const url = `${ENDPOINT}?function=TOP_GAINERS_LOSERS&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Alpha Vantage request failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  // Rate-limit/invalid-key responses come back as HTTP 200 with one of these fields.
  const notice = json.Note || json.Information || json['Error Message'];
  if (notice) {
    throw new Error(notice);
  }

  const gainers = (json.top_gainers || []).map(toMover);
  const losers = (json.top_losers || []).map(toMover);
  const volatile = [...gainers, ...losers]
    .sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0))
    .slice(0, 20);

  return { gainers, losers, volatile, lastUpdated: json.last_updated || null };
}

function toMover(row) {
  return {
    ticker: row.ticker,
    price: parseFloat(row.price),
    changePct: parseFloat(row.change_percentage),
    volume: parseInt(row.volume, 10) || null,
  };
}
