// Simulated Interactive Brokers short-sale lending data.
//
// IBKR's real short-borrow availability (Stock Loan Availability / SLB tool)
// requires an authenticated brokerage session and isn't publicly queryable,
// so this module generates plausible, deterministic-per-day figures instead.
// Values are seeded from the ticker + today's date, so a given symbol shows
// consistent numbers throughout the day but shifts from day to day. This is
// for demo/UI purposes only — never trade on it.

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const todayKey = () => new Date().toISOString().slice(0, 10);

const ASSUMED_BENCHMARK_RATE_PCT = 5.25; // placeholder short-term rate used only for the mock rebate calc

export function getMockLending(ticker) {
  const rand = mulberry32(hashString(`${ticker}-${todayKey()}`));
  const r = rand();

  let category;
  let feeRatePct;
  let availableShares;

  if (r < 0.55) {
    category = 'Easy to Borrow';
    feeRatePct = +(0.25 + rand() * 1.0).toFixed(2);
    availableShares = Math.round(500_000 + rand() * 20_000_000);
  } else if (r < 0.85) {
    category = 'Hard to Borrow';
    feeRatePct = +(3 + rand() * 12).toFixed(2);
    availableShares = Math.round(5_000 + rand() * 300_000);
  } else if (r < 0.96) {
    category = 'Very Hard to Borrow';
    feeRatePct = +(15 + rand() * 60).toFixed(2);
    availableShares = Math.round(500 + rand() * 20_000);
  } else {
    category = 'Not Available';
    feeRatePct = null;
    availableShares = 0;
  }

  const rebateRatePct =
    category === 'Easy to Borrow' ? +(ASSUMED_BENCHMARK_RATE_PCT - feeRatePct).toFixed(2) : null;

  return {
    category,
    borrowable: category !== 'Not Available',
    feeRatePct,
    rebateRatePct,
    availableShares,
    asOf: new Date().toISOString(),
    source: 'simulated',
  };
}
