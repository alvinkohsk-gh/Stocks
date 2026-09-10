import { getMovers } from './yahoo.js';
import { getMockLending } from './lending.js';

// Yahoo's screener already returns live quote data, so the whole mover row
// (ticker + price + change) is fresh on every fetch. We still cache briefly
// to avoid hammering the endpoint if the dashboard is refreshed rapidly.
// Note: on serverless deploys each instance keeps its own cache, so this is
// a best-effort optimization rather than a guaranteed single fetch.
const MOVERS_CACHE_TTL_MS = 30 * 1000;
const moversCache = new Map();

export async function getMoversCached(type) {
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

export function summarize(movers) {
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
