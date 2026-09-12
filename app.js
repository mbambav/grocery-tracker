import { CATEGORIES, categoryDefault } from './defaults.js';
import * as gh from './github-store.js';
import { parseReceiptLines, parseReceiptDate } from './receipt-parser.js';
import {
  getPeriodBounds, getPeriodBoundsAtOffset, periodBudget, purchasesInRange, totalSpend, projectedSpend,
  inferLastingDays, nextBuyEstimate, fmtMoney, fmtDate, addDays, toDateOnly,
} from './calc.js';

let config = gh.loadConfig();
let sha = null;
let data = null;
let currentPeriodOffset = 0; // 0 = current period, -1 = previous, etc.
let saveTimer = null;
let saveStatus = 'idle'; // idle | saving | saved | error
let editingPurchaseId = null;
let scanCandidates = null; // null = scan panel closed; [] or [...] once a scan has run
let scanReceiptDate = new Date().toISOString().slice(0, 10);
let scanBuyerId = '';
let scanBusy = false;
let scanError = null;

const root = document.getElementById('app');

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ---------- boot ----------

async function boot() {
  if (!config) {
    renderConnectScreen();
    return;
  }
  renderShell('dashboard');
  setStatus('saving', 'Connecting…');
  try {
    await gh.testConnection(config);
    const loaded = await gh.loadData(config);
    if (loaded.data) {
      data = loaded.data;
      sha = loaded.sha;
    } else {
      data = gh.emptyData();
      sha = await gh.saveData(config, data, null);
    }
    setStatus('saved', 'Synced');
    renderTab('dashboard');
  } catch (err) {
    setStatus('error', err.message);
    renderConnectScreen(err.message);
  }
}

function setStatus(status, message) {
  saveStatus = status;
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.textContent = message;
  el.className = `sync-status sync-status--${status}`;
}

function persist() {
  clearTimeout(saveTimer);
  setStatus('saving', 'Saving…');
  saveTimer = setTimeout(async () => {
    try {
      sha = await gh.saveData(config, data, sha);
      setStatus('saved', 'Saved');
    } catch (err) {
      setStatus('error', err.message);
    }
  }, 600);
}

// ---------- connect screen ----------

function renderConnectScreen(errorMessage) {
  root.innerHTML = `
    <div class="connect-screen">
      <div class="connect-card">
        <h1>Pantry Ledger</h1>
        <p class="connect-sub">Track how long groceries last, and whether you're on pace for the month.</p>
        ${errorMessage ? `<div class="banner banner--danger">${escapeHtml(errorMessage)}</div>` : ''}
        <p class="connect-note">Data is stored as a JSON file in a <strong>private</strong> GitHub repo you control, read and written from your browser. The token below is saved only in this browser's local storage — it is never sent anywhere except GitHub's API.</p>
        <form id="connect-form">
          <label>GitHub username / org
            <input name="owner" required placeholder="e.g. arnav" value="${config?.owner ?? ''}">
          </label>
          <label>Private repo name
            <input name="repo" required placeholder="e.g. grocery-data" value="${config?.repo ?? ''}">
          </label>
          <label>Branch
            <input name="branch" required value="${config?.branch ?? 'main'}">
          </label>
          <label>Data file path
            <input name="path" required value="${config?.path ?? 'data.json'}">
          </label>
          <label>Fine-grained personal access token
            <input name="token" type="password" required placeholder="github_pat_…">
          </label>
          <p class="connect-hint">Create one at github.com → Settings → Developer settings → Fine-grained tokens. Scope it to just this repo, with Contents: Read and write.</p>
          <button type="submit">Connect</button>
        </form>
      </div>
    </div>
  `;
  document.getElementById('connect-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    config = Object.fromEntries(fd.entries());
    gh.saveConfig(config);
    await boot();
  });
}

// ---------- shell ----------

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'purchases', label: 'Purchases' },
  { id: 'items', label: 'Items' },
  { id: 'people', label: 'People' },
  { id: 'reports', label: 'Reports' },
  { id: 'settings', label: 'Settings' },
];

