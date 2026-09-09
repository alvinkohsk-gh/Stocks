const state = {
  summary: null,
  activeTab: 'gainers',
  watchlist: loadWatchlist(),
  quotes: new Map(), // symbol -> { price, change, changePct }
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
};

const WATCHLIST_STORAGE_KEY = 'stokc.watchlist';

function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveWatchlist() {
  try {
    localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(state.watchlist));
  } catch {
    // ignore storage failures (private browsing, quota, etc.)
  }
}

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

function renderTable() {
  const data = state.summary?.[state.activeTab];
  if (!data || !data.results.length) {
    els.moversBody.innerHTML = `<tr><td colspan="9" class="empty">No data available.</td></tr>`;
    return;
  }

  els.moversBody.innerHTML = data.results
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

// --- Live watchlist (server polls Yahoo Finance, pushes over WebSocket) ---

let ws = null;
let wsReconnectTimer = null;

function connectLiveFeed() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.addEventListener('open', () => {
    state.watchlist.forEach((symbol) => ws.send(JSON.stringify({ type: 'subscribe', symbol })));
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === 'tick') {
      const prev = state.quotes.get(msg.symbol);
      const basePrice = prev?.basePrice ?? msg.price;
      state.quotes.set(msg.symbol, {
        price: msg.price,
        basePrice,
        change: msg.price - basePrice,
        changePct: basePrice ? ((msg.price - basePrice) / basePrice) * 100 : null,
        flash: prev && msg.price > prev.price ? 'up' : prev && msg.price < prev.price ? 'down' : null,
      });
      renderWatchlist();
    }
  });

  ws.addEventListener('close', () => {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(connectLiveFeed, 3000);
  });
}

async function seedInitialQuote(symbol) {
  try {
    const res = await fetch(`/api/quote/${encodeURIComponent(symbol)}`);
    if (!res.ok) return;
    const q = await res.json();
    state.quotes.set(symbol, {
      price: q.price,
      basePrice: q.prevClose ?? q.price,
      change: q.change,
      changePct: q.changePct,
      flash: null,
    });
    renderWatchlist();
  } catch {
    // live feed may be unavailable; row will just show placeholders
  }
}

function addToWatchlist(symbol) {
  symbol = symbol.toUpperCase().trim();
  if (!symbol || state.watchlist.includes(symbol)) return;
  state.watchlist.push(symbol);
  saveWatchlist();
  seedInitialQuote(symbol);
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'subscribe', symbol }));
  }
  renderWatchlist();
}

function removeFromWatchlist(symbol) {
  state.watchlist = state.watchlist.filter((s) => s !== symbol);
  state.quotes.delete(symbol);
  saveWatchlist();
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'unsubscribe', symbol }));
  }
  renderWatchlist();
}

function renderWatchlist() {
  if (!state.watchlist.length) {
    els.watchlistBody.innerHTML = `<tr><td colspan="5" class="empty">No symbols yet — add one above.</td></tr>`;
    return;
  }

  els.watchlistBody.innerHTML = state.watchlist
    .map((symbol) => {
      const q = state.quotes.get(symbol);
      const changeClass = q?.changePct == null ? '' : q.changePct >= 0 ? 'change-pos' : 'change-neg';
      const flashClass = q?.flash === 'up' ? 'flash-up' : q?.flash === 'down' ? 'flash-down' : '';
      return `
      <tr>
        <td class="ticker-cell">${escapeHtml(symbol)}</td>
        <td class="num ${flashClass}">${q ? fmtMoney(q.price) : '—'}</td>
        <td class="num ${changeClass}">${q?.change != null ? (q.change >= 0 ? '+' : '') + q.change.toFixed(2) : '—'}</td>
        <td class="num ${changeClass}">${q?.changePct != null ? fmtPct(q.changePct) : '—'}</td>
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

loadSummary();
renderWatchlist();
state.watchlist.forEach(seedInitialQuote);
connectLiveFeed();
