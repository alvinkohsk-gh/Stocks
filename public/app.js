const WATCHLIST_STORAGE_KEY = 'stock.watchlist';

// Some browsers (private/incognito windows, strict cookie/storage settings)
// throw on localStorage access instead of just failing quietly. Detect that
// up front so we can warn instead of silently losing the watchlist on the
// next page load. This must run before `state` below, since state.watchlist
// calls loadWatchlist() immediately.
function checkStorageAvailable() {
  try {
    const testKey = '__stock_storage_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

const storageAvailable = checkStorageAvailable();

function loadWatchlist() {
  if (!storageAvailable) return [];
  try {
    const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveWatchlist() {
  if (!storageAvailable) return;
  try {
    localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(state.watchlist));
  } catch {
    // ignore storage failures (quota exceeded, etc.)
  }
}

const state = {
  summary: null,
  activeTab: 'gainers',
  watchlist: loadWatchlist(),
  quotes: new Map(), // symbol -> { price, change, changePct, volume, marketState, extendedPrice, extendedChangePct, sparkline }
  moversSort: { key: null, dir: 1 },
  watchlistSort: { key: null, dir: 1 },
};

const els = {
  summaryGrid: document.getElementById('summaryGrid'),
  squeezeSection: document.getElementById('squeezeSection'),
  squeezeCards: document.getElementById('squeezeCards'),
  moversBody: document.getElementById('moversBody'),
  updatedAt: document.getElementById('updatedAt'),
  refreshBtn: document.getElementById('refreshBtn'),
  tabs: document.querySelectorAll('.tab'),
  watchlistForm: document.getElementById('watchlistForm'),
  symbolInput: document.getElementById('symbolInput'),
  searchResults: document.getElementById('searchResults'),
  watchlistBody: document.getElementById('watchlistBody'),
  storageWarning: document.getElementById('storageWarning'),
};

const BADGE_CLASS = {
  'Easy to Borrow': 'badge-easy',
  'Hard to Borrow': 'badge-hard',
  'Very Hard to Borrow': 'badge-vhard',
  'Not Available': 'badge-none',
};

function fmtNum(n, opts = {}) {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('en-US', opts);
}

function fmtPct(n) {
  if (n === null || n === undefined) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function fmtMoney(n) {
  if (n === null || n === undefined) return '—';
  return `$${n.toFixed(2)}`;
}

// Generic click-to-sort: rows are re-sorted by `getValue(row, key)`, nulls
// always sink to the bottom regardless of direction. Clicking the same
// column again flips direction; clicking a new column starts ascending.
function sortRows(rows, sortState, getValue) {
  if (!sortState.key) return rows;
  const { key, dir } = sortState;
  return [...rows].sort((a, b) => {
    const va = getValue(a, key);
    const vb = getValue(b, key);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'string' || typeof vb === 'string') {
      return dir * String(va).localeCompare(String(vb));
    }
    return dir * (va - vb);
  });
}

function wireSortableHeaders(table, sortState, onSort) {
  table.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortState.key === key) {
        sortState.dir *= -1;
      } else {
        sortState.key = key;
        sortState.dir = 1;
      }
      table.querySelectorAll('th.sortable').forEach((h) => h.classList.remove('sort-asc', 'sort-desc'));
      th.classList.add(sortState.dir === 1 ? 'sort-asc' : 'sort-desc');
      onSort();
    });
  });
}

