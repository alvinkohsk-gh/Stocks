import * as cheerio from 'cheerio';

const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

const SCREENER_URLS = {
  gainers: 'https://finviz.com/screener.ashx?v=111&s=ta_topgainers',
  losers: 'https://finviz.com/screener.ashx?v=111&s=ta_toplosers',
  volatile: 'https://finviz.com/screener.ashx?v=111&s=ta_mostvolatile',
};

export async function fetchMovers(type) {
  const url = SCREENER_URLS[type];
  if (!url) throw new Error(`Unknown mover type: ${type}`);

  const res = await fetch(url, { headers: REQUEST_HEADERS });
  if (!res.ok) {
    throw new Error(`Finviz request failed: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  return parseScreenerTable(html);
}

// Finviz periodically changes its table's CSS classes, so instead of relying
// on class names we locate the header row generically (by its "Ticker"/
// "Price" labels) and read data rows positionally from the same table.
function parseScreenerTable(html) {
  const $ = cheerio.load(html);

  let headerRow = null;
  $('tr').each((_, tr) => {
    const labels = $(tr)
      .find('th,td')
      .map((__, c) => $(c).text().trim().toLowerCase())
      .get();
    if (labels.includes('ticker') && labels.includes('price')) {
      headerRow = tr;
      return false;
    }
  });

  if (!headerRow) {
    throw new Error('Could not locate Finviz screener table — page markup may have changed');
  }

  const headers = $(headerRow)
    .find('th,td')
    .map((_, c) => $(c).text().trim())
    .get();
  const colIndex = (name) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  const idx = {
    ticker: colIndex('Ticker'),
    company: colIndex('Company'),
    sector: colIndex('Sector'),
    industry: colIndex('Industry'),
    price: colIndex('Price'),
    change: colIndex('Change'),
    volume: colIndex('Volume'),
  };

  const table = $(headerRow).closest('table');
  const rows = [];

  table.find('tr').each((_, tr) => {
    if (tr === headerRow) return;
    const cells = $(tr).find('td');
    if (cells.length === 0) return;

    const text = (i) => (i >= 0 ? $(cells.get(i)).text().trim() : '');
    const ticker = text(idx.ticker);
    if (!ticker || !/^[A-Z][A-Z.\-]{0,9}$/.test(ticker)) return;

    rows.push({
      ticker,
      company: text(idx.company),
      sector: text(idx.sector),
      industry: text(idx.industry),
      price: parseNumber(text(idx.price)),
      changePct: parseNumber(text(idx.change)),
      volume: parseVolume(text(idx.volume)),
    });
  });

  return rows;
}

function parseNumber(value) {
  if (!value) return null;
  const num = parseFloat(value.replace(/[^0-9.\-]/g, ''));
  return Number.isNaN(num) ? null : num;
}

function parseVolume(value) {
  if (!value) return null;
  const cleaned = value.replace(/,/g, '');
  const num = parseFloat(cleaned);
  if (Number.isNaN(num)) return null;
  if (/K$/i.test(cleaned)) return Math.round(num * 1e3);
  if (/M$/i.test(cleaned)) return Math.round(num * 1e6);
  if (/B$/i.test(cleaned)) return Math.round(num * 1e9);
  return Math.round(num);
}