function renderShell(activeTab) {
  root.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">Pantry Ledger</div>
        <nav class="tabs">
          ${TABS.map(t => `<button class="tab ${t.id === activeTab ? 'tab--active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
        </nav>
        <div id="sync-status" class="sync-status">—</div>
      </header>
      <main id="tab-content"></main>
    </div>
  `;
  root.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.tab').forEach(b => b.classList.remove('tab--active'));
      btn.classList.add('tab--active');
      renderTab(btn.dataset.tab);
    });
  });
}

function renderTab(tab) {
  currentPeriodOffset = 0;
  const el = document.getElementById('tab-content');
  if (!el) return;
  const renderers = {
    dashboard: renderDashboard,
    purchases: renderPurchases,
    items: renderItems,
    people: renderPeople,
    reports: renderReports,
    settings: renderSettings,
  };
  renderers[tab](el);
}

// ---------- dashboard ----------

function currentBounds() {
  return getPeriodBoundsAtOffset(data.settings, currentPeriodOffset, new Date());
}

function lenInDays(settings) {
  if (settings.periodType === 'weekly') return 7;
  if (settings.periodType === 'biweekly') return 14;
  const b = getPeriodBounds(settings, new Date());
  return Math.round((toDateOnly(b.end) - toDateOnly(b.start)) / 86400000);
}

