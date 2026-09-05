const state = {
  summary: null,
  activeTab: 'gainers',
};

const els = {
  summaryGrid: document.getElementById('summaryGrid'),
  squeezeSection: document.getElementById('squeezeSection'),
  squeezeCards: document.getElementById('squeezeCards'),
  moversBody: document.getElementById('moversBody'),
  updatedAt: document.getElementById('updatedAt'),
  refreshBtn: document.getElementById('refreshBtn'),
  tabs: document.querySelectorAll('.tab'),
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
  const { gainers, losers, volatile, updatedAt } = state.summary;

  els.updatedAt.textContent = `Updated ${new Date(updatedAt).toLocaleTimeString()}`;

  els.summaryGrid.innerHTML = `
    ${statCard('Gainers Scanned', gainers.count)}
    ${statCard('Losers Scanned', losers.count)}
    ${statCard('Most Volatile Scanned', volatile.count)}
    ${statCard('Hard-to-Borrow (Gainers)', gainers.hardToBorrowCount)}
    ${statCard('Hard-to-Borrow (Losers)', losers.hardToBorrowCount)}
    ${statCard('Hard-to-Borrow (Volatile)', volatile.hardToBorrowCount)}
    ${statCard('Avg Borrow Fee — Gainers', gainers.avgFeeRatePct != null ? `${gainers.avgFeeRatePct}%` : '—')}
    ${statCard('Avg Borrow Fee — Losers', losers.avgFeeRatePct != null ? `${losers.avgFeeRatePct}%` : '—')}
    ${statCard('Avg Borrow Fee — Volatile', volatile.avgFeeRatePct != null ? `${volatile.avgFeeRatePct}%` : '—')}
  `;

  const squeezeCandidates = dedupeByTicker([
    ...gainers.squeezeCandidates,
    ...losers.squeezeCandidates,
    ...volatile.squeezeCandidates,
  ]);
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

function dedupeByTicker(movers) {
  const seen = new Set();
  return movers.filter((m) => (seen.has(m.ticker) ? false : (seen.add(m.ticker), true)));
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