// Tiny inline SVG line chart from a handful of intraday closing prices.
function renderSparkline(points) {
  if (!points || points.length < 2) return '<span class="muted">—</span>';
  const w = 70;
  const h = 24;
  const pad = 2;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = (w - pad * 2) / (points.length - 1);
  const coords = points
    .map((p, i) => {
      const x = pad + i * step;
      const y = pad + (1 - (p - min) / range) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const trendClass = points[points.length - 1] >= points[0] ? 'spark-up' : 'spark-down';
  return `<svg class="sparkline ${trendClass}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${coords}" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>`;
}

const MARKET_STATE_LABEL = { PRE: 'PRE', POST: 'AH' };

function marketStateBadge(marketState) {
  const label = MARKET_STATE_LABEL[marketState];
  return label ? `<span class="market-badge">${label}</span>` : '';
}

async function loadSummary() {
  els.refreshBtn.disabled = true;
  els.refreshBtn.textContent = 'Loading…';
  try {
    const res = await fetch('/api/summary');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.summary = await res.json();
    render();
  } catch (err) {
    els.moversBody.innerHTML = `<tr><td colspan="9" class="empty">Failed to load data: ${escapeHtml(err.message)}</td></tr>`;
  } finally {
    els.refreshBtn.disabled = false;
    els.refreshBtn.textContent = 'Refresh';
  }
}

function render() {
  if (!state.summary) return;
  const { gainers, losers, updatedAt } = state.summary;

  els.updatedAt.textContent = `Updated ${new Date(updatedAt).toLocaleTimeString()}`;

  els.summaryGrid.innerHTML = `
    ${statCard('Gainers Scanned', gainers.count)}
    ${statCard('Losers Scanned', losers.count)}
    ${statCard('Hard-to-Borrow (Gainers)', gainers.hardToBorrowCount)}
    ${statCard('Hard-to-Borrow (Losers)', losers.hardToBorrowCount)}
    ${statCard('Avg Borrow Fee — Gainers', gainers.avgFeeRatePct != null ? `${gainers.avgFeeRatePct}%` : '—')}
    ${statCard('Avg Borrow Fee — Losers', losers.avgFeeRatePct != null ? `${losers.avgFeeRatePct}%` : '—')}
  `;

  const squeezeCandidates = [...gainers.squeezeCandidates, ...losers.squeezeCandidates];
  if (squeezeCandidates.length) {
    els.squeezeSection.hidden = false;
    els.squeezeCards.innerHTML = squeezeCandidates
      .map(
        (m) => `
      <div class="squeeze-card">
        <div class="ticker">${escapeHtml(m.ticker)} <span class="${m.changePct >= 0 ? 'change-pos' : 'change-neg'}">${fmtPct(m.changePct)}</span></div>
        <div class="meta">${escapeHtml(m.company || '')}</div>
        <div class="meta">${m.lending.category} · ${m.lending.feeRatePct != null ? m.lending.feeRatePct + '% fee' : 'no borrow'} · ${fmtNum(m.lending.availableShares)} shares</div>
      </div>`
      )
      .join('');
  } else {
    els.squeezeSection.hidden = true;
  }

  renderTable();
}

function statCard(label, value) {
  return `<div class="stat-card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(String(value))}</div></div>`;
}

const MOVERS_SORT_GETTERS = {
  ticker: (m) => m.ticker,
  price: (m) => m.price,
  changePct: (m) => m.changePct,
  volume: (m) => m.volume,
  feeRatePct: (m) => m.lending.feeRatePct,
  availableShares: (m) => m.lending.availableShares,
};

function renderTable() {
  const data = state.summary?.[state.activeTab];
  if (!data || !data.results.length) {
    els.moversBody.innerHTML = `<tr><td colspan="9" class="empty">No data available.</td></tr>`;
    return;
  }

  const rows = sortRows(data.results, state.moversSort, (m, key) => MOVERS_SORT_GETTERS[key](m));

  els.moversBody.innerHTML = rows
    .map((m) => {
      const changeClass = (m.changePct ?? 0) >= 0 ? 'change-pos' : 'change-neg';
      const badgeClass = BADGE_CLASS[m.lending.category] || 'badge-none';
      return `
      <tr>
        <td class="ticker-cell">${escapeHtml(m.ticker)}</td>
        <td>${escapeHtml(m.company || '—')}</td>
        <td>${escapeHtml(m.sector || '—')}</td>
        <td class="num">${fmtMoney(m.price)}</td>
        <td class="num ${changeClass}">${fmtPct(m.changePct)}</td>
        <td class="num">${fmtNum(m.volume)}</td>
        <td><span class="badge ${badgeClass}">${escapeHtml(m.lending.category)}</span></td>
        <td class="num">${m.lending.feeRatePct != null ? m.lending.feeRatePct + '%' : '—'}</td>
        <td class="num">${fmtNum(m.lending.availableShares)}</td>
      </tr>`;
    })
    .join('');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

// --- Live watchlist (browser polls a serverless quote endpoint) ---
//
// Vercel-friendly: no persistent connection needed, just a per-symbol
// interval that fetches /api/quote/:symbol and re-renders on change.

const POLL_INTERVAL_MS = 5000;
const pollers = new Map(); // symbol -> interval handle

async function pollQuote(symbol) {
  try {
    const res = await fetch(`/api/quote/${encodeURIComponent(symbol)}`);
    if (!res.ok) return;
    const q = await res.json();
    const prev = state.quotes.get(symbol);
    state.quotes.set(symbol, {
      price: q.price,
      change: q.change,
      changePct: q.changePct,
      volume: q.volume,
      marketState: q.marketState,
      extendedPrice: q.extendedPrice,
      extendedChangePct: q.extendedChangePct,
      sparkline: q.sparkline,
      flash: prev && q.price > prev.price ? 'up' : prev && q.price < prev.price ? 'down' : null,
    });
    renderWatchlist();
  } catch {
    // transient network error; next poll will retry
  }
}

function startPolling(symbol) {
  if (pollers.has(symbol)) return;
  pollQuote(symbol);
  pollers.set(symbol, setInterval(() => pollQuote(symbol), POLL_INTERVAL_MS));
}

function stopPolling(symbol) {
  const handle = pollers.get(symbol);
  if (handle) clearInterval(handle);
  pollers.delete(symbol);
}

function addToWatchlist(symbol) {
  symbol = symbol.toUpperCase().trim();
  if (!symbol || state.watchlist.includes(symbol)) return;
  state.watchlist.push(symbol);
  saveWatchlist();
  startPolling(symbol);
  renderWatchlist();
}

function removeFromWatchlist(symbol) {
  state.watchlist = state.watchlist.filter((s) => s !== symbol);
  state.quotes.delete(symbol);
  saveWatchlist();
  stopPolling(symbol);
  renderWatchlist();
}

const WATCHLIST_SORT_GETTERS = {
  symbol: (symbol) => symbol,
  price: (symbol) => state.quotes.get(symbol)?.price,
  change: (symbol) => state.quotes.get(symbol)?.change,
  changePct: (symbol) => state.quotes.get(symbol)?.changePct,
  volume: (symbol) => state.quotes.get(symbol)?.volume,
};

function renderWatchlist() {
  if (!state.watchlist.length) {
    els.watchlistBody.innerHTML = `<tr><td colspan="7" class="empty">No symbols yet — add one above.</td></tr>`;
    return;
  }

  const symbols = sortRows(state.watchlist, state.watchlistSort, (symbol, key) => WATCHLIST_SORT_GETTERS[key](symbol));

  els.watchlistBody.innerHTML = symbols
    .map((symbol) => {
      const q = state.quotes.get(symbol);
      const changeClass = q?.changePct == null ? '' : q.changePct >= 0 ? 'change-pos' : 'change-neg';
      const flashClass = q?.flash === 'up' ? 'flash-up' : q?.flash === 'down' ? 'flash-down' : '';
      const extended =
        q?.extendedPrice != null
          ? `<div class="extended-price">${marketStateBadge(q.marketState)} ${fmtMoney(q.extendedPrice)} ${
              q.extendedChangePct != null ? fmtPct(q.extendedChangePct) : ''
            }</div>`
          : '';
      return `
      <tr>
        <td class="ticker-cell">${escapeHtml(symbol)}</td>
        <td>${renderSparkline(q?.sparkline)}</td>
        <td class="num ${flashClass}">${q ? fmtMoney(q.price) : '—'}${extended}</td>
        <td class="num ${changeClass}">${q?.change != null ? (q.change >= 0 ? '+' : '') + q.change.toFixed(2) : '—'}</td>
        <td class="num ${changeClass}">${q?.changePct != null ? fmtPct(q.changePct) : '—'}</td>
        <td class="num">${q?.volume != null ? fmtNum(q.volume) : '—'}</td>
        <td><button class="remove-btn" data-symbol="${escapeHtml(symbol)}" title="Remove">✕</button></td>
      </tr>`;
    })
    .join('');

  els.watchlistBody.querySelectorAll('.remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => removeFromWatchlist(btn.dataset.symbol));
  });
}

let searchDebounce = null;
els.symbolInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  const q = els.symbolInput.value.trim();
  if (!q) {
    els.searchResults.hidden = true;
    return;
  }
  searchDebounce = setTimeout(async () => {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) {
        els.searchResults.hidden = true;
        return;
      }
      const { results } = await res.json();
      if (!results.length) {
        els.searchResults.hidden = true;
        return;
      }
      els.searchResults.hidden = false;
      els.searchResults.innerHTML = results
        .map((r) => `<div class="search-result" data-symbol="${escapeHtml(r.symbol)}">${escapeHtml(r.symbol)} <span class="muted">${escapeHtml(r.name)}</span></div>`)
        .join('');
      els.searchResults.querySelectorAll('.search-result').forEach((el) => {
        el.addEventListener('click', () => {
          addToWatchlist(el.dataset.symbol);
          els.symbolInput.value = '';
          els.searchResults.hidden = true;
        });
      });
    } catch {
      els.searchResults.hidden = true;
    }
  }, 300);
});

els.watchlistForm.addEventListener('submit', (e) => {
  e.preventDefault();
  addToWatchlist(els.symbolInput.value);
  els.symbolInput.value = '';
  els.searchResults.hidden = true;
});

els.tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    els.tabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    state.activeTab = tab.dataset.tab;
    renderTable();
  });
});

els.refreshBtn.addEventListener('click', loadSummary);

wireSortableHeaders(document.getElementById('moversTable'), state.moversSort, renderTable);
wireSortableHeaders(document.getElementById('watchlistTable'), state.watchlistSort, renderWatchlist);

loadSummary();
els.storageWarning.hidden = storageAvailable;
renderWatchlist();
state.watchlist.forEach(startPolling);