function renderDashboard(el) {
  const { start, end } = currentBounds();
  const inPeriod = purchasesInRange(data.purchases, start, end);
  const budget = periodBudget(data.settings, data.people.length);
  const spent = totalSpend(inPeriod);
  const proj = projectedSpend(inPeriod, start, end, new Date());
  const remaining = budget - spent;
  const overPace = proj && proj.projectedTotal > budget;

  const itemRows = data.items.map(item => {
    const est = nextBuyEstimate(item, data.purchases);
    return { item, est };
  }).sort((a, b) => {
    const da = a.est.nextBuyDate ? +toDateOnly(a.est.nextBuyDate) : Infinity;
    const db = b.est.nextBuyDate ? +toDateOnly(b.est.nextBuyDate) : Infinity;
    return da - db;
  });

  el.innerHTML = `
    <div class="period-nav">
      <button id="prev-period">&larr; Prev</button>
      <div class="period-label">${fmtDate(start)} – ${fmtDate(addDays(end, -1))}</div>
      <button id="next-period" ${currentPeriodOffset >= 0 ? 'disabled' : ''}>Next &rarr;</button>
    </div>

    ${overPace ? `<div class="banner banner--danger">On pace to spend ${fmtMoney(proj.projectedTotal)} — ${fmtMoney(proj.projectedTotal - budget)} over your ${fmtMoney(budget)} budget for this period.</div>` : ''}
    ${!overPace && proj ? `<div class="banner banner--ok">On pace to land around ${fmtMoney(proj.projectedTotal)}, within your ${fmtMoney(budget)} budget.</div>` : ''}

    <section class="stat-row">
      <div class="stat-card">
        <div class="stat-label">Budget this period</div>
        <div class="stat-value">${fmtMoney(budget)}</div>
        ${data.people.length > 1 ? `<div class="stat-sub">scaled for ${data.people.length} people</div>` : ''}
      </div>
      <div class="stat-card">
        <div class="stat-label">Spent so far</div>
        <div class="stat-value">${fmtMoney(spent)}</div>
      </div>
      <div class="stat-card ${remaining < 0 ? 'stat-card--danger' : ''}">
        <div class="stat-label">${remaining >= 0 ? 'Remaining' : 'Over budget'}</div>
        <div class="stat-value">${fmtMoney(Math.abs(remaining))}</div>
      </div>
    </section>

    <h2>What to buy next</h2>
    ${itemRows.length === 0 ? `<p class="empty">No items yet — add some in the Items tab, then log purchases to build up history.</p>` : `
    <table class="data-table">
      <thead><tr><th>Item</th><th>Last bought</th><th>Lasts ~</th><th>Next buy</th><th>Source</th></tr></thead>
      <tbody>
        ${itemRows.map(({ item, est }) => `
          <tr class="${est.nextBuyDate && toDateOnly(est.nextBuyDate) <= toDateOnly(new Date()) ? 'row--due' : ''}">
            <td>${escapeHtml(item.name)}</td>
            <td>${est.lastPurchase ? fmtDate(est.lastPurchase.date) : '—'}</td>
            <td>${Math.round(est.lastingDays)} days</td>
            <td>${est.nextBuyDate ? fmtDate(est.nextBuyDate) : 'log a purchase'}</td>
            <td><span class="tag tag--${est.source}">${est.source}</span></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    `}
  `;

  document.getElementById('prev-period').addEventListener('click', () => { currentPeriodOffset -= 1; renderDashboard(el); });
  document.getElementById('next-period').addEventListener('click', () => { currentPeriodOffset += 1; renderDashboard(el); });
}

// ---------- purchases ----------

function renderPurchases(el) {
  const sorted = [...data.purchases].sort((a, b) => toDateOnly(b.date) - toDateOnly(a.date));
  el.innerHTML = `
    <h2>Scan a receipt</h2>
    <div class="scan-panel">
      ${renderScanPanel()}
    </div>

    <h2>Log a purchase manually</h2>
    <form id="purchase-form" class="form-grid">
      <label>Item
        <select name="itemId" required>
          <option value="" disabled selected>Choose…</option>
          ${data.items.map(i => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('')}
        </select>
      </label>
      <label>Date
        <input type="date" name="date" required value="${new Date().toISOString().slice(0, 10)}">
      </label>
      <label>Quantity
        <input type="number" step="any" name="quantity" required value="1">
      </label>
      <label>Unit
        <input name="unit" placeholder="e.g. lb, loaf, gallon">
      </label>
      <label>Price
        <input type="number" step="0.01" name="price" required placeholder="0.00">
      </label>
      <label>Buyer
        <select name="buyerId">
          <option value="">Shared</option>
          ${data.people.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
        </select>
      </label>
      <button type="submit">Add purchase</button>
    </form>
    ${data.items.length === 0 ? `<p class="empty">Add items first, in the Items tab.</p>` : ''}

    <h2>History</h2>
    ${sorted.length === 0 ? `<p class="empty">No purchases logged yet.</p>` : `
    <table class="data-table">
      <thead><tr><th>Date</th><th>Item</th><th>Qty</th><th>Price</th><th>Buyer</th><th>Finished on</th><th></th></tr></thead>
      <tbody>
        ${sorted.map(p => renderPurchaseRow(p)).join('')}
      </tbody>
    </table>
    `}
  `;

  wirePurchaseForm(el);
  wirePurchaseRows(el);
  wireScanPanel(el);
}

function renderPurchaseRow(p) {
  const item = data.items.find(i => i.id === p.itemId);
  const buyer = data.people.find(pp => pp.id === p.buyerId);

  if (p.id === editingPurchaseId) {
    return `
      <tr class="row--editing">
        <td><input type="date" data-edit-field="date" value="${p.date.slice(0, 10)}"></td>
        <td>
          <select data-edit-field="itemId">
            ${data.items.map(i => `<option value="${i.id}" ${i.id === p.itemId ? 'selected' : ''}>${escapeHtml(i.name)}</option>`).join('')}
          </select>
        </td>
        <td>
          <input type="number" step="any" data-edit-field="quantity" value="${p.quantity}" style="width:4.5em">
          <input data-edit-field="unit" value="${escapeHtml(p.unit || '')}" placeholder="unit" style="width:5em">
        </td>
        <td><input type="number" step="0.01" data-edit-field="price" value="${p.price}" style="width:5.5em"></td>
        <td>
          <select data-edit-field="buyerId">
            <option value="">Shared</option>
            ${data.people.map(pp => `<option value="${pp.id}" ${pp.id === p.buyerId ? 'selected' : ''}>${escapeHtml(pp.name)}</option>`).join('')}
          </select>
        </td>
        <td><input type="date" data-edit-field="finishedDate" value="${p.finishedDate ? p.finishedDate.slice(0, 10) : ''}"></td>
        <td>
          <button class="btn-save" data-save-purchase="${p.id}">Save</button>
          <button class="btn-plain" data-cancel-edit="${p.id}">Cancel</button>
        </td>
      </tr>`;
  }

  return `
    <tr>
      <td>${fmtDate(p.date)}</td>
      <td>${item ? escapeHtml(item.name) : '(deleted item)'}</td>
      <td>${p.quantity}${p.unit ? ' ' + escapeHtml(p.unit) : ''}</td>
      <td>${fmtMoney(p.price)}</td>
      <td>${buyer ? escapeHtml(buyer.name) : 'Shared'}</td>
      <td><input type="date" data-finish-id="${p.id}" value="${p.finishedDate ? p.finishedDate.slice(0, 10) : ''}"></td>
      <td>
        <button class="btn-plain" data-edit-purchase="${p.id}">Edit</button>
        <button class="btn-danger" data-del-purchase="${p.id}">Delete</button>
      </td>
    </tr>`;
}

function wirePurchaseForm(el) {
  document.getElementById('purchase-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    data.purchases.push({
      id: uid(),
      itemId: fd.get('itemId'),
      date: fd.get('date'),
      quantity: Number(fd.get('quantity')),
      unit: fd.get('unit') || '',
      price: Number(fd.get('price')),
      buyerId: fd.get('buyerId') || null,
      finishedDate: null,
    });
    persist();
    renderPurchases(el);
  });
}

function wirePurchaseRows(el) {
  el.querySelectorAll('[data-finish-id]').forEach(input => {
    input.addEventListener('change', () => {
      const p = data.purchases.find(x => x.id === input.dataset.finishId);
      p.finishedDate = input.value || null;
      persist();
    });
  });

  el.querySelectorAll('[data-del-purchase]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Delete this purchase?')) return;
      data.purchases = data.purchases.filter(p => p.id !== btn.dataset.delPurchase);
      persist();
      renderPurchases(el);
    });
  });

  el.querySelectorAll('[data-edit-purchase]').forEach(btn => {
    btn.addEventListener('click', () => {
      editingPurchaseId = btn.dataset.editPurchase;
      renderPurchases(el);
    });
  });

  el.querySelectorAll('[data-cancel-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      editingPurchaseId = null;
      renderPurchases(el);
    });
  });

  el.querySelectorAll('[data-save-purchase]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.savePurchase;
      const p = data.purchases.find(x => x.id === id);
      const row = btn.closest('tr');
      const get = (field) => row.querySelector(`[data-edit-field="${field}"]`).value;
      p.date = get('date');
      p.itemId = get('itemId');
      p.quantity = Number(get('quantity'));
      p.unit = get('unit');
      p.price = Number(get('price'));
      p.buyerId = get('buyerId') || null;
      p.finishedDate = get('finishedDate') || null;
      editingPurchaseId = null;
      persist();
      renderPurchases(el);
    });
  });
}

// ---------- receipt scanning ----------

function renderScanPanel() {
  if (scanCandidates === null) {
    return `
      <p class="section-note">Take or upload a photo of a receipt. Text recognition happens in your browser — nothing is uploaded anywhere. It's often wrong about item names and quantities, so you'll review everything before it's saved.</p>
      <input type="file" id="receipt-input" accept="image/*" capture="environment">
      <button id="scan-btn" disabled>Scan receipt</button>
      ${scanError ? `<div class="banner banner--danger">${escapeHtml(scanError)}</div>` : ''}
    `;
  }

  if (scanBusy) {
    return `<p id="scan-progress" class="section-note">Reading receipt… this can take 10–30 seconds.</p>`;
  }

  if (scanCandidates.length === 0) {
    return `
      <div class="banner banner--danger">Couldn't find any price lines on that image. Try a clearer, flatter photo, or add purchases manually below.</div>
      <button id="scan-reset">Try another photo</button>
    `;
  }

  return `
    <p class="section-note">Found ${scanCandidates.length} candidate line${scanCandidates.length === 1 ? '' : 's'}. Fix anything wrong, uncheck anything that isn't actually an item (leftover totals/discounts sometimes slip through), then add them.</p>
    <div class="form-grid">
      <label>Receipt date
        <input type="date" id="scan-date" value="${scanReceiptDate}">
      </label>
      <label>Buyer
        <select id="scan-buyer">
          <option value="">Shared</option>
          ${data.people.map(p => `<option value="${p.id}" ${p.id === scanBuyerId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
        </select>
      </label>
    </div>
    <table class="data-table scan-table">
      <thead><tr><th></th><th>Name</th><th>Match to item</th><th>Qty</th><th>Price</th></tr></thead>
      <tbody>
        ${scanCandidates.map((c, idx) => `
          <tr class="${c.include ? '' : 'row--excluded'}">
            <td><input type="checkbox" data-scan-include="${idx}" ${c.include ? 'checked' : ''}></td>
            <td><input data-scan-name="${idx}" value="${escapeHtml(c.name)}"></td>
            <td>
              <select data-scan-match="${idx}">
                <option value="">+ New item</option>
                ${data.items.map(i => `<option value="${i.id}" ${c.itemId === i.id ? 'selected' : ''}>${escapeHtml(i.name)}</option>`).join('')}
              </select>
              ${!c.itemId ? `
                <select data-scan-category="${idx}">
                  ${CATEGORIES.map(cat => `<option value="${cat.id}" ${c.category === cat.id ? 'selected' : ''}>${cat.label}</option>`).join('')}
                </select>
              ` : ''}
            </td>
            <td><input type="number" step="any" data-scan-qty="${idx}" value="${c.quantity}" style="width:4.5em"></td>
            <td><input type="number" step="0.01" data-scan-price="${idx}" value="${c.price}" style="width:5.5em"></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <button id="scan-commit">Add ${scanCandidates.filter(c => c.include).length} purchase${scanCandidates.filter(c => c.include).length === 1 ? '' : 's'}</button>
    <button id="scan-reset" class="btn-plain">Discard scan</button>
  `;
}

function wireScanPanel(el) {
  const panel = el.querySelector('.scan-panel');

  const fileInput = document.getElementById('receipt-input');
  const scanBtn = document.getElementById('scan-btn');
  if (fileInput && scanBtn) {
    fileInput.addEventListener('change', () => { scanBtn.disabled = !fileInput.files.length; });
    scanBtn.addEventListener('click', () => runScan(fileInput.files[0], panel));
  }

  const resetBtn = document.getElementById('scan-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      scanCandidates = null;
      scanError = null;
      panel.innerHTML = renderScanPanel();
      wireScanPanel(el);
    });
  }

  const dateInput = document.getElementById('scan-date');
  if (dateInput) dateInput.addEventListener('change', () => { scanReceiptDate = dateInput.value; });

  const buyerSelect = document.getElementById('scan-buyer');
  if (buyerSelect) buyerSelect.addEventListener('change', () => { scanBuyerId = buyerSelect.value; });

  el.querySelectorAll('[data-scan-include]').forEach(cb => {
    cb.addEventListener('change', () => { scanCandidates[cb.dataset.scanInclude].include = cb.checked; refreshScanPanel(panel, el); });
  });
  el.querySelectorAll('[data-scan-name]').forEach(inp => {
    inp.addEventListener('input', () => { scanCandidates[inp.dataset.scanName].name = inp.value; });
  });
  el.querySelectorAll('[data-scan-qty]').forEach(inp => {
    inp.addEventListener('input', () => { scanCandidates[inp.dataset.scanQty].quantity = Number(inp.value); });
  });
  el.querySelectorAll('[data-scan-price]').forEach(inp => {
    inp.addEventListener('input', () => { scanCandidates[inp.dataset.scanPrice].price = Number(inp.value); });
  });
  el.querySelectorAll('[data-scan-match]').forEach(sel => {
    sel.addEventListener('change', () => { scanCandidates[sel.dataset.scanMatch].itemId = sel.value; refreshScanPanel(panel, el); });
  });
  el.querySelectorAll('[data-scan-category]').forEach(sel => {
    sel.addEventListener('change', () => { scanCandidates[sel.dataset.scanCategory].category = sel.value; });
  });

  const commitBtn = document.getElementById('scan-commit');
  if (commitBtn) commitBtn.addEventListener('click', () => commitScan(el));
}

function refreshScanPanel(panel, el) {
  panel.innerHTML = renderScanPanel();
  wireScanPanel(el);
}

async function runScan(file, panel) {
  if (!file) return;
  scanBusy = true;
  scanError = null;
  scanCandidates = [];
  panel.innerHTML = renderScanPanel();

  try {
    const mod = await import('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js');
    const Tesseract = mod.default || mod;
    const { data: ocr } = await Tesseract.recognize(file, 'eng', {
      logger: (m) => {
        const p = document.getElementById('scan-progress');
        if (p && m.status) p.textContent = `${m.status}${m.progress ? ` — ${Math.round(m.progress * 100)}%` : ''}`;
      },
    });

    const parsed = parseReceiptLines(ocr.text);
    const guessedDate = parseReceiptDate(ocr.text);
    if (guessedDate) scanReceiptDate = guessedDate;

    scanCandidates = parsed.map(c => ({
      ...c,
      include: true,
      itemId: matchExistingItem(c.name),
      category: guessCategory(c.name),
    }));
  } catch (err) {
    scanError = `Scan failed: ${err.message}. You can still add purchases manually below.`;
    scanCandidates = null;
  } finally {
    scanBusy = false;
    panel.innerHTML = renderScanPanel();
    wireScanPanel(panel.closest('#tab-content'));
  }
}

function matchExistingItem(name) {
  const norm = name.toLowerCase();
  const exact = data.items.find(i => i.name.toLowerCase() === norm);
  if (exact) return exact.id;
  const partial = data.items.find(i => norm.includes(i.name.toLowerCase()) || i.name.toLowerCase().includes(norm));
  return partial ? partial.id : '';
}

function guessCategory(name) {
  const norm = name.toLowerCase();
  const hit = CATEGORIES.find(c => norm.includes(c.id.split('-')[1] || '___'));
  return hit ? hit.id : 'other';
}

function commitScan(el) {
  const included = scanCandidates.filter(c => c.include);
  included.forEach(c => {
    let itemId = c.itemId;
    if (!itemId) {
      itemId = uid();
      data.items.push({
        id: itemId,
        name: c.name,
        category: c.category || 'other',
        shelfLifeDays: null,
        shared: !scanBuyerId,
      });
    }
    data.purchases.push({
      id: uid(),
      itemId,
      date: scanReceiptDate,
      quantity: c.quantity || 1,
      unit: '',
      price: c.price,
      buyerId: scanBuyerId || null,
      finishedDate: null,
    });
  });
  scanCandidates = null;
  persist();
  renderPurchases(el);
}


// ---------- items ----------

function renderItems(el) {
  el.innerHTML = `
    <h2>Add an item</h2>
    <form id="item-form" class="form-grid">
      <label>Name
        <input name="name" required placeholder="e.g. Milk">
      </label>
      <label>Category
        <select name="category" required>
          ${CATEGORIES.map(c => `<option value="${c.id}">${c.label}</option>`).join('')}
        </select>
      </label>
      <label>Shelf life override (days)
        <input type="number" name="shelfLifeDays" placeholder="uses category default if blank">
      </label>
      <label class="checkbox-label">
        <input type="checkbox" name="shared" checked> Shared item (not tied to one person)
      </label>
      <button type="submit">Add item</button>
    </form>

    <h2>Your items</h2>
    ${data.items.length === 0 ? `<p class="empty">No items yet.</p>` : `
    <table class="data-table">
      <thead><tr><th>Name</th><th>Category</th><th>Default shelf life</th><th>Shared</th><th></th></tr></thead>
      <tbody>
        ${data.items.map(i => `
          <tr>
            <td>${escapeHtml(i.name)}</td>
            <td>${categoryDefault(i.category).label}</td>
            <td>${i.shelfLifeDays || categoryDefault(i.category).shelfLifeDays} days</td>
            <td>${i.shared ? 'Shared' : 'Individual'}</td>
            <td><button class="btn-danger" data-del-item="${i.id}">Delete</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    `}
  `;

  document.getElementById('item-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    data.items.push({
      id: uid(),
      name: fd.get('name'),
      category: fd.get('category'),
      shelfLifeDays: fd.get('shelfLifeDays') ? Number(fd.get('shelfLifeDays')) : null,
      shared: fd.get('shared') === 'on',
    });
    persist();
    renderItems(el);
  });

  el.querySelectorAll('[data-del-item]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.delItem;
      data.items = data.items.filter(i => i.id !== id);
      data.purchases = data.purchases.filter(p => p.itemId !== id);
      persist();
      renderItems(el);
    });
  });
}

// ---------- people ----------

function renderPeople(el) {
  el.innerHTML = `
    <h2>Household</h2>
    <p class="section-note">Adding people scales the budget up (not by simple doubling — see the marginal factor in Settings) and lets you tag individually-bought items to a person.</p>
    <form id="person-form" class="form-grid">
      <label>Name
        <input name="name" required placeholder="e.g. Arnav">
      </label>
      <button type="submit">Add person</button>
    </form>
    ${data.people.length === 0 ? `<p class="empty">Just you, so far — budget isn't scaled.</p>` : `
    <table class="data-table">
      <thead><tr><th>Name</th><th></th></tr></thead>
      <tbody>
        ${data.people.map(p => `
          <tr><td>${escapeHtml(p.name)}</td><td><button class="btn-danger" data-del-person="${p.id}">Remove</button></td></tr>
        `).join('')}
      </tbody>
    </table>
    `}
  `;
  document.getElementById('person-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    data.people.push({ id: uid(), name: fd.get('name') });
    persist();
    renderPeople(el);
  });
  el.querySelectorAll('[data-del-person]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.delPerson;
      data.people = data.people.filter(p => p.id !== id);
      data.purchases.forEach(p => { if (p.buyerId === id) p.buyerId = null; });
      persist();
      renderPeople(el);
    });
  });
}

// ---------- reports ----------

function listPastPeriods(n = 12) {
  const periods = [];
  for (let i = 0; i <= n; i++) {
    periods.push(getPeriodBoundsAtOffset(data.settings, -i, new Date()));
  }
  return periods;
}

function renderReports(el) {
  const periods = listPastPeriods();
  el.innerHTML = `
    <h2>Reports</h2>
    <label>Period
      <select id="report-period">
        ${periods.map((p, idx) => `<option value="${idx}">${fmtDate(p.start)} – ${fmtDate(addDays(p.end, -1))}</option>`).join('')}
      </select>
    </label>
    <div id="report-body"></div>
  `;
  const select = document.getElementById('report-period');
  const renderBody = () => {
    const p = periods[Number(select.value)];
    const inPeriod = purchasesInRange(data.purchases, p.start, p.end);
    const spent = totalSpend(inPeriod);
    const budget = periodBudget(data.settings, data.people.length);
    const byItem = {};
    inPeriod.forEach(pu => {
      if (!byItem[pu.itemId]) byItem[pu.itemId] = [];
      byItem[pu.itemId].push(pu);
    });

    document.getElementById('report-body').innerHTML = `
      <div class="stat-row">
        <div class="stat-card"><div class="stat-label">Total spent</div><div class="stat-value">${fmtMoney(spent)}</div></div>
        <div class="stat-card"><div class="stat-label">Budget</div><div class="stat-value">${fmtMoney(budget)}</div></div>
        <div class="stat-card ${spent > budget ? 'stat-card--danger' : ''}"><div class="stat-label">${spent > budget ? 'Over by' : 'Under by'}</div><div class="stat-value">${fmtMoney(Math.abs(budget - spent))}</div></div>
      </div>
      ${Object.keys(byItem).length === 0 ? `<p class="empty">No purchases in this period.</p>` : `
      <table class="data-table">
        <thead><tr><th>Item</th><th>Times bought</th><th>Total spent</th><th>Avg lasting</th><th>Suggestion</th></tr></thead>
        <tbody>
          ${Object.entries(byItem).map(([itemId, pl]) => {
            const item = data.items.find(i => i.id === itemId);
            const lasting = inferLastingDays(item, data.purchases);
            const periodLen = lenInDays(data.settings);
            const suggestion = lasting.days < periodLen / pl.length * 0.6
              ? 'Running out early — consider buying more per trip'
              : lasting.days > periodLen * 1.5
                ? 'Lasting a long time — consider buying less or less often'
                : 'On a reasonable cadence';
            return `
            <tr>
              <td>${item ? escapeHtml(item.name) : '(deleted)'}</td>
              <td>${pl.length}</td>
              <td>${fmtMoney(totalSpend(pl))}</td>
              <td>${Math.round(lasting.days)} days (${lasting.source})</td>
              <td>${suggestion}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      `}
    `;
  };
  select.addEventListener('change', renderBody);
  renderBody();
}

// ---------- settings ----------

function renderSettings(el) {
  const s = data.settings;
  el.innerHTML = `
    <h2>Budget</h2>
    <form id="settings-form" class="form-grid">
      <label>Budget amount
        <input type="number" step="0.01" name="budgetAmount" value="${s.budgetAmount}" required>
      </label>
      <label>…per
        <select name="budgetInputType">
          <option value="weekly" ${s.budgetInputType === 'weekly' ? 'selected' : ''}>Week</option>
          <option value="biweekly" ${s.budgetInputType === 'biweekly' ? 'selected' : ''}>Two weeks</option>
          <option value="monthly" ${s.budgetInputType === 'monthly' ? 'selected' : ''}>Month</option>
        </select>
      </label>
      <label>Track dashboard by
        <select name="periodType">
          <option value="weekly" ${s.periodType === 'weekly' ? 'selected' : ''}>Week</option>
          <option value="biweekly" ${s.periodType === 'biweekly' ? 'selected' : ''}>Two weeks</option>
          <option value="monthly" ${s.periodType === 'monthly' ? 'selected' : ''}>Month</option>
        </select>
      </label>
      <label>Period starts on
        <input type="date" name="periodAnchorDate" value="${s.periodAnchorDate}">
      </label>
      <label>Multi-person marginal factor
        <input type="number" step="0.05" min="0" max="1" name="marginalFactor" value="${s.marginalFactor}">
      </label>
      <p class="section-note">Budget scales as base × (1 + factor × (people − 1)) — so a factor of 0.6 means each extra person adds 60% of the base, not a full 100%, since some items are shared. Set to 0 for a flat per-period budget regardless of household size, or 1 for straight per-person multiplication.</p>
      <button type="submit">Save settings</button>
    </form>

    <h2>Connection</h2>
    <p class="section-note">Connected to <code>${escapeHtml(config.owner)}/${escapeHtml(config.repo)}</code> (${escapeHtml(config.path)} on ${escapeHtml(config.branch)}).</p>
    <button id="disconnect" class="btn-danger">Disconnect this browser</button>
  `;

  document.getElementById('settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    data.settings = {
      ...s,
      budgetAmount: Number(fd.get('budgetAmount')),
      budgetInputType: fd.get('budgetInputType'),
      periodType: fd.get('periodType'),
      periodAnchorDate: fd.get('periodAnchorDate'),
      marginalFactor: Number(fd.get('marginalFactor')),
    };
    persist();
  });

  document.getElementById('disconnect').addEventListener('click', () => {
    if (confirm('This only forgets the connection on this browser — your data stays in the GitHub repo. Continue?')) {
      gh.clearConfig();
      config = null;
      data = null;
      renderConnectScreen();
    }
  });
}

// ---------- utils ----------

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

boot();
